import * as THREE from 'three';

/**
 * RTS 攝影機：方向鍵平移、滾輪縮放、右鍵(或中鍵)拖曳旋轉、Q/E 轉向。
 */
export class RtsCamera {
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.5, 600);
  readonly target = new THREE.Vector3();
  dist = 42;
  yaw = Math.PI * 0.25;
  pitch = 0.95;
  bounds = { w: 256, h: 256 };

  /** WASD 能不能移動鏡頭（main.ts 設成「沒選部隊時」） */
  allowWasd: () => boolean = () => true;
  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(private readonly dom: HTMLElement) {
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.min(110, Math.max(8, this.dist * Math.pow(1.0015, e.deltaY)));
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
      this.yaw -= (e.clientX - this.lastX) * 0.006;
      this.pitch = Math.min(1.45, Math.max(0.35, this.pitch + (e.clientY - this.lastY) * 0.004));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    dom.addEventListener('pointerup', (e) => {
      if (e.button === 1 || e.button === 2) this.dragging = false;
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.key.toLowerCase());
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  update(dt: number): void {
    const k = this.keys;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); // 地面上的「前方」
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let mx = 0, mz = 0;
    // 方向鍵隨時可以；WASD 只在 allowWasd()（沒選部隊）時移動，選了部隊 A/S 是指令
    const wasd = this.allowWasd();
    if (k.has('arrowup') || (wasd && k.has('w'))) { mx += fx; mz += fz; }
    if (k.has('arrowdown') || (wasd && k.has('s'))) { mx -= fx; mz -= fz; }
    if (k.has('arrowright') || (wasd && k.has('d'))) { mx += rx; mz += rz; }
    if (k.has('arrowleft') || (wasd && k.has('a'))) { mx -= rx; mz -= rz; }
    if (k.has('q')) this.yaw += dt * 1.8;
    if (k.has('e')) this.yaw -= dt * 1.8;
    const spd = this.dist * 0.9 * dt;
    this.target.x = Math.min(this.bounds.w, Math.max(0, this.target.x + mx * spd));
    this.target.z = Math.min(this.bounds.h, Math.max(0, this.target.z + mz * spd));

    const c = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + this.dist * c * Math.sin(this.yaw),
      this.dist * Math.sin(this.pitch),
      this.target.z + this.dist * c * Math.cos(this.yaw),
    );
    this.camera.lookAt(this.target);
  }

  /** 螢幕座標 → 地面 (y=0) 上的點 */
  pick(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, out);
  }

  /** 世界座標（x, y＝地面、h＝高度）→ 螢幕座標（選取部隊用） */
  worldToClient(x: number, y: number, h = 0): [number, number] {
    const r = this.dom.getBoundingClientRect();
    const v = this.tmpV.set(x, h, y).project(this.camera);
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
  }
  private tmpV = new THREE.Vector3();
}

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}
