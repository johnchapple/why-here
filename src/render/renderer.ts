// Canvas 2D renderer. The static basemap is baked once into a raster plus
// cached Path2D geometry (all in cell units); each frame we just set the
// camera transform and draw: raster -> overlay -> coast/rivers -> glyphs ->
// roads/rail -> settlements -> labels. Canvas 2D was chosen over WebGL
// because the map is mostly vector line-work and lettering, which Canvas 2D
// draws beautifully (anti-aliased strokes, real fonts, text halos) and
// comfortably within budget at this map size.
import type { World } from '../sim/grid';
import type { SimSnapshot, Settlement } from '../sim/types';
import { Basemap, bakeBasemap } from './basemap';
import { chaikin, marchingSquares } from './contours';
import { FONT_SC, FONT_SERIF, INK, LABEL_HALO, RAIL_INK, RIVER_INK, ROAD_INK } from './style';
import { OverlayKind, buildOverlay } from './overlays';

export interface Camera { cx: number; cy: number; zoom: number }

export interface RealCityMarker { name: string; x: number; y: number; pop: number; matched: boolean; rank: number; note?: string }

const ERA_COLORS = ['#7b5a2e', '#2f6f6a', '#3c5a99', '#8e2f2f', '#5d3f8c'];

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  world: World | null = null;
  base: Basemap | null = null;
  snap: SimSnapshot | null = null;
  cam: Camera = { cx: 0, cy: 0, zoom: 4 };
  dpr = 1;
  overlay: OverlayKind = 'none';
  overlayCanvas: HTMLCanvasElement | null = null;
  selected = -1;
  hover = -1;
  realCities: RealCityMarker[] = [];
  showRealCities = true;
  highlightCells: { cells: number[]; color: string } | null = null;
  private roadPaths: { level: number; path: Path2D }[] = [];
  private railPath: Path2D | null = null;
  private dirty = true;
  private animT = 0;
  private placedLabels: { x0: number; y0: number; x1: number; y1: number; id: number }[] = [];
  onFrame?: () => void;
  brushPreview: { x: number; y: number; r: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
    const loop = (t: number) => {
      const animating = this.overlay === 'trade' && !!this.snap?.flows.length;
      if (animating) { this.animT = t; this.dirty = true; }
      if (this.dirty) { this.dirty = false; this.draw(); this.onFrame?.(); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  invalidate() { this.dirty = true; }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.invalidate();
  }

  get viewW() { return this.canvas.width / this.dpr; }
  get viewH() { return this.canvas.height / this.dpr; }

  setWorld(w: World, fit = true) {
    this.world = w;
    this.base = bakeBasemap(w);
    if (fit) this.fit();
    this.rebuildOverlay();
    this.invalidate();
  }

  setSnapshot(s: SimSnapshot | null) {
    this.snap = s;
    this.buildRoads();
    if (this.overlay !== 'none' && this.overlay !== 'trade') this.rebuildOverlay();
    this.invalidate();
  }

  setOverlay(o: OverlayKind) {
    this.overlay = o;
    this.rebuildOverlay();
    this.invalidate();
  }

  borderPath: Path2D | null = null;

  rebuildOverlay() {
    this.overlayCanvas = this.world ? buildOverlay(this.overlay, this.world, this.snap) : null;
    this.borderPath = (this.overlay === 'catchments' || this.overlay === 'farms') && this.world && this.snap
      ? marketBorders(this.world.W, this.world.H, this.overlay === 'farms' ? this.snap.catchment : this.snap.marketOf) : null;
  }

  /** Screen insets (px) covered by UI panels: left, top, right, bottom. */
  insets = { l: 0, t: 0, r: 0, b: 0 };

  fit() {
    if (!this.world) return;
    const { W, H } = this.world;
    const pad = 18;
    const { l, t, r, b } = this.insets;
    const aw = this.viewW - l - r - pad * 2, ah = this.viewH - t - b - pad * 2;
    const z = Math.min(aw / W, ah / H);
    const zoom = Math.max(0.5, z);
    // centre the map within the free area
    const sx = l + pad + aw / 2, sy = t + pad + ah / 2;
    this.cam = { cx: W / 2 - (sx - this.viewW / 2) / zoom, cy: H / 2 - (sy - this.viewH / 2) / zoom, zoom };
    this.invalidate();
  }

  minZoom() {
    if (!this.world) return 0.5;
    return Math.min(this.viewW / this.world.W, this.viewH / this.world.H) * 0.6;
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const { cx, cy, zoom } = this.cam;
    return [(sx - this.viewW / 2) / zoom + cx, (sy - this.viewH / 2) / zoom + cy];
  }

  worldToScreen(x: number, y: number): [number, number] {
    const { cx, cy, zoom } = this.cam;
    return [(x - cx) * zoom + this.viewW / 2, (y - cy) * zoom + this.viewH / 2];
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const z = Math.max(this.minZoom(), Math.min(40, this.cam.zoom * factor));
    this.cam.zoom = z;
    // keep (wx,wy) under the cursor
    this.cam.cx = wx - (sx - this.viewW / 2) / z;
    this.cam.cy = wy - (sy - this.viewH / 2) / z;
    this.clampCam();
    this.invalidate();
  }

  panBy(dx: number, dy: number) {
    this.cam.cx -= dx / this.cam.zoom;
    this.cam.cy -= dy / this.cam.zoom;
    this.clampCam();
    this.invalidate();
  }

  flyTo(x: number, y: number, zoom?: number) {
    this.cam.cx = x; this.cam.cy = y;
    if (zoom) this.cam.zoom = zoom;
    this.clampCam();
    this.invalidate();
  }

  private clampCam() {
    if (!this.world) return;
    const mx = this.viewW / 2 / this.cam.zoom, my = this.viewH / 2 / this.cam.zoom;
    this.cam.cx = Math.max(-mx * 0.6, Math.min(this.world.W + mx * 0.6, this.cam.cx));
    this.cam.cy = Math.max(-my * 0.6, Math.min(this.world.H + my * 0.6, this.cam.cy));
  }

  /** Settlement under a screen point (uses screen-space icon radii). */
  pick(sx: number, sy: number): Settlement | null {
    if (!this.snap) return null;
    let best: Settlement | null = null, bd = 1e9;
    for (const s of this.snap.settlements) {
      if (s.abandoned && this.cam.zoom < 6) continue;
      const [px, py] = this.worldToScreen(s.x, s.y);
      const r = this.iconRadius(s) + 5;
      const d = Math.hypot(px - sx, py - sy);
      if (d < r && d - s.tier * 2 < bd) { bd = d - s.tier * 2; best = s; }
    }
    // label hit
    if (!best) {
      for (const l of this.placedLabels) {
        if (sx >= l.x0 && sx <= l.x1 && sy >= l.y0 && sy <= l.y1) return this.snap.settlements[l.id] ?? null;
      }
    }
    return best;
  }

  pickRealCity(sx: number, sy: number): RealCityMarker | null {
    if (!this.showRealCities) return null;
    for (const c of this.realCities) {
      const [px, py] = this.worldToScreen(c.x, c.y);
      if (Math.hypot(px - sx, py - sy) < 9) return c;
    }
    return null;
  }

  private iconRadius(s: Settlement): number {
    const zs = Math.max(0.75, Math.min(1.5, this.cam.zoom / 4));
    const base = [1.5, 2.0, 3.0, 3.9, 5.4][s.tier];
    return base * zs + (s.capital ? 1.5 : 0);
  }

  private buildRoads() {
    this.roadPaths = [];
    this.railPath = null;
    const s = this.snap, w = this.world;
    if (!s || !w) return;
    const W = w.W;
    for (let level = 1; level <= 3; level++) {
      const edges: number[] = [];
      for (let k = 0; k < s.roadEdges.length; k += 3) if (s.roadEdges[k + 2] === level) edges.push(s.roadEdges[k], s.roadEdges[k + 1]);
      if (edges.length) this.roadPaths.push({ level, path: edgesToPath(edges, W) });
    }
    if (s.railEdges.length) this.railPath = edgesToPath(Array.from(s.railEdges), W);
  }

  draw() {
    const ctx = this.ctx;
    const w = this.world, b = this.base;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#2b2118';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!w || !b) return;
    const { cx, cy, zoom } = this.cam;
    const dpr = this.dpr;
    const tx = this.viewW / 2 - cx * zoom, ty = this.viewH / 2 - cy * zoom;
    const setWorld = () => ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * tx, dpr * ty);
    const px = 1 / zoom; // one screen pixel in cell units

    setWorld();
    // shadow under the sheet
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0.6 * px * 6, 0.6 * px * 6, w.W, w.H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(b.raster, 0, 0, w.W, w.H);

    if (this.overlayCanvas) {
      ctx.globalAlpha = this.overlay === 'catchments' ? 0.5 : 0.72;
      ctx.drawImage(this.overlayCanvas, 0, 0, w.W, w.H);
      ctx.globalAlpha = 1;
    }
    if (this.borderPath) {
      ctx.strokeStyle = this.overlay === 'farms' ? 'rgba(90,60,20,0.6)' : 'rgba(90,40,20,0.85)';
      ctx.lineWidth = (this.overlay === 'farms' ? 0.8 : 1.3) * px;
      ctx.setLineDash([4 * px, 2 * px]);
      ctx.stroke(this.borderPath);
      ctx.setLineDash([]);
    }

    // view bounds in cell units for culling
    const vx0 = cx - this.viewW / 2 / zoom - 5, vx1 = cx + this.viewW / 2 / zoom + 5;
    const vy0 = cy - this.viewH / 2 / zoom - 5, vy1 = cy + this.viewH / 2 / zoom + 5;

    // trees (stipple)
    ctx.lineWidth = Math.max(0.05, 0.7 * px);
    ctx.strokeStyle = 'rgba(70,82,40,0.55)';
    ctx.fillStyle = 'rgba(214,220,178,0.9)';
    if (zoom > 2.2) { ctx.fill(b.trees); ctx.stroke(b.trees); }

    // coast + lakes
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.12, 1.3 * px);
    ctx.stroke(b.coast);
    ctx.strokeStyle = RIVER_INK;
    ctx.lineWidth = Math.max(0.1, 1.0 * px);
    ctx.stroke(b.lakes);

    // rivers
    ctx.strokeStyle = RIVER_INK;
    for (const r of b.rivers) {
      ctx.lineWidth = Math.max(r.width, 0.8 * px);
      ctx.stroke(r.path);
    }

    // mountains and hills
    this.drawGlyphs(b, px, vx0, vx1, vy0, vy1);

    // roads & rail
    const emph = this.overlay === 'roads' ? 1.7 : 1;
    for (const r of this.roadPaths) {
      if (r.level === 1 && zoom < 1.6) continue;
      if (r.level === 3) {
        ctx.strokeStyle = 'rgba(58,42,27,0.9)';
        ctx.lineWidth = 3.6 * px * emph;
        ctx.stroke(r.path);
        ctx.strokeStyle = '#d9a35a';
        ctx.lineWidth = 2.0 * px * emph;
        ctx.stroke(r.path);
        continue;
      }
      ctx.strokeStyle = ROAD_INK;
      ctx.globalAlpha = r.level === 1 ? 0.75 : 0.95;
      ctx.lineWidth = (r.level === 1 ? 1.0 : 1.7) * px * emph;
      if (r.level === 1) ctx.setLineDash([3.5 * px, 2.5 * px]);
      ctx.stroke(r.path);
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    if (this.railPath) {
      ctx.strokeStyle = RAIL_INK;
      ctx.lineWidth = 2.6 * px;
      ctx.stroke(this.railPath);
      ctx.strokeStyle = '#f3e9cf';
      ctx.lineWidth = 1.2 * px;
      ctx.setLineDash([4 * px, 4 * px]);
      ctx.stroke(this.railPath);
      ctx.setLineDash([]);
    }

    // trade flows
    if (this.overlay === 'trade' && this.snap) this.drawFlows(px);

    if (this.highlightCells) {
      ctx.fillStyle = this.highlightCells.color;
      for (const c of this.highlightCells.cells) ctx.fillRect(c % w.W, Math.floor(c / w.W), 1, 1);
    }

    // frame
    this.drawFrame(px);

    // hydro feature markers in "sites" overlay
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.overlay === 'sites') this.drawFeatureMarkers();

    // settlements + labels in screen space
    this.placedLabels = [];
    if (this.snap) this.drawSettlements(vx0, vx1, vy0, vy1);
    this.drawRiverLabels();
    if (this.realCities.length && this.showRealCities) this.drawRealCities();

    if (this.brushPreview) {
      const [sx, sy] = this.worldToScreen(this.brushPreview.x, this.brushPreview.y);
      ctx.strokeStyle = 'rgba(40,20,10,0.8)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(sx, sy, this.brushPreview.r * zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawGlyphs(b: Basemap, px: number, vx0: number, vx1: number, vy0: number, vy1: number) {
    const ctx = this.ctx;
    ctx.lineWidth = Math.max(0.06, 0.85 * px);
    for (const g of b.glyphs) {
      if (g.x < vx0 || g.x > vx1 || g.y < vy0 || g.y > vy1) continue;
      const s = g.size;
      if (g.kind === 'mtn') {
        const hw = s * 0.62, h = s * 0.85;
        const peakX = g.x - hw * 0.08;
        ctx.beginPath();
        ctx.moveTo(g.x - hw, g.y);
        ctx.lineTo(peakX, g.y - h);
        ctx.lineTo(g.x + hw, g.y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(236,224,196,0.92)';
        ctx.fill();
        // shadow side hatching
        ctx.beginPath();
        const n = Math.max(2, Math.round(s * 1.6));
        for (let k = 1; k <= n; k++) {
          const t = k / (n + 1);
          const sx = peakX + (g.x + hw - peakX) * t * 0.95;
          const sy = g.y - h + h * t * 0.95;
          ctx.moveTo(sx, sy);
          ctx.lineTo(peakX + (sx - peakX) * 0.35, g.y);
        }
        ctx.strokeStyle = 'rgba(70,48,28,0.55)';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(g.x - hw, g.y);
        ctx.lineTo(peakX, g.y - h);
        ctx.lineTo(g.x + hw, g.y);
        ctx.strokeStyle = 'rgba(58,42,27,0.9)';
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(g.x - s * 0.5, g.y);
        ctx.quadraticCurveTo(g.x, g.y - s * 0.75, g.x + s * 0.5, g.y);
        ctx.strokeStyle = 'rgba(58,42,27,0.6)';
        ctx.stroke();
      }
    }
  }

  private drawFrame(px: number) {
    const ctx = this.ctx, w = this.world!;
    const bw = 10 * px;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6 * px;
    ctx.strokeRect(0, 0, w.W, w.H);
    ctx.lineWidth = 0.8 * px;
    ctx.strokeRect(-bw, -bw, w.W + 2 * bw, w.H + 2 * bw);
    // alternating degree bar
    const seg = Math.max(4, Math.round(w.W / 24));
    ctx.fillStyle = INK;
    for (let x = 0, k = 0; x < w.W; x += seg, k++) {
      if (k % 2) continue;
      ctx.fillRect(x, -bw, Math.min(seg, w.W - x), bw * 0.45);
      ctx.fillRect(x, w.H + bw * 0.55, Math.min(seg, w.W - x), bw * 0.45);
    }
    for (let y = 0, k = 0; y < w.H; y += seg, k++) {
      if (k % 2) continue;
      ctx.fillRect(-bw, y, bw * 0.45, Math.min(seg, w.H - y));
      ctx.fillRect(w.W + bw * 0.55, y, bw * 0.45, Math.min(seg, w.H - y));
    }
  }

  private drawFlows(px: number) {
    const ctx = this.ctx;
    const flows = this.snap!.flows;
    const maxV = Math.max(1e-9, ...flows.map((f) => f.volume));
    const off = -(this.animT / 60) % 16;
    ctx.lineCap = 'round';
    for (const f of flows) {
      const t = Math.sqrt(f.volume / maxV);
      ctx.strokeStyle = f.water ? `rgba(30,80,140,${0.35 + 0.5 * t})` : `rgba(150,40,20,${0.35 + 0.5 * t})`;
      ctx.lineWidth = (0.8 + 5 * t) * px;
      ctx.setLineDash([6 * px, 10 * px]);
      ctx.lineDashOffset = off * px * 2;
      ctx.beginPath();
      ctx.moveTo(f.pts[0], f.pts[1]);
      for (let j = 2; j < f.pts.length; j += 2) ctx.lineTo(f.pts[j], f.pts[j + 1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  private drawFeatureMarkers() {
    const ctx = this.ctx, w = this.world!;
    const sym: Record<string, string> = { confluence: 'Y', mouth: '⚓', fall: '≋', head: '⊣', ford: '⇋', pass: '⋀', lakeshore: '◒' };
    const col: Record<string, string> = { confluence: '#6a2d7a', mouth: '#1d4f7a', fall: '#a1311e', head: '#a1311e', ford: '#2d6a3a', pass: '#5b3b1b', lakeshore: '#1d4f7a' };
    ctx.font = `bold 13px ${FONT_SERIF}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of w.features) {
      const [sx, sy] = this.worldToScreen((f.cell % w.W) + 0.5, Math.floor(f.cell / w.W) + 0.5);
      if (sx < -20 || sy < -20 || sx > this.viewW + 20 || sy > this.viewH + 20) continue;
      ctx.fillStyle = 'rgba(245,236,212,0.9)';
      ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col[f.kind]; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = col[f.kind];
      ctx.fillText(sym[f.kind] ?? '?', sx, sy + 1);
    }
    for (const r of w.resources) {
      const [sx, sy] = this.worldToScreen((r.cell % w.W) + 0.5, Math.floor(r.cell / w.W) + 0.5);
      drawResourceIcon(ctx, r.kind, sx, sy);
    }
  }

  private drawSettlements(vx0: number, vx1: number, vy0: number, vy1: number) {
    const ctx = this.ctx;
    const zoom = this.cam.zoom;
    const list = this.snap!.settlements.filter((s) => s.x > vx0 && s.x < vx1 && s.y > vy0 && s.y < vy1);
    // draw small first so big ones are on top
    list.sort((a, b) => a.pop - b.pop);
    const eraMode = this.overlay === 'eras';
    for (const s of list) {
      if (s.abandoned && zoom < 5) continue;
      const [sx, sy] = this.worldToScreen(s.x, s.y);
      const r = this.iconRadius(s);
      const sel = s.id === this.selected, hov = s.id === this.hover;
      if (s.tier <= 1 && zoom < 2.2 && !s.market && !sel) continue;
      ctx.lineWidth = 1;
      if (s.abandoned) {
        ctx.strokeStyle = 'rgba(58,42,27,0.6)';
        ctx.beginPath(); ctx.moveTo(sx - 3, sy); ctx.lineTo(sx + 3, sy); ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, sy + 4); ctx.stroke();
        continue;
      }
      const ink = eraMode ? ERA_COLORS[s.foundedEra] : INK;
      if (s.capital) {
        drawStar(ctx, sx, sy, r + 2, '#9e2a1c', ink);
      } else if (s.tier >= 3) {
        ctx.fillStyle = eraMode ? ink : s.tier >= 4 ? '#9e2a1c' : '#4a3424';
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = ink; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.beginPath(); ctx.arc(sx, sy, r + 2.2, 0, Math.PI * 2); ctx.lineWidth = 0.9; ctx.stroke();
      } else if (s.tier === 2 || s.market) {
        ctx.fillStyle = '#f4ead2';
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = ink; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.fillStyle = ink;
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, r * 0.42), 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = eraMode ? ink : 'rgba(58,42,27,0.85)';
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      }
      if (s.port && zoom > 3 && s.tier >= 2) drawAnchor(ctx, sx + r + 5, sy - r - 3, '#1d4f7a');
      if (s.origin === 'mining' && zoom > 3) drawResourceIcon(ctx, 'ore', sx - r - 6, sy - r - 3, 0.8);
      if (sel || hov) {
        ctx.strokeStyle = sel ? '#b3261e' : 'rgba(179,38,30,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // labels by priority: the more you zoom in, the more places get named
    const byPri = [...list].filter((s) => !s.abandoned).sort((a, b) => (b.capital ? 1e12 : b.pop) - (a.capital ? 1e12 : a.pop));
    const allRank = new Map<number, number>();
    [...this.snap!.settlements].filter((s) => !s.abandoned).sort((a, b) => b.pop - a.pop).forEach((s, i) => allRank.set(s.id, i));
    const budget = 6 + zoom * zoom * 2.2;
    for (const s of byPri) {
      const rank = allRank.get(s.id) ?? 999;
      const show = s.id === this.selected || s.capital || rank < budget || (s.market && zoom > 6) || zoom > 10;
      if (!show) continue;
      this.placeLabel(s, rank);
    }
  }

  private placeLabel(s: Settlement, rank: number) {
    const ctx = this.ctx;
    const [sx, sy] = this.worldToScreen(s.x, s.y);
    const r = this.iconRadius(s);
    const size = (rank < 3 ? 19 : rank < 10 ? 15.5 : rank < 25 ? 13 : 11.5) + (s.capital ? 1.5 : 0);
    const big = rank < 10 || s.capital;
    const name = big ? s.name.toUpperCase() : s.name;
    ctx.font = `${big ? '' : 'italic '}${size}px ${big ? FONT_SC : FONT_SERIF}`;
    const tw = ctx.measureText(name).width + (big ? name.length * 0.8 : 0);
    const cands: [number, number][] = [
      [sx + r + 4, sy - size * 0.1],
      [sx - r - 4 - tw, sy - size * 0.1],
      [sx - tw / 2, sy - r - size * 0.6],
      [sx - tw / 2, sy + r + size * 0.75],
    ];
    for (const [lx, ly] of cands) {
      const box = { x0: lx - 2, y0: ly - size * 0.75, x1: lx + tw + 2, y1: ly + size * 0.3, id: s.id };
      if (this.placedLabels.some((o) => box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0)) continue;
      this.placedLabels.push(box);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      if (big) ctx.letterSpacing = '0.8px';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = LABEL_HALO;
      ctx.lineWidth = 3.2;
      ctx.strokeText(name, lx, ly + size * 0.3);
      ctx.fillStyle = s.id === this.selected ? '#9e2a1c' : INK;
      ctx.fillText(name, lx, ly + size * 0.3);
      ctx.letterSpacing = '0px';
      return;
    }
  }

  private drawRiverLabels() {
    const ctx = this.ctx, b = this.base!, w = this.world!;
    const zoom = this.cam.zoom;
    for (const r of b.riverLabelPaths) {
      if (r.q < w.qNav * 1.2 && zoom < 5) continue;
      const pts = chaikin(r.pts, 3);
      // take a stretch around 55% downstream
      const n = pts.length / 2;
      const text = (`River ${r.name}`).split('').join(' ');
      const size = Math.min(15, 10 + Math.log10(r.q) * 1.5);
      ctx.font = `italic ${size}px ${FONT_SERIF}`;
      const totalW = ctx.measureText(text).width * 1.25;
      // screen-space path
      const sp: number[] = [];
      for (let k = 0; k < n; k++) { const [x, y] = this.worldToScreen(pts[2 * k], pts[2 * k + 1]); sp.push(x, y); }
      // cumulative length
      const cum = [0];
      for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(sp[2 * k] - sp[2 * k - 2], sp[2 * k + 1] - sp[2 * k - 1]));
      const L = cum[n - 1];
      if (L < totalW * 1.4) continue;
      let start = L * 0.5 - totalW / 2;
      // keep on screen
      const at = (d: number) => {
        let k = 1;
        while (k < n - 1 && cum[k] < d) k++;
        const t = (d - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
        const x = sp[2 * k - 2] + (sp[2 * k] - sp[2 * k - 2]) * t;
        const y = sp[2 * k - 1] + (sp[2 * k + 1] - sp[2 * k - 1]) * t;
        return [x, y, Math.atan2(sp[2 * k + 1] - sp[2 * k - 1], sp[2 * k] - sp[2 * k - 2])];
      };
      const [mx, my] = at(start + totalW / 2);
      if (mx < 0 || my < 0 || mx > this.viewW || my > this.viewH) {
        continue;
      }
      // flip text if it would read upside-down
      const [, , ang0] = at(start + totalW / 2);
      const flip = Math.cos(ang0) < 0;
      ctx.fillStyle = RIVER_INK;
      ctx.strokeStyle = 'rgba(241,230,201,0.7)';
      ctx.lineWidth = 2.5;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const chars = text.split('');
      let d = flip ? start + totalW : start;
      for (const ch of chars) {
        const cw = ctx.measureText(ch).width * 1.25;
        const [x, y, a] = at(flip ? d - cw / 2 : d + cw / 2);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(flip ? a + Math.PI : a);
        ctx.translate(0, -size * 0.75);
        ctx.strokeText(ch, 0, 0);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
        d += flip ? -cw : cw;
      }
    }
  }

  private drawRealCities() {
    const ctx = this.ctx;
    for (const c of this.realCities) {
      const [sx, sy] = this.worldToScreen(c.x, c.y);
      if (sx < -20 || sy < -20 || sx > this.viewW + 20 || sy > this.viewH + 20) continue;
      const r = 3 + Math.min(6, Math.log10(Math.max(1e4, c.pop)) - 3.5) * 1.6;
      ctx.lineWidth = 2;
      ctx.strokeStyle = c.matched ? '#1f7a4d' : '#c0392b';
      ctx.fillStyle = c.matched ? 'rgba(31,122,77,0.15)' : 'rgba(192,57,43,0.15)';
      ctx.beginPath();
      ctx.rect(sx - r, sy - r, r * 2, r * 2);
      ctx.fill(); ctx.stroke();
      ctx.font = `bold 11px ${FONT_SERIF}`;
      ctx.textAlign = 'left';
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.strokeText(c.name, sx + r + 3, sy + r + 9);
      ctx.fillStyle = c.matched ? '#14563a' : '#8e2418';
      ctx.fillText(c.name, sx + r + 3, sy + r + 9);
    }
  }
}

function edgesToPath(edges: number[], W: number): Path2D {
  // chain edges into polylines where nodes have degree 2, then smooth
  const adj = new Map<number, number[]>();
  for (let k = 0; k < edges.length; k += 2) {
    const a = edges[k], b = edges[k + 1];
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const used = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const p = new Path2D();
  const cx = (c: number) => (c % W) + 0.5, cy = (c: number) => Math.floor(c / W) + 0.5;
  const walk = (start: number, next: number) => {
    const pts = [cx(start), cy(start)];
    let prev = start, cur = next;
    used.add(key(prev, cur));
    for (;;) {
      pts.push(cx(cur), cy(cur));
      const nb = adj.get(cur)!;
      if (nb.length !== 2) break;
      const nxt = nb[0] === prev ? nb[1] : nb[0];
      if (used.has(key(cur, nxt))) break;
      used.add(key(cur, nxt));
      prev = cur; cur = nxt;
    }
    const sm = chaikin(pts, 2);
    p.moveTo(sm[0], sm[1]);
    for (let j = 2; j < sm.length; j += 2) p.lineTo(sm[j], sm[j + 1]);
  };
  for (const [node, nb] of adj) {
    if (nb.length === 2) continue;
    for (const n of nb) if (!used.has(key(node, n))) walk(node, n);
  }
  for (const [node, nb] of adj) for (const n of nb) if (!used.has(key(node, n))) walk(node, n);
  return p;
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke: string) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, Math.PI * 2); ctx.stroke();
}

function drawAnchor(ctx: CanvasRenderingContext2D, x: number, y: number, col: string) {
  ctx.strokeStyle = col; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y - 3.5, 1.3, 0, Math.PI * 2);
  ctx.moveTo(x, y - 2.2); ctx.lineTo(x, y + 3.5);
  ctx.moveTo(x - 2.5, y - 0.8); ctx.lineTo(x + 2.5, y - 0.8);
  ctx.moveTo(x - 3.2, y + 1.2); ctx.quadraticCurveTo(x, y + 5.5, x + 3.2, y + 1.2);
  ctx.stroke();
}

export function drawResourceIcon(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, scale = 1) {
  const col: Record<string, string> = { ore: '#5a4a3a', coal: '#1c1c1c', salt: '#7a7a8a', stone: '#8a7a6a', timber: '#3f6a2d', gold: '#b8860b' };
  ctx.save();
  ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(245,236,212,0.9)';
  ctx.strokeStyle = col[kind] ?? INK;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  if (kind === 'timber') { ctx.moveTo(0, -6); ctx.lineTo(5, 4); ctx.lineTo(-5, 4); ctx.closePath(); }
  else if (kind === 'salt') { ctx.rect(-4.5, -4.5, 9, 9); }
  else if (kind === 'gold' || kind === 'coal') { ctx.moveTo(0, -6); ctx.lineTo(5.5, 0); ctx.lineTo(0, 6); ctx.lineTo(-5.5, 0); ctx.closePath(); }
  else { ctx.arc(0, 0, 5, 0, Math.PI * 2); }
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = col[kind] ?? INK;
  ctx.font = `bold 8px ${FONT_SERIF}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const letter: Record<string, string> = { ore: 'Fe', coal: 'C', salt: 'S', stone: 'St', timber: 'T', gold: 'Au' };
  ctx.fillText(letter[kind] ?? '?', 0, kind === 'timber' ? 1.5 : 0.5);
  ctx.restore();
}

/** Smooth inked borders between market areas (marching squares per market). */
function marketBorders(W: number, H: number, marketOf: Int32Array): Path2D {
  const ids = new Set<number>();
  for (let i = 0; i < marketOf.length; i++) if (marketOf[i] >= 0) ids.add(marketOf[i]);
  const p = new Path2D();
  const f = new Float32Array(W * H);
  for (const id of ids) {
    let x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (let i = 0; i < marketOf.length; i++) {
      const v = marketOf[i] === id ? 1 : 0;
      f[i] = v;
      if (v) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    // only the bounding box matters, but marchingSquares works on the full grid; fine for ~100 markets
    for (const l of marchingSquares(f, W, H, 0.5)) {
      const sm = chaikin(l, 2);
      p.moveTo(sm[0], sm[1]);
      for (let j = 2; j < sm.length; j += 2) p.lineTo(sm[j], sm[j + 1]);
    }
  }
  return p;
}
