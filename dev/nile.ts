import fs from 'fs'; import zlib from 'zlib';
import { buildWorld } from '../src/sim/world';
import { REGION_DEFS } from '../src/earth/regionDefs';
import type { TerrainInput } from '../src/sim/grid';
const id='nile';
const meta = JSON.parse(fs.readFileSync(`public/regions/${id}.json`, 'utf8'));
const buf = zlib.gunzipSync(fs.readFileSync(`public/regions/${id}.bin.gz`));
const N = meta.W*meta.H; const elev = new Float32Array(N); const mask = Uint8Array.from(buf.subarray(N*2,N*3)); const burn = Uint8Array.from(buf.subarray(N*3,N*4));
for (let i=0;i<N;i++){ let e=buf.readInt16LE(i*2); if(mask[i]===0&&e<1)e=1; if(mask[i]===1&&e>-5)e=-5; elev[i]=e; }
const def = REGION_DEFS.find(d=>d.id===id)!;
const t: TerrainInput = { W: meta.W, H: meta.H, cellKm: meta.cellKm, elev, latTop: meta.latTop, latBottom: meta.latBottom, waterMask: mask, riverBurn: burn, inflow: meta.inflows.map((f:any)=>({cell:f.cell,q:f.q})), precipScale: def.precipScale, wind: def.wind ?? 'auto' };
const w = buildWorld(t, 42, true);
console.log('inflow', meta.inflows, 'W', meta.W);
let c = meta.inflows[0].cell; let k=0;
while (c >= 0 && k < 400) { if (k%10===0) console.log(k, c%meta.W, Math.floor(c/meta.W), 'e', w.elev[c].toFixed(0), 'filled', w.filled[c].toFixed(1), 'Q', w.discharge[c].toFixed(0), 'water', w.water[c], 'river', w.river[c]); c = w.flowDir[c]; k++; }
console.log('end', c, k);
