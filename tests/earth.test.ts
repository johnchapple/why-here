import { describe, expect, it } from 'vitest';
import { scoreRegion, RegionMeta } from '../src/earth/loader';
import type { Settlement } from '../src/sim/types';

const town = (id: number, x: number, y: number, pop: number): Settlement => ({
  id, name: `T${id}`, cell: 0, x, y, founded: 0, foundedEra: 0, origin: 'market', pop, peakPop: pop, ruralPop: 0, ruralCap: 0,
  tier: 3, market: true, marketSince: 0, order: 1, capital: false, port: false, rail: false, servedBy: -1, servedPop: 0, abandoned: false,
  foundingFactors: [], siteFacts: [], growth: { farming: 0, market: 0, trade: 0, transfer: 0, through: 0, industry: 0, resource: 0, admin: 0 }, history: [], resourceId: -1, popHistory: [],
});

const meta: RegionMeta = {
  id: 't', W: 100, H: 100, cellKm: 5, bbox: [0, 0, 1, 1], latTop: 1, latBottom: 0, inflows: [], resources: [],
  cities: [
    { name: 'Big', lon: 0, lat: 0, x: 20, y: 20, pop: 1e6, capital: '', country: '' },
    { name: 'Suburb', lon: 0, lat: 0, x: 21, y: 20, pop: 2e5, capital: '', country: '' },
    { name: 'Far', lon: 0, lat: 0, x: 80, y: 80, pop: 5e5, capital: '', country: '' },
  ],
};

describe('earth scoring', () => {
  it('matches nearby model towns, merges suburbs and reports misses', () => {
    const r = scoreRegion(meta, [town(0, 22, 21, 50000), town(1, 50, 50, 40000)], 20);
    expect(r.k).toBe(2); // the suburb is merged into Big
    expect(r.matched.map((m) => m.real.name)).toEqual(['Big']);
    expect(r.missed.map((m) => m.name)).toEqual(['Far']);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(100);
  });

  it('a random baseline is computed from the land mask', () => {
    const land = new Uint8Array(100 * 100);
    const r = scoreRegion(meta, [town(0, 20, 20, 5e4), town(1, 80, 80, 4e4)], 20, land);
    expect(r.score).toBe(100);
    expect(r.baseline).toBeGreaterThanOrEqual(0);
    expect(r.baseline).toBeLessThan(100);
  });
});
