/// <reference lib="webworker" />
// The simulation runs here so the UI thread only renders.
import { generateTerrain } from '../sim/terrain';
import { buildWorld } from '../sim/world';
import { applyBrush } from '../sim/brush';
import type { TerrainInput, World } from '../sim/grid';
import { Sim } from '../sim/emergence';
import { hashString } from '../sim/rng';
import type { FromWorker, ToWorker } from './protocol';

let terrain: TerrainInput | null = null;
let world: World | null = null;
let sim: Sim | null = null;
let seedNum = 1;

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

function sendWorld(reqId: number) {
  post({ type: 'world', world: world!, reqId });
}
function sendSnap(reqId: number, timing?: number) {
  if (!sim) return;
  post({ type: 'snapshot', snap: sim.snapshot(), reqId, timing });
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case 'generate': {
        seedNum = hashString(m.params.seed);
        terrain = generateTerrain(m.params);
        world = buildWorld(terrain, seedNum);
        sim = new Sim(world, seedNum);
        sendWorld(m.reqId);
        sendSnap(m.reqId);
        break;
      }
      case 'loadTerrain': {
        seedNum = m.seed;
        terrain = m.terrain;
        world = buildWorld(terrain, seedNum, !!terrain.resources);
        sim = new Sim(world, seedNum);
        if (m.startEra !== undefined) sim.setEra(m.startEra, true);
        sendWorld(m.reqId);
        sendSnap(m.reqId);
        break;
      }
      case 'step': {
        if (!sim) return;
        const t0 = performance.now();
        sim.advance(m.years);
        sendSnap(m.reqId, performance.now() - t0);
        break;
      }
      case 'runTo': {
        if (!sim) return;
        const t0 = performance.now();
        while (sim.year < m.year) sim.advance(10);
        sendSnap(m.reqId, performance.now() - t0);
        break;
      }
      case 'setEra': {
        sim?.setEra(m.era, m.auto);
        break;
      }
      case 'resetSim': {
        if (!world) return;
        sim = new Sim(world, seedNum);
        sendSnap(m.reqId);
        break;
      }
      case 'edit': {
        if (!terrain || !world) return;
        for (const op of m.ops) applyBrush(terrain, world, op);
        terrain.resources = world.resources;
        world = buildWorld(terrain, seedNum, true);
        if (sim && m.keepSim) sim.rebind(world);
        else sim = new Sim(world, seedNum);
        sendWorld(m.reqId);
        sendSnap(m.reqId);
        break;
      }
      case 'placeResource': {
        if (!terrain || !world) return;
        const cell = Math.floor(m.y) * world.W + Math.floor(m.x);
        if (world.water[cell]) return;
        const id = world.resources.reduce((a, r) => Math.max(a, r.id), -1) + 1;
        world.resources.push({ id, kind: m.kind, cell, richness: 0.85, placedByPlayer: true });
        terrain.resources = world.resources;
        sim?.rebind(world);
        sendWorld(m.reqId);
        sendSnap(m.reqId);
        break;
      }
    }
  } catch (e) {
    post({ type: 'error', message: String((e as Error)?.stack ?? e), reqId: (m as { reqId?: number }).reqId ?? -1 });
  }
};
