// Marching squares: extracts iso-lines from a scalar grid as polylines in
// cell coordinates (cell centres at integer + 0.5).

export type Polyline = number[]; // flat [x0,y0,x1,y1,...]

export function marchingSquares(f: Float32Array, W: number, H: number, iso: number): Polyline[] {
  // Collect segments keyed by edge ids then stitch them.
  const segs: [number, number][] = [];
  const pts = new Map<number, [number, number]>();
  const edgeId = (x: number, y: number, horiz: boolean) => ((y * (W + 1) + x) << 1) | (horiz ? 0 : 1);
  const interp = (a: number, b: number) => (iso - a) / (b - a);
  const point = (x: number, y: number, horiz: boolean): number => {
    const id = edgeId(x, y, horiz);
    if (!pts.has(id)) {
      if (horiz) {
        const a = f[y * W + x], b = f[y * W + x + 1];
        pts.set(id, [x + 0.5 + interp(a, b), y + 0.5]);
      } else {
        const a = f[y * W + x], b = f[(y + 1) * W + x];
        pts.set(id, [x + 0.5, y + 0.5 + interp(a, b)]);
      }
    }
    return id;
  };
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const a = f[y * W + x] > iso ? 1 : 0;
      const b = f[y * W + x + 1] > iso ? 1 : 0;
      const c = f[(y + 1) * W + x + 1] > iso ? 1 : 0;
      const d = f[(y + 1) * W + x] > iso ? 1 : 0;
      const code = a | (b << 1) | (c << 2) | (d << 3);
      if (code === 0 || code === 15) continue;
      const top = () => point(x, y, true);
      const bottom = () => point(x, y + 1, true);
      const left = () => point(x, y, false);
      const right = () => point(x + 1, y, false);
      switch (code) {
        case 1: case 14: segs.push([left(), top()]); break;
        case 2: case 13: segs.push([top(), right()]); break;
        case 3: case 12: segs.push([left(), right()]); break;
        case 4: case 11: segs.push([right(), bottom()]); break;
        case 6: case 9: segs.push([top(), bottom()]); break;
        case 7: case 8: segs.push([left(), bottom()]); break;
        case 5: segs.push([left(), top()]); segs.push([right(), bottom()]); break;
        case 10: segs.push([top(), right()]); segs.push([left(), bottom()]); break;
      }
    }
  }
  // Stitch segments into polylines.
  const adj = new Map<number, number[]>();
  segs.forEach(([p, q], k) => {
    (adj.get(p) ?? adj.set(p, []).get(p)!).push(k);
    (adj.get(q) ?? adj.set(q, []).get(q)!).push(k);
  });
  const used = new Uint8Array(segs.length);
  const lines: Polyline[] = [];
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue;
    used[k] = 1;
    const chain = [segs[k][0], segs[k][1]];
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const end = chain[chain.length - 1];
        const next = adj.get(end)?.find((s) => !used[s]);
        if (next === undefined) break;
        used[next] = 1;
        const [p, q] = segs[next];
        chain.push(p === end ? q : p);
      }
      chain.reverse();
    }
    const flat: number[] = [];
    for (const id of chain) { const p = pts.get(id)!; flat.push(p[0], p[1]); }
    lines.push(flat);
  }
  return lines;
}

/** Chaikin smoothing for nicer hand-drawn curves. */
export function chaikin(line: Polyline, iterations = 2, closed = false): Polyline {
  let pts = line;
  for (let it = 0; it < iterations; it++) {
    const out: number[] = [];
    const n = pts.length / 2;
    if (n < 3) return pts;
    if (!closed) out.push(pts[0], pts[1]);
    for (let i = 0; i < n - (closed ? 0 : 1); i++) {
      const j = (i + 1) % n;
      const x0 = pts[i * 2], y0 = pts[i * 2 + 1], x1 = pts[j * 2], y1 = pts[j * 2 + 1];
      out.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1, 0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
    }
    if (!closed) out.push(pts[pts.length - 2], pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

export function isClosed(line: Polyline): boolean {
  const n = line.length;
  return n >= 6 && Math.abs(line[0] - line[n - 2]) < 1e-6 && Math.abs(line[1] - line[n - 1]) < 1e-6;
}
