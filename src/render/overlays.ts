// Thematic overlays rendered as small rasters at grid resolution.
import type { World } from '../sim/grid';
import type { SimSnapshot } from '../sim/types';
import { hash2 } from '../sim/rng';
import { ERAS } from '../sim/eras';

export type OverlayKind = 'none' | 'elevation' | 'fertility' | 'cost' | 'catchments' | 'farms' | 'trade' | 'roads' | 'eras' | 'sites';

export const OVERLAYS: { id: OverlayKind; label: string; hint: string }[] = [
  { id: 'none', label: 'Plain map', hint: 'The atlas without thematic shading.' },
  { id: 'sites', label: 'Natural sites', hint: 'Confluences, river mouths, falls / heads of navigation, fords, passes and resources.' },
  { id: 'elevation', label: 'Elevation', hint: 'Hypsometric tint: green lowlands to brown mountains.' },
  { id: 'fertility', label: 'Fertility', hint: 'Farm productivity from climate, slope, soil and river water.' },
  { id: 'cost', label: 'Movement cost', hint: 'How hard it is to cross each cell in the current era (darker = harder). Roads, rivers and the sea are the cheap highways.' },
  { id: 'farms', label: 'Village fields', hint: 'The farmland each village works — all within about a day’s round-trip walk (the “ten-mile rule”).' },
  { id: 'catchments', label: 'Market areas', hint: 'Each colour is the hinterland served by one market town (central places).' },
  { id: 'trade', label: 'Trade flows', hint: 'Gravity-model trade between towns. Red = overland, blue = by water. Width = volume.' },
  { id: 'roads', label: 'Roads', hint: 'Roads emerge where traffic is heavy; they make travel cheaper, which attracts more traffic.' },
  { id: 'eras', label: 'Founding era', hint: 'Settlements coloured by the era they were founded in.' },
];

type Ramp = [number, number, number, number][]; // stops: t, r, g, b

function ramp(stops: Ramp, t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const a = stops[k - 1], b = stops[k];
      const u = (t - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
    }
  }
  const l = stops[stops.length - 1];
  return [l[1], l[2], l[3]];
}

const ELEV: Ramp = [[0, 92, 140, 80], [0.08, 150, 180, 100], [0.22, 220, 210, 130], [0.45, 190, 140, 80], [0.7, 140, 95, 60], [1, 245, 240, 235]];
const FERT: Ramp = [[0, 220, 200, 160], [0.3, 200, 210, 120], [0.6, 120, 170, 60], [1, 30, 110, 30]];
const COST: Ramp = [[0, 255, 253, 240], [0.25, 250, 225, 160], [0.45, 235, 170, 95], [0.7, 190, 80, 45], [1, 70, 20, 30]];

export function buildOverlay(kind: OverlayKind, w: World, snap: SimSnapshot | null): HTMLCanvasElement | null {
  if (kind === 'none' || kind === 'trade' || kind === 'roads' || kind === 'sites') return null;
  if (kind === 'eras') return null;
  const { W, H, N } = w;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    let rgb: [number, number, number] | null = null;
    let a = 255;
    if (w.water[i] && kind !== 'cost') { d[o + 3] = 0; continue; }
    switch (kind) {
      case 'elevation': rgb = ramp(ELEV, Math.pow(Math.max(0, w.elev[i]) / 3200, 0.6)); break;
      case 'fertility': rgb = ramp(FERT, w.fertility[i]); break;
      case 'cost': {
        const cf = snap?.costField;
        const land = ERAS[snap?.era ?? 0].land;
        const v = cf ? cf[i] : land * (1 + w.slope[i] * 30);
        rgb = ramp(COST, 0.42 + Math.log2(Math.max(0.01, v) / land) / 3.2);
        break;
      }
      case 'farms': {
        const f = snap?.catchment[i] ?? -1;
        if (f < 0) { a = 0; rgb = [0, 0, 0]; break; }
        rgb = hslToRgb(hash2(f, 3, 9) * 0.25 + 0.15, 0.55, 0.62);
        a = 120 + Math.round(w.fertility[i] * 135);
        break;
      }
      case 'catchments': {
        const m = snap?.marketOf[i] ?? -1;
        if (m < 0) { a = 0; rgb = [0, 0, 0]; break; }
        const h = hash2(m, 7, 3);
        rgb = hslToRgb(h, 0.5, 0.58);
        if ((snap?.catchment[i] ?? -1) < 0) a = 150; // not farmed yet
        break;
      }
    }
    if (!rgb) { d[o + 3] = 0; continue; }
    d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}
