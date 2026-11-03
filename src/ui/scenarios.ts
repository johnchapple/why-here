// Guided lessons: each prepares a map that makes one idea easy to see,
// sets a few small goals that the app checks as you play, and ends with
// the real-world story.
import type { App, ModeController } from './app';
import { h, fmtPop } from './dom';
import * as T from '../sim/scenarioTerrain';
import type { TerrainInput, World } from '../sim/grid';
import type { EraId, Settlement, SimSnapshot } from '../sim/types';

interface Goal { text: string; check: (app: App, ctx: Ctx) => boolean }
interface Ctx { baseline?: { year: number; ranks: { id: number; name: string; pop: number; rail: boolean }[] }; done: Set<number> }

interface Scenario {
  id: string;
  title: string;
  tagline: string;
  intro: string[];
  terrain: () => TerrainInput;
  seed: number;
  preRunTo?: number;
  startEra?: EraId;
  overlay?: Parameters<App['setOverlay']>[0];
  goals: Goal[];
  result: (app: App, ctx: Ctx) => (HTMLElement | string)[];
  realWorld: string[];
}

const near = (w: World, s: Settlement, kind: string, r: number) => w.features.some((f) => f.kind === kind && Math.hypot((f.cell % w.W) + 0.5 - s.x, Math.floor(f.cell / w.W) + 0.5 - s.y) <= r);
const isTown = (s: Settlement) => !s.abandoned && (s.tier >= 2 || s.market || s.port);

const SCENARIOS: Scenario[] = [
  {
    id: 'tenmile',
    title: 'A day’s walk',
    tagline: 'Why farming villages are spaced the way they are.',
    intro: [
      'Before engines, every farmer walked to the fields at dawn and home at dusk. The further the field, the more of the day went on walking — so fields far from home were hardly worth working.',
      'In this model each village farms the land within about 8 km: a ten-mile round trip. Watch what spacing that produces.',
    ],
    terrain: T.tenMileTerrain, seed: 11,
    goals: [
      { text: 'Press ▶ and let the villages spread until year 300.', check: (a) => (a.snap?.year ?? 0) >= 300 },
      { text: 'Open the “Village fields” layer.', check: (a) => a.overlay === 'farms' },
      { text: 'Click any farming village and read why it is there.', check: (a) => a.selected?.origin === 'farming' },
    ],
    result: (app) => {
      const w = app.world!, s = app.snap!;
      const v = s.settlements.filter((x) => !x.abandoned && x.origin === 'farming');
      let sum = 0;
      for (const a of v) {
        let best = Infinity;
        for (const b of v) if (a !== b) best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y));
        sum += best;
      }
      const mean = (sum / Math.max(1, v.length)) * w.cellKm;
      return [`${v.length} villages have been founded. On average each sits `, h('b', {}, `${mean.toFixed(1)} km`), ' from its nearest neighbour — close enough that no field is more than a couple of hours’ walk from someone’s door, far enough that each has its own ring of fields.'];
    },
    realWorld: [
      'Geographer Michael Chisholm (Rural Settlement and Land Use, 1962) gathered evidence from Europe, Africa and Asia that the cost of farming rises quickly with distance from home: beyond about a kilometre returns start to fall, and fields more than 3–4 km from the farmstead are rare.',
      'So traditional farming landscapes — the open-field villages of medieval England, the plains of northern France or the Po valley — are dotted with villages a few kilometres apart, each at the heart of its own fields. Our model’s villages are coarser (each stands for a cluster of real hamlets), but the logic is the same.',
    ],
  },
  {
    id: 'fallline',
    title: 'The fall line',
    tagline: 'Cities where rivers tumble off the upland.',
    intro: [
      'Four rivers cross from a hilly upland onto a flat coastal plain. Where they drop off the edge there are rapids: boats coming up from the sea can go no further.',
      'Cargo must be unloaded there and carried on by land — and the falling water can turn mill wheels.',
    ],
    terrain: T.fallLineTerrain, seed: 12, overlay: 'sites',
    goals: [
      { text: 'With “Natural sites” on, find the falls (≋) where each river leaves the upland.', check: (a) => a.overlay === 'sites' },
      { text: 'Run history into the Horse & Sail era (year 700).', check: (a) => (a.snap?.year ?? 0) >= 700 },
      { text: 'Click a town that grew at the falls and read its “Why here?”.', check: (a) => !!a.selected && near(a.world!, a.selected, 'fall', 4) },
    ],
    result: (app) => {
      const w = app.world!;
      const towns = app.snap!.settlements.filter((s) => isTown(s) && near(w, s, 'fall', 4));
      return [`${towns.length} town${towns.length === 1 ? '' : 's'} grew within a few kilometres of the falls: `, h('b', {}, towns.slice(0, 6).map((t) => t.name).join(', ') || '—'), '. Look at their “break of bulk” share: dockers and wagoners moving cargo around the rapids.'];
    },
    realWorld: [
      'In the eastern United States the hard rocks of the Piedmont meet the soft sands of the Atlantic Coastal Plain along a line of rapids and falls. It marked the head of navigation for ships coming upriver, and its falling water powered early mills.',
      'A chain of cities stands on it: Trenton on the Delaware, Philadelphia on the Schuylkill, Baltimore, Georgetown (Washington) on the Potomac, Fredericksburg on the Rappahannock, Richmond on the James, Petersburg on the Appomattox, Columbia on the Congaree, Augusta on the Savannah, Macon on the Ocmulgee and Columbus on the Chattahoochee.',
    ],
  },
  {
    id: 'confluence',
    title: 'Where rivers meet',
    tagline: 'Confluences gather the traffic of two valleys.',
    intro: [
      'Two long valleys join here before running to the sea. Anyone travelling between them, or down to the coast, passes the meeting point.',
    ],
    terrain: T.confluenceTerrain, seed: 13, overlay: 'sites',
    goals: [
      { text: 'Run history to year 800.', check: (a) => (a.snap?.year ?? 0) >= 800 },
      { text: 'Turn on “Trade flows” and watch where the routes converge.', check: (a) => a.overlay === 'trade' },
      { text: 'Click the town nearest the confluence (Y) of the two big rivers.', check: (a) => {
        const w = a.world!;
        const main = [...w.features].filter((f) => f.kind === 'confluence').sort((x, y) => y.strength - x.strength)[0];
        return !!a.selected && !!main && Math.hypot((main.cell % w.W) + 0.5 - a.selected.x, Math.floor(main.cell / w.W) + 0.5 - a.selected.y) < 6;
      } },
    ],
    result: (app) => {
      const s = app.selected;
      return s ? [`${s.name} has ${fmtPop(s.pop)} people. Its trade and through-traffic shares show why: the routes of both valleys meet at its door.`] : ['Look at the trade and through-traffic shares of the confluence town.'];
    },
    realWorld: [
      'Koblenz takes its name from the Latin Confluentes — the meeting of the Rhine and the Moselle. Lyon sits where the Saône joins the Rhône; Pittsburgh where the Allegheny and Monongahela form the Ohio; Khartoum where the Blue and White Nile meet; Wuhan where the Han joins the Yangtze; Belgrade where the Sava meets the Danube.',
      'A confluence is also often a natural strongpoint — the point of land between two rivers is protected on two sides.',
    ],
  },
  {
    id: 'port',
    title: 'Break of bulk',
    tagline: 'Ports grow where cargo changes hands.',
    intro: [
      'A fertile interior drains through a big river to an estuary; further north lies a deep, sheltered bay. Out beyond the sea edge lies the rest of the world, eager to trade once ships can cross the open sea.',
      'Every time goods move between ship, river boat and cart they must be unloaded, stored and reloaded. Those places employ a lot of people.',
    ],
    terrain: T.portTerrain, seed: 14,
    goals: [
      { text: 'Run history past the start of the Horse & Sail era to year 900.', check: (a) => (a.snap?.year ?? 0) >= 900 },
      { text: 'Turn on “Trade flows”: blue lines go by water, red by land.', check: (a) => a.overlay === 'trade' },
      { text: 'Click a port (⚓) and look at its “Break of bulk” share.', check: (a) => !!a.selected?.port },
    ],
    result: (app) => {
      const ports = app.snap!.settlements.filter((s) => s.port && !s.abandoned).sort((a, b) => b.pop - a.pop).slice(0, 4);
      return ['The leading ports: ', h('b', {}, ports.map((p) => `${p.name} (${fmtPop(p.pop)}, ${Math.round((100 * p.growth.transfer) / Math.max(1, p.pop))}% break of bulk)`).join('; ') || '—'), '. Try the Flood brush (◒) to cut a new sheltered harbour and see if trade moves.'];
    },
    realWorld: [
      'Charles Cooley’s “The Theory of Transportation” (1894) argued that cities form wherever there is a break in transportation — where goods must be transferred and stored. Seaports are the classic case.',
      'Rotterdam grew at the mouth of the Rhine–Maas delta, Hamburg up the sheltered Elbe estuary, New Orleans near the mouth of the Mississippi, and Shanghai where the Yangtze reaches the sea. Container ships later cut the cost of each transfer, and the biggest ports moved downstream to deeper water — but the logic remains.',
    ],
  },
  {
    id: 'pass',
    title: 'The mountain pass',
    tagline: 'Mountains funnel trade through a few gaps.',
    intro: [
      'Two basins are divided by a high range. There is one low saddle — a pass — and any trade between the basins must squeeze through it.',
    ],
    terrain: T.passTerrain, seed: 15, overlay: 'sites',
    goals: [
      { text: 'Find the pass (⋀) on the ridge, then run history to year 900.', check: (a) => (a.snap?.year ?? 0) >= 900 },
      { text: 'Turn on the “Roads” layer and follow the road over the mountains.', check: (a) => a.overlay === 'roads' },
      { text: 'Click a settlement on the road near the pass.', check: (a) => !!a.selected && near(a.world!, a.selected, 'pass', 12) },
    ],
    result: () => ['Traffic converges on the pass, so roads, inns and toll-towns line its approaches. Now try the ▼ brush on another part of the ridge to open a second pass — and keep playing to watch the traffic divide.'],
    realWorld: [
      'Innsbruck grew on the road to the Brenner Pass, the lowest route across the main chain of the Alps, with Bolzano on the far side; Chur and Bellinzona guard the approaches to other Alpine passes. In America, the Cumberland Gap funnelled settlers through the Appalachians on the Wilderness Road, and in Asia, Peshawar stands at the eastern end of the Khyber Pass.',
    ],
  },
  {
    id: 'rail',
    title: 'The railway age',
    tagline: 'How rail reshuffled the winners.',
    intro: [
      'This land grew up on rivers and canals: its towns sit at landings, fords and the river mouth. The history has been run for you up to the canal age.',
      'Railways cut the cost of moving goods over land dramatically, and they need neither rivers nor good harbours — only gentle gradients.',
    ],
    terrain: T.railTerrain, seed: 16, preRunTo: 1150,
    goals: [
      { text: 'Note the leading towns in the Charts tab, then press ▶ into the Rail era.', check: (a) => (a.snap?.year ?? 0) >= 1250 },
      { text: 'Keep going to year 1400.', check: (a) => (a.snap?.year ?? 0) >= 1400 },
      { text: 'Open the Charts tab and watch the lines cross.', check: (a) => a.tab === 'stats' },
    ],
    result: (app, ctx) => {
      const base = ctx.baseline;
      if (!base) return [];
      const now = app.snap!.settlements.filter((s) => !s.abandoned).sort((a, b) => b.pop - a.pop);
      const rankNow = new Map(now.map((s, i) => [s.id, i + 1]));
      const moves = base.ranks.slice(0, 10).map((b, i) => ({ name: b.name, from: i + 1, to: rankNow.get(b.id) ?? 99, rail: app.snap!.settlements[b.id].rail }));
      const risers = now.slice(0, 8).filter((s) => !base.ranks.slice(0, 8).some((b) => b.id === s.id));
      return [
        h('div', {}, 'Rank in year ', String(base.year), ' → now:'),
        h('ul', { class: 'hist' }, moves.map((m) => h('li', {}, `${m.name}: ${m.from} → ${m.to}${m.rail ? ' (on the railway)' : ' (bypassed)'}`))),
        risers.length ? h('div', {}, 'New in the top eight: ', h('b', {}, risers.map((r) => r.name).join(', ')), '.') : '',
      ];
    },
    realWorld: [
      'In the 1830s Chicago was a muddy village at a portage; by 1880 it was the rail hub of North America, with about 503,000 people, and had overtaken St. Louis, the great river city (about 350,000). Atlanta began in 1837 as the end of a railway line and was first called simply “Terminus”. In England, Crewe and Swindon grew from almost nothing into railway towns.',
      'Meanwhile many river landings and canal towns that the main lines passed by stopped growing.',
    ],
  },
];

export function scenarioMode(app: App): ModeController {
  let active: Scenario | null = null;
  const ctx: Ctx = { done: new Set() };
  let completedShown = false;

  const start = async (sc: Scenario) => {
    active = sc;
    ctx.done = new Set(); ctx.baseline = undefined; completedShown = false;
    app.editingAllowed = true;
    await app.loadTerrain(sc.terrain(), sc.seed, sc.startEra);
    app.setOverlay(sc.overlay ?? 'none');
    if (sc.preRunTo) {
      app.setLoading(`Running history to year ${sc.preRunTo}…`);
      try { await app.runTo(sc.preRunTo); } finally { app.setLoading(null); }
      const s = app.snap!;
      ctx.baseline = { year: s.year, ranks: s.settlements.filter((x) => !x.abandoned).sort((a, b) => b.pop - a.pop).map((x) => ({ id: x.id, name: x.name, pop: x.pop, rail: x.rail })) };
    }
    app.stopAt = null;
    app.setTab('mode');
  };

  const render = (el: HTMLElement) => {
    if (!active) {
      el.appendChild(h('p', {}, 'Six short lessons. Each prepares a land that makes one idea easy to see, gives you a few small goals, and ends with the real-world story.'));
      el.appendChild(h('div', { class: 'card-list' }, SCENARIOS.map((sc, i) => h('div', { class: 'card', onclick: () => start(sc) },
        h('span', { class: 'tag' }, `Lesson ${i + 1}`), h('h4', {}, sc.title), h('p', {}, sc.tagline)))));
      return;
    }
    const sc = active;
    el.appendChild(h('div', { style: 'display:flex;justify-content:space-between;align-items:center' },
      h('h3', { style: 'margin:0;font-family:var(--sc);font-weight:400;font-size:22px' }, sc.title),
      h('button', { class: 'btn small', onclick: () => { active = null; app.setTab('mode'); } }, '← All lessons'),
    ));
    for (const p of sc.intro) el.appendChild(h('p', {}, p));
    const allDone = sc.goals.every((_, i) => ctx.done.has(i));
    el.appendChild(h('div', { class: 'goal' },
      h('h4', {}, allDone ? 'Lesson complete' : 'Your goals'),
      h('ol', {}, sc.goals.map((g, i) => h('li', { class: ctx.done.has(i) ? 'done' : '' }, g.text))),
    ));
    if (allDone && app.snap && app.world) {
      el.appendChild(h('div', { class: 'section-title' }, 'What happened'));
      el.appendChild(h('div', {}, sc.result(app, ctx)));
      el.appendChild(h('div', { class: 'section-title' }, 'In the real world'));
      for (const p of sc.realWorld) el.appendChild(h('p', {}, p));
      const idx = SCENARIOS.indexOf(sc);
      const next = SCENARIOS[idx + 1];
      if (next) el.appendChild(h('button', { class: 'btn primary', onclick: () => start(next) }, `Next lesson: ${next.title} →`));
      else el.appendChild(h('button', { class: 'btn primary', onclick: () => app.onModeChange?.('earth') }, 'Now try the real world: Earth Mode →'));
    } else {
      el.appendChild(h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
        h('button', { class: 'btn primary', onclick: () => app.play() }, '▶ Play'),
        h('button', { class: 'btn', onclick: () => start(sc) }, '⟲ Restart lesson'),
      ));
    }
  };

  const evaluate = () => {
    if (!active || !app.snap) return;
    let changed = false;
    active.goals.forEach((g, i) => {
      // goals are completed in order
      if (ctx.done.has(i)) return;
      if ([...Array(i).keys()].every((k) => ctx.done.has(k)) && g.check(app, ctx)) { ctx.done.add(i); changed = true; }
    });
    const allDone = active.goals.every((_, i) => ctx.done.has(i));
    if (changed) {
      if (allDone && !completedShown) { completedShown = true; app.toast(`Lesson complete: ${active.title}. See the Lessons tab for the real-world story.`, 5000); app.pause(); app.setTab('mode', true); }
      else if (app.tab === 'mode') app.refreshPanel(true);
    }
  };

  return {
    id: 'scenario',
    title: 'Lessons',
    renderPanel: render,
    onSnapshot: (_s: SimSnapshot) => evaluate(),
    onOverlay: () => evaluate(),
    onSelect: () => setTimeout(evaluate, 0),
    onTab: () => evaluate(),
    leave: () => { active = null; },
  };
}
