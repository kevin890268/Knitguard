import { isTyping } from '../render/camera';

/**
 * 45 度斜角（2:1 等角）投影：方格地圖畫成菱形。
 * 世界座標 (x, y) 一單位 = 一格；h = 離地高度（世界單位）。
 *
 *   螢幕 x = (x − y) × TILE_W/2
 *   螢幕 y = (x + y) × TILE_H/2 − h × HEIGHT_PX
 *
 * 和 3D 版的對應：世界 x → Three 的 X，世界 y → Three 的 Z，鏡頭從 +X +Z 方向、仰角 30° 往下看。
 */
export const TILE_W = 64;
export const TILE_H = 32;
/** 地面上每個世界單位（沿菱形對角線）是幾個像素 */
export const PX_PER_UNIT = TILE_W / Math.SQRT2;
/** 往上 1 單位在螢幕上是幾個像素（仰角 30°） */
export const HEIGHT_PX = PX_PER_UNIT * Math.cos(Math.PI / 6);
/** 鏡頭仰角（等角 2:1 → 30°） */
export const ELEVATION = Math.PI / 6;

export function toScreen(x: number, y: number, h = 0): [number, number] {
  return [(x - y) * (TILE_W / 2), (x + y) * (TILE_H / 2) - h * HEIGHT_PX];
}

/** 螢幕（世界像素座標）→ 地面上的世界座標 */
export function toWorld(sx: number, sy: number): [number, number] {
  const a = sx / (TILE_W / 2), b = sy / (TILE_H / 2);
  return [(a + b) / 2, (b - a) / 2];
}

/**
 * 2D 鏡頭：方向鍵平移、滾輪縮放（以滑鼠為中心）、右鍵或中鍵拖曳平移。
 * 介面和 3D 的 RtsCamera 一樣有 update() 和 pick()，main.ts 不用分兩套。
 */
export class IsoCamera {
  /** 鏡頭中心（世界座標） */
  cx = 48;
  cy = 48;
  zoom = 1;
  minZoom = 0.35;
  maxZoom = 2.2;
  bounds = { w: 256, h: 256 };
  /** 相容 3D 鏡頭的欄位（main.ts 用它設定開場位置） */
  readonly target = { set: (x: number, _y: number, z: number) => { this.cx = x; this.cy = z; } };

  /** WASD 能不能移動鏡頭（main.ts 設成「沒選部隊時」） */
  allowWasd: () => boolean = () => true;
  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private readonly dom: HTMLCanvasElement) {
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      // 以滑鼠位置為中心縮放
      const before = this.screenToWorld(e.clientX, e.clientY);
      this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * Math.pow(0.9985, e.deltaY)));
      const after = this.screenToWorld(e.clientX, e.clientY);
      this.cx += before[0] - after[0];
      this.cy += before[1] - after[1];
    }, { passive: false });
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        dom.setPointerCapture(e.pointerId);
      }
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = (e.clientX - this.lastX) / this.zoom, dy = (e.clientY - this.lastY) / this.zoom;
      const [wx, wy] = toWorld(dx, dy);
      this.cx -= wx;
      this.cy -= wy;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    dom.addEventListener('pointerup', (e) => {
      if (e.button === 1 || e.button === 2) this.dragging = false;
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => { if (!isTyping(e)) this.keys.add(e.key.toLowerCase()); });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  update(dt: number): void {
    const k = this.keys;
    // 螢幕上的上下左右 → 世界方向
    let sx = 0, sy = 0;
    // 方向鍵隨時可以；WASD 只在 allowWasd()（沒選部隊）時移動，選了部隊 A/S 是指令
    const wasd = this.allowWasd();
    if (k.has('arrowup') || (wasd && k.has('w'))) sy -= 1;
    if (k.has('arrowdown') || (wasd && k.has('s'))) sy += 1;
    if (k.has('arrowright') || (wasd && k.has('d'))) sx += 1;
    if (k.has('arrowleft') || (wasd && k.has('a'))) sx -= 1;
    if (sx || sy) {
      const spd = (900 * dt) / this.zoom;
      const [wx, wy] = toWorld(sx * spd, sy * spd * 0.75);
      this.cx += wx;
      this.cy += wy;
    }
    this.cx = Math.min(this.bounds.w, Math.max(0, this.cx));
    this.cy = Math.min(this.bounds.h, Math.max(0, this.cy));
  }

  /** 世界像素座標的原點在螢幕上的位置（畫的時候用） */
  originOnScreen(): [number, number] {
    const [sx, sy] = toScreen(this.cx, this.cy);
    const r = this.dom.getBoundingClientRect();
    return [r.width / 2 - sx * this.zoom, r.height / 2 - sy * this.zoom];
  }

  screenToWorld(clientX: number, clientY: number): [number, number] {
    const r = this.dom.getBoundingClientRect();
    const [ox, oy] = this.originOnScreen();
    return toWorld((clientX - r.left - ox) / this.zoom, (clientY - r.top - oy) / this.zoom);
  }

  /** 世界座標（x, y＝地面、h＝高度）→ 螢幕座標（選取部隊用） */
  worldToClient(x: number, y: number, h = 0): [number, number] {
    const r = this.dom.getBoundingClientRect();
    const [ox, oy] = this.originOnScreen();
    const [sx, sy] = toScreen(x, y, h);
    return [r.left + ox + sx * this.zoom, r.top + oy + sy * this.zoom];
  }

  /** 和 3D 鏡頭相同的介面：滑鼠 → 地面點（x, z 是世界 x, y） */
  pick(clientX: number, clientY: number): { x: number; y: number; z: number } {
    const [x, y] = this.screenToWorld(clientX, clientY);
    return { x, y: 0, z: y };
  }
}
