import { generateTerrain, DEFAULT_GEN } from '../src/sim/terrain';
import { buildWorld } from '../src/sim/world';
import { Sim } from '../src/sim/emergence';
const t = generateTerrain({ ...DEFAULT_GEN, seed: 'atlas' });
const w = buildWorld(t, 1);
const sim = new Sim(w, 1);
for (let k=0;k<9;k++) sim.step();
const pf = sim.pf as any;
const orun = pf.run.bind(pf);
pf.run = (...a: any[]) => { const t0=performance.now(); const r = orun(...a); console.log('run', a[1].length, (performance.now()-t0).toFixed(0)); return r; };
const anySim = sim as any;
for (const name of ['updateRoads','nearestSettlement','tooClose','evalSite','newSettlement','isCoastal']) {
  const orig = anySim[name].bind(sim);
  let n=0;
  anySim[name] = (...a: any[]) => { if(n++<5) console.log('>', name); return orig(...a); };
}
anySim.updateTrade();
console.log("script done")
