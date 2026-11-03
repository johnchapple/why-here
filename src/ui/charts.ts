// Small SVG charts drawn in the atlas style: rank-size (Zipf) and
// population over time for the leading places.
import { s, fmtPop } from './dom';
import type { Settlement, SimSnapshot } from '../sim/types';

const W = 330, H = 230, M = { l: 40, r: 10, t: 22, b: 30 };

export function rankSizeChart(snap: SimSnapshot, onPick?: (id: number) => void): SVGSVGElement {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Rank-size chart' });
  const live = snap.settlements.filter((x) => !x.abandoned).sort((a, b) => b.pop - a.pop).slice(0, 60);
  svg.appendChild(s('text', { x: M.l, y: 14, class: 'ttl' }, 'Rank–size (log–log)'));
  if (live.length < 3) {
    svg.appendChild(s('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }, 'Not enough towns yet'));
    return svg;
  }
  const maxP = live[0].pop, minP = Math.max(10, live[live.length - 1].pop);
  const lx = (r: number) => M.l + (Math.log10(r) / Math.log10(live.length)) * (W - M.l - M.r);
  const ly = (p: number) => H - M.b - ((Math.log10(p) - Math.log10(minP * 0.8)) / (Math.log10(maxP * 1.3) - Math.log10(minP * 0.8))) * (H - M.t - M.b);
  // grid
  for (let e = Math.ceil(Math.log10(minP * 0.8)); e <= Math.log10(maxP * 1.3); e++) {
    const y = ly(Math.pow(10, e));
    svg.appendChild(s('line', { x1: M.l, x2: W - M.r, y1: y, y2: y, stroke: 'rgba(58,42,27,.12)' }));
    svg.appendChild(s('text', { x: M.l - 4, y: y + 3, 'text-anchor': 'end' }, fmtPop(Math.pow(10, e))));
  }
  for (const r of [1, 2, 5, 10, 20, 50]) {
    if (r > live.length) continue;
    const x = lx(r);
    svg.appendChild(s('line', { x1: x, x2: x, y1: M.t, y2: H - M.b, stroke: 'rgba(58,42,27,.12)' }));
    svg.appendChild(s('text', { x, y: H - M.b + 12, 'text-anchor': 'middle' }, String(r)));
  }
  svg.appendChild(s('text', { x: (W + M.l) / 2, y: H - 4, 'text-anchor': 'middle' }, 'rank'));
  // ideal Zipf line through the largest city
  svg.appendChild(s('line', { x1: lx(1), y1: ly(maxP), x2: lx(live.length), y2: ly(maxP / live.length), stroke: '#2f5f7f', 'stroke-dasharray': '4 3', 'stroke-width': 1.3 }));
  svg.appendChild(s('text', { x: lx(live.length) - 2, y: ly(maxP / live.length) - 6, 'text-anchor': 'end', fill: '#2f5f7f' }, 'Zipf: size ∝ 1/rank'));
  // points
  live.forEach((st, i) => {
    const c = s('circle', { cx: lx(i + 1), cy: ly(st.pop), r: i < 5 ? 3.5 : 2.5, fill: st.capital ? '#9e2a1c' : '#3a2a1b', 'fill-opacity': 0.85 });
    const t = s('title', {}, `${i + 1}. ${st.name} — ${fmtPop(st.pop)}`);
    c.appendChild(t);
    if (onPick) { c.style.cursor = 'pointer'; c.addEventListener('click', () => onPick(st.id)); }
    svg.appendChild(c);
    if (i < 3) svg.appendChild(s('text', { x: lx(i + 1) + 6, y: ly(st.pop) + 3, fill: '#3a2a1b' }, st.name));
  });
  return svg;
}

const LINE_COLORS = ['#9e2a1c', '#2f5f7f', '#3f6a2d', '#b8860b', '#5d3f8c', '#7b5a2e'];

export function popTimeChart(snap: SimSnapshot, eraStarts: number[], onPick?: (id: number) => void): SVGSVGElement {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Population over time' });
  svg.appendChild(s('text', { x: M.l, y: 14, class: 'ttl' }, 'The leading places over time'));
  // pick the top 6 by peak population
  const cand: Settlement[] = snap.settlements.filter((x) => x.popHistory.length > 1).sort((a, b) => b.peakPop - a.peakPop).slice(0, 6);
  if (!cand.length || snap.year < 100) {
    svg.appendChild(s('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }, 'Run the simulation to see history'));
    return svg;
  }
  const maxY = snap.year;
  const maxP = Math.max(...cand.map((c) => c.peakPop));
  const x = (yr: number) => M.l + (yr / maxY) * (W - M.l - M.r);
  const y = (p: number) => H - M.b - (Math.sqrt(p) / Math.sqrt(maxP)) * (H - M.t - M.b);
  for (const e of eraStarts) {
    if (e <= 0 || e > maxY) continue;
    svg.appendChild(s('line', { x1: x(e), x2: x(e), y1: M.t, y2: H - M.b, stroke: 'rgba(158,42,28,.25)', 'stroke-dasharray': '2 3' }));
  }
  for (const f of [0.25, 1]) {
    const p = maxP * f;
    svg.appendChild(s('text', { x: M.l - 4, y: y(p) + 3, 'text-anchor': 'end' }, fmtPop(p)));
    svg.appendChild(s('line', { x1: M.l, x2: W - M.r, y1: y(p), y2: y(p), stroke: 'rgba(58,42,27,.1)' }));
  }
  svg.appendChild(s('text', { x: M.l, y: H - M.b + 12 }, '0'));
  svg.appendChild(s('text', { x: W - M.r, y: H - M.b + 12, 'text-anchor': 'end' }, `year ${maxY}`));
  cand.forEach((c, k) => {
    const pts: string[] = [];
    // popHistory sampled every 50 years starting from founding
    const start = Math.ceil(c.founded / 50) * 50;
    c.popHistory.forEach((p, i) => pts.push(`${x(Math.min(maxY, start + i * 50)).toFixed(1)},${y(p).toFixed(1)}`));
    pts.push(`${x(maxY).toFixed(1)},${y(c.pop).toFixed(1)}`);
    const pl = s('polyline', { points: pts.join(' '), fill: 'none', stroke: LINE_COLORS[k], 'stroke-width': 1.8 });
    pl.appendChild(s('title', {}, c.name));
    svg.appendChild(pl);
    const lab = s('text', { x: M.l + 4 + (k % 2) * 140, y: M.t + 10 + Math.floor(k / 2) * 12, fill: LINE_COLORS[k] }, `— ${c.name}`);
    if (onPick) { lab.style.cursor = 'pointer'; lab.addEventListener('click', () => onPick(c.id)); }
    svg.appendChild(lab);
  });
  svg.appendChild(s('text', { x: W - M.r, y: M.t - 8 + 2, 'text-anchor': 'end' }, 'dashed = new era'));
  return svg;
}

export function sparkline(values: number[], w = 300, hgt = 46): SVGSVGElement {
  const svg = s('svg', { viewBox: `0 0 ${w} ${hgt}`, class: 'chart' });
  if (values.length < 2) return svg;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 4) + 2},${hgt - 4 - (v / max) * (hgt - 10)}`).join(' ');
  svg.appendChild(s('polyline', { points: `2,${hgt - 4} ${pts} ${w - 2},${hgt - 4}`, fill: 'rgba(158,42,28,.12)', stroke: 'none' }));
  svg.appendChild(s('polyline', { points: pts, fill: 'none', stroke: '#9e2a1c', 'stroke-width': 1.5 }));
  svg.appendChild(s('text', { x: 4, y: 10 }, `peak ${fmtPop(max)}`));
  return svg;
}
