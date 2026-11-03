import { describe, expect, it } from 'vitest';
import { generateTerrain, DEFAULT_GEN } from '../src/sim/terrain';
import { buildWorld } from '../src/sim/world';
import { Sim, tierOf, zipfFit } from '../src/sim/emergence';

const params = { ...DEFAULT_GEN, W: 160, H: 112, cellKm: 4, seed: 'unit' };

function run(years: number, seed = 5) {
  const w = buildWorld(generateTerrain(params), seed);
  const sim = new Sim(w, seed);
  sim.advance(years);
  return { w, sim };
}

describe('emergence', () => {
  it('is deterministic for a given seed', () => {
    const a = run(300).sim.snapshot();
    const b = run(300).sim.snapshot();
    expect(a.settlements.map((s) => [s.name, s.cell, Math.round(s.pop)])).toEqual(b.settlements.map((s) => [s.name, s.cell, Math.round(s.pop)]));
  });

  it('founds villages on fertile, low land — never on mountain tops or in the sea', () => {
    const { w, sim } = run(400);
    const live = sim.settlements.filter((s) => !s.abandoned);
    expect(live.length).toBeGreaterThan(10);
    for (const s of live) {
      expect(w.water[s.cell]).toBe(0);
      expect(w.elev[s.cell]).toBeLessThan(2600);
    }
    const meanFert = live.reduce((a, s) => a + w.fertility[s.cell], 0) / live.length;
    let landFert = 0, n = 0;
    for (let i = 0; i < w.N; i++) if (!w.water[i]) { landFert += w.fertility[i]; n++; }
    expect(meanFert).toBeGreaterThan(landFert / n);
  });

  it('villages keep their distance (about a day\'s walk of farmland each)', () => {
    const { sim, w } = run(500);
    const live = sim.settlements.filter((s) => !s.abandoned && s.origin === 'farming');
    let minD = Infinity;
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      minD = Math.min(minD, Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y) * w.cellKm);
    }
    expect(minD).toBeGreaterThanOrEqual(8);
  });

  it('market towns emerge and serve the villages around them', () => {
    const { sim } = run(500);
    const markets = sim.settlements.filter((s) => s.market && !s.abandoned);
    expect(markets.length).toBeGreaterThan(0);
    expect(markets.every((m) => m.marketFactors && m.marketFactors.length > 0)).toBe(true);
    const served = sim.settlements.filter((s) => s.servedBy >= 0);
    expect(served.length).toBeGreaterThan(markets.length);
  });

  it('every settlement can explain itself: founding factors sum to ~100%', () => {
    const { sim } = run(300);
    for (const s of sim.settlements) {
      const sum = s.foundingFactors.reduce((a, f) => a + f.weight, 0);
      expect(sum).toBeGreaterThan(0.99);
      expect(sum).toBeLessThan(1.01);
    }
  });

  it('one step advances ten years and never loses population to NaN', () => {
    const { sim } = run(100);
    const y = sim.year;
    sim.step();
    expect(sim.year).toBe(y + 10);
    for (const s of sim.settlements) expect(Number.isFinite(s.pop)).toBe(true);
  });

  it('tiers and Zipf fit behave', () => {
    expect(tierOf(100)).toBe(0);
    expect(tierOf(3000)).toBe(2);
    expect(tierOf(200000)).toBe(4);
    const zipf = Array.from({ length: 30 }, (_, i) => 100000 / (i + 1));
    const f = zipfFit(zipf);
    expect(f.slope).toBeCloseTo(-1, 3);
    expect(f.r2).toBeCloseTo(1, 3);
  });
});
