import * as THREE from 'three';
import { BK, BUILDING_KINDS, UNIT_KINDS } from '../sim/data';
import { Tile } from '../sim/map';
import type { Building, World } from '../sim/world';
import { ArtLibrary } from '../render/art/library';
import type { ArtSlot } from '../render/art/manifest';
import { buildingMesh, unitGeometry } from '../render/models';
import { makeKnitTexture, WoolMaterials } from '../render/wool';
import { HEIGHT_PX, IsoCamera, PX_PER_UNIT, TILE_H, TILE_W, toScreen } from './iso';
import { makeCutout, type Cutout } from '../render/art/imageTo3d';
import { ART_SLOTS } from '../render/art/manifest';
import { flipSprite, paintBuilding, paintMonster, paintRock, paintTree, spritesFromViews, VIEW_FILES, type ViewName } from './sprites2d';

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im.naturalWidth > 0 ? im : null);
    im.onerror = () => res(null);
    im.src = url;
  });
}
import { SPRITE_SCALE, SpriteBaker, tintSprite, type Sprite } from './spriteBaker';

const TILE_COLORS: Record<number, [number, number, number]> = {
  [Tile.Grass]: [168, 207, 134],
  [Tile.Rock]: [172, 164, 150],
  [Tile.Tree]: [150, 194, 120],
  [Tile.Water]: [128, 190, 222],
};
const CHUNK = 16; // 地面每 16×16 格預先畫成一張圖
const DIRS = 8;

interface Prop { x: number; y: number; sprite: Sprite; scale: number; flip: boolean }

/**
 * 2D 斜角繪圖層（Canvas 2D）。和 3D 版一樣只「讀」World，不改它。
 * 所有單位、建築、樹都是載入時從 3D 模型拍好的圖片（spriteBaker），遊戲中只做 drawImage。
 */
export class Renderer2D {
  readonly canvas: HTMLCanvasElement;
  readonly cam: IsoCamera;
  readonly mats: WoolMaterials;
  readonly art: ArtLibrary;
  showFlow = false;
  unitShadows = true;
  selected: Building | null = null;

  private ctx: CanvasRenderingContext2D;
  private world!: World;
  private baker = new SpriteBaker();
  private unitSprites: Sprite[][] = [];
  private unitFlash: Sprite[][] = [];
  /** 從設定圖做的 8 方向圖（public/sprites/），有就優先用 */
  private viewSprites: Sprite[][] = [];
  private buildingSprites = new Map<string, Sprite>();
  private treeSprites: Sprite[] = [];
  private rockSprites: Sprite[] = [];
  private props: Prop[] = [];
  private chunks = new Map<number, HTMLCanvasElement>();
  private ghost = { visible: false, tx: 0, ty: 0, size: 1, ok: true };
  private dpr = 1;
  private drawn = 0;
  private knitPattern: HTMLCanvasElement;

  constructor(private readonly container: HTMLElement, _unitCap: number) {
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.cam = new IsoCamera(this.canvas);
    this.mats = new WoolMaterials(makeKnitTexture());
    this.knitPattern = makeKnitTexture(0.45).image as HTMLCanvasElement;
    this.art = new ArtLibrary(this.mats.knit.image as HTMLCanvasElement);
    this.bakeUnits();
    this.bakeProps();
    this.art.onChange((slot) => this.onArt(slot));
    void this.art.loadAll();
    void this.loadViewSprites();
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  // ---------------------------------------------------------------- 預渲染
  /**
   * 單位的 8 方向圖。羊人（以及任何有 .glb／圖片的插槽）從 3D 模型拍；
   * 其他單位用 2D 畫的毛球（一張朝右的圖，朝左時鏡像）。
   */
  private bakeUnits(only?: number): void {
    UNIT_KINDS.forEach((k, i) => {
      if (only !== undefined && only !== i) return;
      const art = this.art.forUnit(i);
      let dirs: Sprite[];
      if (this.viewSprites[i]) {
        dirs = this.viewSprites[i]; // 設定圖的多視角（最優先）
      } else if (art || k.model === 'sheep') {
        const mesh = art
          ? new THREE.Mesh(art.geometry, art.material)
          : new THREE.Mesh(unitGeometry(k.model), this.mats.get(0xffffff, { vertexColors: true }).clone());
        if (!art) (mesh.material as THREE.MeshStandardMaterial).color.setHex(k.color); // 等同 3D 版的 instance 顏色
        mesh.scale.setScalar(k.scale);
        dirs = this.baker.bakeDirections(mesh, DIRS);
      } else {
        const right = paintMonster(k.color, k.scale), left = flipSprite(right);
        // 第 i 個方向在世界中朝 (sin θ, cos θ)；畫面上往左（x − y < 0）就用鏡像
        dirs = Array.from({ length: DIRS }, (_, d) => {
          const th = (d * Math.PI * 2) / DIRS;
          return Math.sin(th) - Math.cos(th) < -1e-6 ? left : right;
        });
      }
      this.unitSprites[i] = dirs;
      const flash = new Map<Sprite, Sprite>();
      this.unitFlash[i] = dirs.map((s) => { if (!flash.has(s)) flash.set(s, tintSprite(s, '#ff4040', 0.45)); return flash.get(s)!; });
    });
  }

  /**
   * 讀 public/sprites/<插槽名>/front.png、front45.png、side.png、back45.png、back.png
   * （至少要有 front），去背後當成 8 方向圖。有的話優先於 3D 模型。
   */
  private async loadViewSprites(bust = ''): Promise<void> {
    const base = import.meta.env.BASE_URL + 'sprites/';
    await Promise.all(UNIT_KINDS.map(async (k, i) => {
      const slot = ART_SLOTS.find((s) => s.target.type === 'unit' && s.target.kind === i);
      if (!slot) return;
      const imgs = await Promise.all(VIEW_FILES.map((n) => loadImage(`${base}${slot.id}/${n}.png${bust}`)));
      if (!imgs[0]) { delete this.viewSprites[i]; return; }
      const cut: Partial<Record<ViewName, Cutout>> = {};
      VIEW_FILES.forEach((n, j) => { const im = imgs[j]; const c = im ? makeCutout(im, slot.bgTolerance) : null; if (c) cut[n] = c; });
      if (!cut.front) return;
      this.viewSprites[i] = spritesFromViews(cut, slot.height * k.scale * HEIGHT_PX);
      this.bakeUnits(i);
      console.info(`🖼️ ${slot.label}：用設定圖（${Object.keys(cut).join('、')}）當 8 方向圖`);
    }));
  }

  private bakeProps(): void {
    const treeArt = this.art.get('tree');
    this.treeSprites = [0.25, 0.29, 0.33].map((hue) =>
      treeArt ? this.baker.bake(new THREE.Mesh(treeArt.geometry, treeArt.material)) : paintTree(hue));
    this.rockSprites = [0, 1, 2].map((i) => paintRock(i));
  }

  private buildingSprite(b: Building): Sprite {
    const key = `${b.kind}:${b.level}`;
    let s = this.buildingSprites.get(key);
    if (!s) {
      const art = this.art.forBuilding(b.kind);
      s = art
        ? this.baker.bake(buildingMesh(b.kind, b.level, BUILDING_KINDS[b.kind].color, this.mats, art))
        : paintBuilding(b.kind, b.level, BUILDING_KINDS[b.kind].color);
      this.buildingSprites.set(key, s);
    }
    return s;
  }

  /** 美術插槽換了（.glb / 圖片載入或重載）→ 重拍對應的圖 */
  private onArt(slot: ArtSlot): void {
    const t = slot.target;
    if (t.type === 'unit') this.bakeUnits(t.kind);
    else if (t.type === 'building') this.buildingSprites.clear();
    else { this.bakeProps(); if (this.world) this.buildProps(); }
  }

  // ---------------------------------------------------------------- 地圖
  setWorld(world: World): void {
    this.world = world;
    this.chunks.clear();
    this.selected = null;
    this.buildProps();
    this.cam.bounds = { w: world.map.w, h: world.map.h };
    this.cam.target.set(world.map.baseX + 1.5, 0, world.map.baseY + 1.5);
  }

  private buildProps(): void {
    const map = this.world.map;
    const hash = (i: number) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };
    this.props = [];
    for (let i = 0; i < map.tiles.length; i++) {
      const t = map.tiles[i];
      if (t !== Tile.Tree && t !== Tile.Rock) continue;
      const x = (i % map.w) + 0.5 + (t === Tile.Tree ? (hash(i + 1) - 0.5) * 0.3 : 0);
      const y = Math.floor(i / map.w) + 0.5 + (t === Tile.Tree ? (hash(i + 2) - 0.5) * 0.3 : 0);
      const list = t === Tile.Tree ? this.treeSprites : this.rockSprites;
      this.props.push({ x, y, sprite: list[Math.floor(hash(i) * list.length)], scale: 0.8 + hash(i + 3) * 0.45, flip: hash(i + 4) > 0.5 });
    }
  }

  /** 一塊 16×16 格的地面圖（第一次用到才畫） */
  private chunk(cx: number, cy: number): HTMLCanvasElement {
    const key = cy * 1000 + cx;
    let c = this.chunks.get(key);
    if (c) return c;
    const map = this.world.map;
    c = document.createElement('canvas');
    c.width = CHUNK * TILE_W;
    c.height = CHUNK * TILE_H + 2;
    const g = c.getContext('2d')!;
    // 這塊左上角那格的頂點，放在圖的上方正中間
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const [ox, oy] = toScreen(x0, y0);
    g.translate(c.width / 2 - ox, 1 - oy);
    const hash = (i: number) => { const x = Math.sin(i * 78.233) * 43758.5453; return x - Math.floor(x); };
    for (let ty = y0; ty < Math.min(map.h, y0 + CHUNK); ty++) for (let tx = x0; tx < Math.min(map.w, x0 + CHUNK); tx++) {
      const i = ty * map.w + tx, t = map.tiles[i];
      const [r, gg, b] = TILE_COLORS[t];
      const j = 0.95 + hash(i) * 0.08;
      g.fillStyle = `rgb(${r * j},${gg * j},${b * j})`;
      const [sx, sy] = toScreen(tx, ty);
      g.beginPath();
      g.moveTo(sx, sy); g.lineTo(sx + TILE_W / 2, sy + TILE_H / 2); g.lineTo(sx, sy + TILE_H); g.lineTo(sx - TILE_W / 2, sy + TILE_H / 2);
      g.closePath();
      g.fill();
      g.strokeStyle = t === Tile.Water ? 'rgba(255,255,255,0.10)' : 'rgba(60,40,20,0.07)'; // 淡淡的格線
      g.lineWidth = 1;
      g.stroke();
    }
    // 淡淡的針織紋理，只蓋在已經畫好的格子上
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = 0.16;
    g.fillStyle = g.createPattern(this.knitPattern, 'repeat')!;
    g.fillRect(0, 0, c.width, c.height);
    this.chunks.set(key, c);
    return c;
  }

  // ---------------------------------------------------------------- 對外介面（和 3D 版相同）
  setGhost(visible: boolean, tx = 0, ty = 0, size = 1, ok = true): void {
    Object.assign(this.ghost, { visible, tx, ty, size, ok });
  }

  drawStats(): string {
    return `2D 斜角  畫了 ${this.drawn} 張圖  縮放 ${this.cam.zoom.toFixed(2)}`;
  }

  private resize(): void {
    this.dpr = Math.min(devicePixelRatio, 2);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  // ---------------------------------------------------------------- 每幀
  render(alpha: number): void {
    const g = this.ctx, w = this.world, map = w.map, z = this.cam.zoom;
    const [ox, oy] = this.cam.originOnScreen();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#f3e9dc';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(z * this.dpr, 0, 0, z * this.dpr, ox * this.dpr, oy * this.dpr);
    g.imageSmoothingQuality = 'high';

    // 可見範圍（世界像素）
    const vw = this.canvas.width / this.dpr / z, vh = this.canvas.height / this.dpr / z;
    const vx0 = -ox / z, vy0 = -oy / z, vx1 = vx0 + vw, vy1 = vy0 + vh;
    const onScreen = (sx: number, sy: number, m: number) => sx > vx0 - m && sx < vx1 + m && sy > vy0 - m && sy < vy1 + m * 2;

    this.drawBoard(g, map.w, map.h);
    // 地面
    for (let cy = 0; cy < Math.ceil(map.h / CHUNK); cy++) for (let cx = 0; cx < Math.ceil(map.w / CHUNK); cx++) {
      const [sx, sy] = toScreen(cx * CHUNK, cy * CHUNK);
      const left = sx - (CHUNK * TILE_W) / 2;
      if (left > vx1 || left + CHUNK * TILE_W < vx0 || sy > vy1 || sy + CHUNK * TILE_H < vy0) continue;
      g.drawImage(this.chunk(cx, cy), left, sy - 1);
    }
    if (this.showFlow) this.drawFlow(g);
    this.drawGroundMarks(g);

    // 收集要畫的東西，依「離鏡頭的遠近」（x+y）排序：後面的先畫
    const items: { k: number; draw: () => void }[] = [];
    const shadows: [number, number, number][] = [];
    for (const p of this.props) {
      const [sx, sy] = toScreen(p.x, p.y);
      if (!onScreen(sx, sy, 80)) continue;
      items.push({ k: p.x + p.y, draw: () => this.drawSprite(g, p.sprite, sx, sy, p.scale, p.flip) });
    }
    for (const b of w.buildings) {
      const cx = b.tx + b.size / 2, cy = b.ty + b.size / 2;
      const [sx, sy0] = toScreen(cx, cy);
      if (!onScreen(sx, sy0, 200)) continue;
      const sy = sy0 + (b.hitT > 0 ? 2 : 0); // 被打時輕微下沉
      const sp = this.buildingSprite(b);
      shadows.push([sx, sy0, b.size * 0.55]);
      items.push({ k: cx + cy + b.size * 0.3, draw: () => { this.drawSprite(g, sp, sx, sy, 1, false); this.drawBar(g, b, sx, sy - sp.top - 8); } });
    }
    const u = w.units, t = w.time;
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i]) continue;
      const x = u.px[i] + (u.x[i] - u.px[i]) * alpha, y = u.py[i] + (u.y[i] - u.py[i]) * alpha;
      const [sx, sy] = toScreen(x, y);
      if (!onScreen(sx, sy, 40)) continue;
      const k = u.kind[i], kind = UNIT_KINDS[k];
      const moving = u.vx[i] * u.vx[i] + u.vy[i] * u.vy[i] > 0.05;
      const bob = moving ? Math.abs(Math.sin(t * 12 + i)) * 0.12 * kind.scale : 0;
      const dir = ((Math.round(u.face[i] / ((Math.PI * 2) / DIRS)) % DIRS) + DIRS) % DIRS;
      const sp = (u.hitT[i] > 0 ? this.unitFlash : this.unitSprites)[k][dir];
      if (this.unitShadows) shadows.push([sx, sy, kind.radius * 1.3]);
      items.push({ k: x + y, draw: () => this.drawSprite(g, sp, sx, sy - bob * HEIGHT_PX, 1, false) });
    }
    // 影子（壓扁的橢圓）先畫，所有東西都在影子上面
    g.fillStyle = 'rgba(60,40,30,0.22)';
    for (const [sx, sy, r] of shadows) {
      g.beginPath();
      g.ellipse(sx, sy, r * PX_PER_UNIT, r * PX_PER_UNIT * 0.5, 0, 0, Math.PI * 2);
      g.fill();
    }
    items.sort((a, b) => a.k - b.k);
    for (const it of items) it.draw();
    this.drawn = items.length;

    this.drawShots(g);
    this.drawSelectionTop(g);
  }

  private drawSprite(g: CanvasRenderingContext2D, s: Sprite, sx: number, sy: number, scale: number, flip: boolean): void {
    const k = scale / SPRITE_SCALE, w = s.canvas.width * k, h = s.canvas.height * k;
    if (flip) {
      g.save();
      g.translate(sx, sy);
      g.scale(-1, 1);
      g.drawImage(s.canvas, -s.ax * k, -s.ay * k, w, h);
      g.restore();
    } else {
      g.drawImage(s.canvas, sx - s.ax * k, sy - s.ay * k, w, h);
    }
  }

  /** 地圖底下的毛氈板（菱形下方的兩個側面） */
  private drawBoard(g: CanvasRenderingContext2D, W: number, H: number): void {
    const [lx, ly] = toScreen(0, H), [bx, by] = toScreen(W, H), [rx, ry] = toScreen(W, 0);
    const d = 22;
    g.fillStyle = '#b98d68';
    g.beginPath(); g.moveTo(lx, ly); g.lineTo(bx, by); g.lineTo(bx, by + d); g.lineTo(lx, ly + d); g.closePath(); g.fill();
    g.fillStyle = '#a57a58';
    g.beginPath(); g.moveTo(bx, by); g.lineTo(rx, ry); g.lineTo(rx, ry + d); g.lineTo(bx, by + d); g.closePath(); g.fill();
  }

  private diamond(g: CanvasRenderingContext2D, tx: number, ty: number, size: number): void {
    const a = toScreen(tx, ty), b = toScreen(tx + size, ty), c = toScreen(tx + size, ty + size), d = toScreen(tx, ty + size);
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath();
  }

  /** 地面上的標記：建造預覽、選取框、射程圈 */
  private drawGroundMarks(g: CanvasRenderingContext2D): void {
    const gh = this.ghost;
    if (gh.visible) {
      this.diamond(g, gh.tx, gh.ty, gh.size);
      g.fillStyle = gh.ok ? 'rgba(102,255,102,0.35)' : 'rgba(255,85,85,0.35)';
      g.fill();
      g.strokeStyle = gh.ok ? '#4c4' : '#d44';
      g.lineWidth = 2;
      g.stroke();
    }
    const sel = this.selected;
    if (sel && sel.dead) this.selected = null;
    if (!this.selected) return;
    const s = this.selected;
    this.diamond(g, s.tx, s.ty, s.size);
    g.strokeStyle = '#ffd54a';
    g.lineWidth = 3;
    g.stroke();
    if (s.kind === BK.Tower) {
      const r = this.world.towerRange(s);
      const [cx, cy] = toScreen(s.tx + s.size / 2, s.ty + s.size / 2);
      g.beginPath();
      g.ellipse(cx, cy, r * PX_PER_UNIT, r * PX_PER_UNIT * 0.5, 0, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 2;
      g.stroke();
    }
  }

  /** 物件之上的標記：集結旗 */
  private drawSelectionTop(g: CanvasRenderingContext2D): void {
    const s = this.selected;
    if (!s || s.kind !== BK.Barracks) return;
    const [fx, fy] = toScreen(s.rallyX, s.rallyY);
    g.strokeStyle = '#6b4a2a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx, fy - 34); g.stroke();
    g.fillStyle = '#4a8be0';
    g.fillRect(fx, fy - 34, 16, 10);
  }

  private drawBar(g: CanvasRenderingContext2D, b: Building, sx: number, sy: number): void {
    const r = b.hp / b.maxHp;
    if (r >= 0.999) return;
    const w = b.size * 26;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 6);
    g.fillStyle = r > 0.5 ? '#5ad35a' : r > 0.25 ? '#f0c040' : '#e05050';
    g.fillRect(sx - w / 2, sy, w * Math.max(0, r), 4);
  }

  private drawShots(g: CanvasRenderingContext2D): void {
    const shots = this.world.shots;
    if (!shots.length) return;
    g.strokeStyle = '#ff6f91';
    g.lineWidth = 1.5;
    g.beginPath();
    for (const s of shots) {
      const [ax, ay] = toScreen(s.x1, s.y1, 1.8), [bx, by] = toScreen(s.x2, s.y2, 0.35);
      g.moveTo(ax, ay); g.lineTo(bx, by);
    }
    g.stroke();
  }

  private drawFlow(g: CanvasRenderingContext2D): void {
    const f = this.world.flow, W = this.world.map.w, H = this.world.map.h;
    g.strokeStyle = 'rgba(51,85,170,0.6)';
    g.lineWidth = 1;
    g.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (f.dirX[i] === 0 && f.dirY[i] === 0) continue;
      const [ax, ay] = toScreen(x + 0.5, y + 0.5), [bx, by] = toScreen(x + 0.5 + f.dirX[i] * 0.45, y + 0.5 + f.dirY[i] * 0.45);
      g.moveTo(ax, ay); g.lineTo(bx, by);
    }
    g.stroke();
  }
}
