import type { Units } from './units';

/**
 * 均勻網格空間雜湊（計數排序版，零配置）。
 * 每 tick 重建一次；查詢只看附近格子 → 碰撞與索敵都是 O(n)。
 */
export class SpatialHash {
  readonly cols: number;
  readonly rows: number;
  readonly cellStart: Int32Array; // 長度 cells+1，cell c 的項目在 items[cellStart[c]..cellStart[c+1])
  readonly items: Int32Array;
  readonly cellOf: Int32Array;
  private cursor: Int32Array;

  constructor(worldW: number, worldH: number, readonly cell: number, cap: number) {
    this.cols = Math.ceil(worldW / cell);
    this.rows = Math.ceil(worldH / cell);
    const n = this.cols * this.rows;
    this.cellStart = new Int32Array(n + 1);
    this.cursor = new Int32Array(n);
    this.items = new Int32Array(cap);
    this.cellOf = new Int32Array(cap);
  }

  cellIndex(x: number, y: number): number {
    let cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  build(u: Units): void {
    const cs = this.cellStart, n = this.cols * this.rows;
    cs.fill(0);
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i]) continue;
      const c = this.cellIndex(u.x[i], u.y[i]);
      this.cellOf[i] = c;
      cs[c + 1]++;
    }
    for (let c = 0; c < n; c++) cs[c + 1] += cs[c];
    this.cursor.set(cs.subarray(0, n));
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i]) continue;
      this.items[this.cursor[this.cellOf[i]]++] = i;
    }
  }

  /** 收集 (x,y) 半徑 r 範圍內「可能」的單位索引到 out，回傳數量（呼叫端自行精確判斷距離）。 */
  queryInto(x: number, y: number, r: number, out: Int32Array): number {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c)), x1 = Math.min(this.cols - 1, Math.floor((x + r) / c));
    const y0 = Math.max(0, Math.floor((y - r) / c)), y1 = Math.min(this.rows - 1, Math.floor((y + r) / c));
    let n = 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = cy * this.cols + cx;
        for (let p = this.cellStart[cell], e = this.cellStart[cell + 1]; p < e; p++) {
          if (n >= out.length) return n;
          out[n++] = this.items[p];
        }
      }
    }
    return n;
  }
}
