import { generateTerrain, DEFAULT_GEN } from '../src/sim/terrain';
import { buildWorld } from '../src/sim/world';
import { Sim } from '../src/sim/emergence';
import { hashString } from '../src/sim/rng';
const seed = process.argv[2] ?? 'atlas';
const until = +(process.argv[3] ?? 1600);
const t = generateTerrain({ ...DEFAULT_GEN, seed });
const w = buildWorld(t, hashString(seed));
const t0 = performance.now();
const sim = new Sim(w, hashString(seed));
let last = performance.now();
while (sim.year < until) {
  sim.advance(10);
  if (sim.year % 200 === 0) {
    const now = performance.now();
    const live = sim.settlements.filter(s=>!s.abandoned);
    const top = [...live].sort((a,b)=>b.pop-a.pop).slice(0,6).map(s=>`${s.name}:${Math.round(s.pop)}${s.port?'⚓':''}${s.capital?'*':''}`).join(' ');
    const snap = sim.snapshot();
    console.log(`y${sim.year} era${sim.era} n=${live.length} mk=${live.filter(s=>s.market).length} pop=${Math.round(snap.stats.totalPop)} zipf=${snap.stats.zipfSlope.toFixed(2)} roads=${snap.roadEdges.length/3} rail=${snap.railEdges.length/2} dt=${(now-last).toFixed(0)}ms | ${top}`);
    last = now;
  }
}
console.log('total', (performance.now()-t0).toFixed(0), 'ms');
const snap = sim.snapshot();
console.log(snap.events.slice(-25).map(e=>`${e.year}: ${e.text}`).join('\n'));
