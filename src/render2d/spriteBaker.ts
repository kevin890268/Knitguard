import * as THREE from 'three';
import { ELEVATION, PX_PER_UNIT } from './iso';

/** 預渲染圖：canvas ＋「地面原點」在圖上的位置（像素）。畫的時候縮小 SPRITE_SCALE 倍。 */
export interface Sprite {
  canvas: HTMLCanvasElement;
  /** 模型原點（腳底中心）在圖上的位置 */
  ax: number;
  ay: number;
  /** 模型最高點到原點的螢幕高度（像素，已除以 SPRITE_SCALE），放血條用 */
  top: number;
}

/** 預渲染時放大幾倍（拉近時才不會糊） */
export const SPRITE_SCALE = 2;

/**
 * 把 3D 模型「拍照」成 2D 圖片：正交鏡頭，角度和 2D 地圖的斜角完全一樣。
 * 單位拍 8 個方向；建築、樹、石頭各拍一張。全部在載入時做完，遊戲中只畫圖片。
 */
export class SpriteBaker {
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private view = new THREE.Matrix4();

  constructor() {
    this.gl = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.gl.setPixelRatio(1);
    this.gl.setClearColor(0x000000, 0);
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    // 燈光和 3D 版相同，太陽固定在世界中 → 單位轉向時明暗會跟著變，看起來是立體的
    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0x8a7a6a, 1.4));
    const sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
    sun.position.set(30, 60, 20);
    this.scene.add(sun);
    // 鏡頭在 +X +Z 方向、仰角 30°
    const d = new THREE.Vector3(Math.cos(ELEVATION) / Math.SQRT2, Math.sin(ELEVATION), Math.cos(ELEVATION) / Math.SQRT2);
    this.camera.position.copy(d.multiplyScalar(100));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.view.copy(this.camera.matrixWorldInverse);
  }

  /** 拍一張。obj 的原點要在腳底中心。 */
  bake(obj: THREE.Object3D): Sprite {
    this.scene.add(obj);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(this.view);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const pad = 0.05;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    const k = PX_PER_UNIT * SPRITE_SCALE;
    const w = Math.max(2, Math.ceil((maxX - minX) * k)), h = Math.max(2, Math.ceil((maxY - minY) * k));
    // 讓像素剛好對齊：依整數寬高回推鏡頭範圍
    maxX = minX + w / k; minY = maxY - h / k;
    Object.assign(this.camera, { left: minX, right: maxX, top: maxY, bottom: minY });
    this.camera.updateProjectionMatrix();
    this.gl.setSize(w, h, false);
    this.gl.render(this.scene, this.camera);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(this.gl.domElement, 0, 0);
    this.scene.remove(obj);
    const o = new THREE.Vector3(0, 0, 0).applyMatrix4(this.view);
    const ax = (o.x - minX) * k, ay = (maxY - o.y) * k;
    return { canvas, ax, ay, top: ay / SPRITE_SCALE };
  }

  /** 8 個方向（和模擬的 face 角度一致：第 i 張 = 轉 i×45°） */
  bakeDirections(obj: THREE.Object3D, dirs = 8): Sprite[] {
    const out: Sprite[] = [];
    const holder = new THREE.Group();
    holder.add(obj);
    for (let i = 0; i < dirs; i++) {
      obj.rotation.y = (i * Math.PI * 2) / dirs;
      out.push(this.bake(holder));
    }
    return out;
  }
}

/** 同一張圖疊上一層顏色（被打中時閃紅） */
export function tintSprite(s: Sprite, color: string, alpha: number): Sprite {
  const c = document.createElement('canvas');
  c.width = s.canvas.width; c.height = s.canvas.height;
  const g = c.getContext('2d')!;
  g.drawImage(s.canvas, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return { ...s, canvas: c };
}
