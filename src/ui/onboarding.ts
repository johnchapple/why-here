// First-visit welcome: three short cards, then pick a way to play.
import type { App } from './app';
import { h, clear } from './dom';

const KEY = 'why-here:onboarded';

export function showOnboarding(app: App, force = false) {
  try { if (!force && localStorage.getItem(KEY)) return; } catch { /* storage may be unavailable */ }
  const pages: (() => HTMLElement[])[] = [
    () => [
      h('h2', {}, 'Why are cities where they are?'),
      h('p', {}, 'Paris, Cairo, St. Louis, Osaka — none were put there by a game designer. Farmers, merchants, boatmen and railway engineers chose those spots, again and again, for reasons you can read in the land.'),
      h('p', {}, h('b', {}, 'In this atlas you never place a city. '), 'You shape the land and pick an era. Villages, market towns, ports, roads and railways emerge on their own from the rules of economic geography.'),
    ],
    () => [
      h('h2', {}, 'Click any town: “Why here?”'),
      h('p', {}, 'Every settlement remembers why it was founded — fertile land within a day’s walk, a ford, the meeting of two rivers, a sheltered harbour, the falls where boats must unload — and what its people live on today.'),
      h('p', {}, 'Press ', h('b', {}, '▶'), ' to let history run. Drag to pan, scroll or pinch to zoom. Turn on map layers (bottom left) to see market areas, trade flows and natural sites.'),
    ],
    () => [
      h('h2', {}, 'Three ways to play'),
      h('div', { class: 'card-list' },
        h('div', { class: 'card', onclick: () => { done(); app.play(); } }, h('h4', {}, 'Sandbox'), h('p', {}, 'Watch a new land fill up, then sculpt it with brushes and see what changes.')),
        h('div', { class: 'card', onclick: () => { done(); app.onModeChange?.('scenario'); } }, h('h4', {}, 'Lessons'), h('p', {}, 'Six short guided maps: the ten-mile rule, fall-line cities, confluences, ports, passes and the railway age.')),
        h('div', { class: 'card', onclick: () => { done(); app.onModeChange?.('earth'); } }, h('h4', {}, 'Earth Mode'), h('p', {}, 'Run the model on the Nile, the Rhine, the Mississippi, Japan and more — then see where it agrees with reality, and why it doesn’t.')),
      ),
    ],
  ];
  let page = 0;
  const body = h('div', {});
  const dots = h('div', { style: 'display:flex;gap:6px;justify-content:center;margin-top:10px' });
  const next = h('button', { class: 'btn primary' }, 'Next →') as HTMLButtonElement;
  const skip = h('button', { class: 'btn' }, 'Skip') as HTMLButtonElement;
  const render = () => {
    clear(body); body.append(...pages[page]());
    clear(dots);
    pages.forEach((_, i) => dots.appendChild(h('span', { style: `width:8px;height:8px;border-radius:50%;background:${i === page ? '#9e2a1c' : 'rgba(58,42,27,.25)'}` })));
    next.style.display = page === pages.length - 1 ? 'none' : '';
    skip.textContent = page === pages.length - 1 ? 'Just explore' : 'Skip';
  };
  const done = () => {
    try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    close();
  };
  next.addEventListener('click', () => { page = Math.min(pages.length - 1, page + 1); render(); });
  skip.addEventListener('click', () => done());
  const close = app.modal([body, dots, h('div', { class: 'actions' }, skip, next)], () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } });
  render();
}
