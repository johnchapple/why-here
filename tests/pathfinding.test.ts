import { describe, expect, it } from 'vitest';
import { buildWorld } from '../src/sim/world';
import { buildCostModel, Pathfinder } from '../src/sim/movement';
import { ERAS } from '../src/sim/eras';
import type { TerrainInput } from '../src/sim/grid';

function emptyInfra(N: number) {
  return { roads: new Uint8Array(N), rail: new Uint8Array(N), railEdge: new Set<number>(), canal: new Uint8Array(N) };
}

/** Flat plain, sea on the right edge. */
function plain(W = 30, H = 20, hill = false): TerrainInput {
  const elev = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let e = x < W - 3 ? 20 + (W - x) * 0.05 : -30;
    if (hill && x >= 10 && x <= 14) e += 900; // a ridge across the map
    elev[y * W + x] = e;
  }
  return { W, H, cellKm: 2, elev, latTop: 46, latBottom: 45, wind: 'west', precipScale: 0.05 };
}

describe('pathfinding', () => {
  it('on flat land, cost grows with distance and diagonals cost sqrt(2)', () => {
    const w = buildWorld(plain(), 1);
    const cm = buildCostModel(w, ERAS[0], emptyInfra(w.N));
    const pf = new Pathfinder(w);
    const src = 10 * w.W + 2;
    const r = pf.run(cm, [{ node: src }], Infinity, { landOnly: true });
    const straight = r.dist[10 * w.W + 8];
    const diag = r.dist[16 * w.W + 8];
    expect(straight).toBeGreaterThan(0);
    expect(diag / straight).toBeGreaterThan(1.3);
    expect(diag / straight).toBeLessThan(1.5);
  });

  it('prefers going around a ridge when the detour is cheaper, and climbing costs more', () => {
    const flat = buildWorld(plain(30, 20, false), 1);
    const hilly = buildWorld(plain(30, 20, true), 1);
    const a = 10 * 30 + 3, b = 10 * 30 + 22;
    const run = (w: typeof flat) => new Pathfinder(w).run(buildCostModel(w, ERAS[0], emptyInfra(w.N)), [{ node: a }], Infinity, { landOnly: true }).dist[b];
    expect(run(hilly)).toBeGreaterThan(run(flat) * 1.5);
  });

  it('roads make travel cheaper (path dependence)', () => {
    const w = buildWorld(plain(), 1);
    const a = 10 * w.W + 2, b = 10 * w.W + 20;
    const infra = emptyInfra(w.N);
    const pf = new Pathfinder(w);
    const before = pf.run(buildCostModel(w, ERAS[1], infra), [{ node: a }], Infinity, { landOnly: true }).dist[b];
    for (let x = 2; x <= 20; x++) infra.roads[10 * w.W + x] = 3;
    const after = pf.run(buildCostModel(w, ERAS[1], infra), [{ node: a }], Infinity, { landOnly: true }).dist[b];
    expect(after).toBeLessThan(before * 0.6);
  });

  it('switching between land and water costs a transfer (break of bulk) and sea travel is cheap in the age of sail', () => {
    const W = 40, H = 20;
    const elev = new Float32Array(W * H);
    // two coastal points separated by a long bay
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) elev[y * W + x] = y < 8 ? -40 : 20;
    const w = buildWorld({ W, H, cellKm: 2, elev, latTop: 46, latBottom: 45, wind: 'west', precipScale: 0.05 }, 1);
    const pf = new Pathfinder(w);
    const a = 8 * W + 2, b = 8 * W + 36;
    const cm = buildCostModel(w, ERAS[1], { roads: new Uint8Array(w.N), rail: new Uint8Array(w.N), railEdge: new Set(), canal: new Uint8Array(w.N) });
    const r = pf.run(cm, [{ node: a }]);
    const path = pf.trace(b);
    const usesWater = path.some((n) => n >= w.N);
    expect(usesWater).toBe(true);
    // landOnly is costlier than the ship route
    const land = new Pathfinder(w).run(cm, [{ node: a }], Infinity, { landOnly: true }).dist[b];
    expect(r.dist[b]).toBeLessThan(land);
    // and the trip pays at least two transfers
    expect(r.dist[b]).toBeGreaterThan(2 * ERAS[1].transfer * 0.5);
  });
});
