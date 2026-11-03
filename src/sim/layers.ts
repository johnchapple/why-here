// Land-value layers: fertility, forest, marsh, defensibility, harbour quality
// and resource sites.
import {
  DX, DY, ResourceKind, ResourceSite, WATER_LAND, WATER_OCEAN, boxBlur, clamp, distanceTo, smoothstep,
} from './grid';
import { evapotranspiration } from './climate';
import { Hydro } from './hydrology';
import { makeRng } from './rng';
import { Simplex } from './noise';
import type { TerrainInput } from './grid';

export interface Layers {
  fertility: Float32Array;
  forest: Float32Array;
  marsh: Float32Array;
  defense: Float32Array;
  harbor: Float32Array;
  coastDist: Float32Array;
}

export function computeLayers(t: TerrainInput, h: Hydro): Layers {
  const { W, H, elev, cellKm } = t;
  const N = W * H;
  const { water, discharge, river, temp, precip, slope, qRiver } = h;

  // Distance to rivers (cells) and height above the nearby river: floodplains.
  const bigRiver = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (river[i] && discharge[i] >= qRiver * 2) bigRiver[i] = 1;
  const dRiver = distanceTo(bigRiver, W, H);
  // Local river level: blur of elevation over river cells only.
  const rivElev = new Float32Array(N), rivW = new Float32Array(N);
  for (let i = 0; i < N; i++) if (bigRiver[i]) { rivElev[i] = elev[i]; rivW[i] = 1; }
  const rE = boxBlur(rivElev, W, H, 3, 2), rW = boxBlur(rivW, W, H, 3, 2);

  const landMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) landMask[i] = water[i] ? 1 : 0;
  const dWater = distanceTo(landMask, W, H); // land: distance to water
  const seaMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) seaMask[i] = water[i] ? 0 : 1;
  const dLand = distanceTo(seaMask, W, H); // water: distance to land
  const coastDist = new Float32Array(N);
  for (let i = 0; i < N; i++) coastDist[i] = water[i] ? dLand[i] : dWater[i];

  const fertility = new Float32Array(N);
  const forest = new Float32Array(N);
  const marsh = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (water[i]) continue;
    const T = temp[i];
    const et = evapotranspiration(T);
    const ratio = precip[i] / et;
    const tS = smoothstep(-3, 9, T) * (1 - smoothstep(29, 36, T));
    let mS = smoothstep(0.18, 0.75, ratio) * (1 - 0.35 * smoothstep(1.8, 3.5, ratio));
    const sS = 1 - smoothstep(0.015, 0.11, slope[i]);
    const eS = 1 - smoothstep(1800, 3600, elev[i]);
    // floodplain / alluvium: close to a river and only a little above it
    let flood = 0;
    if (dRiver[i] < 5 && rW[i] > 0.01) {
      const above = elev[i] - rE[i] / rW[i];
      flood = (1 - smoothstep(1, 5, dRiver[i])) * (1 - smoothstep(4, 30, above));
    }
    // irrigation: river water rescues dry land (the Nile effect)
    const irrigate = flood * (1 - smoothstep(0.2, 0.9, ratio)) * 0.95;
    mS = Math.max(mS, irrigate);
    const alluvial = flood * 0.28;
    const m = flood * smoothstep(1.2, 2.5, ratio) * (1 - smoothstep(0.002, 0.01, slope[i]));
    marsh[i] = clamp(m * 0.8 + (dWater[i] < 2 && slope[i] < 0.002 && ratio > 1.3 ? 0.3 : 0), 0, 1);
    fertility[i] = clamp(tS * mS * sS * eS * (0.85 + alluvial) + alluvial * tS * sS - marsh[i] * 0.25, 0, 1);
    forest[i] = clamp(smoothstep(0.6, 1.3, ratio) * smoothstep(-4, 4, T) * (1 - smoothstep(2200, 3200, elev[i])) * (0.55 + 0.45 * smoothstep(0.01, 0.08, slope[i])), 0, 1);
  }

  // Defensibility: local prominence + enclosure by water (river bends, peninsulas).
  const sm = boxBlur(elev, W, H, Math.max(2, Math.round(6 / cellKm)), 1);
  const wet = new Float32Array(N);
  for (let i = 0; i < N; i++) wet[i] = water[i] || (river[i] && discharge[i] > qRiver * 4) ? 1 : 0;
  const enc = boxBlur(wet, W, H, 2, 1);
  const defense = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (water[i]) continue;
    const prom = smoothstep(8, 90, elev[i] - sm[i]);
    const e = smoothstep(0.2, 0.55, enc[i]);
    const steepPenalty = smoothstep(0.12, 0.25, slope[i]);
    defense[i] = clamp(0.75 * prom + 0.55 * e - 0.3 * steepPenalty, 0, 1);
  }

  // Harbour quality for coastal land cells: shelter from open sea + depth.
  const harbor = new Float32Array(N);
  const rays = 16;
  const rayLen = Math.max(8, Math.round(24 / cellKm));
  for (let i = 0; i < N; i++) {
    if (water[i] !== WATER_LAND) continue;
    const x = i % W, y = (i / W) | 0;
    let seaN = -1;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (water[n] === WATER_OCEAN) { seaN = n; break; }
    }
    if (seaN < 0) continue;
    const sx = seaN % W, sy = (seaN / W) | 0;
    let blocked = 0;
    for (let r = 0; r < rays; r++) {
      const a = (r / rays) * Math.PI * 2;
      const ddx = Math.cos(a), ddy = Math.sin(a);
      for (let s = 1; s <= rayLen; s++) {
        const px = Math.round(sx + ddx * s), py = Math.round(sy + ddy * s);
        if (px < 0 || py < 0 || px >= W || py >= H) break;
        if (water[py * W + px] === WATER_LAND) { blocked++; break; }
      }
    }
    const shelter = blocked / rays; // ~0.5 on a straight coast
    // depth proxy: deepest sea within 2 cells
    let depth = 0;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const px = x + ox, py = y + oy;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const j = py * W + px;
      if (water[j] === WATER_OCEAN) depth = Math.max(depth, -elev[j]);
    }
    const depthOK = smoothstep(2, 25, depth);
    const estuary = river[i] && discharge[i] > qRiver * 8 ? 0.12 : 0;
    harbor[i] = clamp(smoothstep(0.45, 0.85, shelter) * 0.7 + depthOK * 0.3 + estuary - marsh[i] * 0.2, 0, 1);
  }

  return { fertility, forest, marsh, defense, harbor, coastDist };
}

const RES_COUNTS: Record<ResourceKind, number> = { ore: 6, coal: 4, salt: 3, stone: 4, timber: 4, gold: 1 };

/** Procedurally place resource deposits where geology/climate make sense. */
export function placeResources(t: TerrainInput, h: Hydro, layers: Layers, seed: number): ResourceSite[] {
  const { W, H, elev } = t;
  const N = W * H;
  const rng = makeRng(seed, 'resources');
  const nz = new Simplex(seed ^ 0x1234567);
  const sites: ResourceSite[] = [];
  const scale = Math.sqrt((W * H) / (320 * 224));
  const suit = (kind: ResourceKind, i: number): number => {
    if (h.water[i]) return 0;
    const x = i % W, y = (i / W) | 0;
    const e = elev[i];
    const n = 0.5 + 0.5 * nz.fbm(x / 23 + kind.length * 7, y / 23, 2);
    switch (kind) {
      case 'ore': return smoothstep(250, 900, e) * (1 - smoothstep(2600, 3200, e)) * n * n;
      case 'gold': return smoothstep(600, 1500, e) * Math.pow(n, 4);
      case 'coal': return smoothstep(60, 300, e) * (1 - smoothstep(700, 1100, e)) * smoothstep(0.004, 0.03, h.slope[i]) * n * n;
      case 'stone': return smoothstep(80, 400, e) * smoothstep(0.03, 0.1, h.slope[i]) * n;
      case 'salt': {
        const dry = 1 - smoothstep(0.5, 1.2, h.precip[i] / evapotranspiration(h.temp[i]));
        const coastal = layers.coastDist[i] < 2 && layers.harbor[i] < 0.5 ? 0.6 : 0;
        return (coastal * (0.4 + dry) + 0.25 * n * n * n) * (1 - smoothstep(400, 900, e));
      }
      case 'timber': return layers.forest[i] * (h.river[i] ? 1 : 0.45) * n;
    }
  };
  let id = 0;
  for (const kind of Object.keys(RES_COUNTS) as ResourceKind[]) {
    const count = Math.max(1, Math.round(RES_COUNTS[kind] * scale));
    const cands: { i: number; s: number }[] = [];
    for (let i = 0; i < N; i += 3) {
      const s = suit(kind, i) * (0.6 + 0.4 * rng());
      if (s > 0.08) cands.push({ i, s });
    }
    cands.sort((a, b) => b.s - a.s);
    const placed: number[] = [];
    for (const c of cands) {
      const cx = c.i % W, cy = (c.i / W) | 0;
      if (sites.some((s) => Math.hypot((s.cell % W) - cx, ((s.cell / W) | 0) - cy) < 14)) continue;
      sites.push({ id: id++, kind, cell: c.i, richness: clamp(0.45 + c.s * 0.6, 0.3, 1) });
      placed.push(c.i);
      if (placed.length >= count) break;
    }
  }
  return sites;
}
