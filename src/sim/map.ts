import { Rng } from '../core/rng';

export const Tile = { Grass: 0, Rock: 1, Tree: 2, Water: 3 } as const;

/** 隨機地圖：用值雜訊 (value noise) 產生岩石、森林與水塘，中央保留給城堡。 */
export class GameMap {
  readonly tiles: Uint8Array;
  readonly baseX: number; // 城堡左上角格子
  readonly baseY: number;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly seed: number,
  ) {
    this.tiles = new Uint8Array(w * h);
    const rng = new Rng(seed);
    const n1 = valueNoise(rng, w, h, 14);
    const n2 = valueNoise(rng, w, h, 6);
    const forest = valueNoise(rng, w, h, 9);
    const cx = w / 2, cy = h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const n = 0.65 * n1[i] + 0.35 * n2[i];
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        let t: number = Tile.Grass;
        if (d < 8) t = Tile.Grass;
        else if (n > 0.68) t = Tile.Rock;
        else if (n < 0.25) t = Tile.Water;
        else if (forest[i] > 0.62 && rng.next() < 0.55) t = Tile.Tree;
        this.tiles[i] = t;
      }
    }
    this.baseX = Math.floor(cx) - 1;
    this.baseY = Math.floor(cy) - 1;
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
