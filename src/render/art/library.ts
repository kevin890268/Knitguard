import * as THREE from 'three';
import { glbToModel, loadGlb, type GlbFile } from './glb';
import { inflate, makeCutout, makeTexture, type Cutout } from './imageTo3d';
import { ART_SLOTS, type ArtSlot } from './manifest';

export interface ArtModel {
  slot: ArtSlot;
  geometry: THREE.BufferGeometry;
  /** .glb 有多種材質時是陣列（每種材質一個 draw call） */
  material: THREE.Material | THREE.Material[];
  /** 只有圖片模型需要（陰影也要照 alpha 切輪廓） */
  depthMaterial?: THREE.MeshDepthMaterial;
  width: number;
  height: number;
  depth: number;
  source: 'glb' | 'image';
}

type ArtState = 'loading' | 'missing' | 'ok' | 'error';

interface Entry {
  state: ArtState;
  glb: GlbFile | null;
  img: HTMLImageElement | null;
  depthImg: HTMLImageElement | null;
  cut: Cutout | null;
  depthCut: Cutout | null;
  model: ArtModel | null;
  file: string;
}

const BASE = import.meta.env.BASE_URL + 'art/';
const MODELS = import.meta.env.BASE_URL + 'models/';
const EXTS = ['png', 'webp'];

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im.naturalWidth > 0 ? im : null);
    im.onerror = () => res(null);
    im.src = url;
  });
}

async function findImage(name: string, bust: string): Promise<{ img: HTMLImageElement; file: string } | null> {
  for (const ext of EXTS) {
    const file = `${name}.${ext}`;
    const img = await loadImage(BASE + file + bust);
    if (img) return { img, file };
  }
  return null;
}

/**
 * 美術庫：每個插槽依序找
 *   1. public/models/<id>.glb（Blender 或 AI 圖片轉 3D 工具做的模型）
 *   2. public/art/<id>.png / .webp（圖片充氣成布偶）
 *   3. 都沒有 → 用 models.ts 的程式模型
 * 檔案隨時可以換：開發者面板「重新載入」即可，不用重新整理。
 */
export class ArtLibrary {
  private entries = new Map<string, Entry>();
  private listeners: ((slot: ArtSlot) => void)[] = [];
  private loads = 0;

  constructor(private readonly knitCanvas: HTMLCanvasElement) {
    for (const s of ART_SLOTS) this.entries.set(s.id, { state: 'loading', glb: null, img: null, depthImg: null, cut: null, depthCut: null, model: null, file: '' });
  }

  onChange(fn: (slot: ArtSlot) => void): void {
    this.listeners.push(fn);
  }

  get(id: string): ArtModel | null {
    return this.entries.get(id)?.model ?? null;
  }

  forUnit(kind: number): ArtModel | null {
    const s = ART_SLOTS.find((o) => o.target.type === 'unit' && o.target.kind === kind);
    return s ? this.get(s.id) : null;
  }

  forBuilding(kind: number): ArtModel | null {
    const s = ART_SLOTS.find((o) => o.target.type === 'building' && o.target.kind === kind);
    return s ? this.get(s.id) : null;
  }

  status(): { id: string; 名稱: string; 狀態: string; 檔案: string; 第二張剪影: string; 三角形: number }[] {
    return ART_SLOTS.map((s) => {
      const e = this.entries.get(s.id)!;
      const g = e.model?.geometry;
      const tri = g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0;
      const label = {
        loading: '讀取中',
        missing: '沒有檔案（用程式模型）',
        ok: e.model?.source === 'glb' ? '✅ 3D 模型' : '✅ 圖片模型',
        error: e.glb ? '❌ 模型裡沒有網格' : '❌ 圖片裡找不到主體',
      }[e.state];
      return { id: s.id, 名稱: s.label, 狀態: label, 檔案: e.file, 第二張剪影: e.depthImg ? '有' : '', 三角形: tri };
    });
  }

  summary(): string {
    let ok = 0;
    for (const e of this.entries.values()) if (e.state === 'ok') ok++;
    return `${ok} / ${ART_SLOTS.length} 已套用`;
  }

  /** 讀取（或重新讀取）所有插槽的圖片。bust＝避開瀏覽器快取 */
  async loadAll(bust = false): Promise<void> {
    const q = bust ? `?v=${Date.now()}` : '';
    const n = ++this.loads;
    await Promise.all(ART_SLOTS.map(async (slot) => {
      const glb = await loadGlb(`${MODELS}${slot.id}.glb${q}`);
      const main = glb ? null : await findImage(slot.id, q);
      const other = main ? await findImage(`${slot.id}_${slot.view === 'front' ? 'side' : 'front'}`, q) : null;
      if (n !== this.loads) return; // 有更新的讀取在進行
      const e = this.entries.get(slot.id)!;
      e.glb = glb;
      e.img = main?.img ?? null;
      e.file = glb ? `models/${slot.id}.glb` : main ? `art/${main.file}` : '';
      e.depthImg = other?.img ?? null;
      e.cut = e.depthCut = null;
      this.rebuild(slot.id, true);
    }));
    console.info(`🎨 美術：${this.summary()}`);
    console.table(this.status());
  }

  /** 用目前插槽的參數重建模型（開發者面板調數值時會呼叫）。recut＝重新去背 */
  rebuild(id: string, recut = false): void {
    const slot = ART_SLOTS.find((s) => s.id === id);
    const e = this.entries.get(id);
    if (!slot || !e) return;
    const old = e.model;
    e.model = null;
    if (e.glb) {
      const r = glbToModel(e.glb, slot);
      e.model = r ? { slot, ...r, source: 'glb' } : null;
      e.state = r ? 'ok' : 'error';
    } else if (!e.img) {
      e.state = 'missing';
    } else {
      if (recut || !e.cut) {
        e.cut = makeCutout(e.img, slot.bgTolerance);
        e.depthCut = e.depthImg ? makeCutout(e.depthImg, slot.bgTolerance) : null;
      }
      if (!e.cut) {
        e.state = 'error';
      } else {
        const r = inflate(e.cut, e.depthCut, slot);
        const map = makeTexture(e.cut, this.knitCanvas, slot.knit, slot.height);
        const material = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, alphaToCoverage: true, roughness: 1, metalness: 0 });
        const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
        e.model = { slot, geometry: r.geometry, material, depthMaterial, width: r.width, height: r.height, depth: r.depth, source: 'image' };
        e.state = 'ok';
      }
    }
    for (const fn of this.listeners) fn(slot);
    if (old) {
      old.geometry.dispose();
      for (const m of Array.isArray(old.material) ? old.material : [old.material]) {
        // 圖片模型的貼圖是自己產生的，要一起釋放；.glb 的貼圖屬於檔案，重建時還會用到
        if (old.source === 'image') (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      }
      old.depthMaterial?.dispose();
    }
  }
}
