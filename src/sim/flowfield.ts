/**
 * 流場尋路 (flow field)：從城堡往外跑一次 Dijkstra，
 * 每一格記錄「往城堡該走的方向」。所有敵人共用 → 一萬隻怪也只算一次。
 * 建築格的成本較高：繞路太遠時，怪物會選擇直接拆牆（They Are Billions 式）。
 */
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const SQRT2 = Math.SQRT2;

export class FlowField {
  readonly dist: Float32Array;
  readonly dirX: Float32Array;
  readonly dirY: Float32Array;
  version = 0;

  constructor(readonly w: number, readonly h: number) {
    this.dist = new Float32Array(w * h);
    this.dirX = new Float32Array(w * h);
    this.dirY = new Float32Array(w * h);
  }

  /** costs：進入該格的成本，Infinity = 不可通行；cost > 1 的格子不允許斜切角。 */
  compute(costs: Float32Array, goals: number[]): void {
    const { w, h, dist } = this;
    dist.fill(Infinity);
    const heap = new MinHeap();
    for (const g of goals) {
      dist[g] = 0;
      heap.push(g, 0);
    }
    const diagOk = (x: number, y: number, dx: number, dy: number) =>
      costs[y * w + x + dx] === 1 && costs[(y + dy) * w + x] === 1;

    while (heap.size > 0) {
      const d = heap.peekKey();
      const i = heap.pop();
      if (d > dist[i]) continue;
      const x = i % w, y = (i / w) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        const c = costs[n];
        if (c === Infinity) continue;
        const diag = k >= 4;
        if (diag && !diagOk(x, y, DX[k], DY[k])) continue;
        // 先轉成 float32：dist 是 Float32Array，不轉的話存進去會被捨入得比 heap 裡的 key 小，
        // 取出時 d > dist[i] 被誤判成過期而跳過 → 大片地圖算不到（敵人「卡住」的元凶之一）
        const nd = Math.fround(d + (diag ? c * SQRT2 : c));
        if (nd < dist[n]) {
          dist[n] = nd;
          heap.push(n, nd);
        }
      }
    }

    // 每格方向 = 指向距離最小的鄰居
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        this.dirX[i] = 0;
        this.dirY[i] = 0;
        if (!(dist[i] > 0 && dist[i] < Infinity)) continue;
        let best = dist[i], bx = 0, by = 0;
        for (let k = 0; k < 8; k++) {
          const nx = x + DX[k], ny = y + DY[k];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (k >= 4 && !diagOk(x, y, DX[k], DY[k])) continue;
          const nd = dist[ny * w + nx];
          if (nd < best) {
            best = nd;
            bx = DX[k];
            by = DY[k];
          }
        }
        const len = Math.hypot(bx, by) || 1;
        this.dirX[i] = bx / len;
        this.dirY[i] = by / len;
      }
    }
    this.version++;
  }
}

class MinHeap {
  private idx: number[] = [];
  private key: number[] = [];
  get size(): number {
    return this.idx.length;
  }
  peekKey(): number {
    return this.key[0];
  }
  push(i: number, k: number): void {
    const a = this.idx, b = this.key;
    let n = a.length;
    a.push(i);
    b.push(k);
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (b[p] <= k) break;
      a[n] = a[p]; b[n] = b[p];
      n = p;
    }
    a[n] = i; b[n] = k;
  }
  pop(): number {
    const a = this.idx, b = this.key;
    const top = a[0];
    const li = a.pop()!, lk = b.pop()!;
    const len = a.length;
    if (len > 0) {
      let n = 0;
      for (;;) {
        let c = 2 * n + 1;
        if (c >= len) break;
        if (c + 1 < len && b[c + 1] < b[c]) c++;
        if (b[c] >= lk) break;
        a[n] = a[c]; b[n] = b[c];
        n = c;
      }
      a[n] = li; b[n] = lk;
    }
    return top;
  }
}
