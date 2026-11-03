// Application shell: wires the worker, renderer and the parchment UI.
import { Renderer } from '../render/renderer';
import { OVERLAYS, OverlayKind } from '../render/overlays';
import { SimClient } from './client';
import { h, clear, fmtPop, fmtPopLong } from './dom';
import { renderInspector, GROWTH_META } from './inspector';
import { rankSizeChart, popTimeChart } from './charts';
import { ERAS, END_YEAR } from '../sim/eras';
import { DEFAULT_GEN, GenParams, WorldStyle } from '../sim/terrain';
import type { World, ResourceKind, TerrainInput } from '../sim/grid';
import type { EraId, Settlement, SimSnapshot } from '../sim/types';
import type { BrushOp } from '../worker/protocol';
import { tierName } from '../sim/emergence';

export type Tool = 'inspect' | 'raise' | 'lower' | 'smooth' | 'river' | 'sea' | 'drain' | 'resource';
export type Tab = 'inspect' | 'places' | 'stats' | 'chronicle' | 'mode';

export interface ModeController {
  id: 'sandbox' | 'scenario' | 'earth';
  title: string;
  renderPanel(el: HTMLElement): void;
  onSnapshot?(snap: SimSnapshot): void;
  onWorld?(w: World): void;
  onTool?(tool: Tool): void;
  onOverlay?(o: OverlayKind): void;
  onSelect?(s: Settlement | null): void;
  onTab?(t: Tab): void;
  inspectorExtra?(s: Settlement): HTMLElement | null;
  leave?(): void;
}

const TOOLS: { id: Tool; icon: string; tip: string }[] = [
  { id: 'inspect', icon: '☞', tip: 'Inspect & pan (click a town: “Why here?”)' },
  { id: 'raise', icon: '▲', tip: 'Raise land' },
  { id: 'lower', icon: '▼', tip: 'Lower land' },
  { id: 'smooth', icon: '≈', tip: 'Smooth' },
  { id: 'river', icon: '〰', tip: 'Carve a river valley (drag downhill)' },
  { id: 'sea', icon: '◒', tip: 'Flood: make sea or lake' },
  { id: 'drain', icon: '◓', tip: 'Drain: make land' },
  { id: 'resource', icon: '⛏', tip: 'Place a resource' },
];

const SPEEDS = [1, 2, 5, 10];

export class App {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  client: SimClient;
  world: World | null = null;
  snap: SimSnapshot | null = null;
  selected: Settlement | null = null;
  playing = false;
  speed = 2;
  autoEra = true;
  tool: Tool = 'inspect';
  brushR = 6;
  brushStrength = 0.6;
  resourceKind: ResourceKind = 'ore';
  overlay: OverlayKind = 'none';
  tab: Tab = 'inspect';
  busy = false;
  stopAt: number | null = END_YEAR;
  mode: ModeController | null = null;
  genParams: GenParams = { ...DEFAULT_GEN };
  editingAllowed = true;
  private stepTimer = 0;
  private placesSort: 'pop' | 'name' | 'founded' = 'pop';
  // DOM refs
  private el: Record<string, HTMLElement> = {};
  private lastEventCount = 0;
  private panelBody!: HTMLElement;
  private tabButtons: Record<string, HTMLButtonElement> = {};
  private renderedTab: Tab | null = null;
  private panelOpen = true;
  onModeChange?: (id: string) => void;
  onRealCity?: (name: string) => void;

  constructor(root: HTMLElement) {
    this.root = root;
    this.canvas = h('canvas', { id: 'map' });
    root.appendChild(this.canvas);
    this.renderer = new Renderer(this.canvas);
    this.client = new SimClient();
    this.client.onError = (m) => this.toast('Something went wrong in the simulation: ' + m.split('\n')[0]);
    this.buildUI();
    this.bindInput();
    window.addEventListener('resize', () => { this.renderer.resize(); this.updateInsets(); });
    if (this.isMobile) { this.setPanelOpen(false); this.el.legend.classList.add('collapsed'); }
  }

  // ------------------------------------------------------------------ UI build
  private buildUI() {
    const r = this.root;
    // cartouche
    const modes = h('div', { class: 'modes' });
    for (const [id, label] of [['sandbox', 'Sandbox'], ['scenario', 'Lessons'], ['earth', 'Earth Mode']] as const) {
      const b = h('button', { 'data-mode': id, onclick: () => this.onModeChange?.(id) }, label);
      modes.appendChild(b);
    }
    this.el.modes = modes;
    r.appendChild(h('div', { class: 'cartouche parchment' },
      h('div', {}, h('h1', {}, 'Why ', h('em', {}, 'Here'), '?'), h('div', { class: 'sub' }, 'where cities come from')),
      modes,
    ));

    // time bar
    const yearEl = h('div', { class: 'year' }, 'Year 0');
    const eraName = h('span', { class: 'era-name' }, ERAS[0].name);
    const play = h('button', { class: 'btn iconbtn primary', title: 'Play / pause (space)', onclick: () => this.togglePlay() }, '▶');
    const step = h('button', { class: 'btn iconbtn', title: 'Step 10 years', onclick: () => this.stepOnce() }, '⏭');
    const reset = h('button', { class: 'btn iconbtn', title: 'Restart history on this land', onclick: () => this.resetSim() }, '⟲');
    const speed = h('div', { class: 'speed' }, SPEEDS.map((sp) => h('button', { class: 'btn small' + (sp === this.speed ? ' on' : ''), 'data-speed': sp, onclick: () => this.setSpeed(sp), title: `${sp * 10} years per tick` }, `${sp}×`)));
    const eraRange = h('input', { type: 'range', min: 0, max: 4, step: 1, value: 0, 'aria-label': 'Technology era' }) as HTMLInputElement;
    eraRange.addEventListener('input', () => this.setEra(+eraRange.value as EraId, false));
    const ticks = h('div', { class: 'era-ticks' }, ERAS.map((e) => h('span', { 'data-era': e.id, title: e.blurb, onclick: () => this.setEra(e.id, false) }, e.name.split(' ')[0])));
    const autoBox = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
    autoBox.addEventListener('change', () => { this.autoEra = autoBox.checked; if (this.snap) this.client.send({ type: 'setEra', era: this.snap.era, auto: this.autoEra }); });
    const eraCtl = h('div', { class: 'era-ctl' }, eraRange, ticks, h('label', { class: 'auto', title: 'Let eras follow the calendar: foot (0), sail (500), canal (1000), rail (1200), automobile (1400)' }, autoBox, 'eras advance with time'));
    r.appendChild(h('div', { class: 'timebar parchment' }, reset, play, step, h('div', {}, yearEl, eraName), speed, eraCtl));
    Object.assign(this.el, { yearEl, eraName, play, speed, eraRange, ticks, autoBox });

    // tools
    const tools = h('div', { class: 'tools parchment' });
    TOOLS.forEach((t, i) => {
      if (i === 1 || i === 7) tools.appendChild(h('div', { class: 'sep' }));
      tools.appendChild(h('button', { class: 'btn' + (t.id === this.tool ? ' on' : ''), 'data-tool': t.id, 'data-tip': t.tip, 'aria-label': t.tip, onclick: () => this.setTool(t.id) }, t.icon));
    });
    tools.appendChild(h('div', { class: 'sep' }));
    tools.appendChild(h('button', { class: 'btn', 'data-tip': 'New world…', 'aria-label': 'New world', onclick: () => this.newWorldDialog() }, '✦'));
    tools.appendChild(h('button', { class: 'btn', 'data-tip': 'Fit map to screen', 'aria-label': 'Fit map', onclick: () => this.renderer.fit() }, '⤢'));
    tools.appendChild(h('button', { class: 'btn', 'data-tip': 'How it works', 'aria-label': 'Help', onclick: () => this.showHelp() }, '?'));
    r.appendChild(tools);
    this.el.tools = tools;

    const radius = h('input', { type: 'range', min: 2, max: 20, value: this.brushR }) as HTMLInputElement;
    radius.addEventListener('input', () => { this.brushR = +radius.value; });
    const strength = h('input', { type: 'range', min: 0.1, max: 1.5, step: 0.05, value: this.brushStrength }) as HTMLInputElement;
    strength.addEventListener('input', () => { this.brushStrength = +strength.value; });
    const resSel = h('select', {}, (['ore', 'coal', 'gold', 'salt', 'stone', 'timber'] as ResourceKind[]).map((k) => h('option', { value: k }, k))) as HTMLSelectElement;
    resSel.addEventListener('change', () => { this.resourceKind = resSel.value as ResourceKind; });
    const keep = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
    this.el.keepSim = keep;
    const brushOpts = h('div', { class: 'brush-opts parchment' },
      h('label', {}, 'Size', radius), h('label', {}, 'Strength', strength),
      h('label', { class: 'res-only' }, 'Resource', resSel),
      h('label', {}, 'Keep history', keep),
      h('div', { class: 'note' }, 'Rivers re-route and towns respond when you release the brush.'),
    );
    r.appendChild(brushOpts);
    this.el.brushOpts = brushOpts;

    // legend / overlays
    const list = h('div', { class: 'overlay-list' }, OVERLAYS.map((o) => h('button', { class: 'btn small' + (o.id === this.overlay ? ' on' : ''), 'data-ov': o.id, onclick: () => this.setOverlay(o.id) }, o.label)));
    const hint = h('div', { class: 'hint' }, OVERLAYS[0].hint);
    const key = h('div', { class: 'key' });
    const legend = h('div', { class: 'legend parchment' }, h('h3', {}, 'Map layers'), list, hint, key);
    legend.querySelector('h3')!.addEventListener('click', () => legend.classList.toggle('collapsed'));
    r.appendChild(legend);
    Object.assign(this.el, { ovList: list, ovHint: hint, ovKey: key, legend });
    this.renderKey();

    // right panel
    const tabs = h('div', { class: 'tabs' });
    const tabDefs: [Tab, string][] = [['mode', 'Guide'], ['inspect', 'Why here?'], ['places', 'Places'], ['stats', 'Charts'], ['chronicle', 'Chronicle']];
    for (const [id, label] of tabDefs) {
      const b = h('button', { class: 'btn', onclick: () => this.setTab(id) }, label) as HTMLButtonElement;
      this.tabButtons[id] = b;
      tabs.appendChild(b);
    }
    this.panelBody = h('div', { class: 'tab-body' });
    const close = h('button', { class: 'btn small', title: 'Hide panel', style: 'flex:0 0 auto;border-radius:4px;margin-bottom:4px', onclick: () => this.setPanelOpen(false) }, '×');
    tabs.appendChild(close);
    const panel = h('div', { class: 'panel parchment' }, tabs, this.panelBody);
    r.appendChild(panel);
    const toggle = h('button', { class: 'btn panel-toggle', onclick: () => this.setPanelOpen(true) }, '☰ Guide');
    r.appendChild(toggle);
    Object.assign(this.el, { panel, panelToggle: toggle });
    this.setPanelOpen(true);

    // ticker
    const ticker = h('div', { class: 'ticker parchment', onclick: () => this.setTab('chronicle') });
    r.appendChild(ticker);
    this.el.ticker = ticker;

    const loading = h('div', { class: 'loading' }, h('div', { class: 'parchment' }, 'Surveying the land…'));
    r.appendChild(loading);
    this.el.loading = loading;

    document.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); }
      else if (e.key === 'Escape') this.select(null);
      else if (e.key === '.') this.stepOnce();
    });
  }

  setPanelOpen(open: boolean) {
    this.panelOpen = open;
    this.el.panel.classList.toggle('hidden', !open);
    this.el.panelToggle.style.display = open ? 'none' : '';
    this.updateInsets();
  }

  setLoading(msg: string | null) {
    this.el.loading.classList.toggle('hidden', !msg);
    if (msg) (this.el.loading.firstChild as HTMLElement).textContent = msg;
  }

  toast(msg: string, ms = 3500) {
    const t = h('div', { class: 'toast parchment' }, msg);
    this.root.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  setModeButtons(id: string) {
    for (const b of this.el.modes.querySelectorAll('button')) b.classList.toggle('on', b.getAttribute('data-mode') === id);
  }

  setMode(m: ModeController) {
    this.mode?.leave?.();
    this.mode = m;
    this.setModeButtons(m.id);
    this.tabButtons.mode.textContent = m.title;
    this.setTab('mode');
  }

  // --------------------------------------------------------------- world I/O
  async generate(params: GenParams) {
    this.pause();
    this.genParams = params;
    this.setLoading('Raising mountains, carving rivers…');
    this.select(null);
    try {
      const r = await this.client.request({ type: 'generate', params });
      this.acceptWorld(r.world!, true);
      this.acceptSnapshot(r.snap!);
    } finally { this.setLoading(null); }
  }

  async loadTerrain(terrain: TerrainInput, seed: number, startEra?: EraId) {
    this.pause();
    this.setLoading('Surveying the land…');
    this.select(null);
    try {
      const r = await this.client.request({ type: 'loadTerrain', terrain, seed, startEra });
      this.acceptWorld(r.world!, true);
      this.acceptSnapshot(r.snap!);
    } finally { this.setLoading(null); }
  }

  private updateInsets() {
    const mobile = window.innerWidth < 760;
    this.renderer.insets = mobile
      ? { l: 0, t: 100, r: 0, b: 110 }
      : { l: 76, t: 84, r: this.panelOpen ? 384 : 0, b: 20 };
  }

  private acceptWorld(w: World, fit: boolean) {
    this.world = w;
    this.updateInsets();
    this.renderer.setWorld(w, fit);
    this.mode?.onWorld?.(w);
  }

  acceptSnapshot(s: SimSnapshot) {
    this.snap = s;
    this.renderer.setSnapshot(s);
    if (this.selected) {
      this.selected = s.settlements[this.selected.id] ?? null;
      this.renderer.selected = this.selected?.id ?? -1;
    }
    this.updateTimebar();
    this.updateTicker();
    this.refreshPanel(false);
    this.mode?.onSnapshot?.(s);
  }

  // ------------------------------------------------------------------- time
  togglePlay() { if (this.playing) this.pause(); else this.play(); }

  play() {
    if (!this.world || this.playing) return;
    if (this.stopAt !== null && this.snap && this.snap.year >= this.stopAt) this.stopAt = null;
    this.playing = true;
    this.el.play.textContent = '❚❚';
    this.tick();
  }

  pause() {
    this.playing = false;
    this.el.play.textContent = '▶';
    clearTimeout(this.stepTimer);
  }

  private async tick() {
    if (!this.playing || this.busy) return;
    this.busy = true;
    const t0 = performance.now();
    try {
      const r = await this.client.request({ type: 'step', years: this.speed * 10 });
      this.acceptSnapshot(r.snap!);
    } finally { this.busy = false; }
    if (this.stopAt !== null && this.snap && this.snap.year >= this.stopAt) {
      this.pause();
      if (this.snap.year >= END_YEAR) this.toast('The present day. Keep playing to continue, or explore the map.');
      return;
    }
    const elapsed = performance.now() - t0;
    this.stepTimer = window.setTimeout(() => this.tick(), Math.max(30, 220 - elapsed));
  }

  async stepOnce() {
    if (this.busy) return;
    this.busy = true;
    try { const r = await this.client.request({ type: 'step', years: 10 }); this.acceptSnapshot(r.snap!); } finally { this.busy = false; }
  }

  async runTo(year: number, onProgress?: (y: number) => void) {
    this.pause();
    while (this.snap && this.snap.year < year) {
      const r = await this.client.request({ type: 'step', years: Math.min(100, year - this.snap.year) });
      this.acceptSnapshot(r.snap!);
      onProgress?.(this.snap.year);
    }
  }

  async resetSim() {
    this.pause();
    this.select(null);
    const r = await this.client.request({ type: 'resetSim' });
    this.acceptSnapshot(r.snap!);
    this.stopAt = END_YEAR;
  }

  setSpeed(sp: number) {
    this.speed = sp;
    for (const b of this.el.speed.querySelectorAll('button')) b.classList.toggle('on', +b.getAttribute('data-speed')! === sp);
  }

  setEra(e: EraId, auto: boolean) {
    this.autoEra = auto;
    (this.el.autoBox as HTMLInputElement).checked = auto;
    this.client.send({ type: 'setEra', era: e, auto });
    // reflect immediately; snapshot will confirm
    (this.el.eraRange as HTMLInputElement).value = String(e);
    this.markEraTicks(e);
    this.el.eraName.textContent = ERAS[e].name;
    if (!this.playing) this.stepOnce();
  }

  private markEraTicks(e: EraId) {
    for (const sp of this.el.ticks.querySelectorAll('span')) sp.classList.toggle('on', +sp.getAttribute('data-era')! === e);
  }

  private updateTimebar() {
    if (!this.snap) return;
    this.el.yearEl.textContent = `Year ${this.snap.year}`;
    this.el.eraName.textContent = ERAS[this.snap.era].name;
    (this.el.eraRange as HTMLInputElement).value = String(this.snap.era);
    this.markEraTicks(this.snap.era);
  }

  private updateTicker() {
    const ev = this.snap?.events;
    if (!ev || !ev.length) { this.el.ticker.textContent = ''; return; }
    if (ev.length === this.lastEventCount && this.el.ticker.textContent) return;
    this.lastEventCount = ev.length;
    // prefer interesting events
    const interesting = [...ev].reverse().find((e) => e.kind !== 'grow') ?? ev[ev.length - 1];
    clear(this.el.ticker);
    this.el.ticker.appendChild(h('span', { class: 'y' }, `Year ${interesting.year}`));
    this.el.ticker.appendChild(document.createTextNode(interesting.text));
  }

  // ------------------------------------------------------------------ tools
  setTool(t: Tool) {
    if (t !== 'inspect' && !this.editingAllowed) { this.toast('Terrain editing is off in this mode — switch to Sandbox to sculpt.'); return; }
    this.tool = t;
    for (const b of this.el.tools.querySelectorAll('button[data-tool]')) b.classList.toggle('on', b.getAttribute('data-tool') === t);
    this.el.brushOpts.classList.toggle('show', t !== 'inspect');
    (this.el.brushOpts.querySelector('.res-only') as HTMLElement).style.display = t === 'resource' ? '' : 'none';
    this.canvas.classList.toggle('brush', t !== 'inspect');
    this.renderer.brushPreview = null;
    this.mode?.onTool?.(t);
  }

  setOverlay(o: OverlayKind) {
    this.overlay = o;
    this.renderer.setOverlay(o);
    for (const b of this.el.ovList.querySelectorAll('button')) b.classList.toggle('on', b.getAttribute('data-ov') === o);
    this.el.ovHint.textContent = OVERLAYS.find((x) => x.id === o)?.hint ?? '';
    this.renderKey();
    this.mode?.onOverlay?.(o);
  }

  private renderKey() {
    const k = this.el.ovKey;
    clear(k);
    const dot = (style: string) => h('b', { style: `display:inline-block;${style}` });
    const items: [HTMLElement, string][] = [
      [dot('width:7px;height:7px;border-radius:50%;background:#3a2a1b'), 'village'],
      [dot('width:9px;height:9px;border-radius:50%;border:1.5px solid #3a2a1b;background:radial-gradient(#3a2a1b 30%,#f4ead2 35%)'), 'market town'],
      [dot('width:11px;height:11px;border-radius:50%;background:#9e2a1c;border:1.5px solid #3a2a1b'), 'city'],
      [h('b', { style: 'color:#9e2a1c' }, '★'), 'capital'],
      [dot('width:16px;height:0;border-top:2px solid #9a3b26'), 'road'],
      [dot('width:16px;height:3px;background:repeating-linear-gradient(90deg,#1f1a16 0 4px,#f3e9cf 4px 8px);border:1px solid #1f1a16'), 'railway'],
    ];
    if (this.overlay === 'sites') {
      const sym: [string, string, string][] = [['Y', '#6a2d7a', 'confluence'], ['⚓', '#1d4f7a', 'river mouth'], ['≋', '#a1311e', 'falls'], ['⊣', '#a1311e', 'head of navigation'], ['⇋', '#2d6a3a', 'ford'], ['⋀', '#5b3b1b', 'pass']];
      items.length = 0;
      for (const [g, c, t] of sym) items.push([h('b', { style: `color:${c};font-family:var(--serif)` }, g), t]);
      items.push([h('b', {}, 'Fe C S Au'), 'resources']);
    }
    if (this.overlay === 'eras') {
      ['#7b5a2e', '#2f6f6a', '#3c5a99', '#8e2f2f', '#5d3f8c'].forEach((c, i) => items.push([dot(`width:9px;height:9px;border-radius:50%;background:${c}`), ERAS[i].name]));
    }
    for (const [d, t] of items) k.appendChild(h('span', {}, d, t));
  }

  // ------------------------------------------------------------------ panel
  get isMobile() { return window.innerWidth < 760; }

  setTab(t: Tab, open = !this.isMobile) {
    this.tab = t;
    for (const [id, b] of Object.entries(this.tabButtons)) b.classList.toggle('on', id === t);
    if (open && !this.panelOpen) this.setPanelOpen(true);
    this.refreshPanel(true);
    this.mode?.onTab?.(t);
  }

  refreshPanel(force: boolean) {
    const body = this.panelBody;
    if (!force && this.tab === 'mode') return; // mode panels refresh themselves
    if (!force && this.renderedTab === this.tab && this.tab === 'stats' && this.playing && (this.snap?.year ?? 0) % 50 !== 0) return;
    const scroll = body.scrollTop;
    clear(body);
    this.renderedTab = this.tab;
    switch (this.tab) {
      case 'mode': this.mode?.renderPanel(body); break;
      case 'inspect': this.renderInspectTab(body); break;
      case 'places': this.renderPlaces(body); break;
      case 'stats': this.renderStats(body); break;
      case 'chronicle': this.renderChronicle(body); break;
    }
    if (!force) body.scrollTop = scroll;
  }

  private renderInspectTab(body: HTMLElement) {
    if (!this.snap) return;
    if (!this.selected) {
      body.appendChild(h('div', { class: 'empty' },
        h('p', {}, 'Click any settlement on the map to ask: why here?'),
        h('p', {}, 'Every place remembers the reasons it was founded — fertile land, a ford, a confluence, a harbour, a break in the journey — and what its people live on today.'),
      ));
      const top = this.snap.settlements.filter((s) => !s.abandoned).sort((a, b) => b.pop - a.pop).slice(0, 5);
      if (top.length) {
        body.appendChild(h('div', { class: 'section-title' }, 'Try one of these'));
        body.appendChild(h('div', { class: 'chips' }, top.map((s) => h('button', { class: 'btn small', onclick: () => this.select(s, true) }, s.name))));
      }
      return;
    }
    const extra = this.mode?.inspectorExtra?.(this.selected);
    if (extra) body.appendChild(extra);
    body.appendChild(renderInspector(this.selected, this.snap, {
      onSelect: (id) => this.select(this.snap!.settlements[id], true),
      onZoom: (s) => this.renderer.flyTo(s.x, s.y, Math.max(this.renderer.cam.zoom, 8)),
      onCatchment: (s) => this.highlightCatchment(s),
    }));
  }

  highlightCatchment(s: Settlement) {
    if (!this.snap) return;
    const cells: number[] = [];
    for (let i = 0; i < this.snap.catchment.length; i++) if (this.snap.catchment[i] === s.id) cells.push(i);
    this.renderer.highlightCells = { cells, color: 'rgba(158,42,28,0.28)' };
    this.renderer.invalidate();
  }

  private renderPlaces(body: HTMLElement) {
    if (!this.snap) return;
    const live = this.snap.settlements.filter((s) => !s.abandoned && (s.tier >= 2 || s.market || s.origin !== 'farming'));
    const sorters = {
      pop: (a: Settlement, b: Settlement) => b.pop - a.pop,
      name: (a: Settlement, b: Settlement) => a.name.localeCompare(b.name),
      founded: (a: Settlement, b: Settlement) => a.founded - b.founded,
    };
    live.sort(sorters[this.placesSort]);
    const villages = this.snap.settlements.filter((s) => !s.abandoned).length - live.length;
    body.appendChild(h('p', { class: 'explain' }, `${live.length} towns and cities, plus ${villages} farming villages. Click a row to inspect.`));
    const th = (k: 'pop' | 'name' | 'founded', label: string) => h('th', { onclick: () => { this.placesSort = k; this.refreshPanel(true); } }, label + (this.placesSort === k ? ' ▾' : ''));
    const table = h('table', { class: 'places' },
      h('thead', {}, h('tr', {}, h('th', {}, '#'), th('name', 'Place'), th('pop', 'People'), th('founded', 'Founded'), h('th', {}, 'Lives on'))),
      h('tbody', {}, live.slice(0, 150).map((s, i) => {
        const g = s.growth;
        const main = (Object.keys(GROWTH_META) as (keyof typeof GROWTH_META)[]).filter((k) => k !== 'farming' || s.tier < 2).sort((a, b) => g[b] - g[a])[0];
        return h('tr', { onclick: () => this.select(s, true) },
          h('td', { class: 'num' }, String(i + 1)),
          h('td', {}, (s.capital ? '★ ' : '') + s.name, s.port ? ' ⚓' : ''),
          h('td', { class: 'num' }, fmtPop(s.pop)),
          h('td', { class: 'num' }, String(s.founded)),
          h('td', { style: `font-size:12px;color:${GROWTH_META[main].color}` }, GROWTH_META[main].label),
        );
      })),
    );
    body.appendChild(table);
  }

  private renderStats(body: HTMLElement) {
    const s = this.snap;
    if (!s) return;
    const st = s.stats;
    body.appendChild(h('div', { class: 'stat-grid' },
      h('div', { class: 'stat' }, h('b', {}, fmtPopLong(st.totalPop)), h('span', {}, 'people')),
      h('div', { class: 'stat' }, h('b', {}, `${Math.round((100 * st.urbanPop) / Math.max(1, st.totalPop))}%`), h('span', {}, 'live off non-farm work')),
      h('div', { class: 'stat' }, h('b', {}, `${st.cities} / ${st.towns}`), h('span', {}, 'cities / towns')),
      h('div', { class: 'stat' }, h('b', {}, st.zipfSlope ? st.zipfSlope.toFixed(2) : '—'), h('span', {}, 'rank-size slope (Zipf ≈ −1)')),
    ));
    body.appendChild(rankSizeChart(s, (id) => this.select(s.settlements[id], true)));
    const verdict = !st.zipfSlope ? '' : st.zipfSlope > -0.7 ? 'Flatter than Zipf: many similar-sized towns and no dominant metropolis yet — typical of farming societies before cheap transport.'
      : st.zipfSlope < -1.3 ? 'Steeper than Zipf: one city dominates (a “primate city”), as often happens with a capital or a single great port.'
      : 'Close to Zipf’s law: the 2nd city is about half the 1st, the 3rd about a third… the pattern found in most real countries.';
    body.appendChild(h('p', { class: 'explain' }, verdict));
    body.appendChild(popTimeChart(s, ERAS.map((e) => e.startYear), (id) => this.select(s.settlements[id], true)));
    body.appendChild(h('p', { class: 'explain' }, 'Watch the lines cross when a new era begins: railways and highways reshuffle which places win.'));
  }

  private renderChronicle(body: HTMLElement) {
    const ev = this.snap?.events ?? [];
    body.appendChild(h('p', { class: 'explain' }, 'The history of the land, newest first. Click an entry to visit the place.'));
    body.appendChild(h('ul', { class: 'hist' }, [...ev].reverse().slice(0, 250).map((e) => h('li', {
      class: e.sid !== undefined ? 'clickable' : '',
      onclick: () => { if (e.sid !== undefined && this.snap) this.select(this.snap.settlements[e.sid], true); },
    }, h('span', { class: 'y' }, String(e.year)), e.text))));
  }

  select(s: Settlement | null, fly = false) {
    this.selected = s;
    this.renderer.selected = s?.id ?? -1;
    this.renderer.highlightCells = null;
    if (s && fly) {
      const [sx, sy] = this.renderer.worldToScreen(s.x, s.y);
      if (sx < 80 || sy < 80 || sx > this.renderer.viewW - 400 || sy > this.renderer.viewH - 80) this.renderer.flyTo(s.x, s.y, Math.max(this.renderer.cam.zoom, 5));
    }
    this.renderer.invalidate();
    this.mode?.onSelect?.(s);
    if (s) this.setTab('inspect', true);
    else if (this.tab === 'inspect') this.refreshPanel(true);
  }

  // ------------------------------------------------------------------ input
  private bindInput() {
    const c = this.canvas;
    const pointers = new Map<number, { x: number; y: number }>();
    let dragStart: { x: number; y: number } | null = null;
    let moved = false;
    let pinchDist = 0;
    let brushOps: BrushOp[] = [];
    let riverPts: number[] = [];
    let lastBrushAt = 0;

    const local = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      dragStart = p; moved = false;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      if (this.tool !== 'inspect' && pointers.size === 1 && e.button === 0) {
        const [wx, wy] = this.renderer.screenToWorld(p.x, p.y);
        brushOps = []; riverPts = [wx, wy];
        if (this.tool === 'resource') {
          this.placeResource(wx, wy);
          return;
        }
        this.addBrush(brushOps, wx, wy);
      }
      if (this.tool === 'inspect' || e.button !== 0) c.classList.add('dragging');
    });

    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      const prev = pointers.get(e.pointerId);
      if (this.tool !== 'inspect') {
        const [wx, wy] = this.renderer.screenToWorld(p.x, p.y);
        this.renderer.brushPreview = { x: wx, y: wy, r: this.brushR };
        this.renderer.invalidate();
      }
      if (!prev) {
        // hover
        if (this.tool === 'inspect') {
          const s = this.renderer.pick(p.x, p.y);
          const id = s?.id ?? -1;
          if (id !== this.renderer.hover) { this.renderer.hover = id; this.renderer.invalidate(); }
          c.style.cursor = s ? 'pointer' : '';
        }
        return;
      }
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) this.renderer.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
        pinchDist = d;
        moved = true;
        return;
      }
      if (dragStart && Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > 4) moved = true;
      if (this.tool === 'inspect' || e.buttons === 2 || e.buttons === 4) {
        this.renderer.panBy(p.x - prev.x, p.y - prev.y);
      } else if (this.tool !== 'resource') {
        const [wx, wy] = this.renderer.screenToWorld(p.x, p.y);
        const now = performance.now();
        if (this.tool === 'river') {
          const lx = riverPts[riverPts.length - 2], ly = riverPts[riverPts.length - 1];
          if (Math.hypot(wx - lx, wy - ly) > 0.8) riverPts.push(wx, wy);
        } else if (now - lastBrushAt > 30) {
          this.addBrush(brushOps, wx, wy);
          lastBrushAt = now;
        }
      }
    });

    const end = (e: PointerEvent) => {
      const p = local(e);
      const had = pointers.has(e.pointerId);
      pointers.delete(e.pointerId);
      c.classList.remove('dragging');
      if (pointers.size < 2) pinchDist = 0;
      if (!had) return;
      if (this.tool === 'inspect' && !moved && e.type === 'pointerup') {
        const real = this.renderer.pickRealCity(p.x, p.y);
        const s = this.renderer.pick(p.x, p.y);
        if (real && !s) this.onRealCity?.(real.name);
        else this.select(s);
      } else if (this.tool !== 'inspect' && this.tool !== 'resource') {
        if (this.tool === 'river' && riverPts.length >= 4) brushOps.push({ kind: 'river', pts: riverPts, r: Math.max(1.5, this.brushR / 3) });
        if (brushOps.length) this.commitBrush(brushOps);
        brushOps = []; riverPts = [];
      }
      dragStart = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (this.renderer.brushPreview) { this.renderer.brushPreview = null; this.renderer.invalidate(); } });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
      this.renderer.zoomAt(p.x, p.y, f);
    }, { passive: false });
  }

  private addBrush(ops: BrushOp[], x: number, y: number) {
    const t = this.tool;
    if (t === 'raise' || t === 'lower' || t === 'smooth') ops.push({ kind: t, x, y, r: this.brushR, strength: this.brushStrength });
    else if (t === 'sea' || t === 'drain') ops.push({ kind: t, x, y, r: this.brushR });
    // live feedback: a dotted trail
    const prev = this.renderer.highlightCells?.cells ?? [];
    if (this.world) {
      const W = this.world.W;
      const cells = [...prev];
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) cells.push(Math.floor(y + oy) * W + Math.floor(x + ox));
      this.renderer.highlightCells = { cells, color: t === 'lower' || t === 'sea' ? 'rgba(47,95,127,0.35)' : 'rgba(158,42,28,0.3)' };
      this.renderer.invalidate();
    }
  }

  private async commitBrush(ops: BrushOp[]) {
    const wasPlaying = this.playing;
    this.pause();
    this.setLoading('Rivers finding their way…');
    try {
      const r = await this.client.request({ type: 'edit', ops, keepSim: (this.el.keepSim as HTMLInputElement).checked });
      this.renderer.highlightCells = null;
      this.acceptWorld(r.world!, false);
      this.acceptSnapshot(r.snap!);
    } finally { this.setLoading(null); }
    if (wasPlaying) this.play();
  }

  private async placeResource(x: number, y: number) {
    const r = await this.client.request({ type: 'placeResource', kind: this.resourceKind, x, y });
    if (r.world) this.acceptWorld(r.world, false);
    if (r.snap) this.acceptSnapshot(r.snap);
    this.toast(`A ${this.resourceKind} deposit is discovered. Will anyone come to work it?`);
  }

  // ---------------------------------------------------------------- dialogs
  modal(content: HTMLElement[], onClose?: () => void): () => void {
    const close = () => { bg.remove(); onClose?.(); };
    const bg = h('div', { class: 'modal-bg', onclick: (e: Event) => { if (e.target === bg) close(); } }, h('div', { class: 'modal parchment' }, content));
    this.root.appendChild(bg);
    return close;
  }

  newWorldDialog() {
    const p = { ...this.genParams };
    const seed = h('input', { type: 'text', value: p.seed }) as HTMLInputElement;
    const style = h('select', {}, (['coast', 'continent', 'peninsula', 'archipelago', 'inland'] as WorldStyle[]).map((s) => h('option', { value: s, selected: s === p.style }, s))) as HTMLSelectElement;
    const range = (min: number, max: number, step: number, v: number) => h('input', { type: 'range', min, max, step, value: v }) as HTMLInputElement;
    const land = range(0.3, 0.85, 0.01, p.landFraction);
    const mtn = range(0, 1, 0.05, p.mountains);
    const lat = range(0, 65, 1, p.latitude);
    const latLab = h('span', { style: 'width:40px;text-align:right' }, `${p.latitude}°`);
    lat.addEventListener('input', () => { latLab.textContent = `${lat.value}°`; });
    const close = this.modal([
      h('h2', {}, 'A new world'),
      h('p', {}, 'Every seed makes a different land. The model never places a city — it only shapes the terrain and lets history happen.'),
      h('div', { class: 'row' }, h('label', {}, 'Seed'), seed, h('button', { class: 'btn small', onclick: () => { seed.value = randomSeed(); } }, '🎲')),
      h('div', { class: 'row' }, h('label', {}, 'Shape'), style),
      h('div', { class: 'row' }, h('label', {}, 'Land'), land),
      h('div', { class: 'row' }, h('label', {}, 'Mountains'), mtn),
      h('div', { class: 'row' }, h('label', {}, 'Latitude'), lat, latLab),
      h('p', { class: 'explain' }, 'Latitude sets the climate: the tropics are hot and wet at the equator but dry around 25°; westerly winds bring rain to west-facing coasts in the mid-latitudes and leave a rain shadow behind mountains.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => {
          close();
          this.generate({ ...p, seed: seed.value || randomSeed(), style: style.value as WorldStyle, landFraction: +land.value, mountains: +mtn.value, latitude: +lat.value });
        } }, 'Make the world'),
      ),
    ]);
  }

  showHelp() {
    const close = this.modal([
      h('h2', {}, 'How the model works'),
      h('p', {}, h('b', {}, 'Land. '), 'Noise-built terrain is eroded by thousands of simulated raindrops. Rain falls from the prevailing wind, heaviest on windward slopes. Water flows downhill (D8 flow directions after filling pits) and gathers into rivers.'),
      h('p', {}, h('b', {}, 'Villages. '), 'Farmers settle where there is good land within a day’s walk (the “ten-mile rule”), fresh water, and safety. Full villages send settlers to the best free land nearby.'),
      h('p', {}, h('b', {}, 'Market towns. '), 'When villagers are more than half a day from a market, the most central village becomes one. This produces Christaller’s evenly spaced central places.'),
      h('p', {}, h('b', {}, 'Trade & roads. '), 'Towns trade in proportion to size × size ÷ cost² (a gravity model), along the cheapest routes over land, river and sea. Busy routes become roads, roads make routes cheaper, and traffic piles onto them: path dependence.'),
      h('p', {}, h('b', {}, 'Break of bulk. '), 'Loading and unloading cargo is costly, so the places where goods must switch between boat and cart — river mouths, falls, harbours — grow into ports.'),
      h('p', {}, h('b', {}, 'Eras. '), 'Each era changes the costs of moving and what makes towns grow: markets first, then trade and ports, then railways and industry, then highways.'),
      h('p', { class: 'explain' }, 'Controls: drag to pan, wheel or pinch to zoom, click a town. Space = play/pause. Full model notes and sources are in the README on GitHub.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => close() }, 'Back to the map')),
    ]);
  }
}

export function randomSeed(): string {
  const words = ['amber', 'basalt', 'cinder', 'delta', 'ember', 'fjord', 'granite', 'heron', 'isle', 'juniper', 'kestrel', 'loam', 'marsh', 'north', 'oxbow', 'pine', 'quartz', 'reed', 'shale', 'tidal', 'umber', 'vale', 'willow', 'yarrow'];
  const r = () => words[Math.floor(Math.random() * words.length)];
  return `${r()}-${r()}-${Math.floor(Math.random() * 100)}`;
}

export function describeTier(s: Settlement) { return tierName(s.tier); }
