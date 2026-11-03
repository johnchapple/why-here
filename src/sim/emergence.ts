// The emergence model. Time advances in 10-year steps. Nothing is placed by
// hand: farming villages bud off onto good land within a day's walk,
// market towns appear where unserved villagers need one (central places),
// trade between towns follows a gravity model along least-cost routes,
// traffic builds roads (which make those routes cheaper still), cargo
// changing mode creates ports, and every era re-weights what makes a town
// grow. Every settlement keeps the reasons it was founded and why it grew.
import { DX, DY, World, WATER_OCEAN, clamp, smoothstep } from './grid';
import { ERAS, EraDef, eraForYear, END_YEAR } from './eras';
import { buildCostModel, buildRailConstructionModel, Infra, landCostField, neighborIndex, Pathfinder } from './movement';
import type { CostModel } from './movement';
import { makeRng, Rng } from './rng';
import { NameGen, NameHint } from './names';
import type {
  EraId, Factor, FlowLine, GrowthKey, HistoryEvent, Settlement, SettlementTier, SimSnapshot,
} from './types';

const STEP = 10;
const TIER_POP = [0, 250, 2500, 15000, 100000];
const TIER_NAME = ['hamlet', 'village', 'town', 'city', 'metropolis'];

export function tierOf(pop: number): SettlementTier {
  let t: SettlementTier = 0;
  for (let k = 1; k < TIER_POP.length; k++) if (pop >= TIER_POP[k]) t = k as SettlementTier;
  return t;
}
export function tierName(t: SettlementTier) { return TIER_NAME[t]; }

const FEATURE_LABEL: Record<string, string> = {
  confluence: 'river confluence',
  mouth: 'river mouth',
  fall: 'falls at the head of navigation',
  head: 'head of navigation',
  ford: 'ford (shallow crossing)',
  pass: 'mountain pass',
  lakeshore: 'where a river meets a lake',
};

interface SiteEval { score: number; factors: Factor[]; facts: string[]; hint: NameHint }

export class Sim {
  w: World;
  seed: number;
  rng: Rng;
  names: NameGen;
  year = 0;
  era: EraId = 0;
  autoEra = true;
  steps = 0;
  settlements: Settlement[] = [];
  events: HistoryEvent[] = [];
  owner: Int32Array;
  ownerCost: Float32Array;
  marketOf: Int32Array;
  farmPot: Float32Array; // fertility summed over a day's-walk disk
  siteBase: Float32Array; // static village site score
  traffic: Float32Array;
  edgeTraffic = new Map<number, number>();
  infra: Infra;
  shipping: Float32Array;
  transfer: Float32Array;
  flows: FlowLine[] = [];
  cm!: CostModel;
  pf: Pathfinder;
  catchPf: Pathfinder;
  catchCm!: CostModel;
  cellOwnerS: Int32Array; // settlement located at cell (-1)
  capitalId = -1;
  largestId = -1;
  railBuilt = 0;
  private tradeStats = new Map<number, { through: number; throughput: number; transfer: number; mp: number }>();
  private marketParent: Int32Array | null = null;
  marketDist: Float32Array | null = null;
  private Rcells: number;
  private costDirty = true;
  private overseasSources: number[] = [];

  constructor(w: World, seed: number) {
    this.w = w;
    this.seed = seed;
    this.rng = makeRng(seed, 'sim');
    this.names = new NameGen(makeRng(seed, 'names'));
    const N = w.N;
    this.owner = new Int32Array(N).fill(-1);
    this.ownerCost = new Float32Array(N).fill(Infinity);
    this.marketOf = new Int32Array(N).fill(-1);
    this.traffic = new Float32Array(N);
    this.shipping = new Float32Array(N);
    this.transfer = new Float32Array(N);
    this.cellOwnerS = new Int32Array(N).fill(-1);
    this.infra = { roads: new Uint8Array(N), rail: new Uint8Array(N), railEdge: new Set(), canal: new Uint8Array(N) };
    this.pf = new Pathfinder(w);
    this.catchPf = new Pathfinder(w);
    // ten-mile rule: farmland within ~8 km (a 16 km round trip on foot)
    this.Rcells = Math.max(2, Math.round(8 / w.cellKm));
    this.farmPot = new Float32Array(N);
    this.siteBase = new Float32Array(N);
    this.computeSitePotential();
    this.refreshCosts();
    this.catchCm = buildCostModel(w, ERAS[0], { roads: new Uint8Array(N), rail: new Uint8Array(N), railEdge: new Set(), canal: new Uint8Array(N) });
    this.findOverseas();
    this.log(0, `The land lies empty. ${ERAS[0].name} era begins.`, undefined, 'era');
    this.seedFirstVillages();
    this.updatePopulations();
  }

  /** Re-attach to an edited world while keeping as much history as possible. */
  rebind(w: World) {
    const old = this.settlements;
    const year = this.year, era = this.era, events = this.events, roads = this.infra.roads;
    const fresh = new Sim(w, this.seed);
    Object.assign(this, fresh);
    this.year = year; this.era = era; this.events = events;
    this.infra.roads = roads.length === w.N ? roads : this.infra.roads;
    // keep settlements that are still on dry land
    this.settlements = [];
    this.owner.fill(-1); this.ownerCost.fill(Infinity); this.cellOwnerS.fill(-1);
    for (const s of old) {
      if (w.water[s.cell]) { s.abandoned = true; }
      const ns: Settlement = { ...s, id: this.settlements.length };
      this.settlements.push(ns);
      if (!ns.abandoned) { this.cellOwnerS[ns.cell] = ns.id; this.claim(ns); }
    }
    this.capitalId = this.settlements.findIndex((s) => s.capital);
    this.costDirty = true;
    this.refreshCosts();
    this.updateMarkets(true);
    this.updatePopulations();
  }

  get eraDef(): EraDef { return ERAS[this.era]; }

  setEra(e: EraId, auto: boolean) {
    this.autoEra = auto;
    if (e !== this.era) this.enterEra(e);
  }

  private enterEra(e: EraId) {
    const prev = this.era;
    this.era = e;
    this.costDirty = true;
    this.refreshCosts();
    this.log(this.year, `${e > prev ? 'A new age' : 'Back to an older age'}: the ${ERAS[e].name} era. ${ERAS[e].blurb}`, undefined, 'era');
    this.updateMarkets(true);
    this.updateTrade();
  }

  advance(years: number) {
    const n = Math.max(1, Math.round(years / STEP));
    for (let k = 0; k < n; k++) this.step();
  }

  step() {
    this.year += STEP;
    this.steps++;
    if (this.autoEra) {
      const e = eraForYear(this.year);
      if (e !== this.era && this.year <= END_YEAR + 200) this.enterEra(e);
    }
    this.growRural();
    this.foundVillages();
    if (this.steps % 3 === 0) this.updateMarkets(false);
    if (this.steps % (this.era === 0 ? 8 : 6) === 0) this.updateTrade();
    if (this.era >= 3 && this.steps % 2 === 0) this.buildRail();
    if (this.steps % 3 === 0) this.foundResourceTowns();
    this.updatePopulations();
    if (this.steps % 5 === 0) for (const s of this.settlements) s.popHistory.push(Math.round(s.pop));
  }

  // ----------------------------------------------------------------------
  // Site potential: fertile land within a day's walk, water, defence...
  private computeSitePotential() {
    const { W, H, N, fertility, water } = this.w;
    const R = this.Rcells;
    // disk sum via summed-area table (square approx is fine for ranking)
    const sat = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        row += water[y * W + x] ? 0 : fertility[y * W + x];
        sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row;
      }
    }
    const area = (2 * R + 1) * (2 * R + 1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
      const s = sat[y1 * (W + 1) + x1] - sat[y0 * (W + 1) + x1] - sat[y1 * (W + 1) + x0] + sat[y0 * (W + 1) + x0];
      this.farmPot[y * W + x] = s / area;
    }
    for (let i = 0; i < N; i++) this.siteBase[i] = water[i] ? 0 : this.evalSite(i).score;
  }

  /** Why would people settle on this cell? Returns score and factor breakdown. */
  evalSite(i: number): SiteEval {
    const w = this.w;
    const { W, H } = w;
    const x = i % W, y = (i / W) | 0;
    const factors: Factor[] = [];
    const facts: string[] = [];
    let hint: NameHint = 'plain';
    const farm = this.farmPot[i];
    factors.push({ key: 'farmland', label: 'fertile farmland within a day\'s walk', weight: farm * 1.0 });
    // fresh water access
    let nearRiver = 0, nearLake = 0, nearSea = 0, bigRiver = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (w.river[j]) { nearRiver = 1; bigRiver = Math.max(bigRiver, w.discharge[j]); }
      if (w.water[j] === 2) nearLake = 1;
      if (w.water[j] === WATER_OCEAN) nearSea = 1;
    }
    const fresh = Math.max(nearRiver, nearLake, smoothstep(300, 1200, w.precip[i]) * 0.4);
    if (fresh > 0) factors.push({ key: 'water', label: nearRiver ? 'fresh water from the river' : nearLake ? 'fresh water from the lake' : 'wells and springs', weight: fresh * 0.22 });
    if (bigRiver >= w.qNav) {
      factors.push({ key: 'river', label: 'on a navigable river', weight: 0.12 * Math.min(1, Math.log10(bigRiver / w.qNav + 1) * 1.5 + 0.4) });
      facts.push('navigable river');
    }
    if (nearLake) facts.push('lakeshore');
    if (nearSea) {
      const hq = w.harbor[i];
      factors.push({ key: 'coast', label: hq > 0.5 ? 'a sheltered natural harbour' : 'access to the sea', weight: 0.06 + hq * 0.14 });
      facts.push(hq > 0.5 ? 'natural harbour' : 'coast');
      if (hq > 0.55) hint = 'port';
    }
    const def = w.defense[i];
    if (def > 0.15) {
      factors.push({ key: 'defense', label: def > 0.6 ? 'a defensible height' : 'some natural protection', weight: def * 0.18 });
      if (def > 0.55) { facts.push('defensible site'); if (hint === 'plain') hint = 'fort'; }
    }
    const flat = 1 - smoothstep(0.02, 0.15, w.slope[i]);
    factors.push({ key: 'flat', label: 'level ground to build on', weight: flat * 0.08 });
    // flood risk on very low marshy land
    const marshPenalty = w.marsh[i] * 0.2;
    // special natural sites within ~2 cells
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const fl = w.featureAt.get(yy * W + xx);
      if (!fl) continue;
      const d = Math.hypot(ox, oy);
      for (const f of fl) {
        const wgt = f.strength * (f.kind === 'pass' ? 0.12 : f.kind === 'ford' ? 0.14 : 0.2) * (1 - d / 3.2);
        if (wgt <= 0) continue;
        if (factors.some((g) => g.key === f.kind)) continue;
        factors.push({ key: f.kind, label: FEATURE_LABEL[f.kind] ?? f.kind, weight: wgt });
        facts.push(FEATURE_LABEL[f.kind] ?? f.kind);
        if (f.kind === 'ford') hint = 'ford';
        else if (f.kind === 'confluence') hint = 'confluence';
        else if (f.kind === 'mouth') hint = 'port';
        else if (f.kind === 'fall') hint = 'fall';
        else if (f.kind === 'pass') hint = 'pass';
        else if (f.kind === 'lakeshore') hint = 'lake';
      }
    }
    let score = factors.reduce((a, f) => a + f.weight, 0) - marshPenalty;
    // nobody builds a village on a mountain top or in a swamp
    score *= 1 - smoothstep(1600, 2800, w.elev[i]);
    score *= 1 - smoothstep(0.14, 0.3, w.slope[i]);
    return { score: Math.max(0, score), factors, facts, hint };
  }

  // ----------------------------------------------------------------------
  private refreshCosts() {
    if (!this.costDirty) return;
    this.cm = buildCostModel(this.w, this.eraDef, this.infra);
    this.costDirty = false;
  }

  private findOverseas() {
    const { W, H, water } = this.w;
    const src: number[] = [];
    for (let x = 0; x < W; x += 2) { if (water[x] === WATER_OCEAN) src.push(x); if (water[(H - 1) * W + x] === WATER_OCEAN) src.push((H - 1) * W + x); }
    for (let y = 0; y < H; y += 2) { if (water[y * W] === WATER_OCEAN) src.push(y * W); if (water[y * W + W - 1] === WATER_OCEAN) src.push(y * W + W - 1); }
    this.overseasSources = src;
  }

  private log(year: number, text: string, sid?: number, kind?: string) {
    const ev: HistoryEvent = { year, text, sid, kind };
    this.events.push(ev);
    if (sid !== undefined && this.settlements[sid]) this.settlements[sid].history.push(ev);
  }

  // ----------------------------------------------------------------------
  private newSettlement(cell: number, origin: Settlement['origin'], factors: Factor[], facts: string[], hint: NameHint, extra = ''): Settlement {
    const { W } = this.w;
    const total = factors.reduce((a, f) => a + Math.max(0, f.weight), 0) || 1;
    const norm = factors
      .filter((f) => f.weight > 0)
      .map((f) => ({ ...f, weight: f.weight / total }))
      .sort((a, b) => b.weight - a.weight);
    const s: Settlement = {
      id: this.settlements.length,
      name: this.names.place(hint),
      cell, x: (cell % W) + 0.5, y: Math.floor(cell / W) + 0.5,
      founded: this.year, foundedEra: this.era, origin,
      pop: origin === 'farming' ? 80 : 300, peakPop: 0, ruralPop: origin === 'farming' ? 80 : 40, ruralCap: 0,
      tier: 0, market: false, marketSince: -1, order: 0, capital: false, port: false, rail: false,
      servedBy: -1, servedPop: 0, abandoned: false,
      foundingFactors: norm, siteFacts: facts,
      growth: { farming: 0, market: 0, trade: 0, transfer: 0, through: 0, industry: 0, resource: 0, admin: 0 },
      history: [], resourceId: -1, popHistory: [],
    };
    this.settlements.push(s);
    this.cellOwnerS[cell] = s.id;
    this.claim(s);
    const what = origin === 'farming' ? 'a farming village' : origin === 'port' ? 'a port' : origin === 'riverport' ? 'a river port' :
      origin === 'crossing' ? 'a river-crossing town' : origin === 'pass' ? 'a pass town' : origin === 'mining' ? 'a mining camp' :
      origin === 'junction' ? 'a railway junction' : 'a settlement';
    const top = norm.slice(0, 2).map((f) => f.label).join(' and ');
    this.log(this.year, `${s.name} founded as ${what}${top ? ' — ' + top : ''}${extra}.`, s.id, origin === 'farming' ? 'village' : 'found');
    return s;
  }

  /** Assign farmland within a day's walk (least-cost, on foot) to this settlement. */
  private claim(s: Settlement) {
    const R = this.Rcells * this.w.cellKm * 1.25; // effort-km on foot
    const res = this.catchPf.run(this.catchCm, [{ node: s.cell }], R, { landOnly: true });
    const { W } = this.w;
    const x0 = Math.max(0, Math.floor(s.x) - this.Rcells * 2), x1 = Math.min(W - 1, Math.floor(s.x) + this.Rcells * 2);
    const y0 = Math.max(0, Math.floor(s.y) - this.Rcells * 2), y1 = Math.min(this.w.H - 1, Math.floor(s.y) + this.Rcells * 2);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      const d = res.dist[i];
      if (d < this.ownerCost[i]) { this.ownerCost[i] = d; this.owner[i] = s.id; }
    }
  }

  private seedFirstVillages() {
    // the very first farmers pick the best few sites on the map
    const { N, W } = this.w;
    const cands: number[] = [];
    for (let i = 0; i < N; i++) if (this.siteBase[i] > 0) cands.push(i);
    cands.sort((a, b) => this.siteBase[b] - this.siteBase[a]);
    const picked: number[] = [];
    const target = Math.max(3, Math.round((N / (320 * 224)) * 5));
    for (const c of cands) {
      const cx = c % W, cy = (c / W) | 0;
      if (picked.some((p) => Math.hypot((p % W) - cx, ((p / W) | 0) - cy) < this.Rcells * 10)) continue;
      picked.push(c);
      const e = this.evalSite(c);
      this.newSettlement(c, 'farming', e.factors, e.facts, e.hint, ', among the first farmers on the land');
      if (picked.length >= target) break;
    }
  }

  private growRural() {
    const w = this.w;
    const caps = new Float64Array(this.settlements.length);
    const area = w.cellKm * w.cellKm;
    const dens = this.eraDef.farmDensity;
    for (let i = 0; i < w.N; i++) {
      const o = this.owner[i];
      if (o >= 0) caps[o] += w.fertility[i] * area * dens;
    }
    for (const s of this.settlements) {
      if (s.abandoned) continue;
      s.ruralCap = caps[s.id];
      const r = Math.max(s.ruralPop, 30);
      s.ruralPop = Math.max(0, r + 0.32 * r * (1 - r / Math.max(1, s.ruralCap)));
      if (s.ruralCap < 5 && s.origin === 'farming' && !s.market) {
        s.abandoned = true;
        this.log(this.year, `${s.name} is abandoned: its fields are gone.`, s.id, 'decline');
      }
    }
  }

  private freeSat: Float64Array | null = null;
  private budFail = new Map<number, number>();
  private totSat: Float64Array | null = null;

  /** Summed-area tables of total and unclaimed fertility (refreshed per founding round). */
  private buildAvailability() {
    const { W, H, fertility, water } = this.w;
    const free = this.freeSat ?? new Float64Array((W + 1) * (H + 1));
    const tot = this.totSat ?? new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let rf = 0, rt = 0;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const f = water[i] ? 0 : fertility[i];
        rt += f;
        if (this.owner[i] < 0) rf += f;
        const o = (y + 1) * (W + 1) + x + 1;
        free[o] = free[o - W - 1] + rf;
        tot[o] = tot[o - W - 1] + rt;
      }
    }
    this.freeSat = free; this.totSat = tot;
  }

  private availability(c: number): number {
    // share of fertile land around c that nobody farms yet
    const { W, H } = this.w;
    const R = this.Rcells;
    const x = c % W, y = (c / W) | 0;
    const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
    const box = (s: Float64Array) => s[y1 * (W + 1) + x1] - s[y0 * (W + 1) + x1] - s[y1 * (W + 1) + x0] + s[y0 * (W + 1) + x0];
    const tot = box(this.totSat!);
    return tot > 0 ? box(this.freeSat!) / tot : 0;
  }

  private tooClose(c: number, minDist: number): boolean {
    const { W } = this.w;
    const x = c % W, y = (c / W) | 0;
    const r = Math.ceil(minDist);
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      if (ox * ox + oy * oy > minDist * minDist) continue;
      const xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= this.w.H) continue;
      const s = this.cellOwnerS[yy * W + xx];
      if (s >= 0 && !this.settlements[s].abandoned) return true;
    }
    return false;
  }

  private foundVillages() {
    const { W, H } = this.w;
    const R = this.Rcells;
    const villages = this.settlements.filter((s) => !s.abandoned);
    const maxNew = Math.max(2, Math.round(villages.length * 0.06));
    let made = 0;
    this.buildAvailability();
    // budding: crowded villages send settlers to the best free land nearby
    const order = [...villages].sort((a, b) => b.ruralPop / Math.max(1, b.ruralCap) - a.ruralPop / Math.max(1, a.ruralCap));
    for (const s of order) {
      if (made >= maxNew) break;
      if (s.ruralPop < 0.7 * s.ruralCap) continue;
      if (this.rng() < 0.35) continue;
      const failed = this.budFail.get(s.id);
      if (failed !== undefined && this.year - failed < 60) continue;
      const sx = Math.floor(s.x), sy = Math.floor(s.y);
      let best = -1, bestScore = 0.08;
      const r0 = R * 1.6, r1 = R * 5;
      for (let oy = -r1; oy <= r1; oy += 2) for (let ox = -r1; ox <= r1; ox += 2) {
        const d = Math.hypot(ox, oy);
        if (d < r0 || d > r1) continue;
        const xx = sx + ox, yy = sy + oy;
        if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1) continue;
        const c = yy * W + xx;
        const base = this.siteBase[c];
        if (base <= bestScore) continue;
        const avail = this.availability(c);
        const sc = base * (0.25 + avail) * (1 - 0.15 * (d - r0) / (r1 - r0));
        if (sc > bestScore && avail > 0.3 && !this.tooClose(c, R * 1.5)) { bestScore = sc; best = c; }
      }
      if (best >= 0) {
        const e = this.evalSite(best);
        this.newSettlement(best, 'farming', e.factors, e.facts, e.hint, `, settled from ${s.name}`);
        made++;
        this.buildAvailability();
      } else this.budFail.set(s.id, this.year);
    }
    // pioneers: now and then someone leaps to an empty, excellent site far away
    if (this.steps % 3 === 0 && made < maxNew) {
      let best = -1, bestScore = 0.25;
      for (let k = 0; k < 400; k++) {
        const c = Math.floor(this.rng() * this.w.N);
        const base = this.siteBase[c];
        if (base <= bestScore) continue;
        if (this.owner[c] >= 0) continue;
        const avail = this.availability(c);
        const sc = base * avail;
        if (sc > bestScore && !this.tooClose(c, R * 3)) { bestScore = sc; best = c; }
      }
      if (best >= 0) {
        const e = this.evalSite(best);
        this.newSettlement(best, 'farming', e.factors, e.facts, e.hint, ', by pioneers from afar');
      }
    }
  }

  // ----------------------------------------------------------------------
  // Market towns: central places within half a day of every village.
  updateMarkets(force: boolean) {
    this.refreshCosts();
    const w = this.w;
    const N = w.N;
    const era = this.eraDef;
    const range = era.marketRangeKm;
    const live = this.settlements.filter((s) => !s.abandoned);
    const markets = live.filter((s) => s.market);
    const computeAccess = () => {
      const srcs = markets.map((m) => ({ node: m.cell, label: m.id }));
      if (!srcs.length) return null;
      const res = this.pf.run(this.cm, srcs, range * 2.2);
      this.marketParent = Int32Array.from(res.parent);
      this.marketDist = Float32Array.from(res.dist);
      return res;
    };
    let res = computeAccess();
    const servedCost = (s: Settlement) => (res ? res.dist[s.cell] : Infinity);
    // promote up to 2 new markets
    for (let round = 0; round < 3; round++) {
      const unserved = live.filter((s) => servedCost(s) > range && !s.market);
      const unservedPop = unserved.reduce((a, s) => a + s.ruralPop, 0);
      const minPop = 700;
      if (unservedPop < minPop) break;
      const rangeCells = range / w.cellKm / 1.25;
      let best: Settlement | null = null, bestScore = 0, bestFactors: Factor[] = [];
      for (const c of live) {
        if (c.market) continue;
        let central = 0;
        for (const v of unserved) {
          const d = Math.hypot(v.x - c.x, v.y - c.y);
          if (d <= rangeCells) central += v.ruralPop * (1 - 0.6 * d / rangeCells);
        }
        if (central < minPop * 0.6) continue;
        const cross = this.traffic[c.cell];
        const site = c.foundingFactors.filter((f) => ['confluence', 'ford', 'mouth', 'fall', 'river', 'coast', 'defense', 'head', 'pass'].includes(String(f.key)));
        const siteBonus = this.siteBase[c.cell];
        const crossBonus = Math.min(0.6, Math.log10(1 + cross / 200) * 0.25);
        const score = central * (1 + siteBonus * 0.8 + crossBonus);
        if (score > bestScore) {
          bestScore = score; best = c;
          bestFactors = [
            { key: 'centrality', label: `central to ${Math.round(central).toLocaleString()} villagers with no market nearby`, weight: 1 },
            ...(crossBonus > 0.02 ? [{ key: 'crossroads', label: 'at a crossroads of busy tracks', weight: crossBonus }] : []),
            ...site.map((f) => ({ ...f, weight: f.weight * siteBonus * 0.8 * 3 })),
          ];
        }
      }
      if (!best || bestScore < minPop) break;
      best.market = true; best.marketSince = this.year; best.order = Math.max(best.order, 1);
      const tot = bestFactors.reduce((a, f) => a + f.weight, 0);
      const mf = bestFactors.map((f) => ({ ...f, weight: f.weight / tot })).sort((a, b) => b.weight - a.weight);
      best.marketFactors = mf;
      this.log(this.year, `${best.name} holds its first market — ${mf[0].label}.`, best.id, 'market');
      markets.push(best);
      res = computeAccess();
      if (!force && round >= 1) break;
    }
    // service areas
    this.marketOf.fill(-1);
    if (res) {
      for (let i = 0; i < N; i++) {
        if (w.water[i]) continue;
        const d = res.dist[i];
        if (d <= range * 1.6) this.marketOf[i] = res.label[i];
      }
    }
    for (const s of live) {
      s.servedBy = res && res.dist[s.cell] <= range * 1.8 ? res.label[s.cell] : -1;
      s.servedPop = 0;
    }
    for (const s of live) if (s.servedBy >= 0) this.settlements[s.servedBy].servedPop += s.ruralPop;
    // higher-order centres: the market whose wider hinterland is largest
    const regionalRange = (range * 3) / w.cellKm;
    const sortedM = [...markets].sort((a, b) => b.pop - a.pop);
    const regional: Settlement[] = [];
    for (const m of sortedM) {
      if (regional.some((r) => Math.hypot(r.x - m.x, r.y - m.y) < regionalRange)) { m.order = Math.min(m.order, 1); continue; }
      if (m.pop < 1500) continue;
      regional.push(m);
      if (m.order < 2) {
        m.order = 2;
        this.log(this.year, `${m.name} becomes a regional centre, serving the market towns around it.`, m.id, 'market');
      }
    }
  }

  // ----------------------------------------------------------------------
  // Trade: gravity model between the biggest places, along least-cost routes.
  updateTrade() {
    this.refreshCosts();
    const w = this.w;
    const { N, W } = w;
    const era = this.eraDef;
    const live = this.settlements.filter((s) => !s.abandoned);
    const nodes = live.filter((s) => s.market || s.origin !== 'farming').sort((a, b) => b.pop - a.pop).slice(0, 15);
    const newTraffic = new Float32Array(N);
    const newShip = new Float32Array(N);
    const newTransfer = new Float32Array(N);
    const newEdge = new Map<number, number>();
    const stats = new Map<number, { through: number; throughput: number; transfer: number; mp: number }>();
    for (const s of live) stats.set(s.id, { through: 0, throughput: 0, transfer: 0, mp: 0 });
    const flows: { a: number; b: number; f: number; path: number[] }[] = [];
    const totalPop = live.reduce((a, s) => a + s.pop, 0);
    const c0 = 15;
    const canalCands: { cells: number[]; f: number }[] = [];

    const addPath = (path: number[], f: number, endpoints: number[]) => {
      let prevLand = -1;
      let landRun: number[] = [];
      let sawWater = false;
      for (let k = 0; k < path.length; k++) {
        const n = path[k];
        if (n < N) {
          newTraffic[n] += f;
          if (prevLand >= 0 && k > 0 && path[k - 1] < N) {
            const nk = neighborIndex(W, prevLand, n);
            if (nk >= 0) {
              const key = prevLand < n ? prevLand * 8 + nk : n * 8 + neighborIndex(W, n, prevLand);
              newEdge.set(key, (newEdge.get(key) ?? 0) + f);
            }
          }
          if (k > 0 && path[k - 1] >= N) newTransfer[n] += f; // unloading
          if (k < path.length - 1 && path[k + 1] >= N) newTransfer[n] += f; // loading
          const sid = this.cellOwnerS[n];
          if (sid >= 0 && !endpoints.includes(sid)) stats.get(sid)!.through += f;
          prevLand = n;
          landRun.push(n);
        } else {
          newShip[n - N] += f;
          if (sawWater && landRun.length > 1 && landRun.length < 45 && era.locks) canalCands.push({ cells: landRun, f });
          sawWater = true;
          landRun = [];
          prevLand = -1;
        }
      }
    };

    const dists: Float64Array[] = [];
    const parents: Int32Array[] = [];
    for (let a = 0; a < nodes.length; a++) {
      const res = this.pf.run(this.cm, [{ node: nodes[a].cell }]);
      dists.push(Float64Array.from(res.dist));
      parents.push(Int32Array.from(res.parent));
    }
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const c = dists[a][nodes[b].cell];
        if (!isFinite(c)) continue;
        const f = (nodes[a].pop * nodes[b].pop) / Math.pow(c + c0, 2);
        stats.get(nodes[a].id)!.mp += nodes[b].pop / (c + c0);
        stats.get(nodes[b].id)!.mp += nodes[a].pop / (c + c0);
        flows.push({ a, b, f, path: [] });
      }
    }
    // overseas trade: the wider world beyond the sea edge
    let overseasDist: Float64Array | null = null, overseasParent: Int32Array | null = null;
    if (era.overseas > 0 && this.overseasSources.length) {
      const res = this.pf.run(this.cm, this.overseasSources.map((c) => ({ node: N + c })));
      overseasDist = Float64Array.from(res.dist);
      overseasParent = Int32Array.from(res.parent);
      const P = era.overseas * totalPop * 0.25;
      for (let a = 0; a < nodes.length; a++) {
        const c = overseasDist[nodes[a].cell];
        if (!isFinite(c)) continue;
        const f = (nodes[a].pop * P) / Math.pow(c + c0 + 40, 2);
        stats.get(nodes[a].id)!.mp += P / (c + c0 + 40);
        flows.push({ a, b: -1, f, path: [] });
      }
    }
    // normalise flow units to "people-equivalents" of traffic
    const sumF = flows.reduce((s, f) => s + f.f, 0) || 1;
    const scale = (totalPop * 0.6) / sumF;
    flows.sort((p, q) => q.f - p.f);
    const traced = flows.slice(0, 160);
    for (const fl of traced) {
      fl.f *= scale;
      let path: number[];
      if (fl.b < 0) path = tracePath(overseasParent!, nodes[fl.a].cell).reverse();
      else path = tracePath(parents[fl.a], nodes[fl.b].cell);
      fl.path = path;
      addPath(path, fl.f, [nodes[fl.a].id, fl.b >= 0 ? nodes[fl.b].id : -1]);
      stats.get(nodes[fl.a].id)!.throughput += fl.f;
      if (fl.b >= 0) stats.get(nodes[fl.b].id)!.throughput += fl.f;
    }
    // local traffic: villagers going to market
    if (this.marketParent) {
      for (const s of live) {
        if (s.servedBy < 0 || s.servedBy === s.id) continue;
        const path = tracePath(this.marketParent, s.cell);
        addPath(path, s.ruralPop * 0.35, [s.id, s.servedBy]);
      }
    }
    // smooth over time (roads remember past traffic)
    for (let i = 0; i < N; i++) {
      this.traffic[i] = this.traffic[i] * 0.5 + newTraffic[i] * 0.5;
      this.shipping[i] = this.shipping[i] * 0.5 + newShip[i] * 0.5;
      this.transfer[i] = this.transfer[i] * 0.4 + newTransfer[i] * 0.6;
    }
    for (const [k, v] of this.edgeTraffic) this.edgeTraffic.set(k, v * 0.5);
    for (const [k, v] of newEdge) this.edgeTraffic.set(k, (this.edgeTraffic.get(k) ?? 0) + v * 0.5);
    this.updateRoads();

    // break-of-bulk: credit transfers to the nearest settlement, or found a new one
    const tStats = stats;
    const totalTransfer = this.transfer.reduce((a, v) => a + v, 0) || 1;
    const orphan: { cell: number; v: number }[] = [];
    for (let i = 0; i < N; i++) {
      const v = this.transfer[i];
      if (v <= 0) continue;
      const sid = this.nearestSettlement(i, 2.5);
      if (sid >= 0) tStats.get(sid)!.transfer += v;
      else orphan.push({ cell: i, v });
    }
    orphan.sort((p, q) => q.v - p.v);
    let founded = 0;
    for (const o of orphan) {
      if (founded >= 1) break;
      if (o.v < totalTransfer * 0.05 || o.v < totalPop * 0.004) break;
      if (this.tooClose(o.cell, 3)) continue;
      const coastal = this.isCoastal(o.cell);
      const e = this.evalSite(o.cell);
      const kind = coastal ? 'port' : 'riverport';
      const factors: Factor[] = [
        { key: 'breakOfBulk', label: coastal ? 'cargo moves between ships and the land here (break of bulk)' : 'boats unload here to continue overland (break of bulk)', weight: 1.2 },
        ...e.factors.filter((f) => f.key !== 'farmland' && f.key !== 'flat'),
      ];
      const s = this.newSettlement(o.cell, kind, factors, e.facts, coastal ? 'port' : e.hint === 'plain' ? 'port' : e.hint);
      s.port = true;
      s.pop = Math.max(s.pop, 400);
      founded++;
    }
    // crossing towns: heavy overland traffic crossing a river with nobody there
    for (let i = 0; i < N && founded < 2; i++) {
      if (!w.river[i] || w.discharge[i] < w.qRiver * 6) continue;
      if (this.traffic[i] < totalPop * 0.03) continue;
      if (this.tooClose(i, 3)) continue;
      const e = this.evalSite(i);
      const nearFord = e.factors.some((f) => f.key === 'ford');
      this.newSettlement(i, 'crossing', [{ key: 'crossroads', label: `a busy road crosses the river here${nearFord ? ' at a ford' : ''}`, weight: 1 }, ...e.factors.filter((f) => f.key !== 'farmland')], e.facts, nearFord ? 'ford' : 'bridge');
      founded++;
    }
    // pass towns
    for (const f of w.features) {
      if (f.kind !== 'pass' || founded >= 2) continue;
      if (this.traffic[f.cell] < totalPop * 0.02) continue;
      if (this.tooClose(f.cell, 4)) continue;
      const e = this.evalSite(f.cell);
      this.newSettlement(f.cell, 'pass', [{ key: 'pass', label: 'traders cross the mountains through this pass', weight: 1 }, ...e.factors.filter((g) => g.key !== 'farmland')], e.facts, 'pass');
      founded++;
    }
    // canals: short overland portages between navigable waters on busy routes
    if (era.locks && era.id === 2) {
      canalCands.sort((p, q) => q.f / q.cells.length - p.f / p.cells.length);
      for (const cc of canalCands.slice(0, 1)) {
        let lo = Infinity, hi = -Infinity;
        for (const c of cc.cells) { lo = Math.min(lo, w.elev[c]); hi = Math.max(hi, w.elev[c]); }
        if (hi - lo > 220 || cc.f < totalPop * 0.02) continue;
        if (cc.cells.some((c) => this.infra.canal[c])) continue;
        for (const c of cc.cells) this.infra.canal[c] = 1;
        const a = this.nearestSettlement(cc.cells[0], 4), b = this.nearestSettlement(cc.cells[cc.cells.length - 1], 4);
        const nm = (k: number) => (k >= 0 ? this.settlements[k].name : 'the open country');
        this.log(this.year, `A canal is dug between ${nm(a)} and ${nm(b)}, joining two waterways.`, a >= 0 ? a : undefined, 'infra');
        this.costDirty = true;
      }
    }
    // ports: settlements handling a lot of sea or river transfer
    for (const s of live) {
      const st = tStats.get(s.id)!;
      if (!s.port && st.transfer > totalPop * 0.03) {
        s.port = true;
        this.log(this.year, `${s.name} becomes a ${this.isCoastal(s.cell) ? 'seaport' : 'river port'}: cargo changes between boats and carts here.`, s.id, 'port');
      }
    }
    this.tradeStats = tStats;
    // flows for display
    this.flows = traced.slice(0, 70).map((fl) => {
      let waterN = 0;
      const pts: number[] = [];
      for (const n of fl.path) {
        const c = n >= N ? n - N : n;
        if (n >= N) waterN++;
        pts.push((c % W) + 0.5, Math.floor(c / W) + 0.5);
      }
      return { pts: simplifyPts(pts), volume: fl.f, water: waterN > fl.path.length / 2 };
    });
    this.costDirty = true;
    this.refreshCosts();
  }

  private isCoastal(c: number): boolean {
    const { W, H, water } = this.w;
    const x = c % W, y = (c / W) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (water[ny * W + nx] === WATER_OCEAN) return true;
    }
    return false;
  }

  nearestSettlement(c: number, r: number): number {
    const { W, H } = this.w;
    const x = c % W, y = (c / W) | 0;
    const R = Math.ceil(r);
    let best = -1, bd = Infinity;
    for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
      const xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const s = this.cellOwnerS[yy * W + xx];
      if (s < 0 || this.settlements[s].abandoned) continue;
      const d = Math.hypot(ox, oy);
      if (d <= r && d < bd) { bd = d; best = s; }
    }
    return best;
  }

  private updateRoads() {
    const totalPop = this.settlements.reduce((a, s) => a + (s.abandoned ? 0 : s.pop), 0);
    const t1 = 250, t2 = Math.max(2500, totalPop * 0.004), t3 = Math.max(12000, totalPop * 0.025);
    const roads = this.infra.roads;
    const newLevel = new Uint8Array(this.w.N);
    for (const [k, v] of this.edgeTraffic) {
      const lvl = v >= t3 ? 3 : v >= t2 ? 2 : v >= t1 ? 1 : 0;
      if (!lvl) { if (v < 1) this.edgeTraffic.delete(k); continue; }
      const a = Math.floor(k / 8), nk = k % 8;
      const b = a + DY[nk] * this.w.W + DX[nk];
      newLevel[a] = Math.max(newLevel[a], lvl);
      newLevel[b] = Math.max(newLevel[b], lvl);
    }
    let firstHighway = false;
    for (let i = 0; i < roads.length; i++) {
      // roads persist (as at least a track) once built: path dependence
      const nl = Math.max(newLevel[i], roads[i] > 0 ? Math.max(1, roads[i] - 1) : 0, Math.min(roads[i], newLevel[i] + 1));
      if (nl === 3 && roads[i] < 3) firstHighway = true;
      roads[i] = nl;
    }
    if (firstHighway && !this.events.some((e) => e.kind === 'highway')) this.log(this.year, 'Traffic is so heavy that the first great highway is paved.', undefined, 'highway');
    this.costDirty = true;
  }

  roadEdges(): Int32Array {
    const out: number[] = [];
    const totalPop = this.settlements.reduce((a, s) => a + (s.abandoned ? 0 : s.pop), 0);
    const t1 = 250, t2 = Math.max(2500, totalPop * 0.004), t3 = Math.max(12000, totalPop * 0.025);
    const W = this.w.W;
    for (const [k, v] of this.edgeTraffic) {
      const a = Math.floor(k / 8), nk = k % 8;
      const b = a + DY[nk] * W + DX[nk];
      let lvl = v >= t3 ? 3 : v >= t2 ? 2 : v >= t1 ? 1 : 0;
      if (!lvl && this.infra.roads[a] && this.infra.roads[b] && v > t1 * 0.25) lvl = 1;
      if (lvl) out.push(a, b, lvl);
    }
    return Int32Array.from(out);
  }

  // ----------------------------------------------------------------------
  private buildRail() {
    const w = this.w;
    const live = this.settlements.filter((s) => !s.abandoned && s.pop > 2000).sort((a, b) => b.pop - a.pop).slice(0, 15);
    if (live.length < 2) return;
    // construction cost: railways hate gradients and need bridges
    const railCm = buildRailConstructionModel(w, this.cm, this.infra.rail);
    // candidate pairs by gravity
    const pairs: { a: Settlement; b: Settlement; g: number }[] = [];
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const d = Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y) * w.cellKm;
      pairs.push({ a: live[i], b: live[j], g: (live[i].pop * live[j].pop) / Math.pow(d + 20, 2) });
    }
    pairs.sort((p, q) => q.g - p.g);
    let built = 0;
    let tries = 0;
    for (const p of pairs) {
      if (built >= 2 || tries >= 6) break;
      if (p.a.rail && p.b.rail) {
        // already connected through the network within a reasonable detour?
        const d = Math.hypot(p.a.x - p.b.x, p.a.y - p.b.y);
        const rd = this.railDistance(p.a.cell, p.b.cell, d * 1.6);
        if (rd <= d * 1.6) continue;
      }
      tries++;
      const res = this.pf.run(railCm, [{ node: p.a.cell }], Infinity, { landOnly: true });
      if (!isFinite(res.dist[p.b.cell])) continue;
      const path = this.pf.trace(p.b.cell);
      let added = 0;
      for (let k = 0; k < path.length; k++) {
        const c = path[k];
        if (!this.infra.rail[c]) added++;
        this.infra.rail[c] = 1;
        if (k > 0) {
          const a = path[k - 1];
          const nk = neighborIndex(w.W, a, c);
          const nk2 = neighborIndex(w.W, c, a);
          if (nk >= 0) this.infra.railEdge.add(a * 8 + nk);
          if (nk2 >= 0) this.infra.railEdge.add(c * 8 + nk2);
        }
      }
      if (added < 3) continue;
      built++;
      this.railBuilt++;
      for (const s of this.settlements) {
        if (s.abandoned || s.rail) continue;
        const near = this.infra.rail[s.cell] || this.neighborsHave(s.cell, this.infra.rail);
        if (near) {
          s.rail = true;
          if (s.pop > 800) this.log(this.year, `The railway reaches ${s.name}.`, s.id, 'rail');
        }
      }
      if (this.railBuilt === 1) this.log(this.year, `The first railway opens between ${p.a.name} and ${p.b.name}.`, p.a.id, 'rail');
    }
    if (built) {
      this.costDirty = true;
      this.refreshCosts();
      this.foundJunctions();
    }
  }

  /** Breadth-first distance (in cells) along the rail network, capped. */
  private railDistance(a: number, b: number, cap: number): number {
    const { W, H } = this.w;
    const rail = this.infra.rail;
    const start: number[] = [];
    const near = (c: number, out: number[]) => {
      const x = c % W, y = (c / W) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const xx = x + ox, yy = y + oy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && rail[yy * W + xx]) out.push(yy * W + xx);
      }
    };
    near(a, start);
    const goal = new Set<number>();
    const g: number[] = []; near(b, g); for (const c of g) goal.add(c);
    if (!start.length || !goal.size) return Infinity;
    const dist = new Map<number, number>();
    let frontier = start;
    for (const c of start) dist.set(c, 0);
    let d = 0;
    while (frontier.length && d <= cap) {
      const next: number[] = [];
      for (const c of frontier) {
        if (goal.has(c)) return d;
        const x = c % W, y = (c / W) | 0;
        for (let k = 0; k < 8; k++) {
          const xx = x + DX[k], yy = y + DY[k];
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const n = yy * W + xx;
          if (rail[n] && !dist.has(n)) { dist.set(n, d + 1); next.push(n); }
        }
      }
      frontier = next; d++;
    }
    return Infinity;
  }

  private foundJunctions() {
    const { W, H } = this.w;
    const rail = this.infra.rail;
    for (let i = 0; i < this.w.N; i++) {
      if (!rail[i]) continue;
      const x = i % W, y = (i / W) | 0;
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
      // count distinct rail directions leaving a 2-cell ring
      let dirs = 0;
      const ring: number[] = [];
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if (Math.max(Math.abs(ox), Math.abs(oy)) === 2) ring.push((y + oy) * W + x + ox);
      let prev = rail[ring[ring.length - 1]];
      for (const r of ring) { if (rail[r] && !prev) dirs++; prev = rail[r]; }
      if (dirs < 3) continue;
      if (this.tooClose(i, 6)) continue;
      const e = this.evalSite(i);
      const s = this.newSettlement(i, 'junction', [{ key: 'junction', label: 'railway lines meet here', weight: 1 }, ...e.factors.filter((f) => f.key !== 'farmland')], e.facts, 'junction');
      s.rail = true;
      s.pop = 600;
      return;
    }
  }

  private neighborsHave(c: number, arr: Uint8Array): boolean {
    const { W, H } = this.w;
    const x = c % W, y = (c / W) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (arr[ny * W + nx]) return true;
    }
    return false;
  }

  // ----------------------------------------------------------------------
  private foundResourceTowns() {
    const w = this.w;
    const era = this.eraDef;
    for (const r of w.resources) {
      const demand = era.resourceDemand[r.kind] ?? 0;
      const value = r.richness * demand;
      if (value < 0.45) continue;
      const near = this.nearestSettlement(r.cell, 3);
      if (near >= 0) {
        const s = this.settlements[near];
        if (s.resourceId < 0) {
          s.resourceId = r.id;
          s.siteFacts.push(`${r.kind} deposits`);
          this.log(this.year, `${capital(r.kind)} is worked at ${s.name}.`, s.id, 'resource');
        }
        continue;
      }
      // needs a market within reach to sell to
      const mkt = this.settlements.some((s) => s.market && !s.abandoned && Math.hypot(s.x - (r.cell % w.W), s.y - Math.floor(r.cell / w.W)) * w.cellKm < 70 + era.id * 25);
      if (!mkt) continue;
      let cell = r.cell;
      if (w.water[cell]) continue;
      const e = this.evalSite(cell);
      const label = r.kind === 'gold' ? 'a gold strike' : r.kind === 'coal' ? 'a coal seam' : r.kind === 'ore' ? 'rich ore deposits' : r.kind === 'salt' ? 'salt springs and pans' : r.kind === 'timber' ? 'great stands of timber' : 'good building stone';
      const s = this.newSettlement(cell, 'mining', [{ key: 'resource', label, weight: 1 }, ...e.factors.filter((f) => f.key !== 'farmland').map((f) => ({ ...f, weight: f.weight * 0.6 }))], [...e.facts, `${r.kind} deposits`], r.kind === 'timber' ? 'plain' : 'mine', r.kind === 'gold' ? ' — a rush begins' : '');
      s.resourceId = r.id;
      s.pop = r.kind === 'gold' ? 1500 : 500;
      cell = 0;
      void cell;
      return; // one per step
    }
  }

  // ----------------------------------------------------------------------
  updatePopulations() {
    const era = this.eraDef;
    const live = this.settlements.filter((s) => !s.abandoned);
    if (!live.length) return;
    const totalRural = live.reduce((a, s) => a + s.ruralPop, 0);
    const U = (era.urbanShare / (1 - era.urbanShare)) * totalRural;
    const comps: Record<Exclude<GrowthKey, 'farming'>, Float64Array> = {
      market: new Float64Array(this.settlements.length),
      trade: new Float64Array(this.settlements.length),
      transfer: new Float64Array(this.settlements.length),
      through: new Float64Array(this.settlements.length),
      industry: new Float64Array(this.settlements.length),
      resource: new Float64Array(this.settlements.length),
      admin: new Float64Array(this.settlements.length),
    };
    // capital: chosen once a real city exists; it then attracts government
    if (this.capitalId < 0 && this.year >= 300) {
      const cand = [...live].sort((a, b) => b.pop * (1 + (this.tradeStats.get(b.id)?.mp ?? 0) * 1e-5) - a.pop * (1 + (this.tradeStats.get(a.id)?.mp ?? 0) * 1e-5))[0];
      if (cand && cand.pop > 3000) {
        cand.capital = true;
        this.capitalId = cand.id;
        this.log(this.year, `${cand.name}, the greatest town of the land, becomes the seat of government.`, cand.id, 'capital');
      }
    }
    for (const s of live) {
      const st = this.tradeStats.get(s.id);
      if (s.market) comps.market[s.id] = Math.pow(s.servedPop, era.id >= 3 ? 1.15 : 1.0) * (s.order >= 2 ? 1.5 : 1);
      if (st) {
        comps.trade[s.id] = st.throughput;
        comps.transfer[s.id] = st.transfer;
        comps.through[s.id] = st.through;
        if (era.weights.industry > 0) comps.industry[s.id] = st.mp * Math.pow(Math.max(1, s.pop), 0.35) * (s.rail || era.id < 3 ? 1 : 0.35);
      }
      if (s.resourceId >= 0) {
        const r = this.w.resources.find((q) => q.id === s.resourceId);
        if (r) comps.resource[s.id] = r.richness * (era.resourceDemand[r.kind] ?? 0) * (s.rail || era.id < 3 ? 1 : 0.5);
      }
      if (s.capital) comps.admin[s.id] = 1;
      else if (s.order >= 2) comps.admin[s.id] = 0.08;
    }
    const sums: Record<string, number> = {};
    for (const k of Object.keys(comps)) sums[k] = (comps as Record<string, Float64Array>)[k].reduce((a, v) => a + v, 0);
    const A = new Float64Array(this.settlements.length);
    const gamma = [1.3, 1.25, 1.2, 1.1, 1.04][era.id];
    let sumAg = 0;
    for (const s of live) {
      let a = 0;
      for (const k of Object.keys(comps) as (keyof typeof comps)[]) {
        if (sums[k] > 0) a += era.weights[k] * comps[k][s.id] / sums[k];
      }
      A[s.id] = a;
      sumAg += Math.pow(a, gamma);
    }
    for (const s of live) {
      const a = A[s.id];
      const urban = sumAg > 0 ? (U * Math.pow(a, gamma)) / sumAg : 0;
      const target = s.ruralPop + urban;
      const rate = target > s.pop ? 0.22 : 0.09;
      s.pop = Math.max(20, s.pop + (target - s.pop) * rate);
      // growth breakdown (people attributable to each driver)
      s.growth.farming = s.ruralPop;
      for (const k of Object.keys(comps) as (keyof typeof comps)[]) {
        s.growth[k] = a > 0 && sums[k] > 0 ? urban * (era.weights[k] * comps[k][s.id] / sums[k]) / a : 0;
      }
      const newTier = tierOf(s.pop);
      if (newTier > s.tier && s.pop > s.peakPop) {
        if (newTier >= 3 || (newTier === 2 && (s.market || s.origin !== 'farming'))) this.log(this.year, `${s.name} grows into a ${TIER_NAME[newTier]} of ${roundPop(s.pop)}.`, s.id, 'grow');
        s.tier = newTier;
      } else if (newTier < s.tier && s.pop < TIER_POP[s.tier] * 0.85) {
        s.tier = newTier;
      }
      if (s.peakPop >= 4000 && s.pop < s.peakPop * 0.6 && !s.history.some((h) => h.kind === 'decline' && h.year > this.year - 150)) {
        this.log(this.year, `${s.name} is in decline: down to ${roundPop(s.pop)} from a peak of ${roundPop(s.peakPop)}.`, s.id, 'decline');
      }
      s.peakPop = Math.max(s.peakPop, s.pop);
    }
    const largest = live.reduce((m, s) => (s.pop > m.pop ? s : m), live[0]);
    if (largest.id !== this.largestId && largest.pop > 5000) {
      if (this.largestId >= 0) this.log(this.year, `${largest.name} overtakes ${this.settlements[this.largestId].name} as the largest place in the land.`, largest.id, 'rank');
      this.largestId = largest.id;
    }
  }

  // ----------------------------------------------------------------------
  snapshot(): SimSnapshot {
    const live = this.settlements.filter((s) => !s.abandoned);
    const pops = live.map((s) => s.pop).sort((a, b) => b - a);
    const { slope, r2 } = zipfFit(pops.slice(0, Math.min(40, pops.length)));
    const totalPop = live.reduce((a, s) => a + s.pop, 0);
    const rural = live.reduce((a, s) => a + s.ruralPop, 0);
    const railEdges: number[] = [];
    for (const k of this.infra.railEdge) {
      const a = Math.floor(k / 8), nk = k % 8;
      const b = a + DY[nk] * this.w.W + DX[nk];
      if (a < b) railEdges.push(a, b);
    }
    return {
      year: this.year,
      era: this.era,
      settlements: this.settlements.map((s) => ({ ...s, growth: { ...s.growth }, history: s.history.slice(-30), popHistory: s.popHistory.slice() })),
      roads: Uint8Array.from(this.infra.roads),
      roadEdges: this.roadEdges(),
      railEdges: Int32Array.from(railEdges),
      rail: Uint8Array.from(this.infra.rail),
      canal: Uint8Array.from(this.infra.canal),
      catchment: Int32Array.from(this.owner),
      marketOf: Int32Array.from(this.marketOf),
      flows: this.flows,
      shipping: Float32Array.from(this.shipping),
      events: this.events.filter((e) => e.kind !== 'village').slice(-400),
      stats: {
        totalPop, urbanPop: totalPop - rural,
        villages: live.filter((s) => s.tier <= 1).length,
        towns: live.filter((s) => s.tier === 2).length,
        cities: live.filter((s) => s.tier >= 3).length,
        zipfSlope: slope, zipfR2: r2,
      },
      costField: landCostField(this.w, this.cm),
    };
  }
}

function tracePath(parent: Int32Array, target: number): number[] {
  const out: number[] = [];
  let n = target, guard = 0;
  while (n >= 0 && guard++ < parent.length) { out.push(n); n = parent[n]; }
  return out.reverse();
}

function simplifyPts(pts: number[]): number[] {
  // drop collinear points
  if (pts.length <= 4) return pts;
  const out = [pts[0], pts[1]];
  for (let k = 2; k < pts.length - 2; k += 2) {
    const ax = pts[k] - out[out.length - 2], ay = pts[k + 1] - out[out.length - 1];
    const bx = pts[k + 2] - pts[k], by = pts[k + 3] - pts[k + 1];
    if (Math.abs(ax * by - ay * bx) > 1e-6) out.push(pts[k], pts[k + 1]);
  }
  out.push(pts[pts.length - 2], pts[pts.length - 1]);
  return out;
}

/** Fit log(pop) = a + slope * log(rank). Zipf's law predicts slope ~ -1. */
export function zipfFit(popsDesc: number[]): { slope: number; r2: number } {
  const n = popsDesc.length;
  if (n < 3) return { slope: 0, r2: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.log(i + 1), y = Math.log(Math.max(1, popsDesc[i]));
    sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const r = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return { slope, r2: r * r };
}

function roundPop(p: number): string {
  if (p >= 1e6) return (p / 1e6).toFixed(1) + ' million';
  if (p >= 1e4) return Math.round(p / 1000) + ',000';
  return (Math.round(p / 100) * 100).toLocaleString('en-US');
}

function capital(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

export { clamp };
