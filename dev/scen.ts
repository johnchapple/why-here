import * as T from '../src/sim/scenarioTerrain';
import { buildWorld } from '../src/sim/world';
import { Sim } from '../src/sim/emergence';
import { PNG } from 'pngjs';
import fs from 'fs';
const name = process.argv[2] as keyof typeof T;
const until = +(process.argv[3] ?? 0);
const t = (T as any)[name]();
const w = buildWorld(t, 77);
const counts: Record<string, number> = {};
for (const f of w.features) counts[f.kind] = (counts[f.kind]??0)+1;
let nav=0; for (let i=0;i<w.N;i++) if (w.navigable[i]&&!w.water[i]) nav++;
console.log(name, counts, 'nav', nav, 'rivers', w.rivers.map(r=>`${r.name}:${r.q.toFixed(0)}`).join(' '));
let sim: Sim | null = null;
if (until) { sim = new Sim(w, 77); while (sim.year < until) sim.advance(10);
  const live = sim.settlements.filter(s=>!s.abandoned).sort((a,b)=>b.pop-a.pop);
  console.log(live.slice(0,8).map(s=>`${s.name}(${s.origin},${Math.round(s.pop)}${s.port?',port':''}) [${s.foundingFactors.slice(0,2).map(f=>f.key).join(',')}]`).join('\n'));
}
const S=3; const png = new PNG({ width: w.W*S, height: w.H*S });
for (let y=0;y<w.H*S;y++) for (let x=0;x<w.W*S;x++){ const i=((y/S)|0)*w.W+((x/S)|0); const o=(y*w.W*S+x)*4;
 let r,g,b; const e=w.elev[i];
 if (w.water[i]===1){ r=60;g=90;b=150;} else if (w.water[i]===2){r=80;g=140;b=200;}
 else { const f=w.fertility[i]; r=150+e/12; g=110+f*120; b=90; if (w.river[i]) { r=30;g=60;b=w.navigable[i]?120:220;} }
 png.data[o]=Math.min(255,r);png.data[o+1]=Math.min(255,g);png.data[o+2]=Math.min(255,b);png.data[o+3]=255; }
const col: Record<string,number[]> = {confluence:[255,0,255],mouth:[255,255,0],fall:[255,0,0],head:[255,128,0],ford:[0,255,0],pass:[255,255,255],lakeshore:[0,255,255]};
const dot=(cx:number,cy:number,c:number[],r=1)=>{for(let dy=-r;dy<=S+r-1;dy++)for(let dx=-r;dx<=S+r-1;dx++){const o=((cy*S+dy)*w.W*S+cx*S+dx)*4; if(o<0||o>=png.data.length) continue; png.data[o]=c[0];png.data[o+1]=c[1];png.data[o+2]=c[2];}};
for (const f of w.features) dot(f.cell%w.W,(f.cell/w.W)|0,col[f.kind]);
if (sim) for (const s of sim.settlements) if(!s.abandoned) dot(Math.floor(s.x),Math.floor(s.y), s.tier>=2?[0,0,0]:[90,60,40], s.tier>=2?2:0);
fs.writeFileSync(`dev/out/scen_${name}.png`, PNG.sync.write(png));
