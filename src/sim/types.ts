// Types for the emergence model and the snapshot the worker sends the UI.

export type EraId = 0 | 1 | 2 | 3 | 4;

export type SettlementTier = 0 | 1 | 2 | 3 | 4; // hamlet, village, town, city, metropolis

export type FactorKey =
  | 'farmland' | 'water' | 'river' | 'confluence' | 'mouth' | 'fall' | 'head' | 'ford' | 'pass'
  | 'harbor' | 'defense' | 'centrality' | 'crossroads' | 'breakOfBulk' | 'resource' | 'lake'
  | 'coast' | 'flat' | 'rail' | 'junction';

export interface Factor { key: FactorKey | string; label: string; weight: number }

export type GrowthKey = 'farming' | 'market' | 'trade' | 'transfer' | 'through' | 'industry' | 'resource' | 'admin';

export interface HistoryEvent { year: number; text: string; sid?: number; kind?: string }

export interface Settlement {
  id: number;
  name: string;
  cell: number;
  x: number; // cell coords (centre)
  y: number;
  founded: number; // year
  foundedEra: EraId;
  origin: 'farming' | 'market' | 'port' | 'riverport' | 'crossing' | 'pass' | 'mining' | 'junction';
  pop: number;
  peakPop: number;
  ruralPop: number;
  ruralCap: number;
  tier: SettlementTier;
  market: boolean;
  marketSince: number;
  order: number; // central place order: 0 village, 1 market town, 2 regional centre
  capital: boolean;
  port: boolean;
  rail: boolean;
  servedBy: number; // market settlement id (-1)
  servedPop: number;
  abandoned: boolean;
  foundingFactors: Factor[];
  marketFactors?: Factor[];
  siteFacts: string[];
  growth: Record<GrowthKey, number>; // people attributable to each growth driver
  history: HistoryEvent[];
  resourceId: number; // -1
  popHistory: number[]; // sampled every 50 years
}

export interface FlowLine { pts: number[]; volume: number; water: boolean }

export interface SimSnapshot {
  year: number;
  era: EraId;
  settlements: Settlement[];
  roads: Uint8Array; // 0 none, 1 track, 2 road, 3 highway
  roadEdges: Int32Array; // triples (cellA, cellB, level)
  railEdges: Int32Array; // pairs (cellA, cellB)
  rail: Uint8Array; // 1 if railway
  canal: Uint8Array;
  catchment: Int32Array; // farm owner settlement id per cell (-1)
  marketOf: Int32Array; // market settlement id serving each cell (-1)
  flows: FlowLine[];
  shipping: Float32Array; // traffic on water cells (for display)
  events: HistoryEvent[]; // full log (most recent last)
  stats: { totalPop: number; urbanPop: number; villages: number; towns: number; cities: number; zipfSlope: number; zipfR2: number };
  costField?: Float32Array; // per-cell land movement cost in current era
  access?: Float32Array; // travel cost from the largest city (for overlay)
}
