import { generateTerrain, DEFAULT_GEN } from '../src/sim/terrain';
import { buildWorld } from '../src/sim/world';
import { Sim } from '../src/sim/emergence';
import { hashString } from '../src/sim/rng';
const t = generateTerrain({ ...DEFAULT_GEN, seed: 'atlas' });
const w = buildWorld(t, hashString('atlas'));
const sim = new Sim(w, hashString('atlas'));
const prof: Record<string, number> = {};
const anySim = sim as any;
for (const name of ['growRural','foundVillages','updateMarkets','updateTrade','foundResourceTowns','updatePopulations','buildRail','refreshCosts','claim','updateRoads','buildAvailability','snapshot']) {
  const orig = anySim[name].bind(sim);
  anySim[name] = (...a: any[]) => { const t0=performance.now(); const r = orig(...a); prof[name]=(prof[name]??0)+performance.now()-t0; return r; };
}
const pf = sim.pf as any; const orun = pf.run.bind(pf);
pf.run = (...a: any[]) => { const t0=performance.now(); const r = orun(...a); prof.dijkstra=(prof.dijkstra??0)+performance.now()-t0; prof.nd=(prof.nd??0)+1; return r; };
const t0 = performance.now();
while (sim.year < 1600) { sim.advance(10); if (sim.year % 100 === 0) sim.snapshot(); }
console.log('total', performance.now()-t0);
console.log(Object.entries(prof).map(([k,v])=>`${k}:${v.toFixed(0)}`).join(' '));
