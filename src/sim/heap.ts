// Binary min-heap over (key, value) with typed arrays and lazy deletion.
// Used by priority-flood (hydrology) and Dijkstra (movement).

export class MinHeap {
  keys: Float64Array;
  vals: Int32Array;
  size = 0;
  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }
  clear() { this.size = 0; }
  push(key: number, val: number) {
    if (this.size >= this.keys.length) {
      const nk = new Float64Array(this.keys.length * 2); nk.set(this.keys); this.keys = nk;
      const nv = new Int32Array(this.vals.length * 2); nv.set(this.vals); this.vals = nv;
    }
    let i = this.size++;
    const keys = this.keys, vals = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p]; vals[i] = vals[p]; i = p;
    }
    keys[i] = key; vals[i] = val;
  }
  /** Returns the value with the smallest key; key available in `lastKey`. */
  lastKey = 0;
  pop(): number {
    const keys = this.keys, vals = this.vals;
    const topV = vals[0];
    this.lastKey = keys[0];
    const n = --this.size;
    if (n > 0) {
      const k = keys[n], v = vals[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= k) break;
        keys[i] = keys[c]; vals[i] = vals[c]; i = c;
      }
      keys[i] = k; vals[i] = v;
    }
    return topV;
  }
}
