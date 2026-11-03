// Earth Mode: run the same model on real terrain, then compare with the
// real cities and read why it is right or wrong.
import type { App, ModeController } from '../ui/app';
import { h, fmtPop } from '../ui/dom';
import { REGION_DEFS } from './regionDefs';
import { NOTES } from './notes';
import { loadRegion, MatchResult, RegionMeta, RealCity, scoreRegion } from './loader';
import { END_YEAR } from '../sim/eras';
import { hashString } from '../sim/rng';
import type { Settlement, SimSnapshot } from '../sim/types';

export function noteFor(regionId: string, name: string): string | undefined {
  return NOTES[regionId]?.cities[name] ?? Object.values(NOTES).find((n) => n.cities[name])?.cities[name];
}

export function earthMode(app: App): ModeController {
  let region: string | null = null;
  let meta: RegionMeta | null = null;
  let landMask: Uint8Array | null = null;
  let running = false;
  let progressYear = 0;
  let result: MatchResult | null = null;
  let focusCity: RealCity | null = null;
  let token = 0;

  const updateMarkers = () => {
    if (!meta || !result) { app.renderer.realCities = []; app.renderer.invalidate(); return; }
    const matched = new Set(result.matched.map((m) => m.real.name));
    const shown = [...result.matched.map((m) => m.real), ...result.missed];
    app.renderer.realCities = shown.map((c) => ({ name: c.name, x: c.x, y: c.y, pop: c.pop, matched: matched.has(c.name), rank: 0 }));
    app.renderer.invalidate();
  };

  const rescore = (snap: SimSnapshot) => {
    if (!meta || !landMask) return;
    result = scoreRegion(meta, snap.settlements, 20, landMask);
    updateMarkers();
  };

  const open = async (id: string) => {
    const my = ++token;
    region = id; result = null; focusCity = null; running = false;
    app.renderer.realCities = [];
    app.setLoading('Fetching real elevation, coastlines and rivers…');
    try {
      const r = await loadRegion(id);
      if (my !== token) return;
      meta = r.meta;
      landMask = r.terrain.waterMask ?? null;
      app.editingAllowed = false;
      app.setTool('inspect');
      await app.loadTerrain(r.terrain, hashString(id));
    } catch (e) {
      app.setLoading(null);
      app.toast(`Could not load this region: ${(e as Error).message}`);
      region = null;
      app.setTab('mode');
      return;
    }
    app.setOverlay('none');
    app.setTab('mode');
    await run(my);
  };

  const run = async (my: number) => {
    running = true;
    app.refreshPanel(true);
    try {
      await app.runTo(END_YEAR, (y) => {
        progressYear = y;
        const el = document.getElementById('earth-progress');
        if (el) el.textContent = `Year ${y} of ${END_YEAR}…`;
        const bar = document.getElementById('earth-bar');
        if (bar) bar.style.width = `${(100 * y) / END_YEAR}%`;
      });
    } finally { if (my === token) running = false; }
    if (my !== token) return;
    if (app.snap) rescore(app.snap);
    app.setTab('mode', true);
  };

  const renderList = (el: HTMLElement) => {
    el.appendChild(h('p', {}, 'The same model — no hand-tuning per place — runs on real elevation, coastlines and rivers. Then the real cities are revealed. Where it is right, geography explains the city. Where it is wrong, there is usually a story: a capital chosen by politics, a canal, a railway, oil.'));
    el.appendChild(h('div', { class: 'card-list' }, REGION_DEFS.map((d) => h('div', { class: 'card', onclick: () => open(d.id) },
      h('h4', {}, d.name), h('p', {}, NOTES[d.id]?.tagline ?? '')))));
    el.appendChild(h('p', { class: 'explain', style: 'margin-top:10px' }, 'Elevation: AWS Terrain Tiles (Mapzen Terrarium; SRTM and other sources). Coasts, lakes, rivers and cities: Natural Earth 1:10m. All preprocessed at build time.'));
  };

  const cityRow = (c: RealCity, model: Settlement | null, km?: number) => h('li', {
    class: 'clickable',
    onclick: () => { focusCity = c; app.renderer.flyTo(c.x, c.y, Math.max(app.renderer.cam.zoom, 4)); app.refreshPanel(true); },
  },
  h('span', { style: `color:${model ? '#1f7a4d' : '#c0392b'};font-weight:bold;margin-right:6px` }, model ? '✓' : '✗'),
  h('b', {}, c.name), ` ${fmtPop(c.pop)}`,
  model ? h('span', { class: 'explain' }, ` — model: ${model.name} (${fmtPop(model.pop)}, ${Math.round(km ?? 0)} km away)`) : h('span', { class: 'explain' }, ' — no model town nearby'),
  focusCity?.name === c.name && noteFor(region!, c.name) ? h('div', { style: 'margin:4px 0 2px 18px;font-size:13.5px' }, noteFor(region!, c.name)) : null,
  );

  const renderRegion = (el: HTMLElement) => {
    const def = REGION_DEFS.find((d) => d.id === region)!;
    const notes = NOTES[region!];
    el.appendChild(h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' },
      h('h3', { style: 'margin:0;font-family:var(--sc);font-weight:400;font-size:21px' }, def.name),
      h('button', { class: 'btn small', onclick: () => { token++; region = null; result = null; app.renderer.realCities = []; app.pause(); app.setTab('mode'); } }, '← Regions'),
    ));
    el.appendChild(h('p', {}, notes.intro));
    if (running || !result) {
      el.appendChild(h('div', { class: 'goal' },
        h('h4', {}, 'Running history on real terrain'),
        h('div', { id: 'earth-progress' }, `Year ${progressYear} of ${END_YEAR}…`),
        h('div', { style: 'height:6px;background:rgba(58,42,27,.15);border-radius:3px;margin-top:6px;overflow:hidden' }, h('div', { id: 'earth-bar', style: `height:100%;width:${(100 * progressYear) / END_YEAR}%;background:#9e2a1c;transition:width .2s` })),
        h('p', { class: 'explain' }, 'Watch the villages spread along the rivers. The real cities will be revealed at the end.'),
      ));
      el.appendChild(h('div', { class: 'section-title' }, 'What to watch for'));
      el.appendChild(h('ul', { class: 'hist' }, notes.watch.map((w) => h('li', {}, w))));
      return;
    }
    const r = result;
    el.appendChild(h('div', { class: 'goal' },
      h('div', { style: 'display:flex;gap:14px;align-items:center' },
        h('div', { class: 'score' }, `${r.score}`),
        h('div', {}, h('b', {}, `${r.matched.length} of ${r.k}`), ` of the largest real cities have one of the model’s ${r.candidates} biggest places within ${r.radiusKm.toFixed(0)} km.`,
          h('div', { class: 'explain' }, `Randomly scattered towns would score about ${r.baseline}. Size ranking agreement among the matches: ${r.sizeScore > 0 ? '+' : ''}${r.sizeScore}%.`)),
      ),
      h('label', { class: 'auto', style: 'margin-top:6px' },
        h('input', { type: 'checkbox', checked: app.renderer.showRealCities, onchange: (e: Event) => { app.renderer.showRealCities = (e.target as HTMLInputElement).checked; app.renderer.invalidate(); } }),
        'Show real cities (green squares = predicted, red = missed)'),
    ));
    if (focusCity) {
      const n = noteFor(region!, focusCity.name);
      el.appendChild(h('div', { class: 'why' }, h('div', { class: 'lead' }, h('b', {}, focusCity.name), focusCity.capital === 'national' ? ' — national capital' : ''), n ?? 'No note for this city yet.'));
    }
    el.appendChild(h('div', { class: 'section-title' }, 'Real cities, largest first'));
    const rows = [...r.matched.map((m) => ({ c: m.real, m: m.model as Settlement | null, km: m.km })), ...r.missed.map((c) => ({ c, m: null as Settlement | null, km: 0 }))]
      .sort((a, b) => b.c.pop - a.c.pop);
    el.appendChild(h('ul', { class: 'hist' }, rows.map((x) => cityRow(x.c, x.m, x.km))));
    if (r.phantoms.length) {
      el.appendChild(h('div', { class: 'section-title' }, 'Model cities with no real counterpart'));
      el.appendChild(h('p', { class: 'explain' }, 'Places the model expected that history did not build (or built smaller). Click to ask the model why.'));
      el.appendChild(h('div', { class: 'chips' }, r.phantoms.slice(0, 10).map((s) => h('button', { class: 'btn small', onclick: () => app.select(s, true) }, `${s.name} (${fmtPop(s.pop)})`))));
    }
    el.appendChild(h('div', { class: 'section-title' }, 'What the model gets right'));
    el.appendChild(h('ul', { class: 'hist' }, notes.watch.map((w) => h('li', {}, w))));
    el.appendChild(h('div', { class: 'section-title' }, 'What it cannot know'));
    el.appendChild(h('ul', { class: 'hist' }, notes.limits.map((w) => h('li', {}, w))));
    el.appendChild(h('p', { class: 'explain' }, 'Tip: click any model town and read its “Why here?”, then compare with the real city’s note. Try the Charts tab: does the region follow Zipf’s law?'));
  };

  app.onRealCity = (name) => {
    if (!meta) return;
    focusCity = meta.cities.find((c) => c.name === name) ?? null;
    app.setTab('mode', true);
  };

  return {
    id: 'earth',
    title: 'Earth',
    renderPanel(el) {
      if (!region) renderList(el);
      else renderRegion(el);
    },
    onSnapshot(s) {
      if (!running && region && result && s.year >= END_YEAR) rescore(s);
    },
    leave() {
      token++;
      region = null; result = null; meta = null;
      app.renderer.realCities = [];
      app.editingAllowed = true;
      app.onRealCity = undefined;
    },
  };
}

/** Extra line for the inspector in Earth Mode: the real counterpart of a model town. */
export function realCounterpart(meta: RegionMeta | null, s: Settlement): string | null {
  if (!meta) return null;
  let best: RealCity | null = null, bd = Infinity;
  for (const c of meta.cities) {
    const d = Math.hypot(c.x - s.x, c.y - s.y) * meta.cellKm;
    if (d < bd) { bd = d; best = c; }
  }
  return best && bd < 40 ? `${best.name} (${Math.round(bd)} km away)` : null;
}
