// Loads a preprocessed Earth region (see scripts/build-regions.ts) and turns
// it into simulation input, and scores the model's towns against reality.
import type { ResourceSite, TerrainInput } from '../sim/grid';
import type { Settlement } from '../sim/types';
import { REGION_DEFS } from './regionDefs';

export interface RealCity { name: string; lon: number; lat: number; x: number; y: number; pop: number; capital: string; country: string }

export interface RegionMeta {
  id: string; W: number; H: number; cellKm: number; bbox: [number, number, number, number];
  latTop: number; latBottom: number;
  inflows: { name: string; cell: number; q: number }[];
  cities: RealCity[];
  resources: { kind: ResourceSite['kind']; name: string; cell: number }[];
}

const cache = new Map<string, { meta: RegionMeta; terrain: TerrainInput }>();

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const b = new Uint8Array(buf);
  if (!(b[0] === 0x1f && b[1] === 0x8b)) return buf; // already decoded by the server
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return await new Response(stream).arrayBuffer();
}

export async function loadRegion(id: string): Promise<{ meta: RegionMeta; terrain: TerrainInput }> {
  const hit = cache.get(id);
  if (hit) return { meta: hit.meta, terrain: cloneTerrain(hit.terrain) };
  const base = `${import.meta.env.BASE_URL}regions/${id}`;
  const [metaRes, binRes] = await Promise.all([fetch(`${base}.json`), fetch(`${base}.bin.gz`)]);
  if (!metaRes.ok || !binRes.ok) throw new Error(`Could not load region data for ${id}`);
  const meta = (await metaRes.json()) as RegionMeta;
  const buf = await gunzip(await binRes.arrayBuffer());
  const N = meta.W * meta.H;
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const elev = new Float32Array(N);
  const mask = bytes.slice(N * 2, N * 3);
  const burn = bytes.slice(N * 3, N * 4);
  for (let i = 0; i < N; i++) {
    let e = dv.getInt16(i * 2, true);
    if (mask[i] === 0 && e < 1) e = 1; // polders and depressions stay land
    if (mask[i] === 1 && e > -5) e = -5;
    elev[i] = e;
  }
  const def = REGION_DEFS.find((d) => d.id === id)!;
  const terrain: TerrainInput = {
    W: meta.W, H: meta.H, cellKm: meta.cellKm, elev,
    latTop: meta.latTop, latBottom: meta.latBottom,
    waterMask: mask, riverBurn: burn,
    inflow: meta.inflows.filter((f) => f.cell >= 0).map((f) => ({ cell: f.cell, q: f.q })),
    precipScale: def.precipScale, precipBase: def.precipBase, wind: def.wind ?? 'auto',
    resources: meta.resources.map((r, i) => ({ id: i, kind: r.kind, cell: r.cell, richness: 0.9 })),
  };
  cache.set(id, { meta, terrain });
  return { meta, terrain: cloneTerrain(terrain) };
}

function cloneTerrain(t: TerrainInput): TerrainInput {
  return { ...t, elev: Float32Array.from(t.elev), waterMask: t.waterMask && Uint8Array.from(t.waterMask), riverBurn: t.riverBurn && Uint8Array.from(t.riverBurn), resources: t.resources?.map((r) => ({ ...r })) };
}

export interface MatchResult {
  k: number;
  matched: { real: RealCity; model: Settlement; km: number; modelRank: number; realRank: number }[];
  missed: RealCity[];
  phantoms: Settlement[];
  score: number; // 0..100: share of real cities with a model town nearby (weighted by size)
  sizeScore: number; // -100..100: rank correlation of sizes among matched cities
  radiusKm: number;
  baseline: number; // score that the same number of randomly placed towns would get
  candidates: number;
}

/**
 * For each of the K largest real cities (suburbs merged into their city),
 * is there a model town (market town, port or bigger) within the radius?
 * Matching is one-to-one, biggest real cities first, nearest town first.
 */
export function scoreRegion(meta: RegionMeta, settlements: Settlement[], k = 20, landMask?: Uint8Array): MatchResult {
  const radiusKm = Math.max(30, meta.cellKm * 6);
  const real: RealCity[] = [];
  for (const c of [...meta.cities].sort((a, b) => b.pop - a.pop)) {
    if (real.length >= k) break;
    if (real.some((r) => Math.hypot(r.x - c.x, r.y - c.y) * meta.cellKm < radiusKm * 0.8)) continue;
    real.push(c);
  }
  const live = settlements.filter((s) => !s.abandoned).sort((a, b) => b.pop - a.pop);
  const rankOf = new Map(live.map((s, i) => [s.id, i + 1]));
  // the model gets 3 guesses per real city: its 3K biggest places
  const towns = live.slice(0, real.length * 3);
  const used = new Set<number>();
  const matched: MatchResult['matched'] = [];
  const missed: RealCity[] = [];
  real.forEach((r, ri) => {
    // prefer the biggest town within the radius (a city, not a satellite)
    let best: Settlement | null = null, bestKey = -Infinity, bd = 0;
    for (const m of towns) {
      if (used.has(m.id)) continue;
      const d = Math.hypot(m.x - r.x, m.y - r.y) * meta.cellKm;
      if (d > radiusKm) continue;
      const key = Math.log(m.pop) - d / radiusKm;
      if (key > bestKey) { bestKey = key; best = m; bd = d; }
    }
    if (best) { used.add(best.id); matched.push({ real: r, model: best, km: bd, modelRank: rankOf.get(best.id)!, realRank: ri + 1 }); }
    else missed.push(r);
  });
  const phantoms = live.slice(0, real.length).filter((m) => !used.has(m.id));
  const wsum = real.reduce((a, _r, i) => a + 1 / Math.sqrt(i + 1), 0);
  const msum = real.reduce((a, r, i) => a + (matched.some((m) => m.real === r) ? 1 / Math.sqrt(i + 1) : 0), 0);
  // Spearman rank correlation of size among matched pairs
  let sizeScore = 0;
  if (matched.length >= 3) {
    const n = matched.length;
    const rr = rankWithin(matched.map((m) => m.realRank));
    const mr = rankWithin(matched.map((m) => m.modelRank));
    const d2 = rr.reduce((a, v, i) => a + (v - mr[i]) ** 2, 0);
    sizeScore = Math.round(100 * (1 - (6 * d2) / (n * (n * n - 1))));
  }
  const score = Math.round((100 * msum) / wsum);
  const baseline = landMask ? randomBaseline(meta, real, towns.length, radiusKm, landMask, wsum) : 0;
  return { k: real.length, matched, missed, phantoms, score, sizeScore, radiusKm, baseline, candidates: towns.length };
}

/** Average score of the same number of towns dropped at random on land (fixed seed). */
function randomBaseline(meta: RegionMeta, real: RealCity[], n: number, radiusKm: number, landMask: Uint8Array, wsum: number): number {
  const land: number[] = [];
  for (let i = 0; i < landMask.length; i++) if (landMask[i] === 0) land.push(i);
  if (!land.length) return 0;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let total = 0;
  const trials = 25;
  for (let t = 0; t < trials; t++) {
    const pts = Array.from({ length: n }, () => land[Math.floor(rnd() * land.length)]);
    const used = new Set<number>();
    let m = 0;
    real.forEach((r, ri) => {
      let best = -1, bd = Infinity;
      pts.forEach((c, j) => {
        if (used.has(j)) return;
        const d = Math.hypot((c % meta.W) + 0.5 - r.x, Math.floor(c / meta.W) + 0.5 - r.y) * meta.cellKm;
        if (d < bd) { bd = d; best = j; }
      });
      if (best >= 0 && bd <= radiusKm) { used.add(best); m += 1 / Math.sqrt(ri + 1); }
    });
    total += (100 * m) / wsum;
  }
  return Math.round(total / trials);
}

function rankWithin(v: number[]): number[] {
  const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(v.length);
  idx.forEach(([, i], r) => { out[i] = r + 1; });
  return out;
}
