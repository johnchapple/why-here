import { generateTerrain, DEFAULT_GEN } from '../src/sim/terrain';
import { buildWorld } from '../src/sim/world';
import { Sim } from '../src/sim/emergence';
const t = generateTerrain({ ...DEFAULT_GEN, seed: 'atlas' });
const w = buildWorld(t, 1);
const sim = new Sim(w, 1);
for (let k=0;k<9;k++) sim.step();
const anySim = sim as any;
for (const name of ['growRural','foundVillages','updateMarkets','updateTrade','foundResourceTowns','updatePopulations']) {
  const orig = anySim[name].bind(sim);
  anySim[name] = (...a: any[]) => { const t0=performance.now(); console.log('>', name); const r = orig(...a); console.log('<', name, (performance.now()-t0).toFixed(0)); return r; };
}
sim.step();
