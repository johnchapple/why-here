import { generateTerrain, DEFAULT_GEN } from '../src/sim/terrain';
import { buildWorld } from '../src/sim/world';
import { PNG } from 'pngjs';
import fs from 'fs';
const seed = process.argv[2] ?? 'atlas';
let t0 = performance.now();
const t = generateTerrain({ ...DEFAULT_GEN, seed });
let t1 = performance.now();
const w = buildWorld(t, 1);
let t2 = performance.now();
console.log('gen', (t1-t0).toFixed(0), 'world', (t2-t1).toFixed(0));
const counts: Record<string, number> = {};
for (const f of w.features) counts[f.kind] = (counts[f.kind]??0)+1;
let land=0, riv=0, nav=0, lake=0; let maxQ=0;
for (let i=0;i<w.N;i++){ if(!w.water[i])land++; if(w.river[i])riv++; if(w.navigable[i]&&!w.water[i])nav++; if(w.water[i]===2)lake++; maxQ=Math.max(maxQ,w.discharge[i]); }
console.log({counts, land, riv, nav, lake, maxQ, rivers: w.rivers.map(r=>[r.name, r.q.toFixed(0), r.cells.length]), res: w.resources.length});
let pmin=1e9,pmax=0; for (let i=0;i<w.N;i++){ if(!w.water[i]){pmin=Math.min(pmin,w.precip[i]);pmax=Math.max(pmax,w.precip[i]);} }
console.log('precip', pmin.toFixed(0), pmax.toFixed(0));
const S=3; const png = new PNG({ width: w.W*S, height: w.H*S });
for (let y=0;y<w.H*S;y++) for (let x=0;x<w.W*S;x++){ const i=((y/S)|0)*w.W+((x/S)|0); const o=(y*w.W*S+x)*4;
 let r,g,b; const e=w.elev[i];
 if (w.water[i]===1){ r=60;g=90;b=150;} else if (w.water[i]===2){r=80;g=140;b=200;}
 else { const f=w.fertility[i]; r=150+e/30; g=120+f*120; b=90; if (w.river[i]) { const q=Math.log10(w.discharge[i]); r=30;g=60;b=200- (w.navigable[i]?100:0);} }
 png.data[o]=Math.min(255,r);png.data[o+1]=Math.min(255,g);png.data[o+2]=Math.min(255,b);png.data[o+3]=255; }
const col: Record<string,number[]> = {confluence:[255,0,255],mouth:[255,255,0],fall:[255,0,0],head:[255,128,0],ford:[0,255,0],pass:[255,255,255],lakeshore:[0,255,255]};
for (const f of w.features){ const fx=f.cell%w.W, fy=(f.cell/w.W)|0; for(let dy=-1;dy<=S;dy++)for(let dx=-1;dx<=S;dx++){const o=((fy*S+dy)*w.W*S+fx*S+dx)*4; if(o<0||o>=png.data.length) continue; const c=col[f.kind]; png.data[o]=c[0];png.data[o+1]=c[1];png.data[o+2]=c[2];}}
fs.writeFileSync('dev/out/dbg.png', PNG.sync.write(png));
for (const r of w.rivers.slice(0,2)) console.log(r.name, r.cells.filter((_,k)=>k%6===0).map(c=>`${w.elev[c].toFixed(0)}m/${(w.riverGrad[c]*1000).toFixed(1)}/${w.discharge[c].toFixed(0)}`).join(' '));
