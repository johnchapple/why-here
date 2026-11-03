// Movement-cost surface and least-cost pathfinding.
//
// The graph has two layers over the grid: a LAND layer (node = cell) and a
// WATER layer (node = N + cell) that exists on sea, lakes, navigable rivers
// and canals. Moving between layers costs a fixed "transfer" (loading and
// unloading cargo). That transfer is what makes break-of-bulk points -
// river mouths, falls, harbours - valuable places for towns.
//
// For speed, every directed edge cost is precomputed into flat tables
// (8 per cell per layer) whenever the era or the infrastructure changes.
import { DD, DX, DY, World, WATER_OCEAN, WATER_LAND } from './grid';
import { MinHeap } from './heap';
import type { EraDef } from './eras';

export const W_NONE = 0, W_OPEN = 1, W_RIVER = 2, W_CANAL = 3;
const OPP = [1, 0, 3, 2, 7, 6, 5, 4];

export interface CostModel {
  era: EraDef;
  landCost: Float32Array; // per km (for display / reference)
  cross: Float32Array; // extra cost to enter a river cell overland
  wnode: Uint8Array; // which cells have a water-layer node
  xfer: Float32Array; // transfer cost at a land cell (Infinity if no water access)
  rail: Uint8Array;
  landEdge: Float32Array; // N*8 directed land edge costs (Infinity = none)
  waterEdge: Float32Array; // N*8 directed water edge costs
  /** transfer from a land cell into the water layer of neighbour k (N*8), for coasts */
  embark: Float32Array;
}

export interface Infra {
  roads: Uint8Array;
  rail: Uint8Array;
  railEdge: Set<number>; // edge key a*8+k
  canal: Uint8Array;
}

export function buildCostModel(w: World, era: EraDef, infra: Infra): CostModel {
  const { N, W, H } = w;
  const landCost = new Float32Array(N);
  const cross = new Float32Array(N);
  const wnode = new Uint8Array(N);
  const wcost = new Float32Array(N);
  const xfer = new Float32Array(N).fill(Infinity);
  for (let i = 0; i < N; i++) {
    if (w.water[i]) {
      wnode[i] = W_OPEN;
      if (w.water[i] === WATER_OCEAN) wcost[i] = w.coastDist[i] <= 3 ? era.seaCoastal : era.seaOpen;
      else wcost[i] = era.lake;
      continue;
    }
    let c = era.land;
    c *= 1 + (era.forest - 1) * w.forest[i] * 0.8;
    c *= 1 + (era.marsh - 1) * w.marsh[i];
    const r = infra.roads[i];
    if (r) c *= era.road[r - 1];
    landCost[i] = c;
    if (w.river[i]) {
      const q = w.discharge[i] / w.qRiver;
      let cc = era.cross * (0.6 + 1.3 * Math.log2(1 + q));
      const feats = w.featureAt.get(i);
      if (feats?.some((f) => f.kind === 'ford')) cc *= 0.3;
      if (r >= 2) cc *= 0.25; // bridge
      if (infra.rail[i]) cc *= 0.1;
      cross[i] = cc;
      const nav = w.navigable[i] || (era.locks && w.discharge[i] >= w.qNav);
      if (nav) wnode[i] = W_RIVER;
    }
    if (infra.canal[i]) { wnode[i] = W_CANAL; wcost[i] = era.riverUp * 1.1; }
  }
  for (let i = 0; i < N; i++) {
    if (w.water[i]) continue;
    if (wnode[i]) { xfer[i] = era.transfer; continue; }
  }
  const landEdge = new Float32Array(N * 8).fill(Infinity);
  const waterEdge = new Float32Array(N * 8).fill(Infinity);
  const embark = new Float32Array(N * 8).fill(Infinity);
  const { elev, river, flowDir, water, cellKm } = w;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y * W + x;
    const isLand = water[c] === WATER_LAND;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      const dkm = DD[k] * cellKm;
      if (isLand && water[n] === WATER_LAND) {
        const grade = Math.abs(elev[n] - elev[c]) / (dkm * 1000);
        let cost = dkm * 0.5 * (landCost[c] + landCost[n]) * (1 + era.slopeK * grade);
        if (era.rail > 0 && infra.railEdge.has(c * 8 + k)) cost = Math.min(cost, dkm * era.rail);
        if (river[n] && !river[c]) cost += cross[n];
        else if (k >= 4) {
          const a = y * W + nx, b = ny * W + x;
          if (river[a] && river[b] && (flowDir[a] === b || flowDir[b] === a)) cost += Math.min(cross[a], cross[b]);
        }
        landEdge[c * 8 + k] = cost;
      }
      if (isLand && !wnode[c] && water[n]) {
        const hq = water[n] === WATER_OCEAN ? w.harbor[c] : 0.55;
        embark[c * 8 + k] = era.transfer * (1.5 - hq) + dkm * 0.5;
      }
      const tc = wnode[c], tn = wnode[n];
      if (tc && tn) {
        let cost = Infinity;
        if (tc === W_OPEN && tn === W_OPEN) cost = dkm * 0.5 * (wcost[c] + wcost[n]);
        else if (tc === W_RIVER || tn === W_RIVER) {
          if (flowDir[c] === n) cost = dkm * era.riverDown;
          else if (flowDir[n] === c) cost = dkm * era.riverUp;
          else if (tc === W_CANAL || tn === W_CANAL) cost = dkm * era.riverUp * 1.1;
        } else cost = dkm * (tc === W_CANAL ? wcost[c] : wcost[n]);
        waterEdge[c * 8 + k] = cost;
      }
    }
  }
  return { era, landCost, cross, wnode, xfer, rail: infra.rail, landEdge, waterEdge, embark };
}

/** Cost model for *building* railways: gradients are very expensive, rivers need bridges. */
export function buildRailConstructionModel(w: World, base: CostModel, existing: Uint8Array): CostModel {
  const { N, W, H, elev, river, water, cellKm } = w;
  const landEdge = new Float32Array(N * 8).fill(Infinity);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y * W + x;
    if (water[c]) continue;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (water[n]) continue;
      const dkm = DD[k] * cellKm;
      const grade = Math.abs(elev[n] - elev[c]) / (dkm * 1000);
      let cost = dkm * (1 + 180 * grade + 2000 * Math.max(0, grade - 0.025));
      if (river[n] && !river[c]) cost += 2 + Math.log2(1 + w.discharge[n] / w.qRiver);
      if (existing[c] && existing[n]) cost *= 0.3; // reuse existing lines
      landEdge[c * 8 + k] = cost;
    }
  }
  return { ...base, landEdge };
}

export interface PathResult { dist: Float64Array; parent: Int32Array; label: Int32Array }

/**
 * Dijkstra over the two-layer graph. Sources are node ids (cell for land,
 * N+cell for water). `label` records which source each node was reached
 * from (handy for market areas). Search stops beyond maxCost.
 */
export class Pathfinder {
  w: World;
  N: number;
  dist: Float64Array;
  parent: Int32Array;
  label: Int32Array;
  heap: MinHeap;
  off: Int32Array;
  private touched: Int32Array;
  private nTouched = 0;
  private touchedAll = true;
  constructor(w: World) {
    this.w = w;
    this.N = w.N;
    this.dist = new Float64Array(2 * w.N);
    this.parent = new Int32Array(2 * w.N);
    this.label = new Int32Array(2 * w.N);
    this.heap = new MinHeap(4096);
    this.touched = new Int32Array(2 * w.N);
    this.off = new Int32Array(8);
    for (let k = 0; k < 8; k++) this.off[k] = DY[k] * w.W + DX[k];
  }

  run(cm: CostModel, sources: { node: number; cost?: number; label?: number }[], maxCost = Infinity, opts: { landOnly?: boolean } = {}): PathResult {
    const N = this.N;
    const water = this.w.water;
    const dist = this.dist, parent = this.parent, label = this.label, off = this.off;
    // reset only what the previous search touched (cheap for local searches)
    if (this.touchedAll) { dist.fill(Infinity); parent.fill(-1); label.fill(-1); }
    else for (let k = 0; k < this.nTouched; k++) { const n = this.touched[k]; dist[n] = Infinity; parent[n] = -1; label[n] = -1; }
    this.nTouched = 0; this.touchedAll = false;
    let touched = this.touched, nT = 0;
    const cap = touched.length;
    const heap = this.heap;
    heap.clear();
    for (const s of sources) {
      const c = s.cost ?? 0;
      if (c < dist[s.node]) {
        if (dist[s.node] === Infinity) { if (nT < cap) touched[nT++] = s.node; else this.touchedAll = true; }
        dist[s.node] = c; label[s.node] = s.label ?? s.node; heap.push(c, s.node);
      }
    }
    const { landEdge, waterEdge, embark, wnode, xfer } = cm;
    const landOnly = !!opts.landOnly;

    while (heap.size) {
      const u = heap.pop();
      const du = heap.lastKey;
      if (du > dist[u]) continue;
      const lu = label[u];
      if (u < N) {
        const c = u, base = c * 8;
        for (let k = 0; k < 8; k++) {
          const e = landEdge[base + k];
          if (e === Infinity) continue;
          const v = c + off[k];
          const nd = du + e;
          if (nd < dist[v] && nd <= maxCost) { if (dist[v] === Infinity) { if (nT < cap) touched[nT++] = v; else this.touchedAll = true; } dist[v] = nd; parent[v] = u; label[v] = lu; heap.push(nd, v); }
        }
        if (!landOnly) {
          if (wnode[c]) {
            const v = N + c, nd = du + xfer[c];
            if (nd < dist[v] && nd <= maxCost) { if (dist[v] === Infinity) { if (nT < cap) touched[nT++] = v; else this.touchedAll = true; } dist[v] = nd; parent[v] = u; label[v] = lu; heap.push(nd, v); }
          } else {
            for (let k = 0; k < 8; k++) {
              const e = embark[base + k];
              if (e === Infinity) continue;
              const v = N + c + off[k], nd = du + e;
              if (nd < dist[v] && nd <= maxCost) { if (dist[v] === Infinity) { if (nT < cap) touched[nT++] = v; else this.touchedAll = true; } dist[v] = nd; parent[v] = u; label[v] = lu; heap.push(nd, v); }
            }
          }
        }
      } else {
        const c = u - N, base = c * 8;
        for (let k = 0; k < 8; k++) {
          const e = waterEdge[base + k];
          if (e === Infinity) continue;
          const v = u + off[k], nd = du + e;
          if (nd < dist[v] && nd <= maxCost) { if (dist[v] === Infinity) { if (nT < cap) touched[nT++] = v; else this.touchedAll = true; } dist[v] = nd; parent[v] = u; label[v] = lu; heap.push(nd, v); }
        }
        if (water[c] === WATER_LAND) {
          const nd = du + xfer[c];
          if (nd < dist[c] && nd <= maxCost) { if (dist[c] === Infinity) { if (nT < cap) touched[nT++] = c; else this.touchedAll = true; } dist[c] = nd; parent[c] = u; label[c] = lu; heap.push(nd, c); }
        } else {
          // disembark onto the coast: reverse of embark (edge from land n toward c)
          for (let k = 0; k < 8; k++) {
            const n = c + off[k];
            if (n < 0 || n >= N) continue;
            const e = embark[n * 8 + OPP[k]];
            if (e === Infinity) continue;
            const nd = du + e;
            if (nd < dist[n] && nd <= maxCost) { if (dist[n] === Infinity) { if (nT < cap) touched[nT++] = n; else this.touchedAll = true; } dist[n] = nd; parent[n] = u; label[n] = lu; heap.push(nd, n); }
          }
        }
      }
    }
    this.nTouched = nT;
    void touched;
    return { dist, parent, label };
  }

  /** Node path from a source to `target` (inclusive), following parents. */
  trace(target: number): number[] {
    const out: number[] = [];
    let n = target;
    let guard = 0;
    while (n >= 0 && guard++ < 4 * this.N) { out.push(n); n = this.parent[n]; }
    return out.reverse();
  }
}

/** Neighbour index k such that b = a + (DX[k], DY[k]); -1 if not adjacent. */
export function neighborIndex(W: number, a: number, b: number): number {
  const dx = (b % W) - (a % W), dy = ((b / W) | 0) - ((a / W) | 0);
  for (let k = 0; k < 8; k++) if (DX[k] === dx && DY[k] === dy) return k;
  return -1;
}

/** Per-cell land movement cost (for the overlay). */
export function landCostField(w: World, cm: CostModel): Float32Array {
  const out = new Float32Array(w.N);
  for (let i = 0; i < w.N; i++) {
    if (w.water[i]) { out[i] = cm.era.seaCoastal; continue; }
    out[i] = cm.landCost[i] * (1 + cm.era.slopeK * w.slope[i] * 0.5) + (w.river[i] ? cm.cross[i] / w.cellKm : 0);
    if (cm.rail[i]) out[i] = Math.min(out[i], cm.era.rail * 2);
  }
  return out;
}
