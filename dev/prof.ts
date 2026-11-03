import { generateTerrain, DEFAULT_GEN } from '../src/sim/terrain';
import { buildWorld } from '../src/sim/world';
import { Sim } from '../src/sim/emergence';
const t = generateTerrain({ ...DEFAULT_GEN, seed: 'atlas' });
const w = buildWorld(t, 1);
let t0 = performance.now();
const sim = new Sim(w, 1);
console.log('ctor', performance.now()-t0);
for (let k=0;k<12;k++){ t0=performance.now(); sim.step(); console.log(sim.year, (performance.now()-t0).toFixed(0), sim.settlements.length); }
t0=performance.now(); sim.updateTrade(); console.log('trade', performance.now()-t0);
