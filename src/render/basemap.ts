// Bakes the static parts of the map: tinted hillshaded parchment raster,
// water-lining along coasts, and vector geometry (coastline, rivers,
// mountain and forest glyphs) cached as Path2D in cell coordinates.
import type { World } from '../sim/grid';
import { boxBlur, smoothstep, WATER_LAKE, WATER_OCEAN } from '../sim/grid';
import { evapotranspiration } from '../sim/climate';
import { hash2 } from '../sim/rng';
import { C, RGB, mix } from './style';
import { chaikin, marchingSquares } from './contours';

export interface RiverRun { path: Path2D; width: number; nav: boolean }

export interface Glyph { x: number; y: number; size: number; kind: 'mtn' | 'hill' }

export interface Basemap {
  S: number;
  raster: HTMLCanvasElement;
  coast: Path2D;
  lakes: Path2D;
  rivers: RiverRun[];
  glyphs: Glyph[];
  trees: Path2D;
  riverLabelPaths: { name: string; pts: number[]; q: number }[];
}

export function bakeBasemap(w: World): Basemap {
  const { W, H } = w;
  const S = Math.max(2, Math.min(5, Math.floor(1600 / W)));
  const N = W * H;

  // --- per-cell colour and shade ------------------------------------------
  const elevL = new Float32Array(N);
  for (let i = 0; i < N; i++) elevL[i] = w.water[i] ? 0 : w.elev[i];
  const shade = new Float32Array(N);
  const zx = 1 / (w.cellKm * 1000);
  const exag = 7;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const xl = x > 0 ? i - 1 : i, xr = x < W - 1 ? i + 1 : i;
    const yu = y > 0 ? i - W : i, yd = y < H - 1 ? i + W : i;
    const dzdx = (elevL[xr] - elevL[xl]) * zx * exag / ((xr - xl) || 1);
    const dzdy = (elevL[yd] - elevL[yu]) * zx * exag / (((yd - yu) / W) || 1);
    // light from the north-west, 45 deg altitude
    const nx = -dzdx, ny = -dzdy, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    const lx = -0.6, ly = -0.6, lz = 0.53;
    const d = (nx * lx + ny * ly + nz * lz) / len;
    shade[i] = d;
  }
  const flat = 0.53;
  const cellCol = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    let col: RGB;
    if (w.water[i] === WATER_OCEAN) {
      col = mix(C.sea, C.deep, smoothstep(10, 200, -w.elev[i]) * 0.6 + smoothstep(2, 14, w.coastDist[i]) * 0.4);
    } else if (w.water[i] === WATER_LAKE) {
      col = C.lake;
    } else {
      const e = w.elev[i];
      const ratio = w.precip[i] / evapotranspiration(w.temp[i]);
      const moist = smoothstep(0.25, 0.9, ratio);
      col = mix(C.dry, C.lowland, Math.max(moist * 0.8, w.fertility[i]));
      col = mix(col, C.forest, w.forest[i] * 0.55);
      col = mix(col, C.marsh, w.marsh[i] * 0.8);
      col = mix(col, C.upland, smoothstep(500, 1300, e) * 0.85);
      col = mix(col, C.high, smoothstep(1500, 2500, e));
      col = mix(col, C.snow, smoothstep(-6, -12, w.temp[i]) * 0.9);
      // shading in sepia
      const s = (shade[i] - flat) * 1.5;
      if (s < 0) col = mix(col, C.shadow, Math.min(0.55, -s * 0.9));
      else col = mix(col, [250, 244, 226], Math.min(0.5, s * 0.6));
    }
    cellCol[i * 3] = col[0]; cellCol[i * 3 + 1] = col[1]; cellCol[i * 3 + 2] = col[2];
  }

  // --- raster: bilinear upsample + paper grain ----------------------------
  const raster = document.createElement('canvas');
  raster.width = W * S; raster.height = H * S;
  const ctx = raster.getContext('2d')!;
  const img = ctx.createImageData(W * S, H * S);
  const data = img.data;
  const RW = W * S;
  for (let py = 0; py < H * S; py++) {
    const gy = (py + 0.5) / S - 0.5;
    const y0 = Math.max(0, Math.min(H - 1, Math.floor(gy)));
    const y1 = Math.min(H - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, gy - y0));
    for (let px = 0; px < RW; px++) {
      const gx = (px + 0.5) / S - 0.5;
      const x0 = Math.max(0, Math.min(W - 1, Math.floor(gx)));
      const x1 = Math.min(W - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, gx - x0));
      const a = (y0 * W + x0) * 3, b = (y0 * W + x1) * 3, c = (y1 * W + x0) * 3, d = (y1 * W + x1) * 3;
      const grain = (hash2(px, py, 7) - 0.5) * 9 + (hash2(px >> 3, py >> 3, 3) - 0.5) * 4;
      const o = (py * RW + px) * 4;
      for (let k = 0; k < 3; k++) {
        const v = (cellCol[a + k] * (1 - fx) + cellCol[b + k] * fx) * (1 - fy) + (cellCol[c + k] * (1 - fx) + cellCol[d + k] * fx) * fy;
        data[o + k] = v + grain;
      }
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // --- water lining (concentric lines offshore, classic engraved style) ----
  const seaDist = new Float32Array(N);
  for (let i = 0; i < N; i++) seaDist[i] = w.water[i] ? w.coastDist[i] : -1;
  const sd = boxBlur(seaDist, W, H, 1, 1);
  ctx.save();
  ctx.scale(S, S);
  ctx.lineJoin = 'round';
  const levels = [0.9, 1.7, 2.6, 3.7, 5.0, 6.6];
  levels.forEach((lv, k) => {
    const lines = marchingSquares(sd, W, H, lv);
    ctx.strokeStyle = `rgba(61,106,134,${0.42 - k * 0.06})`;
    ctx.lineWidth = 0.22 - k * 0.015;
    ctx.beginPath();
    for (const l of lines) {
      const sm = chaikin(l, 2);
      ctx.moveTo(sm[0], sm[1]);
      for (let j = 2; j < sm.length; j += 2) ctx.lineTo(sm[j], sm[j + 1]);
    }
    ctx.stroke();
  });
  ctx.restore();

  // --- vignette -------------------------------------------------------------
  const g = ctx.createRadialGradient(RW / 2, H * S / 2, Math.min(RW, H * S) * 0.35, RW / 2, H * S / 2, Math.max(RW, H * S) * 0.75);
  g.addColorStop(0, 'rgba(120,80,40,0)');
  g.addColorStop(1, 'rgba(120,80,40,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, RW, H * S);

  // --- coastline & lakes as vector paths -----------------------------------
  const landF = new Float32Array(N), lakeF = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    landF[i] = w.water[i] === WATER_OCEAN ? 0 : 1;
    lakeF[i] = w.water[i] === WATER_LAKE ? 1 : 0;
  }
  const coast = linesToPath(marchingSquares(boxBlur(landF, W, H, 1, 1), W, H, 0.5), 2);
  const lakes = linesToPath(marchingSquares(boxBlur(lakeF, W, H, 1, 1), W, H, 0.5), 2);

  return {
    S, raster, coast, lakes,
    rivers: buildRivers(w),
    glyphs: buildGlyphs(w),
    trees: buildTrees(w),
    riverLabelPaths: w.rivers.map((r) => ({ name: r.name, q: r.q, pts: chaikin(r.cells.flatMap((c) => [(c % W) + 0.5, Math.floor(c / W) + 0.5]), 3) })),
  };
}

function linesToPath(lines: number[][], smooth: number): Path2D {
  const p = new Path2D();
  for (const l of lines) {
    const sm = chaikin(l, smooth);
    p.moveTo(sm[0], sm[1]);
    for (let j = 2; j < sm.length; j += 2) p.lineTo(sm[j], sm[j + 1]);
  }
  return p;
}

/** River chains from sources to mouths, split into runs of similar width. */
export function riverWidth(q: number, qRiver: number): number {
  return 0.12 + 0.2 * Math.log2(1 + q / qRiver) * 0.55;
}

function buildRivers(w: World): RiverRun[] {
  const { W, N, river, flowDir, discharge, water, qRiver } = w;
  const hasUp = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (river[i] && flowDir[i] >= 0) hasUp[flowDir[i]] = 1;
  const visited = new Uint8Array(N);
  const runs = new Map<string, Path2D>();
  const bucket = (q: number) => Math.round(riverWidth(q, qRiver) * 20) / 20;
  const sources: number[] = [];
  for (let i = 0; i < N; i++) if (river[i] && !hasUp[i]) sources.push(i);
  // process big rivers first so tributaries end on the main stem
  sources.sort((a, b) => discharge[b] - discharge[a]);
  const cx = (c: number) => (c % W) + 0.5, cy = (c: number) => Math.floor(c / W) + 0.5;
  for (const s of sources) {
    const chain: number[] = [];
    let c = s;
    while (c >= 0) {
      chain.push(c);
      if (visited[c] || water[c]) break;
      visited[c] = 1;
      const d = flowDir[c];
      if (d < 0) break;
      c = d;
    }
    if (chain.length < 2) continue;
    // smooth the points
    const pts: number[] = [];
    for (const k of chain) pts.push(cx(k), cy(k));
    // pull the last point to the water edge
    const sm = chaikin(pts, 2);
    // per-vertex widths map onto the smoothed polyline proportionally
    const nOrig = chain.length;
    const nSm = sm.length / 2;
    let start = 0;
    let curB = bucket(discharge[chain[0]]);
    const flush = (end: number, b: number) => {
      if (end <= start) return;
      const key = String(b) + (w.navigable[chain[Math.min(nOrig - 1, Math.round((start / nSm) * nOrig))]] ? 'n' : '');
      let p = runs.get(key);
      if (!p) { p = new Path2D(); runs.set(key, p); }
      p.moveTo(sm[start * 2], sm[start * 2 + 1]);
      for (let j = start + 1; j <= end; j++) p.lineTo(sm[j * 2], sm[j * 2 + 1]);
    };
    for (let j = 1; j < nSm; j++) {
      const oi = Math.min(nOrig - 1, Math.floor((j / nSm) * nOrig));
      const b = bucket(discharge[chain[oi]]);
      if (b !== curB) { flush(j, curB); start = j; curB = b; }
    }
    flush(nSm - 1, curB);
  }
  return [...runs.entries()]
    .map(([k, path]) => ({ path, width: parseFloat(k), nav: k.endsWith('n') }))
    .sort((a, b) => a.width - b.width);
}

function buildGlyphs(w: World): Glyph[] {
  const { W, H } = w;
  const out: Glyph[] = [];
  const sm = boxBlur(w.elev, W, H, 4, 1);
  const step = 3;
  for (let gy = 0; gy < H; gy += step) for (let gx = 0; gx < W; gx += step) {
    const jx = gx + Math.floor(hash2(gx, gy, 11) * step);
    const jy = gy + Math.floor(hash2(gx, gy, 12) * step);
    if (jx >= W || jy >= H) continue;
    const i = jy * W + jx;
    if (w.water[i] || w.river[i]) continue;
    const e = w.elev[i];
    const relief = e - sm[i];
    if (e > 1100 || (e > 650 && relief > 40)) {
      if (hash2(jx, jy, 5) < 0.25 && e < 1500) continue;
      out.push({ x: jx + 0.5, y: jy + 0.5, size: Math.min(4.2, 1.3 + e / 900), kind: 'mtn' });
    } else if (e > 220 && relief > 22 && w.slope[i] > 0.02) {
      if (hash2(jx, jy, 6) < 0.45) continue;
      out.push({ x: jx + 0.5, y: jy + 0.5, size: 1.1 + Math.min(1, relief / 120), kind: 'hill' });
    }
  }
  out.sort((a, b) => a.y - b.y);
  return out;
}

function buildTrees(w: World): Path2D {
  const { W, H } = w;
  const p = new Path2D();
  const step = 2;
  for (let gy = 0; gy < H; gy += step) for (let gx = 0; gx < W; gx += step) {
    const x = gx + hash2(gx, gy, 21) * step;
    const y = gy + hash2(gx, gy, 22) * step;
    const i = Math.floor(y) * W + Math.floor(x);
    if (i >= w.N || w.water[i] || w.river[i]) continue;
    const f = w.forest[i];
    if (f < 0.45 || w.elev[i] > 1300) continue;
    if (hash2(gx, gy, 23) > (f - 0.35) * 1.2) continue;
    const r = 0.38 + hash2(gx, gy, 24) * 0.15;
    p.moveTo(x + r, y);
    p.arc(x, y, r, 0, Math.PI * 2);
    p.moveTo(x, y + r);
    p.lineTo(x, y + r + 0.35);
  }
  return p;
}
