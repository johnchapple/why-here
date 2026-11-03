// Procedural terrain: layered noise shaped into a believable landmass,
// followed by droplet-based hydraulic erosion and a thermal (talus) pass.
import { Simplex } from './noise';
import { makeRng, hashString } from './rng';
import { clamp, smoothstep, TerrainInput } from './grid';

export type WorldStyle = 'coast' | 'continent' | 'archipelago' | 'peninsula' | 'inland';

export interface GenParams {
  seed: string;
  W: number;
  H: number;
  cellKm: number;
  style: WorldStyle;
  landFraction: number; // 0..1
  mountains: number; // 0..1 amount of mountain building
  latitude: number; // latitude of map centre, deg N
  erosion: number; // 0..1
}

export const DEFAULT_GEN: GenParams = {
  seed: 'atlas',
  W: 320,
  H: 224,
  cellKm: 2,
  style: 'coast',
  landFraction: 0.58,
  mountains: 0.6,
  latitude: 44,
  erosion: 0.7,
};

const MAX_LAND_M = 3200;
const MAX_DEPTH_M = 2500;

export function generateTerrain(p: GenParams): TerrainInput {
  const { W, H } = p;
  const seedNum = hashString(p.seed);
  const n1 = new Simplex(seedNum);
  const n2 = new Simplex(seedNum ^ 0x9e3779b9);
  const n3 = new Simplex(seedNum ^ 0x85ebca6b);
  const rng = makeRng(seedNum, 'terrain');
  const aspect = W / H;
  const h = new Float32Array(W * H);

  // Style-dependent large-scale mask. 'coast' puts open sea along one side.
  const coastAngle = rng() * Math.PI * 2;
  const cx = Math.cos(coastAngle), cy = Math.sin(coastAngle);
  // Mountain belt runs roughly parallel to the coast, inland.
  const beltOffset = 0.15 + rng() * 0.2;
  const ox = rng() * 100, oy = rng() * 100;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x / W - 0.5) * aspect; // centred coords, height spans [-0.5,0.5]
      const v = y / H - 0.5;
      // domain warp
      const wx = u + 0.18 * n2.fbm(u * 1.6 + ox, v * 1.6 + oy, 3);
      const wy = v + 0.18 * n2.fbm(u * 1.6 + oy + 50, v * 1.6 + ox, 3);
      let base = n1.fbm(wx * 1.7 + ox, wy * 1.7 + oy, 5) * 0.55;
      const r = Math.sqrt(u * u / (aspect * aspect * 0.25) + v * v / 0.25); // 0 centre, ~1 at edges
      const along = u * cx + v * cy; // signed position along coast normal
      let mask = 0;
      switch (p.style) {
        case 'coast': mask = -along * 2.2 + 0.1; break;
        case 'continent': mask = 0.75 - r * 1.15; break;
        case 'archipelago': mask = 0.05 - r * 0.35; base *= 1.6; break;
        case 'peninsula': {
          const across = -u * cy + v * cx;
          mask = 0.55 - Math.abs(across) * 3.2 - Math.max(0, along) * 1.4 + Math.max(0, -along) * 0.6;
          break;
        }
        case 'inland': mask = 1.2 - r * 0.6; break;
      }
      // mountains: ridged noise, strongest in a belt inland from the coast
      const beltPos = p.style === 'coast' || p.style === 'peninsula'
        ? Math.exp(-Math.pow((-along - beltOffset) / 0.18, 2))
        : 0.55 + 0.45 * n3.fbm(wx * 1.1 + 7, wy * 1.1 - 3, 2);
      const orogeny = smoothstep(-0.15, 0.45, n3.fbm(wx * 1.3 + 11, wy * 1.3 + 4, 3) * 0.6 + beltPos * 0.7);
      const ridge = n1.ridged(wx * 4.2 + 3, wy * 4.2 - 8, 5);
      const mtn = orogeny * ridge * p.mountains;
      const detail = n2.fbm(wx * 9 + 20, wy * 9 - 13, 4) * 0.06;
      h[y * W + x] = base + mask + detail + mtn * 0.9;
    }
  }

  // Map the field so that `landFraction` of cells end up above sea level.
  const sorted = Float32Array.from(h).sort();
  const seaCut = sorted[Math.floor(clamp(1 - p.landFraction, 0.02, 0.98) * (sorted.length - 1))];
  const maxV = sorted[sorted.length - 1];
  const minV = sorted[0];
  const elev = new Float32Array(W * H);
  for (let i = 0; i < h.length; i++) {
    const v = h[i] - seaCut;
    if (v >= 0) {
      const t = v / (maxV - seaCut);
      // concave profile: broad coastal plains, steep mountains
      elev[i] = 2 + Math.pow(t, 2.1) * MAX_LAND_M;
    } else {
      const t = v / (seaCut - minV);
      elev[i] = -5 + t * MAX_DEPTH_M * Math.pow(Math.abs(t), 0.4);
    }
  }

  if (p.erosion > 0) {
    hydraulicErosion(elev, W, H, Math.floor(W * H * 0.9 * p.erosion), seedNum, p.cellKm);
    thermalErosion(elev, W, H, 4, p.cellKm);
  }

  const lat = p.latitude;
  const spanDeg = (H * p.cellKm) / 111;
  return {
    W, H, cellKm: p.cellKm, elev,
    latTop: lat + spanDeg / 2,
    latBottom: lat - spanDeg / 2,
    wind: 'auto',
  };
}

/**
 * Droplet hydraulic erosion (after Hans Beyer / Sebastian Lague), operating
 * on the land part of the map in metres. Carves valleys and deposits
 * sediment in basins and at the coast which gives flat alluvial plains.
 */
export function hydraulicErosion(elev: Float32Array, W: number, H: number, drops: number, seed: number, cellKm: number) {
  const rng = makeRng(seed, 'erosion');
  // Work in kilometres of height per cell so parameters are scale-free.
  const k = 1 / 1000;
  const hk = new Float32Array(elev.length);
  for (let i = 0; i < elev.length; i++) hk[i] = elev[i] * k * (2 / cellKm);
  const inertia = 0.05, capacityK = 4, minSlope = 0.01, erodeK = 0.3, depositK = 0.3;
  const evaporate = 0.012, gravity = 4, maxLife = 40;
  const sample = (x: number, y: number, out: number[]) => {
    const xi = x | 0, yi = y | 0;
    const fx = x - xi, fy = y - yi;
    const i = yi * W + xi;
    const a = hk[i], b = hk[i + 1], c = hk[i + W], d = hk[i + W + 1];
    out[0] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    out[1] = (b - a) * (1 - fy) + (d - c) * fy;
    out[2] = (c - a) * (1 - fx) + (d - b) * fx;
  };
  const g = [0, 0, 0], g2 = [0, 0, 0];
  for (let n = 0; n < drops; n++) {
    let x = 1 + rng() * (W - 3), y = 1 + rng() * (H - 3);
    if (hk[(y | 0) * W + (x | 0)] <= 0) continue;
    let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;
    for (let life = 0; life < maxLife; life++) {
      const xi = x | 0, yi = y | 0;
      const fx = x - xi, fy = y - yi;
      const cell = yi * W + xi;
      sample(x, y, g);
      dx = dx * inertia - g[1] * (1 - inertia);
      dy = dy * inertia - g[2] * (1 - inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) break;
      dx /= len; dy /= len;
      x += dx; y += dy;
      if (x < 1 || y < 1 || x >= W - 2 || y >= H - 2) break;
      sample(x, y, g2);
      const dh = g2[0] - g[0];
      if (g2[0] <= 0) {
        // reached the sea: drop part of the load as a delta / beach
        deposit(hk, W, cell, fx, fy, Math.min(sediment * 0.5, Math.max(0, -dh) + 0.002));
        break;
      }
      const cap = Math.max(-dh, minSlope) * speed * water * capacityK;
      if (sediment > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * depositK;
        sediment -= amt;
        deposit(hk, W, cell, fx, fy, amt);
      } else {
        const amt = Math.min((cap - sediment) * erodeK, -dh);
        let taken = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox2 = -1; ox2 <= 1; ox2++) {
          const j = cell + oy * W + ox2;
          const wgt = ox2 === 0 && oy === 0 ? 0.36 : (ox2 === 0 || oy === 0 ? 0.11 : 0.05);
          const t = amt * wgt;
          if (hk[j] - t > 0.0005) { hk[j] -= t; taken += t; }
        }
        sediment += taken;
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity));
      water *= 1 - evaporate;
    }
  }
  for (let i = 0; i < elev.length; i++) {
    if (elev[i] > 0) elev[i] = Math.max(0.5, hk[i] / (k * (2 / cellKm)));
  }
}

function deposit(elev: Float32Array, W: number, cell: number, fx: number, fy: number, amt: number) {
  elev[cell] += amt * (1 - fx) * (1 - fy);
  elev[cell + 1] += amt * fx * (1 - fy);
  elev[cell + W] += amt * (1 - fx) * fy;
  elev[cell + W + 1] += amt * fx * fy;
}

/** Talus relaxation: moves material from slopes steeper than the angle of repose. */
export function thermalErosion(elev: Float32Array, W: number, H: number, iters: number, cellKm: number) {
  const talus = 0.35 * cellKm * 1000; // 35% grade in metres per cell
  for (let it = 0; it < iters; it++) {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (elev[i] <= 0) continue;
      let maxD = 0, mj = -1;
      const nb = [i - 1, i + 1, i - W, i + W];
      for (const j of nb) { const d = elev[i] - elev[j]; if (d > maxD) { maxD = d; mj = j; } }
      if (mj >= 0 && maxD > talus) {
        const mv = (maxD - talus) * 0.4;
        elev[i] -= mv; elev[mj] += mv;
      }
    }
  }
}
