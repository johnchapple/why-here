import * as T from '../src/sim/scenarioTerrain';
import { buildWorld } from '../src/sim/world';
import { Sim } from '../src/sim/emergence';
const cases: [string, number, number, string][] = [['fallLineTerrain',12,700,'fall'],['confluenceTerrain',13,800,'confluence'],['portTerrain',14,900,'port'],['passTerrain',15,900,'pass'],['railTerrain',16,1400,'rail']];
for (const [fn, seed, year, kind] of cases) {
  const w = buildWorld((T as any)[fn](), seed);
  const sim = new Sim(w, seed);
  let base: string[] = [];
  while (sim.year < year) { sim.advance(10); if (sim.year === 1150) base = sim.settlements.filter(s=>!s.abandoned).sort((a,b)=>b.pop-a.pop).slice(0,6).map(s=>s.name); }
  const live = sim.settlements.filter(s=>!s.abandoned);
  const near = (k: string, r: number) => live.filter(s => (s.tier>=2||s.market||s.port) && w.features.some(f=>f.kind===k && Math.hypot((f.cell%w.W)+0.5-s.x, Math.floor(f.cell/w.W)+0.5-s.y)<=r));
  if (kind==='fall') console.log(fn, 'towns at falls:', near('fall',4).map(s=>s.name).join(', '));
  if (kind==='confluence') { const main=[...w.features].filter(f=>f.kind==='confluence').sort((a,b)=>b.strength-a.strength)[0]; const c=live.filter(s=>Math.hypot((main.cell%w.W)+0.5-s.x,Math.floor(main.cell/w.W)+0.5-s.y)<6).sort((a,b)=>b.pop-a.pop); console.log(fn, 'near main confluence:', c.map(s=>`${s.name}(${Math.round(s.pop)})`).join(', ')); }
  if (kind==='port') console.log(fn, 'ports:', live.filter(s=>s.port).sort((a,b)=>b.pop-a.pop).slice(0,4).map(s=>`${s.name}(${Math.round(s.pop)},${Math.round(100*s.growth.transfer/s.pop)}%)`).join(', '));
  if (kind==='pass') console.log(fn, 'near pass (12):', live.filter(s=>w.features.some(f=>f.kind==='pass'&&Math.hypot((f.cell%w.W)+0.5-s.x,Math.floor(f.cell/w.W)+0.5-s.y)<=12)).map(s=>`${s.name}[${s.origin}]`).join(', '), 'pass towns:', live.filter(s=>s.origin==='pass').length);
  if (kind==='rail') console.log(fn, 'top 1150:', base.join(', '), '| now:', live.sort((a,b)=>b.pop-a.pop).slice(0,6).map(s=>s.name+(s.rail?'(R)':'')).join(', '));
}
