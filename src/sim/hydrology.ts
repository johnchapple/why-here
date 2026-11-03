// Hydrology: depression filling (priority-flood with epsilon), D8 flow
// directions, precipitation-weighted flow accumulation, lakes, navigable
// water and the special river sites that attract towns: confluences, river
// mouths, falls / heads of navigation, fords and mountain passes.
import {
  DD, DX, DY, HydroFeature, RiverInfo, TerrainInput, WATER_LAKE, WATER_LAND, WATER_OCEAN, boxBlur,
} from './grid';
import { MinHeap } from './heap';
import { computeClimate, evapotranspiration } from './climate';
import { NameGen } from './names';
import { makeRng } from './rng';
import { Simplex } from './noise';

export interface Hydro {
  water: Uint8Array;
  filled: Float32Array;
  flowDir: Int32Array;
  discharge: Float32Array;
  temp: Float32Array;
  precip: Float32Array;
  river: Uint8Array;
  navigable: Uint8Array;
  riverGrad: Float32Array;
  slope: Float32Array;
  features: HydroFeature[];
  rivers: RiverInfo[];
  riverId: Int32Array;
  qRiver: number;
  qNav: number;
}

export const NAV_GRAD = 0.0019; // m per m: steeper than ~1.9 m/km (10 km average) means rapids/falls

/** Ocean = below sea level and connected to the map edge (or given by mask). */
export function computeWaterMask(t: TerrainInput): Uint8Array {
  const { W, H, elev } = t;
  const N = W * H;
  if (t.waterMask) return Uint8Array.from(t.waterMask);
  const water = new Uint8Array(N);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) { stack.push(x, (H - 1) * W + x); }
  for (let y = 0; y < H; y++) { stack.push(y * W, y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop()!;
    if (water[i] || elev[i] >= 0) continue;
    water[i] = WATER_OCEAN;
    const x = i % W, y = (i / W) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - W);
    if (y < H - 1) stack.push(i + W);
  }
  // Enclosed below-sea basins become lakes (or land if tiny).
  const seen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (water[i] || elev[i] >= 0 || seen[i]) continue;
    const comp: number[] = [];
    const st = [i]; seen[i] = 1;
    while (st.length) {
      const c = st.pop()!; comp.push(c);
      const x = c % W, y = (c / W) | 0;
      const nb = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1];
      for (const n of nb) if (n >= 0 && !water[n] && elev[n] < 0 && !seen[n]) { seen[n] = 1; st.push(n); }
    }
    for (const c of comp) {
      if (comp.length >= 4) water[c] = WATER_LAKE;
      else elev[c] = 0.5;
    }
  }
  return water;
}

/**
 * Priority-flood (Barnes et al. 2014) with an epsilon gradient so every land
 * cell has a strictly lower neighbour: water always drains to the sea or
 * off the map edge, never gets stuck in a pit.
 */
export function priorityFlood(W: number, H: number, elev: Float32Array, water: Uint8Array, eps = 0.01): Float32Array {
  const N = W * H;
  const filled = new Float32Array(N);
  const done = new Uint8Array(N);
  const heap = new MinHeap(N);
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i / W) | 0;
    const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    if (water[i] === WATER_OCEAN || edge) {
      filled[i] = water[i] === WATER_OCEAN ? Math.min(elev[i], 0) : elev[i];
      done[i] = 1;
      heap.push(filled[i], i);
    }
  }
  while (heap.size) {
    const c = heap.pop();
    const cx = c % W, cy = (c / W) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k], ny = cy + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (done[n]) continue;
      done[n] = 1;
      filled[n] = Math.max(elev[n], filled[c] + eps * DD[k]);
      heap.push(filled[n], n);
    }
  }
  return filled;
}

export function computeHydrology(t: TerrainInput, seed: number): Hydro {
  const { W, H, cellKm } = t;
  const N = W * H;
  const water = computeWaterMask(t);
  const elev = t.elev;

  // Stream burning (Earth mode): carve mapped rivers so D8 follows them.
  let work = elev;
  if (t.riverBurn) {
    work = Float32Array.from(elev);
    for (let i = 0; i < N; i++) if (t.riverBurn[i] && !water[i]) work[i] = Math.max(0.2, work[i] - 25 - work[i] * 0.03);
  }

  // A few metres of smooth noise lets rivers meander across flat plains
  // instead of running in parallel straight lines.
  const nz = new Simplex(seed ^ 0x51ed);
  const routing = Float32Array.from(work);
  const jitter = t.riverBurn ? 0.6 : 2.5;
  for (let i = 0; i < N; i++) {
    if (water[i]) continue;
    const x = i % W, y = (i / W) | 0;
    routing[i] += jitter * (nz.fbm(x / 7, y / 7, 3) + 1);
  }
  const filled = priorityFlood(W, H, routing, water);

  // Lakes from depressions (procedural mode) or from the mask (Earth mode).
  if (!t.waterMask) {
    const deep = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (!water[i] && filled[i] - routing[i] > 4) deep[i] = 1;
    const seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (!deep[i] || seen[i]) continue;
      const comp: number[] = [];
      const st = [i]; seen[i] = 1;
      while (st.length) {
        const c = st.pop()!; comp.push(c);
        const cx = c % W, cy = (c / W) | 0;
        for (let k = 0; k < 4; k++) {
          const nx = cx + DX[k], ny = cy + DY[k];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (deep[n] && !seen[n]) { seen[n] = 1; st.push(n); }
        }
      }
      if (comp.length >= 6) for (const c of comp) water[c] = WATER_LAKE;
    }
  }

  // D8 steepest descent on the filled surface.
  const flowDir = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (water[i] === WATER_OCEAN) { flowDir[i] = -1; continue; }
    const x = i % W, y = (i / W) | 0;
    let best = -1, bestDrop = 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      const drop = (filled[i] - filled[n]) / DD[k];
      if (drop > bestDrop) { bestDrop = drop; best = n; }
    }
    flowDir[i] = best >= 0 ? best : -2; // -2: drains off the map edge
  }

  const { temp, precip } = computeClimate(t, water);

  // Flow accumulation in decreasing filled-elevation order.
  const order = new Uint32Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  order.sort((a, b) => filled[b] - filled[a]);
  const discharge = new Float32Array(N);
  const areaKm2 = cellKm * cellKm;
  const toQ = areaKm2 * 3.17e-5; // (mm/yr * km2) -> m3/s
  for (let i = 0; i < N; i++) {
    if (water[i] === WATER_OCEAN) continue;
    const et = evapotranspiration(temp[i]);
    const runoff = water[i] === WATER_LAKE ? precip[i] - et : Math.max(0, precip[i] - 0.62 * et);
    discharge[i] = runoff * toQ;
  }
  if (t.inflow) for (const f of t.inflow) discharge[f.cell] += f.q;
  for (let o = 0; o < N; o++) {
    const i = order[o];
    if (water[i] === WATER_OCEAN) continue;
    if (discharge[i] < 0) discharge[i] = 0;
    const d = flowDir[i];
    if (d >= 0 && water[d] !== WATER_OCEAN) discharge[d] += discharge[i];
  }

  const qRiver = 1.6 * (cellKm / 2) * (cellKm / 2) + 0.4;
  const qNav = 30;

  const river = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (water[i] === WATER_LAND && discharge[i] >= qRiver) river[i] = 1;

  // Gradient along the river, averaged over ~10 km downstream (less noisy).
  const riverGrad = new Float32Array(N);
  const win = Math.max(2, Math.round(10 / cellKm));
  for (let i = 0; i < N; i++) {
    if (water[i]) continue;
    let c = i, dist = 0;
    for (let s = 0; s < win; s++) {
      const d = flowDir[c];
      if (d < 0) break;
      dist += cellDist(W, c, d);
      c = d;
      if (water[c]) break;
    }
    if (dist === 0) continue;
    const endH = water[c] === WATER_OCEAN ? 0 : work[c];
    riverGrad[i] = Math.max(0, work[i] - endH) / (dist * cellKm * 1000);
  }

  // Terrain slope (max gradient to a neighbour).
  const slope = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i / W) | 0;
    let m = 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      const g = Math.abs(Math.max(0, elev[i]) - Math.max(0, elev[n])) / (DD[k] * cellKm * 1000);
      if (g > m) m = g;
    }
    slope[i] = m;
  }

  // Navigable water: sea, lakes, and big, gentle rivers.
  const navigable = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (water[i]) navigable[i] = 1;
    else if (river[i] && discharge[i] >= qNav && riverGrad[i] <= NAV_GRAD) navigable[i] = 1;
  }
  // Drop tiny isolated navigable stretches (< 6 cells) on rivers.
  pruneShortStretches(W, H, navigable, water, flowDir, 6);

  const features = detectFeatures(t, water, flowDir, discharge, river, navigable, riverGrad, slope, qRiver, qNav, work);

  // Name the biggest rivers.
  const names = new NameGen(makeRng(seed, 'rivers'));
  const mouths: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!river[i]) continue;
    const d = flowDir[i];
    if ((d === -2 || (d >= 0 && water[d])) && discharge[i] >= qNav * 0.4) mouths.push(i);
  }
  mouths.sort((a, b) => discharge[b] - discharge[a]);
  const rivers: RiverInfo[] = [];
  const riverId = new Int32Array(N).fill(-1);
  const up = upstreamLists(N, flowDir, river);
  for (const m of mouths.slice(0, 12)) {
    const cells: number[] = [];
    let c = m;
    const id = rivers.length;
    while (c >= 0 && riverId[c] < 0) {
      cells.push(c); riverId[c] = id;
      let best = -1, bq = 0;
      for (const u of up[c] ?? []) if (discharge[u] > bq) { bq = discharge[u]; best = u; }
      c = bq >= qRiver ? best : -1;
    }
    cells.reverse();
    if (cells.length < 10) { for (const cc of cells) riverId[cc] = -1; continue; }
    rivers.push({ id, name: names.river(), mouth: m, q: discharge[m], cells });
  }

  return { water, filled, flowDir, discharge, temp, precip, river, navigable, riverGrad, slope, features, rivers, riverId, qRiver, qNav };
}

export function cellDist(W: number, a: number, b: number): number {
  const dx = Math.abs((a % W) - (b % W));
  const dy = Math.abs(((a / W) | 0) - ((b / W) | 0));
  return dx && dy ? Math.SQRT2 : 1;
}

export function upstreamLists(N: number, flowDir: Int32Array, mask?: Uint8Array): (number[] | undefined)[] {
  const up: (number[] | undefined)[] = new Array(N);
  for (let i = 0; i < N; i++) {
    if (mask && !mask[i]) continue;
    const d = flowDir[i];
    if (d >= 0) (up[d] ??= []).push(i);
  }
  return up;
}

function pruneShortStretches(W: number, H: number, nav: Uint8Array, water: Uint8Array, flowDir: Int32Array, minLen: number) {
  const N = W * H;
  const seen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!nav[i] || water[i] || seen[i]) continue;
    // flood along 8-neighbour navigable river cells (not open water)
    const comp: number[] = [];
    const st = [i]; seen[i] = 1;
    let touchesWater = false;
    while (st.length) {
      const c = st.pop()!; comp.push(c);
      const cx = c % W, cy = (c / W) | 0;
      if (flowDir[c] >= 0 && water[flowDir[c]]) touchesWater = true;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k], ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (nav[n] && !water[n] && !seen[n]) { seen[n] = 1; st.push(n); }
      }
    }
    if (!touchesWater && comp.length < minLen) for (const c of comp) nav[c] = 0;
  }
}

function detectFeatures(
  t: TerrainInput, water: Uint8Array, flowDir: Int32Array, Q: Float32Array, river: Uint8Array,
  nav: Uint8Array, grad: Float32Array, slope: Float32Array, qRiver: number, qNav: number, work: Float32Array,
): HydroFeature[] {
  const { W, H } = t;
  const N = W * H;
  const feats: HydroFeature[] = [];
  const up = upstreamLists(N, flowDir, river);
  const lq = (q: number) => Math.min(1, Math.log10(1 + q / qRiver) / Math.log10(1 + 4000 / qRiver));

  for (let i = 0; i < N; i++) {
    if (!river[i]) continue;
    const d = flowDir[i];
    // River mouths (sea) and lake inflows
    if (d >= 0 && water[d] && Q[i] >= qRiver * 6) {
      feats.push({ cell: i, kind: water[d] === WATER_OCEAN ? 'mouth' : 'lakeshore', strength: lq(Q[i]) });
    }
    // Confluences of two substantial streams
    const u = up[i];
    if (u && u.length >= 2) {
      const qs = u.map((c) => Q[c]).sort((a, b) => b - a);
      if (qs[1] >= qRiver * 5 && qs[1] >= 0.22 * qs[0]) {
        feats.push({ cell: i, kind: 'confluence', strength: Math.min(1, lq(qs[1]) * 1.2) });
      }
    }
    // Falls: first unnavigable cell upstream of navigable water on a big river,
    // or any steep drop on a substantial river (mill power, portage).
    if (!nav[i] && Q[i] >= qNav * 0.5 && d >= 0 && nav[d] && grad[i] > NAV_GRAD) {
      feats.push({ cell: i, kind: 'fall', strength: Math.min(1, lq(Q[i]) * 1.3) });
    } else if (!nav[i] && Q[i] >= qNav && d >= 0 && nav[d] && grad[i] <= NAV_GRAD) {
      feats.push({ cell: i, kind: 'head', strength: lq(Q[i]) * 0.8 });
    }
  }

  // Fords: shallow, slow sections of mid-sized rivers on flat valley floors.
  const fordCand: { cell: number; s: number }[] = [];
  for (let i = 0; i < N; i++) {
    if (!river[i] || nav[i] || Q[i] < qRiver * 3 || Q[i] > qNav * 3) continue;
    const g = grad[i];
    if (g < 0.0003 || g > 0.006) continue;
    const flat = 1 - Math.min(1, slope[i] / 0.04);
    const s = flat * (1 - Q[i] / (qNav * 3)) * Math.min(1, g / 0.001);
    if (s > 0.25) fordCand.push({ cell: i, s });
  }
  fordCand.sort((a, b) => b.s - a.s);
  for (const f of nms(fordCand, W, 7, 60)) feats.push({ cell: f.cell, kind: 'ford', strength: f.s });

  // Mountain passes: saddle points on smoothed terrain.
  const sm = boxBlur(work, W, H, 2, 1);
  const passCand: { cell: number; s: number }[] = [];
  const R = 4;
  const axes = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let y = R; y < H - R; y++) for (let x = R; x < W - R; x++) {
    const i = y * W + x;
    if (water[i] || sm[i] < 250) continue;
    let best = 0;
    for (let a = 0; a < 4; a++) {
      const [ax, ay] = axes[a];
      const [px, py] = [-ay, ax];
      const hi1 = sm[(y + ay * R) * W + x + ax * R] - sm[i];
      const hi2 = sm[(y - ay * R) * W + x - ax * R] - sm[i];
      const lo1 = sm[i] - sm[(y + py * R) * W + x + px * R];
      const lo2 = sm[i] - sm[(y - py * R) * W + x - px * R];
      const s = Math.min(hi1, hi2, lo1, lo2);
      if (s > best) best = s;
    }
    if (best > 60) passCand.push({ cell: i, s: Math.min(1, best / 400) });
  }
  passCand.sort((a, b) => b.s - a.s);
  for (const p of nms(passCand, W, 12, 25)) feats.push({ cell: p.cell, kind: 'pass', strength: p.s });

  // Deduplicate river features of the same kind within 2 cells.
  return dedupe(feats, W);
}

function nms<T extends { cell: number; s: number }>(cands: T[], W: number, r: number, max: number): T[] {
  const out: T[] = [];
  for (const c of cands) {
    const cx = c.cell % W, cy = (c.cell / W) | 0;
    if (out.some((o) => Math.hypot((o.cell % W) - cx, ((o.cell / W) | 0) - cy) < r)) continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

function dedupe(feats: HydroFeature[], W: number): HydroFeature[] {
  const out: HydroFeature[] = [];
  const sorted = [...feats].sort((a, b) => b.strength - a.strength);
  for (const f of sorted) {
    const fx = f.cell % W, fy = (f.cell / W) | 0;
    const r = f.kind === 'confluence' ? 3 : f.kind === 'mouth' ? 4 : 2.5;
    if (out.some((o) => o.kind === f.kind && Math.hypot((o.cell % W) - fx, ((o.cell / W) | 0) - fy) < r)) continue;
    out.push(f);
  }
  return out;
}
