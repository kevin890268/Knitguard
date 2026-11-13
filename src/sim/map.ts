import { Rng } from '../core/rng';

export const Tile = { Grass: 0, Rock: 1, Tree: 2, Water: 3 } as const;

/** 資源聚落（目前只是外觀，還不能採）：石礦／鐵礦／金礦／煤礦是一團石頭格，果樹是一團樹格 */
export const Res = { None: 0, Stone: 1, Iron: 2, Gold: 3, Coal: 4, Fruit: 5 } as const;
export const RES_NAMES = ['', '石礦', '鐵礦', '金礦', '煤礦', '果樹'];
export const RES_ICONS = ['', '🪨', '⛓️', '🪙', '⚫', '🍎'];
/** 採到的東西（之後採集用）：石礦→石頭、鐵礦→鐵、金礦→金、煤礦→煤、果樹→食物 */
export const RES_YIELD = ['', '石頭', '鐵', '金', '煤', '食物'];
/** 每一格資源的存量 */
export const RES_PER_TILE = [0, 200, 150, 100, 150, 120];

/** 一個資源聚落（相連的同種資源格） */
export interface Deposit {
  id: number;
  kind: number;
  tiles: number[];
  /** 中心（世界座標） */
  x: number;
  y: number;
  /** 剩下的量／一開始的量（之後採集會扣） */
  amount: number;
  max: number;
}

/**
 * 地圖排法：
 *   'south'  遊戲用：市鎮中心在畫面最下方（菱形的下角），敵人從左、上、右（上方兩條邊）來
 *   'center' 圖鑑／展示用：市鎮中心在正中間（舊的排法）
 */
export type MapLayout = 'south' | 'center';

/** 隨機地圖：用值雜訊 (value noise) 產生岩石、森林與水塘，市鎮中心周圍保留空地。 */
export class GameMap {
  readonly tiles: Uint8Array;
  /** 每格的資源種類（Res）；石頭格 Stone/Iron/Gold/Coal、樹格 Fruit */
  readonly res: Uint8Array;
  readonly baseX: number; // 城堡左上角格子
  readonly baseY: number;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly seed: number,
    readonly layout: MapLayout = 'south',
  ) {
    this.tiles = new Uint8Array(w * h);
    this.res = new Uint8Array(w * h);
    const rng = new Rng(seed);
    const n1 = valueNoise(rng, w, h, 14);
    const n2 = valueNoise(rng, w, h, 6);
    const forest = valueNoise(rng, w, h, 9);
    // 市鎮中心：south＝菱形下角往內一點（畫面上的「下」＝x、y 都大）
    const cx = layout === 'south' ? w - 16 : w / 2, cy = layout === 'south' ? h - 16 : h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const n = 0.65 * n1[i] + 0.35 * n2[i];
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        let t: number = Tile.Grass;
        if (d < 9) t = Tile.Grass;
        else if (n > 0.68) t = Tile.Rock;
        else if (n < 0.25) t = Tile.Water;
        else if (forest[i] > 0.62 && rng.next() < 0.55) t = Tile.Tree;
        this.tiles[i] = t;
      }
    }
    this.baseX = Math.floor(cx) - 1;
    this.baseY = Math.floor(cy) - 1;
    if (layout === 'south') {
      this.addDeposits(rng, cx, cy);
      this.ensureEntries(rng, cx, cy);
    }
    this.depositOf = new Int32Array(w * h).fill(-1);
    this.groupDeposits();
  }

  /** 資源聚落：相連（8 方向）的同種資源格算一個聚落 */
  readonly deposits: Deposit[] = [];
  /** 每格屬於哪個聚落（deposits 的索引；−1＝不是資源） */
  depositOf: Int32Array;
  private groupDeposits(): void {
    const { w, h, res } = this;
    for (let i0 = 0; i0 < w * h; i0++) {
      if (!res[i0] || this.depositOf[i0] >= 0) continue;
      const kind = res[i0], id = this.deposits.length, tiles: number[] = [i0];
      this.depositOf[i0] = id;
      for (let q = 0; q < tiles.length; q++) {
        const x = tiles[q] % w, y = (tiles[q] / w) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (res[j] === kind && this.depositOf[j] < 0) { this.depositOf[j] = id; tiles.push(j); }
        }
      }
      let sx = 0, sy = 0;
      for (const t of tiles) { sx += (t % w) + 0.5; sy += ((t / w) | 0) + 0.5; }
      const amount = tiles.length * RES_PER_TILE[kind];
      this.deposits.push({ id, kind, tiles, x: sx / tiles.length, y: sy / tiles.length, amount, max: amount });
    }
  }

  /** 這一格（或畫面上蓋住它的石頭／樹，往下 1 格以內）屬於哪個聚落；沒有就 −1 */
  depositNear(tx: number, ty: number): number {
    for (const [dx, dy] of [[0, 0], [1, 1], [1, 0], [0, 1]]) {
      const x = tx + dx, y = ty + dy;
      if (!this.inBounds(x, y)) continue;
      const d = this.depositOf[y * this.w + x];
      if (d >= 0) return d;
    }
    return -1;
  }

  /**
   * 保證敵人進得來：左、上、右三個入口如果走不到市鎮中心（被石頭／水圍住），
   * 才開一條彎曲的路過去（中間經過一個隨機點，路寬約 3 格）。走得到的就不動，避免地圖上多出直線。
   */
  private ensureEntries(rng: Rng, cx: number, cy: number): void {
    const { w, h } = this;
    const entries: [number, number][] = [
      [1, h * (0.7 + rng.next() * 0.2)], // 左（x＝0 這條邊的下段）
      [w * (0.05 + rng.next() * 0.15), 1], // 上（左上角附近）
      [w * (0.7 + rng.next() * 0.2), 1], // 右（y＝0 這條邊的右段）
    ];
    for (const [ex, ey] of entries) {
      if (this.reachable(cx, cy)[Math.floor(ey) * w + Math.floor(ex)]) continue;
      const mx = (ex + cx) / 2 + (rng.next() - 0.5) * w * 0.3, my = (ey + cy) / 2 + (rng.next() - 0.5) * h * 0.3;
      this.carveLine(ex, ey, mx, my, 1.4, rng);
      this.carveLine(mx, my, cx, cy, 1.4, rng);
    }
  }

  /** 從 (cx, cy) 出發走得到的草地格（4 方向） */
  private reachable(cx: number, cy: number): Uint8Array {
    const { w, h } = this, seen = new Uint8Array(w * h), q: number[] = [];
    const s = Math.floor(cy) * w + Math.floor(cx);
    seen[s] = 1; q.push(s);
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (seen[j] || this.tiles[j] !== Tile.Grass) continue;
        seen[j] = 1; q.push(j);
      }
    }
    return seen;
  }

  private carveLine(x0: number, y0: number, x1: number, y1: number, r: number, rng: Rng): void {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(len * 2);
    const bend = (rng.next() - 0.5) * len * 0.25; // 中間彎一點
    const nx = -(y1 - y0) / (len || 1), ny = (x1 - x0) / (len || 1);
    for (let k = 0; k <= n; k++) {
      const t = k / n, b = Math.sin(t * Math.PI) * bend;
      const px = x0 + (x1 - x0) * t + nx * b, py = y0 + (y1 - y0) * t + ny * b;
      for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h || Math.hypot(x + 0.5 - px, y + 0.5 - py) > r) continue;
        const i = y * this.w + x;
        this.tiles[i] = Tile.Grass;
        this.res[i] = Res.None;
      }
    }
  }

  /**
   * 資源聚落：石礦、鐵礦、金礦、煤礦各幾團（石頭格），果樹幾片（樹格）。
   * 市鎮中心附近一定有一團石礦、一團鐵礦、一片果樹。越貴的越遠、越少。
   */
  private addDeposits(rng: Rng, cx: number, cy: number): void {
    const { w, h } = this;
    const place = (kind: number, n: number, rMin: number, rMax: number, distMin: number, distMax: number) => {
      for (let k = 0, tries = 0; k < n && tries < 400; tries++) {
        const a = rng.next() * Math.PI * 2, dist = distMin + rng.next() * (distMax - distMin);
        const px = cx + Math.cos(a) * dist, py = cy + Math.sin(a) * dist;
        if (px < 4 || py < 4 || px > w - 5 || py > h - 5) continue;
        const r = rMin + rng.next() * (rMax - rMin);
        let painted = 0;
        for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
          if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
          const dd = Math.hypot(x + 0.5 - px, y + 0.5 - py);
          if (dd > r || (dd > r * 0.6 && rng.next() < 0.35)) continue; // 邊緣稀疏一點，不要正圓
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < 9) continue; // 不蓋到市鎮中心空地
          if (this.tiles[y * w + x] === Tile.Water) continue; // 不蓋到水上（不然會有長在水裡的果樹）
          const i = y * w + x;
          this.tiles[i] = kind === Res.Fruit ? Tile.Tree : Tile.Rock;
          this.res[i] = kind;
          painted++;
        }
        if (painted) k++;
      }
    };
    // 起始資源（市鎮中心附近）
    place(Res.Stone, 1, 1.8, 2.4, 12, 16);
    place(Res.Iron, 1, 1.6, 2.2, 13, 18);
    place(Res.Fruit, 1, 2.2, 3, 12, 17);
    // 地圖上其他地方
    const far = Math.max(w, h);
    place(Res.Stone, 7, 1.8, 2.8, 22, far);
    place(Res.Iron, 6, 1.6, 2.5, 25, far);
    place(Res.Coal, 6, 1.6, 2.5, 25, far);
    place(Res.Gold, 4, 1.4, 2.2, 45, far);
    place(Res.Fruit, 8, 2.2, 3.4, 20, far);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  tile(x: number, y: number): number {
    return this.inBounds(x, y) ? this.tiles[y * this.w + x] : Tile.Rock;
  }

  /** 地形本身是否不可通行（不含建築） */
  solidTerrain(x: number, y: number): boolean {
    return this.tile(x, y) !== Tile.Grass;
  }
}

function valueNoise(rng: Rng, w: number, h: number, cell: number): Float32Array {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  const out = new Float32Array(w * h);
  const ss = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    const fy = y / cell, iy = Math.floor(fy), ty = ss(fy - iy);
    for (let x = 0; x < w; x++) {
      const fx = x / cell, ix = Math.floor(fx), tx = ss(fx - ix);
      const a = g[iy * gw + ix], b = g[iy * gw + ix + 1];
      const c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
      out[y * w + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}
