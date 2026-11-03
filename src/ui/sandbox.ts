// Sandbox mode: generate worlds, sculpt them, watch history.
import type { App, ModeController } from './app';
import { h } from './dom';
import { END_YEAR, ERAS } from '../sim/eras';
import { randomSeed } from './app';
import { DEFAULT_GEN } from '../sim/terrain';

export function sandboxMode(app: App): ModeController {
  return {
    id: 'sandbox',
    title: 'Sandbox',
    renderPanel(el) {
      const year = app.snap?.year ?? 0;
      el.appendChild(h('div', { class: 'empty', style: 'font-style:normal;color:inherit' },
        h('p', {}, h('b', {}, 'You never place a city. '), 'You shape the land; farmers, merchants and engineers do the rest. Press ', h('b', {}, '▶'), ' and watch villages spread from the best farmland, market towns appear between them, and roads, ports and railways follow the trade.'),
      ));
      el.appendChild(h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:8px 0' },
        h('button', { class: 'btn primary', onclick: () => app.play() }, year > 0 ? '▶ Continue' : '▶ Begin history'),
        h('button', { class: 'btn', onclick: async () => { app.setLoading('Running history…'); try { await app.runTo(END_YEAR); } finally { app.setLoading(null); } } }, `⏩ Run to the present (year ${END_YEAR})`),
        h('button', { class: 'btn', onclick: () => app.newWorldDialog() }, '✦ New world…'),
        h('button', { class: 'btn', onclick: () => app.generate({ ...app.genParams, seed: randomSeed() }) }, '🎲 Surprise me'),
      ));
      el.appendChild(h('div', { class: 'section-title' }, 'Things to try'));
      el.appendChild(h('ul', { class: 'hist' },
        h('li', {}, 'Click the biggest town and read its “Why here?” card. Then click a small village nearby and compare.'),
        h('li', {}, 'Turn on ', h('b', {}, 'Market areas'), ': each colour is one market town’s hinterland. Notice the roughly even spacing — Christaller’s central places.'),
        h('li', {}, 'Turn on ', h('b', {}, 'Natural sites'), ' to see confluences, river mouths, falls, fords and passes. How many towns sit on one?'),
        h('li', {}, 'Run past year 1200 and watch the ', h('b', {}, 'Charts'), ' tab: when the railways come, the leading towns change places.'),
        h('li', {}, 'Use ▼ to lower a ridge into a pass, or 〰 to carve a new river, then keep playing. Roads and towns will respond.'),
        h('li', {}, 'Drag the era slider to ', h('b', {}, 'Rail'), ' early, before the land fills up. What changes?'),
      ));
      el.appendChild(h('div', { class: 'section-title' }, 'The eras'));
      el.appendChild(h('ul', { class: 'hist' }, ERAS.map((e) => h('li', {}, h('span', { class: 'y' }, String(e.startYear)), h('b', {}, e.name), ' — ', e.blurb))));
      el.appendChild(h('p', { class: 'explain' }, `This world: seed “${app.genParams.seed}”, ${app.genParams.style}, latitude ${app.genParams.latitude}°.`));
    },
  };
}

export const START_PARAMS = { ...DEFAULT_GEN, seed: 'atlas' };
