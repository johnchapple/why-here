import fs from 'fs'; import zlib from 'zlib';
import { buildWorld } from '../src/sim/world';
import { Sim } from '../src/sim/emergence';
import { REGION_DEFS } from '../src/earth/regionDefs';
import { scoreRegion, RegionMeta } from '../src/earth/loader';
import type { TerrainInput } from '../src/sim/grid';
import { PNG } from 'pngjs';
import { hashString } from '../src/sim/rng';
const id = process.argv[2]; const until = +(process.argv[3] ?? 1600);
const meta: RegionMeta = JSON.parse(fs.readFileSync(`public/regions/${id}.json`, 'utf8'));
const buf = zlib.gunzipSync(fs.readFileSync(`public/regions/${id}.bin.gz`));
const N = meta.W*meta.H; const elev = new Float32Array(N); const mask = Uint8Array.from(buf.subarray(N*2,N*3)); const burn = Uint8Array.from(buf.subarray(N*3,N*4));
for (let i=0;i<N;i++){ let e=buf.readInt16LE(i*2); if(mask[i]===0&&e<1)e=1; if(mask[i]===1&&e>-5)e=-5; elev[i]=e; }
const def = REGION_DEFS.find(d=>d.id===id)!;
const t: TerrainInput = { W: meta.W, H: meta.H, cellKm: meta.cellKm, elev, latTop: meta.latTop, latBottom: meta.latBottom, waterMask: mask, riverBurn: burn, inflow: meta.inflows.map(f=>({cell:f.cell,q:f.q})), precipScale: def.precipScale, precipBase: def.precipBase, wind: def.wind ?? 'auto', resources: meta.resources.map((r,i)=>({id:i,kind:r.kind,cell:r.cell,richness:0.9})) };
const t0 = performance.now();
const SEED = hashString(id);
const w = buildWorld(t, SEED, true);
let nav=0; for (let i=0;i<N;i++) if (w.navigable[i]&&!w.water[i]) nav++;
console.log(id, 'world', (performance.now()-t0).toFixed(0),'ms', 'nav', nav, 'rivers', w.rivers.slice(0,5).map(r=>r.q.toFixed(0)).join(','));
const sim = new Sim(w, SEED);
const t1 = performance.now();
while (sim.year < until) sim.advance(10);
console.log('sim', (performance.now()-t1).toFixed(0), 'ms');
const live = sim.settlements.filter(s=>!s.abandoned);
const res = scoreRegion(meta, sim.settlements, 20, mask);
console.log(`score ${res.score} baseline ${res.baseline} size ${res.sizeScore} matched ${res.matched.length}/${res.k} radius ${res.radiusKm.toFixed(0)}km`);
console.log('matched:', res.matched.map(m=>`${m.real.name}~#${m.modelRank}(${Math.round(m.model.pop/1000)}k,${m.km.toFixed(0)}km)`).join('; '));
console.log('missed:', res.missed.map(r=>r.name).join(', '));
console.log('phantoms:', res.phantoms.map(p=>`${p.name}[${p.origin},${Math.round(p.pop/1000)}k] @${(meta.bbox[0]+(p.x)/meta.W*(meta.bbox[2]-meta.bbox[0])).toFixed(2)},${(meta.bbox[3]-(p.y)/meta.H*(meta.bbox[3]-meta.bbox[1])).toFixed(2)}`).join('; '));
const cap = live.find(s=>s.capital); if (cap) { const near = meta.cities.map(c=>({c, d: Math.hypot(c.x-cap.x,c.y-cap.y)*meta.cellKm})).sort((a,b)=>a.d-b.d)[0]; console.log('capital', cap.name, 'near', near.c.name, near.d.toFixed(0),'km'); }
// image
const S=2; const png=new PNG({width:meta.W*S,height:meta.H*S});
for (let y=0;y<meta.H*S;y++) for(let x=0;x<meta.W*S;x++){ const i=((y/S)|0)*meta.W+((x/S)|0); const o=(y*meta.W*S+x)*4; let r,g,b;
 if(w.water[i]===1){r=60;g=90;b=150}else if(w.water[i]===2){r=80;g=140;b=200}else{const f=w.fertility[i]; r=150+Math.min(100,w.elev[i]/20); g=100+f*130; b=80; if(w.river[i]){r=30;g=60;b=w.navigable[i]?120:220}}
 png.data[o]=Math.min(255,r);png.data[o+1]=Math.min(255,g);png.data[o+2]=Math.min(255,b);png.data[o+3]=255;}
const dot=(cx:number,cy:number,c:number[],r:number)=>{for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const X=Math.floor(cx*S)+dx,Y=Math.floor(cy*S)+dy; if(X<0||Y<0||X>=meta.W*S||Y>=meta.H*S)continue; const o=(Y*meta.W*S+X)*4; png.data[o]=c[0];png.data[o+1]=c[1];png.data[o+2]=c[2];}};
for (const s of live) if (s.tier>=2) dot(s.x,s.y,[0,0,0],s.tier>=3?3:1);
for (const c of meta.cities.slice(0,20)) dot(c.x,c.y,[255,0,0],2);
fs.writeFileSync(`dev/out/earth_${id}.png`, PNG.sync.write(png));
const lonOf=(x:number)=>(meta.bbox[0]+x/meta.W*(meta.bbox[2]-meta.bbox[0])).toFixed(2), latOf=(y:number)=>(meta.bbox[3]-y/meta.H*(meta.bbox[3]-meta.bbox[1])).toFixed(2);
for (const s of [...live].sort((a,b)=>b.pop-a.pop).slice(0,15)) {
  const g = s.growth; const tot = Object.values(g).reduce((a,b)=>a+b,0);
  const near = meta.cities.map(c=>({c, d: Math.hypot(c.x-s.x,c.y-s.y)*meta.cellKm})).sort((a,b)=>a.d-b.d)[0];
  console.log(`${s.name.padEnd(16)} ${String(Math.round(s.pop/1000)).padStart(5)}k ${s.origin.padEnd(9)} ${lonOf(s.x)},${latOf(s.y)} near ${near.c.name} ${near.d.toFixed(0)}km | ` + Object.entries(g).filter(([k,v])=>v/tot>0.05).map(([k,v])=>`${k}:${Math.round(100*v/tot)}`).join(' ') + ' | ' + s.foundingFactors.slice(0,2).map(f=>f.key).join(','));
}
const at=(lon:number,lat:number)=>{const x=Math.floor((lon-meta.bbox[0])/(meta.bbox[2]-meta.bbox[0])*meta.W), y=Math.floor((meta.bbox[3]-lat)/(meta.bbox[3]-meta.bbox[1])*meta.H); let f=0,p=0,sl=0,n=0,mr=0; for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){const i=(y+dy)*meta.W+x+dx; if(w.water[i])continue; f+=w.fertility[i]; p+=w.precip[i]; sl+=w.slope[i]; mr+=w.marsh[i]; n++;} return `f=${(f/n).toFixed(2)} P=${(p/n).toFixed(0)} slope=${(sl/n).toFixed(3)} marsh=${(mr/n).toFixed(2)}`;};
if (id==='missohio') for (const [n,lo,la] of [['Indiana',-86,40],['Ohio',-83,40],['LA delta',-91,30.5],['Tennessee',-86.5,36],['Kentucky',-85,37.5],['Illinois',-89,40.5]] as [string,number,number][]) console.log(n, at(lo,la));
