import { describe, expect, it } from 'vitest';
import { computeHydrology, priorityFlood } from '../src/sim/hydrology';
import { generateTerrain, DEFAULT_GEN } from '../src/sim/terrain';
import { buildWorld } from '../src/sim/world';
import type { TerrainInput } from '../src/sim/grid';

/** A tilted plane with a bowl in the middle, sea along the left edge. */
function bowlTerrain(): TerrainInput {
  const W = 40, H = 30;
  const elev = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let e = x * 8 - 20; // sea for x < 3
    const d = Math.hypot(x - 25, y - 15);
    if (d < 5) e -= (5 - d) * 30; // a pit
    elev[y * W + x] = e;
  }
  return { W, H, cellKm: 2, elev, latTop: 46, latBottom: 45, wind: 'west' };
}

describe('hydrology', () => {
  it('priority-flood leaves no land pits: every land cell has a strictly lower neighbour or is an outlet', () => {
    const t = bowlTerrain();
    const water = new Uint8Array(t.W * t.H);
    for (let i = 0; i < water.length; i++) if (t.elev[i] < 0 && i % t.W < 3) water[i] = 1;
    const f = priorityFlood(t.W, t.H, t.elev, water);
    for (let y = 1; y < t.H - 1; y++) for (let x = 1; x < t.W - 1; x++) {
      const i = y * t.W + x;
      if (water[i]) continue;
      let lower = false;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if ((ox || oy) && f[(y + oy) * t.W + x + ox] < f[i]) lower = true;
      expect(lower).toBe(true);
    }
  });

  it('water always drains to the sea or off the map (no cycles, no sinks on land)', () => {
    const t = generateTerrain({ ...DEFAULT_GEN, W: 120, H: 90, seed: 'test-drain' });
    const h = computeHydrology(t, 1);
    const N = t.W * t.H;
    for (let i = 0; i < N; i += 7) {
      if (h.water[i] === 1) continue;
      let c = i, steps = 0;
      while (c >= 0 && h.water[c] !== 1 && steps < N) { c = h.flowDir[c]; steps++; }
      expect(steps).toBeLessThan(N);
      expect(c === -2 || c === -1 || h.water[c] === 1).toBe(true);
    }
  });

  it('rivers never flow uphill on the filled surface', () => {
    const t = generateTerrain({ ...DEFAULT_GEN, W: 120, H: 90, seed: 'test-uphill' });
    const h = computeHydrology(t, 1);
    for (let i = 0; i < t.W * t.H; i++) {
      const d = h.flowDir[i];
      if (d >= 0 && h.water[i] !== 1) expect(h.filled[d]).toBeLessThan(h.filled[i]);
    }
  });

  it('discharge accumulates downstream (a river is at least as big as any tributary)', () => {
    const t = generateTerrain({ ...DEFAULT_GEN, W: 120, H: 90, seed: 'test-acc' });
    const h = computeHydrology(t, 1);
    for (let i = 0; i < t.W * t.H; i++) {
      const d = h.flowDir[i];
      if (d >= 0 && !h.water[i] && !h.water[d]) expect(h.discharge[d]).toBeGreaterThanOrEqual(h.discharge[i] - 1e-3);
    }
  });

  it('fills an enclosed depression into a lake', () => {
    const t = bowlTerrain();
    const h = computeHydrology(t, 1);
    expect(h.water[15 * t.W + 25]).toBe(2);
  });

  it('finds river features on a generated world', () => {
    const t = generateTerrain({ ...DEFAULT_GEN, seed: 'atlas' });
    const w = buildWorld(t, 7);
    const kinds = new Set(w.features.map((f) => f.kind));
    expect(kinds.has('confluence')).toBe(true);
    expect(kinds.has('ford')).toBe(true);
    expect(w.rivers.length).toBeGreaterThan(0);
  });
});
