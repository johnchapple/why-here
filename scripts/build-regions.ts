// Build-time preprocessing for Earth Mode.
//
//   npx tsx scripts/build-regions.ts [regionId ...]
//
// For each curated region this script
//  1. downloads AWS Terrain Tiles (Terrarium PNG encoding) at a zoom level
//     fine enough for the grid, and averages them into grid cells
//     (an equirectangular grid with roughly square cells),
//  2. rasterises Natural Earth 1:10m land and lake polygons into a
//     land / ocean / lake mask,
//  3. rasterises Natural Earth river centre-lines into a "burn" mask so that
//     the simulated rivers follow the real ones,
//  4. picks the real populated places inside the region,
// and writes public/regions/<id>.bin.gz (elevation Int16 + mask + burn) and
// public/regions/<id>.json (grid metadata, inflows, real cities).
//
// Downloads are cached in .cache/ so re-running is fast. Run it once after
// changing regionDefs.ts and commit the outputs.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PNG } from 'pngjs';
import { REGION_DEFS, RegionDef } from '../src/earth/regionDefs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public', 'regions');
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const TILE = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

type Ring = number[][];
interface Geo { type: string; coordinates: unknown }
interface Feature { properties: Record<string, unknown>; geometry: Geo | null }

async function fetchCached(url: string, file: string): Promise<Buffer> {
  if (fs.existsSync(file)) return fs.readFileSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      const b = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(file, b);
      return b;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
    }
  }
  throw new Error('unreachable');
}

async function loadNE(name: string): Promise<Feature[]> {
  const buf = await fetchCached(NE + name + '.geojson', path.join(CACHE, 'ne', name + '.geojson'));
  return JSON.parse(buf.toString('utf8')).features;
}

// ---------------------------------------------------------------- tiles
const tileCache = new Map<string, Float32Array>();
async function tile(z: number, x: number, y: number): Promise<Float32Array> {
  const key = `${z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const buf = await fetchCached(TILE(z, x, y), path.join(CACHE, 'tiles', `${z}`, `${x}`, `${y}.png`));
  const png = PNG.sync.read(buf);
  const out = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    const r = png.data[i * 4], g = png.data[i * 4 + 1], b = png.data[i * 4 + 2];
    out[i] = r * 256 + g + b / 256 - 32768;
  }
  tileCache.set(key, out);
  return out;
}

function lonLatToPixel(lon: number, lat: number, z: number): [number, number] {
  const n = 256 * 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y];
}

async function elevationAt(lon: number, lat: number, z: number): Promise<number> {
  const [px, py] = lonLatToPixel(lon, lat, z);
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
  const t = await tile(z, tx, ty);
  const ix = Math.min(255, Math.floor(px - tx * 256)), iy = Math.min(255, Math.floor(py - ty * 256));
  return t[iy * 256 + ix];
}

// ---------------------------------------------------------- rasterising
interface Grid { W: number; H: number; west: number; north: number; dLon: number; dLat: number }

/** Even-odd scanline fill of polygons into mask (value v). */
function fillPolygons(features: Feature[], g: Grid, mask: Uint8Array, v: number) {
  const edges: [number, number, number, number][] = [];
  const bboxW = g.west, bboxE = g.west + g.W * g.dLon, bboxN = g.north, bboxS = g.north - g.H * g.dLat;
  const addRing = (ring: Ring) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    if (maxX < bboxW || minX > bboxE || maxY < bboxS || minY > bboxN) return;
    for (let i = 0; i < ring.length - 1; i++) edges.push([ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]]);
  };
  for (const f of features) {
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') for (const r of geom.coordinates as Ring[]) addRing(r);
    else if (geom.type === 'MultiPolygon') for (const p of geom.coordinates as Ring[][]) for (const r of p) addRing(r);
  }
  for (let y = 0; y < g.H; y++) {
    const lat = g.north - (y + 0.5) * g.dLat;
    const xs: number[] = [];
    for (const [x1, y1, x2, y2] of edges) {
      if ((y1 > lat) !== (y2 > lat)) xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - g.west) / g.dLon - 0.5));
      const c1 = Math.min(g.W - 1, Math.floor((xs[k + 1] - g.west) / g.dLon - 0.5));
      for (let x = c0; x <= c1; x++) mask[y * g.W + x] = v;
    }
  }
}

function burnLines(features: Feature[], g: Grid, burn: Uint8Array, maxRank: number) {
  const plot = (lon: number, lat: number) => {
    const x = Math.floor((lon - g.west) / g.dLon), y = Math.floor((g.north - lat) / g.dLat);
    if (x >= 0 && y >= 0 && x < g.W && y < g.H) burn[y * g.W + x] = 1;
  };
  const line = (cs: number[][]) => {
    for (let i = 0; i < cs.length - 1; i++) {
      const [a, b] = [cs[i], cs[i + 1]];
      const steps = Math.ceil(Math.max(Math.abs(b[0] - a[0]) / g.dLon, Math.abs(b[1] - a[1]) / g.dLat) * 3) + 1;
      for (let s = 0; s <= steps; s++) plot(a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps);
    }
  };
  for (const f of features) {
    const rank = Number(f.properties.scalerank ?? 99);
    if (rank > maxRank || !f.geometry) continue;
    if (f.geometry.type === 'LineString') line(f.geometry.coordinates as number[][]);
    else if (f.geometry.type === 'MultiLineString') for (const l of f.geometry.coordinates as number[][][]) line(l);
  }
}

// ------------------------------------------------------------------ main
async function buildRegion(def: RegionDef, ne: { land: Feature[]; lakes: Feature[]; rivers: Feature[]; places: Feature[] }) {
  const [west, south, east, north] = def.bbox;
  const latMid = (north + south) / 2;
  const kmLon = 111.32 * Math.cos((latMid * Math.PI) / 180);
  const kmLat = 110.57;
  const widthKm = (east - west) * kmLon, heightKm = (north - south) * kmLat;
  const cellKm = Math.max(widthKm, heightKm) / def.maxCells;
  const W = Math.round(widthKm / cellKm), H = Math.round(heightKm / cellKm);
  const g: Grid = { W, H, west, north, dLon: (east - west) / W, dLat: (north - south) / H };
  // zoom so a tile pixel is ~1/3 of a cell
  const z = Math.max(4, Math.min(9, Math.round(Math.log2((40075 * Math.cos((latMid * Math.PI) / 180)) / 256 / (cellKm / 3)))));
  console.log(`${def.id}: ${W}x${H} cells of ${cellKm.toFixed(2)} km, tiles z${z}`);

  const elev = new Int16Array(W * H);
  const sub = 3;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let j = 0; j < sub; j++) for (let i = 0; i < sub; i++) {
        const lon = west + (x + (i + 0.5) / sub) * g.dLon;
        const lat = north - (y + (j + 0.5) / sub) * g.dLat;
        s += await elevationAt(lon, lat, z);
      }
      elev[y * W + x] = Math.max(-11000, Math.min(9000, Math.round(s / (sub * sub))));
    }
    if (y % 40 === 0) process.stdout.write(`  row ${y}/${H}\r`);
  }

  // mask: start as ocean, fill land, then lakes
  const mask = new Uint8Array(W * H).fill(1);
  fillPolygons(ne.land, g, mask, 0);
  fillPolygons(ne.lakes.filter((f) => Number(f.properties.scalerank ?? 99) <= 8), g, mask, 2);
  // land cells below sea level (polders, depressions) keep their land status
  const burn = new Uint8Array(W * H);
  burnLines(ne.rivers, g, burn, def.riverRank);
  for (let i = 0; i < W * H; i++) if (mask[i]) burn[i] = 0;

  const toCell = (lon: number, lat: number) => ({ x: (lon - west) / g.dLon, y: (north - lat) / g.dLat });
  // snap inflows to the nearest burned river cell
  const inflows = def.inflows.map((f) => {
    const p = toCell(f.lon, f.lat);
    let best = -1, bd = Infinity;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!burn[i]) continue;
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bd) { bd = d; best = i; }
    }
    if (bd > 12) best = Math.floor(Math.min(H - 1, Math.max(0, p.y))) * W + Math.floor(Math.min(W - 1, Math.max(0, p.x)));
    return { name: f.name, cell: best, q: f.q };
  });

  // real cities: biggest places inside the frame (with a small margin)
  const margin = 0.02;
  const cities = ne.places
    .map((f) => f.properties as Record<string, number & string>)
    .filter((p) => p.longitude > west + (east - west) * margin && p.longitude < east - (east - west) * margin && p.latitude > south + (north - south) * margin && p.latitude < north - (north - south) * margin)
    .sort((a, b) => b.pop_max - a.pop_max)
    .slice(0, 40)
    .map((p) => {
      const c = toCell(p.longitude, p.latitude);
      return {
        name: String(p.name), lon: +p.longitude.toFixed(3), lat: +p.latitude.toFixed(3),
        x: +c.x.toFixed(2), y: +c.y.toFixed(2), pop: p.pop_max,
        capital: p.featurecla === 'Admin-0 capital' ? 'national' : p.featurecla === 'Admin-1 capital' ? 'regional' : '',
        country: String(p.adm0name),
      };
    });

  const resources = (def.resources ?? []).map((r) => { const c = toCell(r.lon, r.lat); return { ...r, cell: Math.floor(Math.min(H - 1, Math.max(0, c.y))) * W + Math.floor(Math.min(W - 1, Math.max(0, c.x))) }; });

  const bin = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) bin.writeInt16LE(elev[i], i * 2);
  Buffer.from(mask).copy(bin, W * H * 2);
  Buffer.from(burn).copy(bin, W * H * 3);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${def.id}.bin.gz`), zlib.gzipSync(bin, { level: 9 }));
  const meta = { id: def.id, W, H, cellKm: +cellKm.toFixed(4), bbox: def.bbox, latTop: north, latBottom: south, inflows, cities, resources, zoom: z };
  fs.writeFileSync(path.join(OUT, `${def.id}.json`), JSON.stringify(meta));
  let land = 0, lake = 0, riv = 0;
  for (let i = 0; i < W * H; i++) { if (mask[i] === 0) land++; if (mask[i] === 2) lake++; if (burn[i]) riv++; }
  console.log(`  land ${(100 * land / (W * H)).toFixed(0)}% lakes ${lake} river cells ${riv} cities ${cities.length}: ${cities.slice(0, 6).map((c) => c.name).join(', ')}`);
}

async function main() {
  const only = process.argv.slice(2);
  const [land, lakes, rivers, places] = await Promise.all([
    loadNE('ne_10m_land'), loadNE('ne_10m_lakes'), loadNE('ne_10m_rivers_lake_centerlines'), loadNE('ne_10m_populated_places_simple'),
  ]);
  for (const def of REGION_DEFS) {
    if (only.length && !only.includes(def.id)) continue;
    await buildRegion(def, { land, lakes, rivers, places });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
