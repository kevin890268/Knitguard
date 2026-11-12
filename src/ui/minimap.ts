import { BK, Team } from '../sim/data';
import { Tile } from '../sim/map';
import type { World } from '../sim/world';
import type { ArmyControl } from './army';

const TILE_RGB: Record<number, [number, number, number]> = {
  [Tile.Grass]: [168, 207, 134],
  [Tile.Rock]: [150, 142, 130],
  [Tile.Tree]: [96, 150, 82],
  [Tile.Water]: [118, 178, 214],
};

interface MinimapView {
  readonly canvas: HTMLCanvasElement;
  readonly cam: {
    pick(cx: number, cy: number): { x: number; z: number } | null;
    readonly target: { set(x: number, y: number, z: number): unknown };
  };
}

/**
 * 小地圖（右下角）。和畫面一樣是 45 度斜角的菱形，方向一致。
 * 左鍵點／拖曳：鏡頭跳過去；右鍵：選到的部隊移動過去（Shift 排路線）。
 */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement | null = null;
  private terrainWorld: World | null = null;
  private dragging = false;
  /** 世界一格在小地圖上的寬度 */
  private k = 1;

  constructor(
    private readonly el: HTMLCanvasElement,
    private readonly getWorld: () => World,
    private readonly view: MinimapView,
    private readonly army: ArmyControl,
  ) {
    this.ctx = el.getContext('2d')!;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      const [x, y] = this.toWorld(e);
      if (e.button === 2) {
        if (this.army.sel.length) this.army.command('move', x, y, e.shiftKey);
        return;
      }
      if (e.button !== 0) return;
      this.dragging = true;
      el.setPointerCapture(e.pointerId);
      this.view.cam.target.set(x, 0, y);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const [x, y] = this.toWorld(e);
      this.view.cam.target.set(x, 0, y);
    });
    el.addEventListener('pointerup', () => { this.dragging = false; });
  }

  /** 小地圖上的點 → 世界座標（夾在地圖內） */
  private toWorld(e: PointerEvent): [number, number] {
    const r = this.el.getBoundingClientRect(), w = this.getWorld().map;
    const X = ((e.clientX - r.left) / r.width) * this.el.width, Y = ((e.clientY - r.top) / r.height) * this.el.height;
    const a = (X - this.el.width / 2) / this.k, b = (2 * Y) / this.k; // a = x − y, b = x + y
    const clamp = (v: number, m: number) => Math.min(m - 0.5, Math.max(0.5, v));
    return [clamp((a + b) / 2, w.w), clamp((b - a) / 2, w.h)];
  }

  /** 地形先畫成一張 1 格 1 像素的圖 */
  private bakeTerrain(world: World): void {
    const { w, h, tiles } = world.map;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!, img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const [r, gg, b] = TILE_RGB[tiles[i]];
      img.data.set([r, gg, b, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
    this.terrain = c;
    this.terrainWorld = world;
  }

  render(): void {
    const world = this.getWorld(), map = world.map, g = this.ctx;
    if (this.terrainWorld !== world) this.bakeTerrain(world);
    const W = this.el.width, H = this.el.height;
    this.k = Math.min(W / (map.w + map.h), (2 * H) / (map.w + map.h));
    const k = this.k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    // 世界 (x, y) → 小地圖 ((x − y)k + W/2, (x + y)k/2)
    g.setTransform(k, k / 2, -k, k / 2, W / 2, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.terrain!, 0, 0);

    // 建築
    for (const b of world.buildings) {
      g.fillStyle = b.kind === BK.Base ? '#e2577a' : b.kind === BK.Wall ? '#8a6a48' : '#3d78c9';
      g.fillRect(b.tx, b.ty, b.size, b.size);
    }
    // 單位：我方藍、選到的亮綠、敵人紅
    const u = world.units, sel = this.army;
    const selMask = new Set(sel.sel);
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i]) continue;
      g.fillStyle = u.team[i] === Team.Enemy ? '#d8343a' : selMask.has(i) ? '#8dff6a' : '#2f6fe0';
      g.fillRect(u.x[i] - 0.7, u.y[i] - 0.7, 1.4, 1.4);
    }

    // 鏡頭看到的範圍
    const rc = this.view.canvas.getBoundingClientRect();
    const bar = document.getElementById('bottomBar')?.offsetHeight ?? 0; // 被資訊列蓋住的部分不算
    const corners = [[rc.left, rc.top], [rc.right, rc.top], [rc.right, rc.bottom - bar], [rc.left, rc.bottom - bar]]
      .map(([x, y]) => this.view.cam.pick(x, y));
    if (corners.every(Boolean)) {
      g.beginPath();
      corners.forEach((p, j) => (j ? g.lineTo(p!.x, p!.z) : g.moveTo(p!.x, p!.z)));
      g.closePath();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
}
