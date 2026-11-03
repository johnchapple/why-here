import { generateTerrain, DEFAULT_GEN } from '../src/sim/terrain';
import { buildWorld } from '../src/sim/world';
import { Sim } from '../src/sim/emergence';
import { buildCostModel } from '../src/sim/movement';
const t = generateTerrain({ ...DEFAULT_GEN, seed: 'atlas' });
const w = buildWorld(t, 1);
const sim = new Sim(w, 1);
for (let k=0;k<60;k++) sim.step();
const prof: Record<string, number> = {};
const anySim = sim as any;
for (const name of ['growRural','foundVillages','updateMarkets','updateTrade','foundResourceTowns','updatePopulations','buildRail','refreshCosts','claim']) {
  const orig = anySim[name].bind(sim);
  anySim[name] = (...a: any[]) => { const t0=performance.now(); const r = orig(...a); prof[name]=(prof[name]??0)+performance.now()-t0; return r; };
}
const pf = sim.pf as any; const orun = pf.run.bind(pf);
pf.run = (...a: any[]) => { const t0=performance.now(); const r = orun(...a); prof.dijkstra=(prof.dijkstra??0)+performance.now()-t0; prof.nd=(prof.nd??0)+1; return r; };
let t0 = performance.now();
for (let k=0;k<40;k++) sim.step();
console.log('40 steps', performance.now()-t0, prof);
t0 = performance.now(); buildCostModel(w, sim.eraDef, sim.infra); console.log('cm', performance.now()-t0);
