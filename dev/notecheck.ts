import fs from 'fs';
import { NOTES } from '../src/earth/notes';
for (const [id, n] of Object.entries(NOTES)) {
  const meta = JSON.parse(fs.readFileSync(`public/regions/${id}.json`,'utf8'));
  const names = new Set(meta.cities.map((c:any)=>c.name));
  const missing = Object.keys(n.cities).filter(k=>!names.has(k));
  const top = meta.cities.slice(0,22).map((c:any)=>c.name).filter((k:string)=>!n.cities[k]);
  console.log(id, 'unused notes:', missing.join(', '), '| top cities w/o note:', top.join(', '));
}
