// Terrain brushes. They edit the raw elevation; the world is then rebuilt
// (hydrology + layers) so rivers re-route themselves.
import type { TerrainInput, World } from './grid';
import type { BrushOp } from '../worker/protocol';

export function applyBrush(t: TerrainInput, w: World, op: BrushOp) {
  const { W, H, elev } = t;
  const forDisk = (x: number, y: number, r: number, fn: (i: number, f: number) => void) => {
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.ceil(y + r));
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y) / r;
      if (d > 1) continue;
      const f = 0.5 + 0.5 * Math.cos(Math.PI * d); // smooth falloff
      fn(yy * W + xx, f);
    }
  };
  switch (op.kind) {
    case 'raise':
    case 'lower': {
      const s = (op.kind === 'raise' ? 1 : -1) * op.strength * 160;
      forDisk(op.x, op.y, op.r, (i, f) => {
        let v = elev[i] + s * f;
        // lowering land stops just above sea level unless pushed hard
        if (op.kind === 'lower' && elev[i] > 2 && v < 2) v = Math.max(v, 2);
        elev[i] = Math.min(5200, v);
        if (t.waterMask && t.waterMask[i] && elev[i] > 2) t.waterMask[i] = 0;
      });
      break;
    }
    case 'smooth': {
      const src = Float32Array.from(elev);
      forDisk(op.x, op.y, op.r, (i, f) => {
        const x = i % W, y = (i / W) | 0;
        let s = 0, n = 0;
        for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
          const xx = x + ox, yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          s += src[yy * W + xx]; n++;
        }
        const target = s / n;
        if ((src[i] > 0) !== (target > 0)) return; // don't move coastlines
        elev[i] = src[i] + (target - src[i]) * f * Math.min(1, op.strength);
      });
      break;
    }
    case 'flatten': {
      const ci = Math.floor(op.y) * W + Math.floor(op.x);
      const target = Math.max(3, elev[ci] ?? 3);
      forDisk(op.x, op.y, op.r, (i, f) => { if (elev[i] > 0) elev[i] += (target - elev[i]) * f * op.strength; });
      break;
    }
    case 'river': {
      const pts = op.pts;
      if (pts.length < 4) return;
      const cellAt = (k: number) => Math.floor(pts[k + 1]) * W + Math.floor(pts[k]);
      const h0 = Math.max(4, elev[cellAt(0)]);
      const h1 = Math.max(1, Math.min(h0 - 5, elev[cellAt(pts.length - 2)]));
      // cumulative length for a linear descending profile
      const cum = [0];
      for (let k = 2; k < pts.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]));
      const L = cum[cum.length - 1] || 1;
      for (let k = 0; k < pts.length; k += 2) {
        const target = h0 + (h1 - h0) * (cum[k / 2] / L) - 6;
        forDisk(pts[k], pts[k + 1], op.r, (i, f) => {
          if (elev[i] <= 0) return;
          const v = target + (1 - f) * 12;
          if (v < elev[i]) elev[i] = Math.max(0.6, v);
        });
      }
      break;
    }
    case 'sea': {
      forDisk(op.x, op.y, op.r, (i, f) => {
        if (f < 0.25) return;
        elev[i] = Math.min(elev[i], -8 - 30 * f);
        if (t.waterMask) t.waterMask[i] = 1;
      });
      break;
    }
    case 'drain': {
      forDisk(op.x, op.y, op.r, (i, f) => {
        if (f < 0.25) return;
        if (elev[i] <= 2 || w.water[i]) elev[i] = 3 + 4 * f;
        if (t.waterMask) t.waterMask[i] = 0;
      });
      break;
    }
  }
}
