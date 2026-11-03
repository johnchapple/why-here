import type { GenParams } from '../sim/terrain';
import type { ResourceKind, TerrainInput, World } from '../sim/grid';
import type { EraId, SimSnapshot } from '../sim/types';

export type BrushOp =
  | { kind: 'raise' | 'lower' | 'smooth' | 'flatten'; x: number; y: number; r: number; strength: number }
  | { kind: 'river'; pts: number[]; r: number }
  | { kind: 'sea' | 'drain'; x: number; y: number; r: number };

export type ToWorker =
  | { type: 'generate'; params: GenParams; reqId: number }
  | { type: 'loadTerrain'; terrain: TerrainInput; seed: number; reqId: number; startEra?: EraId }
  | { type: 'step'; years: number; reqId: number }
  | { type: 'setEra'; era: EraId; auto: boolean }
  | { type: 'edit'; ops: BrushOp[]; reqId: number; keepSim: boolean }
  | { type: 'placeResource'; kind: ResourceKind; x: number; y: number; reqId: number }
  | { type: 'resetSim'; reqId: number }
  | { type: 'runTo'; year: number; reqId: number };

export type FromWorker =
  | { type: 'world'; world: World; reqId: number }
  | { type: 'snapshot'; snap: SimSnapshot; reqId: number; timing?: number }
  | { type: 'error'; message: string; reqId: number };
