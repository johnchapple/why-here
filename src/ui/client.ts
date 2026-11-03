// Promise-based wrapper around the simulation worker.
import type { FromWorker, ToWorker } from '../worker/protocol';
import type { World } from '../sim/grid';
import type { SimSnapshot } from '../sim/types';

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Pending = { resolve: (v: { world?: World; snap?: SimSnapshot; timing?: number }) => void; reject: (e: Error) => void; world?: World; needsSnap: boolean };

export class SimClient {
  private worker: Worker;
  private reqId = 1;
  private pending = new Map<number, Pending>();
  onWorld?: (w: World) => void;
  onSnapshot?: (s: SimSnapshot, timing?: number) => void;
  onError?: (msg: string) => void;

  constructor() {
    this.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      const p = this.pending.get(m.reqId);
      if (m.type === 'error') {
        console.error(m.message);
        this.onError?.(m.message);
        if (p) { this.pending.delete(m.reqId); p.reject(new Error(m.message)); }
        return;
      }
      if (m.type === 'world') {
        this.onWorld?.(m.world);
        if (p) p.world = m.world;
        if (p && !p.needsSnap) { this.pending.delete(m.reqId); p.resolve({ world: m.world }); }
      } else if (m.type === 'snapshot') {
        this.onSnapshot?.(m.snap, m.timing);
        if (p) { this.pending.delete(m.reqId); p.resolve({ world: p.world, snap: m.snap, timing: m.timing }); }
      }
    };
  }

  /** Send a message; resolves when the worker answers with a snapshot. */
  request(msg: DistOmit<ToWorker, 'reqId'>): Promise<{ world?: World; snap?: SimSnapshot; timing?: number }> {
    const id = this.reqId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, needsSnap: true });
      this.worker.postMessage({ ...msg, reqId: id } as ToWorker);
    });
  }

  send(msg: ToWorker) { this.worker.postMessage(msg); }
}
