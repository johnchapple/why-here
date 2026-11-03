// Core world data structures shared by every simulation module.

export const WATER_LAND = 0;
export const WATER_OCEAN = 1;
export const WATER_LAKE = 2;

/** 8-neighbourhood offsets, orthogonal first. */
export const DX = [1, -1, 0, 0, 1, 1, -1, -1];
export const DY = [0, 0, 1, -1, 1, -1, 1, -1];
export const DD = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

export type ResourceKind = 'ore' | 'coal' | 'salt' | 'stone' | 'timber' | 'gold';

export interface ResourceSite {
  id: number;
  kind: ResourceKind;
  cell: number;
  richness: number; // 0..1
  placedByPlayer?: boolean;
}

export interface TerrainInput {
  W: number;
  H: number;
  cellKm: number;
  /** elevation in metres, negative below sea level */
  elev: Float32Array;
  /** latitude (deg) of the top and bottom rows: used for climate */
  latTop: number;
  latBottom: number;
  /** optional fixed land/sea mask (Earth mode). 1 = ocean, 2 = lake, 0 = land */
  waterMask?: Uint8Array;
  /** optional river-burn mask (Earth mode): cells on mapped rivers */
  riverBurn?: Uint8Array;
  /** extra discharge (m3/s) entering at cells, e.g. rivers entering from off-map */
  inflow?: { cell: number; q: number }[];
  /** multiply computed precipitation (Earth mode calibration) */
  precipScale?: number;
  /** 'west' = prevailing westerlies (wind blows toward +x). Defaults by latitude. */
  wind?: 'west' | 'east' | 'auto';
  resources?: ResourceSite[];
}

export interface HydroFeature {
  cell: number;
  kind: 'confluence' | 'mouth' | 'fall' | 'head' | 'ford' | 'pass' | 'lakeshore';
  strength: number; // 0..1 importance
  label?: string;
}

export interface RiverInfo {
  id: number;
  name: string;
  mouth: number; // cell index where it ends
  q: number; // discharge at mouth
  cells: number[]; // main stem from source to mouth
}

/** Fully derived world: terrain plus everything the emergence model needs. */
export interface World extends TerrainInput {
  N: number;
  water: Uint8Array;
  filled: Float32Array;
  flowDir: Int32Array; // downstream cell, -1 sink (water), -2 off-map
  discharge: Float32Array; // m3/s
  temp: Float32Array; // deg C
  precip: Float32Array; // mm/yr
  slope: Float32Array; // m/m, max gradient
  river: Uint8Array; // 1 if visible river
  navigable: Uint8Array; // 1 if a boat can use this river/lake/sea cell
  riverGrad: Float32Array; // gradient to downstream (m/m)
  coastDist: Float32Array; // distance in cells to nearest land (for water) / water (for land)
  fertility: Float32Array; // 0..1
  forest: Float32Array; // 0..1
  defense: Float32Array; // 0..1
  harbor: Float32Array; // 0..1 (coastal land cells only)
  marsh: Float32Array; // 0..1
  features: HydroFeature[];
  featureAt: Map<number, HydroFeature[]>;
  rivers: RiverInfo[];
  riverId: Int32Array; // which named river a cell belongs to (-1)
  resources: ResourceSite[];
  qRiver: number; // threshold for visible rivers
  qNav: number; // threshold for navigable rivers
}

export function idx(W: number, x: number, y: number): number {
  return y * W + x;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Separable box blur, repeated passes approximate a gaussian. */
export function boxBlur(src: Float32Array, W: number, H: number, r: number, passes = 1): Float32Array {
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      let acc = 0;
      const row = y * W;
      for (let x = -r; x <= r; x++) acc += a[row + clamp(x, 0, W - 1)];
      for (let x = 0; x < W; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + clamp(x + r + 1, 0, W - 1)] - a[row + clamp(x - r, 0, W - 1)];
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[clamp(y, 0, H - 1) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = acc / (2 * r + 1);
        acc += b[clamp(y + r + 1, 0, H - 1) * W + x] - b[clamp(y - r, 0, H - 1) * W + x];
      }
    }
  }
  return a;
}

/** Chamfer distance transform: distance (cells) from every cell to the nearest cell where mask=1. */
export function distanceTo(mask: Uint8Array, W: number, H: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  const D1 = 1, D2 = Math.SQRT2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + D1);
    if (y > 0) {
      v = Math.min(v, d[i - W] + D1);
      if (x > 0) v = Math.min(v, d[i - W - 1] + D2);
      if (x < W - 1) v = Math.min(v, d[i - W + 1] + D2);
    }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + D1);
    if (y < H - 1) {
      v = Math.min(v, d[i + W] + D1);
      if (x < W - 1) v = Math.min(v, d[i + W + 1] + D2);
      if (x > 0) v = Math.min(v, d[i + W - 1] + D2);
    }
    d[i] = v;
  }
  return d;
}
