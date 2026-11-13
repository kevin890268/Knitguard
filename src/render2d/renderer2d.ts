import * as THREE from 'three';
import { BK, BUILDING_KINDS, MAX_LEVEL, PROJ, UNIT_KINDS, type ProjKind } from '../sim/data';
import { Tile } from '../sim/map';
import type { Building, Shot, World } from '../sim/world';
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
  /** 選取的部隊：unitSel[i] = 1（main.ts 設定） */
  unitSel: Uint8Array | null = null;
  /** 下指令時地上閃一下的標記（t＝剩下秒數） */
  pings: { x: number; y: number; t: number; color: string }[] = [];
  private lastFrame = performance.now();

  private ctx: CanvasRenderingContext2D;
  private world!: World;
  private baker = new SpriteBaker();
  private unitSprites: Sprite[][] = [];
  private unitFlash: Sprite[][] = [];
  /** 從設定圖做的 8 方向圖（public/sprites/），有就優先用 */
  private viewSprites: Sprite[][] = [];
  /** 彈道圖片（箭、標槍、石頭） */
  private projSprites: Partial<Record<ProjKind, { img: HTMLCanvasElement; w: number; h: number; angle: number }>> = {};
  /** 刺球衛縮成球時的圖 */
  private curlSprites: Sprite[][] = [];
  private curlFlash: Sprite[][] = [];
  private buildingSprites = new Map<string, Sprite>();
  private treeSprites: Sprite[] = [];
  private rockSprites: Sprite[] = [];
  private props: Prop[] = [];
  private chunks = new Map<number, HTMLCanvasElement>();
  private ghost = { visible: false, tx: 0, ty: 0, size: 1, h: 1, ok: true };
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
    void this.loadProjectiles();
    void this.loadBuildingArt();
    void this.loadTreeArt();
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
      // 縮球形態（刺球衛）：public/sprites/<id>_curl/
      if (k.skill?.type === 'curl') {
        const ci = await Promise.all(VIEW_FILES.map((n) => loadImage(`${base}${slot.id}_curl/${n}.png${bust}`)));
        const cc: Partial<Record<ViewName, Cutout>> = {};
        VIEW_FILES.forEach((n, j) => { const im = ci[j]; const c = im ? makeCutout(im, slot.bgTolerance) : null; if (c) cc[n] = c; });
        if (cc.front) {
          const dirs = spritesFromViews(cc, slot.height * k.scale * HEIGHT_PX * 0.85);
          this.curlSprites[i] = dirs;
          this.curlFlash[i] = dirs.map((s) => tintSprite(s, '#ff4040', 0.45));
        }
      }
    }));
  }

  private bakeProps(): void {
    const treeArt = this.art.get('tree');
    this.treeSprites = [0.25, 0.29, 0.33].map((hue) =>
      treeArt ? this.baker.bake(new THREE.Mesh(treeArt.geometry, treeArt.material)) : paintTree(hue));
    this.rockSprites = [0, 1, 2].map((i) => paintRock(i));
  }

  /**
   * 樹的圖（public/sprites/props/tree_1…16.png、fruit_1…16.png，已去背）。載入後取代程式畫的樹。
   * tree：1–4 綠樹、5–8 秋天、9–12 松樹、13–16 櫻花；fruit：天然果樹（蘋果、桃、橘、櫻桃，每種 4 個樹形）
   */
  private treeGroups: Sprite[][] = [];
  private fruitSprites: Sprite[] = [];
  /** 石頭：rock_1…32（每 8 個一組：灰石、砂岩、青苔、水晶）；礦石：ore_1…24（鐵、金、煤，各 8 個）——礦石目前只是外觀 */
  private rockGroups: Sprite[][] = [];
  private oreSprites: Sprite[] = [];
  private async loadTreeArt(): Promise<void> {
    const load = (name: string, n: number, wPx: number, ayFrac: number) => Promise.all(Array.from({ length: n }, async (_, i) => {
      const im = await loadImage(`${import.meta.env.BASE_URL}sprites/props/${name}_${i + 1}.png`);
      if (!im) return null;
      const cw = Math.round(wPx * (im.naturalWidth / 220) * SPRITE_SCALE), ch = Math.round((im.naturalHeight / im.naturalWidth) * cw);
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(im, 0, 0, cw, ch);
      return { canvas: c, ax: cw / 2, ay: ch * ayFrac, top: (ch * ayFrac) / SPRITE_SCALE } as Sprite;
    }));
    const [trees, fruits, rocks, ores] = await Promise.all([load('tree', 16, TILE_W * 1.1, 0.93), load('fruit', 16, TILE_W * 1.1, 0.9),
      load('rock', 32, TILE_W * 1.05, 0.85), load('ore', 24, TILE_W * 0.95, 0.85)]);
    if (!trees.some((s) => !s)) { // 圖不齊就繼續用程式畫的樹
      this.treeGroups = [0, 4, 8, 12].map((k) => trees.slice(k, k + 4) as Sprite[]);
      this.fruitSprites = fruits.filter((s): s is Sprite => !!s);
    }
    if (!rocks.some((s) => !s)) this.rockGroups = [0, 8, 16, 24].map((k) => rocks.slice(k, k + 8) as Sprite[]);
    this.oreSprites = ores.filter((s): s is Sprite => !!s);
    if (this.world) this.buildProps();
  }

  /** 去背好的建築圖（public/sprites/buildings/<sprite>_<等級>.png），key＝`種類:等級` */
  private buildingArt = new Map<string, Sprite>();
  private async loadBuildingArt(): Promise<void> {
    // 市鎮中心：畫面寬度（佔地 3 格的菱形是 192px，美術含廣場比佔地大；越高階越大）與腳底中心在圖上的位置（由上往下比例）
    const town: [number, number][] = [[250, 0.80], [270, 0.80], [290, 0.80], [340, 0.82], [370, 0.85]];
    const jobs: Promise<void>[] = [];
    BUILDING_KINDS.forEach((k, kind) => {
      if (!k.sprite) return;
      const levels = Math.max(MAX_LEVEL, k.upgradeCost.length + 1);
      jobs.push((async () => {
      const ims = await Promise.all(Array.from({ length: levels }, (_, i) => loadImage(`${import.meta.env.BASE_URL}sprites/buildings/${k.sprite}_${i + 1}.png`)));
      // 其他建築：最高等級的寬度 = 佔地菱形寬 × 1.3，低等級照原圖比例縮小（設定圖大小不一，用佔地統一）
      const maxW = Math.max(1, ...ims.map((im) => im?.naturalWidth ?? 0));
      const fit = ((((k.w ?? k.size) + (k.h ?? k.size)) / 2) * TILE_W * 1.3) / maxW; // 長方形用佔地菱形的平均寬
      ims.forEach((im, li) => {
        const lv = li + 1;
        if (!im) return;
        const [wPx, ayFrac] = kind === BK.Base ? town[lv - 1] ?? town[town.length - 1] : [im.naturalWidth * fit, 0.78];
        const cw = Math.round(wPx * SPRITE_SCALE), ch = Math.round((im.naturalHeight / im.naturalWidth) * cw);
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        const g = c.getContext('2d')!;
        g.imageSmoothingQuality = 'high';
        g.drawImage(im, 0, 0, cw, ch);
        this.buildingArt.set(`${kind}:${lv}`, { canvas: c, ax: cw / 2, ay: ch * ayFrac, top: (ch * ayFrac) / SPRITE_SCALE });
      });
      })());
    });
    await Promise.all(jobs);
  }

  private buildingSprite(b: Building): Sprite {
    const key = `${b.kind}:${b.level}`;
    const art = this.buildingArt.get(key);
    if (art) return art;
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
    this.roadVer = -1;
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
      let list = t === Tile.Tree ? this.treeSprites : this.rockSprites;
      if (t === Tile.Tree && this.treeGroups.length) {
        // 一片樹林同一種樹（每 7×7 格一區），偶爾夾一棵天然果樹
        const tx = i % map.w, ty = Math.floor(i / map.w);
        const zone = hash(Math.floor(tx / 7) * 131 + Math.floor(ty / 7) * 977 + 5);
        const group = zone < 0.45 ? 0 : zone < 0.75 ? 2 : zone < 0.9 ? 1 : 3; // 綠樹 45%、松樹 30%、秋天 15%、櫻花 10%
        list = this.fruitSprites.length && hash(i + 9) < 0.06 ? this.fruitSprites : this.treeGroups[group];
      } else if (t === Tile.Rock && this.rockGroups.length) {
        // 一片石頭同一種（每 6×6 格一區）：灰石 45%、青苔 30%、砂岩 18%、水晶 7%；偶爾一顆礦石
        const tx = i % map.w, ty = Math.floor(i / map.w);
        const zone = hash(Math.floor(tx / 6) * 211 + Math.floor(ty / 6) * 733 + 11);
        const group = zone < 0.45 ? 0 : zone < 0.75 ? 2 : zone < 0.93 ? 1 : 3;
        list = this.oreSprites.length && hash(i + 13) < 0.07 ? this.oreSprites : this.rockGroups[group];
      }
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
  /** 單位頭像：面向鏡頭的那張圖（介面用）；還沒準備好回傳 null */
  portrait(kind: number): HTMLCanvasElement | null {
    return this.unitSprites[kind]?.[1]?.canvas ?? null;
  }

  /** 建造預覽；size＝寬，h＝高（長方形的城門），沒給 h 就是正方形 */
  setGhost(visible: boolean, tx = 0, ty = 0, size = 1, ok = true, h = size): void {
    Object.assign(this.ghost, { visible, tx, ty, size, h, ok });
  }

  drawStats(): string {
    return `2D 斜角  畫了 ${this.drawn} 張圖  縮放 ${this.cam.zoom.toFixed(2)}  解析度 ${Math.round(this.renderScale * 100)}%`;
  }

  private resize(): void {
    this.dpr = Math.min(devicePixelRatio, 2) * this.renderScale;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /**
   * 自動解析度：畫一幀太久（沒有顯示卡加速的瀏覽器，每個像素都要 CPU 畫）就降低內部解析度，
   * 由瀏覽器放大顯示；變快了再調回來。1 = 原始解析度，最低 0.5。
   */
  renderScale = 1;
  autoScale = true;
  private frameMs = 0;
  private scaleCooldown = 0;
  private adaptScale(ms: number): void {
    this.frameMs = this.frameMs * 0.9 + ms * 0.1;
    if (!this.autoScale || --this.scaleCooldown > 0) return;
    let s = this.renderScale;
    if (this.frameMs > 20 && s > 0.5) s = Math.max(0.5, s - 0.1);
    else if (this.frameMs < 8 && s < 1) s = Math.min(1, s + 0.1);
    if (s !== this.renderScale) { this.renderScale = s; this.resize(); this.scaleCooldown = 30; }
  }

  // ---------------------------------------------------------------- 每幀
  render(alpha: number): void {
    const t0 = performance.now();
    this.renderFrame(alpha);
    this.adaptScale(performance.now() - t0);
  }

  private renderFrame(alpha: number): void {
    const g = this.ctx, w = this.world, map = w.map, z = this.cam.zoom;
    const [ox, oy] = this.cam.originOnScreen();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#f3e9dc';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(z * this.dpr, 0, 0, z * this.dpr, ox * this.dpr, oy * this.dpr);
    // 降解析度時圖片縮放也用比較省的取樣
    g.imageSmoothingQuality = this.renderScale >= 1 ? 'high' : 'low';

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
    this.drawRoads(g);
    if (this.showFlow) this.drawFlow(g);
    this.drawGroundMarks(g);
    this.drawUnitMarks(g, alpha);
    this.drawTraps(g);
    this.drawThorns(g);

    // 收集要畫的東西，依「離鏡頭的遠近」（x+y）排序：後面的先畫
    const items: { k: number; draw: () => void }[] = [];
    const shadows: [number, number, number][] = [];
    for (const p of this.props) {
      const [sx, sy] = toScreen(p.x, p.y);
      if (!onScreen(sx, sy, 80)) continue;
      items.push({ k: p.x + p.y, draw: () => this.drawSprite(g, p.sprite, sx, sy, p.scale, p.flip) });
    }
    for (const b of w.buildings) {
      const cx = b.tx + b.w / 2, cy = b.ty + b.h / 2, half = (b.w + b.h) / 4;
      const [sx, sy0] = toScreen(cx, cy);
      if (!onScreen(sx, sy0, 200)) continue;
      const sy = sy0 + (b.hitT > 0 ? 2 : 0); // 被打時輕微下沉
      const sp = this.buildingSprite(b);
      shadows.push([sx, sy0, half * 1.1]);
      // 城門的圖是沿 x 方向（3×1）；轉成 1×3 時左右翻過來
      const flip = b.h > b.w;
      items.push({ k: cx + cy + half * 0.6, draw: () => { this.drawSprite(g, sp, sx, sy, 1, flip); this.drawBar(g, b, sx, sy - sp.top - 8); } });
    }
    const u = w.units, t = w.time, sel = this.unitSel;
    const bars: [number, number, number][] = [];
    const trapped: [number, number][] = [];
    const rage: [number, number, number][] = [];
    const bleeding: [number, number, number][] = [];
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i]) continue;
      const x = u.px[i] + (u.x[i] - u.px[i]) * alpha, y = u.py[i] + (u.y[i] - u.py[i]) * alpha;
      const [sx, sy] = toScreen(x, y);
      if (!onScreen(sx, sy, 40)) continue;
      const k = u.kind[i], kind = UNIT_KINDS[k];
      // 真的在走路才跳：速度要夠快；我方還要有指令、在追敵人或離崗位夠遠（站著被推擠不算）
      const moving = u.vx[i] * u.vx[i] + u.vy[i] * u.vy[i] > 0.4 && (u.team[i] !== 0 || u.order[i] !== 0 || u.target[i] >= 0 ||
        (u.homeX[i] - u.x[i]) ** 2 + (u.homeY[i] - u.y[i]) ** 2 > 0.8);
      // 走路一跳一跳；有輪子的器具用滑的
      const bob = moving && !kind.wheeled ? Math.abs(Math.sin(t * 12 + i)) * 0.12 * kind.scale : 0;
      const dir = ((Math.round(u.face[i] / ((Math.PI * 2) / DIRS)) % DIRS) + DIRS) % DIRS;
      const curl = u.curled[i] && this.curlSprites[k];
      const sp = (u.hitT[i] > 0 ? (curl ? this.curlFlash : this.unitFlash) : (curl ? this.curlSprites : this.unitSprites))[k][dir];
      if (this.unitShadows) shadows.push([sx, sy, kind.radius * 1.3]);
      if (sel && sel[i]) bars.push([sx, sy - sp.top - 4, u.hp[i] / u.maxHp[i]]);
      if (u.team[i] === 0 && w.isTrapped(i)) trapped.push([sx, sy - sp.top - 6]);
      if (u.bleedT[i] > 0) bleeding.push([sx, sy - sp.top * 0.55, i]);
      if (kind.skill?.type === 'rage' && w.raging(i)) rage.push([sx, sy, kind.radius * (w.deepRage(i) ? 2.2 : 1.6)]); // 深度狂化：紅光比較大
      items.push({ k: x + y, draw: () => this.drawSprite(g, sp, sx, sy - bob * HEIGHT_PX, 1, false) });
    }
    // 影子（壓扁的橢圓）先畫，所有東西都在影子上面；全部合成一條路徑一次填色（省很多次填色）
    g.fillStyle = 'rgba(60,40,30,0.22)';
    g.beginPath();
    for (const [sx, sy, r] of shadows) {
      g.moveTo(sx + r * PX_PER_UNIT, sy);
      g.ellipse(sx, sy, r * PX_PER_UNIT, r * PX_PER_UNIT * 0.5, 0, 0, Math.PI * 2);
    }
    g.fill();
    // 狂化中的狼人：腳下一圈會脈動的紅光
    if (rage.length) {
      g.fillStyle = `rgba(230,50,40,${0.3 + 0.15 * Math.sin(t * 10)})`;
      g.beginPath();
      for (const [sx, sy, r] of rage) { g.moveTo(sx + r * PX_PER_UNIT, sy); g.ellipse(sx, sy, r * PX_PER_UNIT, r * PX_PER_UNIT * 0.5, 0, 0, Math.PI * 2); }
      g.fill();
    }
    items.sort((a, b) => a.k - b.k);
    for (const it of items) it.draw();
    this.drawn = items.length;

    this.drawShots(g);
    this.drawFx(g);
    this.drawSelectionTop(g);
    // 選取部隊的血條
    for (const [bx, by, r] of bars) {
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(bx - 11, by - 1, 22, 5);
      g.fillStyle = r > 0.5 ? '#5ad35a' : r > 0.25 ? '#f0c040' : '#e05050';
      g.fillRect(bx - 10, by, 20 * Math.max(0, r), 3);
    }
    // 出血中：身上滴紅色的血
    if (bleeding.length) {
      g.fillStyle = '#c8202a';
      g.beginPath();
      for (const [bx, by, i] of bleeding) {
        for (let d = 0; d < 2; d++) {
          const ph = (t * 1.6 + i * 0.37 + d * 0.5) % 1; // 往下滴
          const dx = (d ? 5 : -4), dy = ph * 14;
          g.moveTo(bx + dx, by + dy - 3); g.quadraticCurveTo(bx + dx + 2.2, by + dy + 1, bx + dx, by + dy + 2); g.quadraticCurveTo(bx + dx - 2.2, by + dy + 1, bx + dx, by + dy - 3);
        }
      }
      g.fill();
    }
    // 被建築關在中間的單位：頭上顯示「無法移動」
    if (trapped.length) {
      g.font = 'bold 11px sans-serif';
      g.textAlign = 'center';
      for (const [tx, ty] of trapped) {
        const label = '🚫 無法移動', tw = g.measureText(label).width + 8;
        g.fillStyle = 'rgba(160,30,30,0.85)';
        g.beginPath(); g.roundRect(tx - tw / 2, ty - 16, tw, 15, 4); g.fill();
        g.fillStyle = '#fff';
        g.fillText(label, tx, ty - 5);
      }
      g.textAlign = 'start';
    }
  }

  /** 選取部隊腳下的圈、指令路線、下指令時的標記 */
  private drawUnitMarks(g: CanvasRenderingContext2D, alpha: number): void {
    const now = performance.now(), fdt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const sel = this.unitSel, u = this.world.units;
    if (sel) {
      // 路線：目前的目的地 → 佇列裡的下一個…（同一個點只畫一次旗子）
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.lineWidth = 1.2;
      g.setLineDash([4, 4]);
      g.beginPath();
      const flags: [number, number, number][] = [];
      for (let i = 0; i < u.hi; i++) {
        if (!u.alive[i] || !sel[i] || u.order[i] === 0) continue;
        const x = u.px[i] + (u.x[i] - u.px[i]) * alpha, y = u.py[i] + (u.y[i] - u.py[i]) * alpha;
        let [ax, ay] = toScreen(x, y);
        const pts: [number, number, number][] = [[u.ordX[i], u.ordY[i], u.order[i]], ...this.world.queuedOrders(i).map((o) => [o.x, o.y, o.ord] as [number, number, number])];
        for (const [px, py, o] of pts) {
          const [bx, by] = toScreen(px, py);
          g.moveTo(ax, ay); g.lineTo(bx, by);
          ax = bx; ay = by;
          flags.push([bx, by, o]);
        }
      }
      g.stroke();
      g.setLineDash([]);
      for (const [fx, fy, o] of flags) {
        g.fillStyle = o === 1 ? 'rgba(120,220,120,0.8)' : o === 4 ? 'rgba(90,160,240,0.8)' : 'rgba(240,90,90,0.8)';
        g.beginPath(); g.ellipse(fx, fy, 3, 1.5, 0, 0, Math.PI * 2); g.fill();
      }
      // 腳下的選取圈
      g.strokeStyle = '#7dff7d';
      g.lineWidth = 1.6;
      g.beginPath();
      for (let i = 0; i < u.hi; i++) {
        if (!u.alive[i] || !sel[i]) continue;
        const x = u.px[i] + (u.x[i] - u.px[i]) * alpha, y = u.py[i] + (u.y[i] - u.py[i]) * alpha;
        const [sx, sy] = toScreen(x, y), r = u.rad[i] * 1.35 * PX_PER_UNIT;
        g.moveTo(sx + r, sy);
        g.ellipse(sx, sy, r, r * 0.5, 0, 0, Math.PI * 2);
      }
      g.stroke();
    }
    // 指令標記：縮小的圈
    for (const p of this.pings) {
      p.t -= fdt;
      if (p.t <= 0) continue;
      const [sx, sy] = toScreen(p.x, p.y), k = p.t / 0.6;
      g.strokeStyle = p.color;
      g.globalAlpha = Math.min(1, k * 1.5);
      g.lineWidth = 2.5;
      g.beginPath(); g.ellipse(sx, sy, 6 + 16 * k, (6 + 16 * k) * 0.5, 0, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
    if (this.pings.length && this.pings.every((p) => p.t <= 0)) this.pings.length = 0;
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

  private diamond(g: CanvasRenderingContext2D, tx: number, ty: number, size: number, h = size): void {
    const a = toScreen(tx, ty), b = toScreen(tx + size, ty), c = toScreen(tx + size, ty + h), d = toScreen(tx, ty + h);
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath();
  }

  /** 道路：土黃色石板路，外緣描一圈深色邊（跟隔壁道路相接的邊不描） */
  private roadTiles: number[] = [];
  private roadVer = -1;
  private drawRoads(g: CanvasRenderingContext2D): void {
    const w = this.world, mw = w.map.w, roads = w.roads;
    if (this.roadVer !== w.roadsVersion) {
      this.roadTiles = [];
      for (let i = 0; i < roads.length; i++) if (roads[i]) this.roadTiles.push(i);
      this.roadVer = w.roadsVersion;
    }
    if (!this.roadTiles.length) return;
    g.beginPath();
    for (const i of this.roadTiles) {
      const tx = i % mw, ty = (i / mw) | 0;
      const a = toScreen(tx, ty), b = toScreen(tx + 1, ty), c = toScreen(tx + 1, ty + 1), d = toScreen(tx, ty + 1);
      g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath();
    }
    g.fillStyle = '#d2b58a';
    g.fill();
    // 石板的縫：每格中間畫一個小菱形
    g.beginPath();
    for (const i of this.roadTiles) {
      const tx = i % mw, ty = (i / mw) | 0;
      const a = toScreen(tx + 0.25, ty + 0.25), b = toScreen(tx + 0.75, ty + 0.25), c = toScreen(tx + 0.75, ty + 0.75), d = toScreen(tx + 0.25, ty + 0.75);
      g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath();
    }
    g.strokeStyle = 'rgba(120,90,55,0.25)';
    g.lineWidth = 1;
    g.stroke();
    // 外緣
    const isRoad = (x: number, y: number) => x >= 0 && y >= 0 && x < mw && y < w.map.h && roads[y * mw + x] === 1;
    g.beginPath();
    for (const i of this.roadTiles) {
      const tx = i % mw, ty = (i / mw) | 0;
      const a = toScreen(tx, ty), b = toScreen(tx + 1, ty), c = toScreen(tx + 1, ty + 1), d = toScreen(tx, ty + 1);
      if (!isRoad(tx, ty - 1)) { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      if (!isRoad(tx + 1, ty)) { g.moveTo(b[0], b[1]); g.lineTo(c[0], c[1]); }
      if (!isRoad(tx, ty + 1)) { g.moveTo(c[0], c[1]); g.lineTo(d[0], d[1]); }
      if (!isRoad(tx - 1, ty)) { g.moveTo(d[0], d[1]); g.lineTo(a[0], a[1]); }
    }
    g.strokeStyle = '#9c7a4e';
    g.lineWidth = 2;
    g.stroke();
  }

  /** 地面上的標記：建造預覽、選取框、射程圈 */
  private drawGroundMarks(g: CanvasRenderingContext2D): void {
    const gh = this.ghost;
    if (gh.visible) {
      this.diamond(g, gh.tx, gh.ty, gh.size, gh.h);
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
    this.diamond(g, s.tx, s.ty, s.w, s.h);
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
    if (!s || !BUILDING_KINDS[s.kind].spawnCap) return;
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

  /** 飛行中的箭、標槍、石頭、尖刺：沿拋物線飛，圖片轉向飛行方向 */
  private drawShots(g: CanvasRenderingContext2D): void {
    const shots = this.world.shots;
    if (!shots.length) return;
    const at = (s: Shot, p: number): [number, number] => {
      const arc = PROJ[s.kind].arc;
      const h = (s.h1 ?? 1.8) * (1 - p) + 0.35 * p + arc * 4 * p * (1 - p);
      return toScreen(s.x1 + (s.x2 - s.x1) * p, s.y1 + (s.y2 - s.y1) * p, h);
    };
    for (const s of shots) {
      const p = Math.min(1, Math.max(0, 1 - s.t / s.dur));
      const [sx, sy] = at(s, p);
      const [nx, ny] = at(s, Math.min(1, p + 0.03));
      const ang = Math.atan2(ny - sy, nx - sx);
      // 投石手的小石頭、配重投石機的大石頭都用石頭的圖，只是大小不同
      if (s.kind === 'water') {
        // 水砲的水彈：一團藍色的水，後面拖一點水花
        g.fillStyle = 'rgba(120,190,250,0.5)';
        const [bx, by] = at(s, Math.max(0, p - 0.05));
        g.beginPath(); g.arc(bx, by, 4, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(70,150,235,0.95)';
        g.beginPath(); g.arc(sx, sy, 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.8)';
        g.beginPath(); g.arc(sx - 2, sy - 2, 2, 0, Math.PI * 2); g.fill();
        continue;
      }
      const rock = s.kind === 'stone' || s.kind === 'pebble' || s.kind === 'boulder';
      const pr = this.projSprites[rock ? 'stone' : s.kind];
      if (s.kind === 'spike' || !pr) { this.drawSpike(g, sx, sy, ang); continue; }
      const k = s.kind === 'pebble' ? 0.4 : s.kind === 'boulder' ? 1.6 : 1;
      g.save();
      g.translate(sx, sy);
      if (rock) g.rotate(p * 6); // 石頭邊飛邊轉
      else g.rotate(ang - pr.angle);
      g.drawImage(pr.img, (-pr.w / 2) * k, (-pr.h / 2) * k, pr.w * k, pr.h * k);
      g.restore();
    }
  }

  /** 尖刺弩砲的刺：米白尖頭＋紅色環（設定圖只有特寫，直接畫） */
  private drawSpike(g: CanvasRenderingContext2D, x: number, y: number, ang: number): void {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = '#f1dcb4';
    g.beginPath(); g.moveTo(16, 0); g.lineTo(-14, -3.5); g.lineTo(-14, 3.5); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(90,60,30,0.5)'; g.lineWidth = 0.8; g.stroke();
    g.fillStyle = '#c0392b';
    g.fillRect(-9, -3, 3, 6); g.fillRect(-3, -2.4, 2.5, 4.8);
    g.restore();
  }

  /** 彈道圖片：從設定圖裁下來去背；angle＝圖片裡箭頭原本朝的角度 */
  private async loadProjectiles(): Promise<void> {
    const base = import.meta.env.BASE_URL + 'sprites/projectiles/';
    // 長度（世界單位）和圖片裡尖端的方向（從尾巴往尖端，螢幕角度）
    const defs: [ProjKind, number, number][] = [['arrow', 0.75, Math.atan2(-50, 193)], ['javelin', 0.95, Math.atan2(-138, 195)], ['stone', 0.42, 0]];
    for (const [kind, len, angle] of defs) {
      const im = await loadImage(base + kind + '.png');
      if (!im) continue;
      const c = makeCutout(im, 26);
      if (!c) continue;
      const cv = document.createElement('canvas');
      cv.width = c.w; cv.height = c.h;
      const g = cv.getContext('2d')!;
      g.putImageData(new ImageData(new Uint8ClampedArray(c.rgba), c.w, c.h), 0, 0);
      if (kind === 'stone') {
        // 石頭下半部連著投石杯：只留圓形的石頭
        g.globalCompositeOperation = 'destination-in';
        g.beginPath(); g.arc(c.w * 0.47, c.h * 0.47, Math.min(c.w, c.h) * 0.42, 0, Math.PI * 2); g.fill();
      }
      // 依長度縮放：箭、標槍以對角長度為準；石頭以寬度為準
      const px = len * PX_PER_UNIT;
      const k = kind === 'stone' ? px / c.w : px / Math.hypot(c.w, c.h);
      this.projSprites[kind] = { img: cv, w: c.w * k, h: c.h * k, angle };
    }
  }

  /** 地上的陷阱（小小的尖刺板） */
  /** 德魯伊的樹枝：地上一圈綠棕色，冒出幾根會晃的枝條；快結束時淡掉 */
  /** 樹根圖（public/sprites/effects/roots_1…4.png）：1–3 生長、4 持續傷害（循環） */
  private rootImgs: HTMLImageElement[] = [];
  private rootsLoading = false;
  private drawThorns(g: CanvasRenderingContext2D): void {
    const t = this.world.time;
    if (!this.rootsLoading) {
      this.rootsLoading = true;
      void Promise.all([1, 2, 3, 4].map((n) => loadImage(`${import.meta.env.BASE_URL}sprites/effects/roots_${n}.png`)))
        .then((ims) => { if (ims.every(Boolean)) this.rootImgs = ims as HTMLImageElement[]; });
    }
    for (const th of this.world.thorns) {
      const [sx, sy] = toScreen(th.x, th.y);
      const a = Math.min(1, th.t / 0.6, (th.dur - th.t) / 0.3 + 0.2);
      if (this.rootImgs.length) {
        // 剛長出來的 0.45 秒依序播生長 1→3，之後停在「持續傷害」那張，輕輕閃動
        const age = th.dur - th.t;
        const im = this.rootImgs[age < 0.45 ? Math.min(2, Math.floor(age / 0.15)) : 3];
        const w = th.r * PX_PER_UNIT * 2.1, h = (im.naturalHeight / im.naturalWidth) * w;
        g.globalAlpha = Math.min(1, th.t / 0.5) * (age < 0.45 ? 1 : 0.85 + 0.15 * Math.sin(t * 6 + th.x));
        g.drawImage(im, sx - w / 2, sy - h * 0.55, w, h);
        g.globalAlpha = 1;
        continue;
      }
      const rx = th.r * PX_PER_UNIT, ry = rx * 0.5;
      g.fillStyle = `rgba(90,120,50,${0.28 * a})`;
      g.beginPath(); g.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(110,75,40,${0.9 * a})`;
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        const ang = k * 2.39 + th.x, d = 0.25 + ((k * 0.37) % 0.7);
        const bx = sx + Math.cos(ang) * rx * d, by = sy + Math.sin(ang) * ry * d;
        const h = 10 + (k % 3) * 4, sway = Math.sin(t * 3 + k) * 3;
        g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + sway, by - h * 0.6, bx + sway * 1.5 + (k % 2 ? 4 : -4), by - h); g.stroke();
      }
      g.lineCap = 'butt';
    }
  }

  private drawTraps(g: CanvasRenderingContext2D): void {
    for (const tr of this.world.traps) {
      const [sx, sy] = toScreen(tr.x, tr.y);
      g.fillStyle = '#9a6a3a';
      g.beginPath(); g.ellipse(sx, sy, 9, 4.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#d9d2c4';
      for (const ox of [-5, 0, 5]) {
        g.beginPath(); g.moveTo(sx + ox - 2, sy); g.lineTo(sx + ox, sy - 7); g.lineTo(sx + ox + 2, sy); g.closePath(); g.fill();
      }
    }
  }

  /** 一閃而過的範圍效果：吼叫（黃）、治療（綠）、號角（紅）、陷阱觸發（棕） */
  private drawFx(g: CanvasRenderingContext2D): void {
    const color = { bark: '255,200,60', heal: '90,210,110', horn: '226,75,91', trap: '160,100,50', splash: '80,170,240' };
    for (const f of this.world.fx) {
      const [sx, sy] = toScreen(f.x, f.y);
      const a = Math.min(1, f.t / 0.3);
      g.strokeStyle = `rgba(${color[f.kind]},${0.7 * a})`;
      g.lineWidth = f.kind === 'horn' ? 1.5 : 2.5;
      g.beginPath(); g.ellipse(sx, sy, f.r * PX_PER_UNIT, f.r * PX_PER_UNIT * 0.5, 0, 0, Math.PI * 2); g.stroke();
      if (f.kind === 'heal') {
        g.fillStyle = `rgba(${color.heal},${a})`;
        g.fillRect(sx - 2, sy - 30, 4, 12); g.fillRect(sx - 6, sy - 26, 12, 4);
      }
    }
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
