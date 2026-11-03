// Hand-shaped terrains for the guided lessons. Each is deterministic and
// built to make one idea easy to see: noise and a light erosion pass keep
// them looking natural.
import type { TerrainInput } from './grid';
import { Simplex } from './noise';
import { hydraulicErosion } from './terrain';
import { smoothstep } from './grid';

type Fn = (u: number, v: number, n: (s: number, o?: number) => number) => number;

function shape(W: number, H: number, cellKm: number, lat: number, seed: number, fn: Fn, erosion = 0.35, extra: Partial<TerrainInput> = {}): TerrainInput {
  const nz = new Simplex(seed);
  const elev = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / (W - 1), v = y / (H - 1);
    const n = (s: number, o = 0) => nz.fbm(u * s * (W / H) + o, v * s + o * 1.7, 4);
    elev[y * W + x] = fn(u, v, n);
  }
  if (erosion > 0) hydraulicErosion(elev, W, H, Math.floor(W * H * erosion), seed, cellKm);
  const span = (H * cellKm) / 111;
  return { W, H, cellKm, elev, latTop: lat + span / 2, latBottom: lat - span / 2, wind: 'west', ...extra };
}

/** A wide fertile plain with a lazy river: villages spread a day's walk apart. */
export function tenMileTerrain(): TerrainInput {
  return shape(220, 150, 2, 48, 101, (u, v, n) => {
    const hills = smoothstep(0.75, 1, Math.abs(v - 0.5) * 2) * 260 + smoothstep(0.85, 1, u) * 120;
    const sea = u < 0.05 ? -40 : 0;
    const base = 10 + u * 70 + Math.abs(v - 0.5) * 60;
    return sea || base + hills + n(5) * 18 + n(14, 3) * 5;
  }, 0.25, { precipScale: 1.05 });
}

/** Piedmont upland dropping sharply onto a coastal plain: the fall line. */
export function fallLineTerrain(): TerrainInput {
  return shape(240, 160, 2, 38, 202, (u, v, n) => {
    const fall = 0.56 + n(2.2, 9) * 0.035; // wiggly fall line
    if (u > 0.9 + n(3, 4) * 0.03) return -30 - (u - 0.9) * 600; // the ocean
    // low interfluves keep four rivers running side by side to the sea
    const inter = Math.pow(Math.abs(Math.sin((v + n(1.5, 6) * 0.04) * Math.PI * 4)), 2);
    if (u > fall) {
      // flat, sandy coastal plain
      return 3 + (0.9 - u) * 110 + inter * 22 + n(6) * 3;
    }
    // piedmont rising to a mountain front in the far west
    const t = (fall - u) / fall;
    const piedmont = 120 + t * 380 + smoothstep(0.7, 1, t) * 900;
    const ridges = Math.abs(n(9, 2)) * 60 * t;
    return piedmont + ridges + inter * 90 + n(4) * 20;
  }, 0.45, { precipScale: 1.35 });
}

/** Two big rivers in long valleys meeting in a Y, then flowing to the sea. */
export function confluenceTerrain(): TerrainInput {
  return shape(220, 160, 2, 44, 303, (u, v, n) => {
    if (u > 0.93) return -35;
    // valley floors: two arms from the west meeting at (0.5, 0.5)
    const cx = 0.5, cy = 0.5;
    let d: number;
    if (u > cx) d = Math.abs(v - cy - n(2, 1) * 0.04);
    else {
      const armA = Math.abs(v - (cy - (cx - u) * 0.75) - n(2, 5) * 0.03);
      const armB = Math.abs(v - (cy + (cx - u) * 0.8) - n(2, 7) * 0.03);
      d = Math.min(armA, armB);
    }
    const valley = smoothstep(0.02, 0.2, d) * 520;
    return 15 + (1 - u) * 160 + valley + n(6, 2) * 40 * smoothstep(0.03, 0.15, d);
  }, 0.4, { precipScale: 1.2 });
}

/** A river estuary and a sheltered bay on a trading coast. */
export function portTerrain(): TerrainInput {
  return shape(220, 150, 2, 42, 404, (u, v, n) => {
    const coast = 0.62 + n(2, 3) * 0.04;
    // a deep, almost enclosed bay with a narrow mouth (a natural harbour)
    const bx = coast - 0.12, by = 0.24;
    const inBay = Math.hypot((u - bx) / 0.09, (v - by) / 0.1) < 1;
    const bayMouth = Math.abs(v - by) < 0.025 && u > bx && u < coast + 0.02;
    // a funnel-shaped estuary further south
    const est = Math.abs(v - 0.7) < 0.012 + Math.max(0, u - (coast - 0.15)) * 0.25 && u > coast - 0.15;
    if (u > coast || inBay || bayMouth || est) return -28 - Math.max(0, u - coast) * 300;
    // a big river valley draining the interior to the estuary
    const rv = Math.abs(v - 0.7 - Math.sin(u * 8) * 0.04 * (coast - u));
    const valley = smoothstep(0.0, 0.18, rv) * 160 * (0.3 + (coast - u));
    return 6 + (coast - u) * 380 + valley + n(5) * 25 + smoothstep(0.12, 0, u) * 500;
  }, 0.4, { precipScale: 1.2 });
}

/** Two fertile basins divided by a high range, crossed by a single low pass. */
export function passTerrain(): TerrainInput {
  return shape(220, 150, 2, 46, 505, (u, v, n) => {
    if (v > 0.95) return -30; // a sea to the south for good measure
    const ridge = Math.exp(-Math.pow((u - 0.5 - n(2, 3) * 0.03) / 0.07, 2));
    const saddle = 1 - 0.78 * Math.exp(-Math.pow((v - 0.42) / 0.06, 2)); // the pass
    const range = ridge * saddle * 2600;
    const basins = 60 + Math.abs(u - 0.5) * 40 + n(5) * 20;
    return basins + range + ridge * Math.abs(n(10, 1)) * 400 * saddle;
  }, 0.35, { precipScale: 1.7 });
}

/** A river-and-canal country that the railways will reorganise. */
export function railTerrain(): TerrainInput {
  return shape(240, 160, 2, 50, 606, (u, v, n) => {
    if (u > 0.93 + n(3, 2) * 0.02) return -30;
    const mainRiver = Math.abs(v - 0.55 - n(1.5, 4) * 0.08);
    const valley = smoothstep(0.0, 0.3, mainRiver) * 170;
    const upland = smoothstep(0.25, 0.0, v) * 300 + smoothstep(0.85, 1, v) * 250;
    return 6 + (0.93 - u) * 140 + valley + upland + n(5) * 18 + Math.abs(n(9, 7)) * 30 * smoothstep(0.05, 0.2, mainRiver);
  }, 0.45, { precipScale: 1.0 });
}
