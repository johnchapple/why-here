// The "Why here?" inspector: explains in plain language why a settlement
// was founded where it is and what its people live on today.
import { h, fmtPopLong } from './dom';
import { sparkline } from './charts';
import type { Settlement, SimSnapshot, GrowthKey } from '../sim/types';
import { ERAS } from '../sim/eras';
import { tierName } from '../sim/emergence';

export const GROWTH_META: Record<GrowthKey, { label: string; color: string; explain: string }> = {
  farming: { label: 'Farming', color: '#7a9a3a', explain: 'farm families working the fields within a day\'s walk' },
  market: { label: 'Market services', color: '#c08a2b', explain: 'merchants, smiths, inns and clerks serving the villages that come here to market' },
  trade: { label: 'Long-distance trade', color: '#9e2a1c', explain: 'merchants handling trade with other towns (gravity model)' },
  transfer: { label: 'Break of bulk', color: '#2f5f7f', explain: 'dockers, warehouses and wagoners where cargo switches between boat and cart' },
  through: { label: 'Through traffic', color: '#8a6d4a', explain: 'inns, tolls and services for traffic passing through' },
  industry: { label: 'Industry', color: '#4a4a4a', explain: 'factories drawn by access to big markets (market potential)' },
  resource: { label: 'Mining & extraction', color: '#6b4c9a', explain: 'mines, quarries, salt pans or timber camps' },
  admin: { label: 'Government', color: '#b03a6a', explain: 'officials, courts and the court of a capital or regional seat' },
};

const ORIGIN_TEXT: Record<Settlement['origin'], string> = {
  farming: 'farming village',
  market: 'market town',
  port: 'port',
  riverport: 'river port',
  crossing: 'river-crossing town',
  pass: 'pass town',
  mining: 'mining town',
  junction: 'railway junction',
};

export function renderInspector(s: Settlement, snap: SimSnapshot, opts: { onSelect: (id: number) => void; onZoom: (s: Settlement) => void; onCatchment: (s: Settlement) => void }): HTMLElement {
  const root = h('div', {});
  const tier = tierName(s.tier);
  const badges: HTMLElement[] = [];
  if (s.capital) badges.push(h('span', { class: 'badge red' }, '★ capital'));
  if (s.order >= 2) badges.push(h('span', { class: 'badge' }, 'regional centre'));
  else if (s.market) badges.push(h('span', { class: 'badge' }, 'market town'));
  if (s.port) badges.push(h('span', { class: 'badge blue' }, '⚓ port'));
  if (s.rail) badges.push(h('span', { class: 'badge' }, 'on the railway'));
  if (s.abandoned) badges.push(h('span', { class: 'badge red' }, 'abandoned'));
  const rank = snap.settlements.filter((x) => !x.abandoned).sort((a, b) => b.pop - a.pop).findIndex((x) => x.id === s.id) + 1;

  root.appendChild(h('div', { class: 's-head' },
    h('div', {},
      h('h2', {}, s.name),
      h('div', { class: 'meta' }, `A ${tier} of ${fmtPopLong(s.pop)} · rank ${rank} · founded year ${s.founded} (${ERAS[s.foundedEra].name}) as a ${ORIGIN_TEXT[s.origin]}`),
      h('div', { class: 'badges' }, badges),
    ),
  ));

  // --- Why here? (founding)
  const top = s.foundingFactors.slice(0, 6);
  const lead = top.length
    ? `Founded here for ${joinList(top.slice(0, 3).map((f) => f.label))}.`
    : 'Founded here.';
  root.appendChild(h('div', { class: 'why' },
    h('div', { class: 'section-title', style: 'margin-top:0' }, 'Why here?'),
    h('div', { class: 'lead' }, lead),
    top.map((f) => factorRow(f.label, f.weight)),
  ));

  if (s.market && s.marketFactors?.length) {
    root.appendChild(h('div', { class: 'section-title' }, `Why a market town (since year ${s.marketSince})?`));
    root.appendChild(h('div', {}, s.marketFactors.slice(0, 4).map((f) => factorRow(f.label, f.weight))));
  }

  // --- Why did it grow?
  const g = s.growth;
  const keys = (Object.keys(GROWTH_META) as GrowthKey[]).filter((k) => g[k] > s.pop * 0.005);
  const total = keys.reduce((a, k) => a + g[k], 0) || 1;
  root.appendChild(h('div', { class: 'section-title' }, 'What its people live on today'));
  root.appendChild(h('div', { class: 'stack' }, keys.map((k) => h('i', { style: `width:${(100 * g[k]) / total}%;background:${GROWTH_META[k].color}`, title: GROWTH_META[k].label }))));
  const sorted = [...keys].sort((a, b) => g[b] - g[a]);
  root.appendChild(h('div', { class: 'stack-key' }, sorted.map((k) => h('span', {}, h('b', { style: `background:${GROWTH_META[k].color}` }), `${GROWTH_META[k].label} ${Math.round((100 * g[k]) / total)}%`))));
  if (sorted.length) {
    const main = sorted[0];
    const second = sorted[1];
    root.appendChild(h('p', { class: 'explain' },
      `Mostly ${GROWTH_META[main].explain}${second ? `; also ${GROWTH_META[second].explain}` : ''}.`,
      s.market && s.servedPop > 0 ? ` Its market serves about ${fmtPopLong(s.servedPop)} country people.` : '',
    ));
  }

  if (s.siteFacts.length) {
    root.appendChild(h('div', { class: 'section-title' }, 'The site'));
    root.appendChild(h('div', { class: 'chips' }, [...new Set(s.siteFacts)].map((f) => h('span', { class: 'badge' }, f))));
  }

  if (s.popHistory.length > 1) {
    root.appendChild(h('div', { class: 'section-title' }, 'Population'));
    root.appendChild(sparkline([...s.popHistory, s.pop]));
  }

  const served = s.servedBy >= 0 && s.servedBy !== s.id ? snap.settlements[s.servedBy] : null;
  const actions = h('div', { style: 'display:flex;gap:6px;margin-top:10px;flex-wrap:wrap' },
    h('button', { class: 'btn small', onclick: () => opts.onZoom(s) }, 'Zoom to'),
    h('button', { class: 'btn small', onclick: () => opts.onCatchment(s) }, 'Show its farmland'),
    served ? h('button', { class: 'btn small', onclick: () => opts.onSelect(served.id) }, `Its market: ${served.name}`) : null,
  );
  root.appendChild(actions);

  if (s.history.length) {
    root.appendChild(h('div', { class: 'section-title' }, 'Chronicle of ' + s.name));
    root.appendChild(h('ul', { class: 'hist' }, [...s.history].reverse().map((e) => h('li', {}, h('span', { class: 'y' }, String(e.year)), e.text))));
  }
  return root;
}

function factorRow(label: string, w: number): HTMLElement {
  const pct = Math.round(w * 100);
  return h('div', { class: 'factor' },
    h('span', {}, capitalize(label)),
    h('span', { class: 'pct' }, `+${pct}%`),
    h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(3, pct)}%` })),
  );
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function joinList(a: string[]) {
  if (a.length <= 1) return a.join('');
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}
