import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { ArtSlot } from './manifest';

/**
 * 讀 .glb 模型（Blender、AI 圖片轉 3D 工具匯出的），整理成 InstancedMesh 能用的樣子：
 *   - 所有網格合併成「一個幾何」；每種材質一個 group → 每種材質一個 draw call，不管幾千隻
 *   - 自動置中、腳底貼地、縮放到插槽的高度
 *   - 面向：glTF 的前方是 +Z，和遊戲一致（Blender 裡角色面向 -Y＝正視圖看得到臉 就對了）
 */

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export interface GlbFile {
  scene: THREE.Object3D;
}

export async function loadGlb(url: string): Promise<GlbFile | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // Vite 對不存在的檔案會回 index.html；glb 檔頭一定是 "glTF"
    if (buf.byteLength < 12 || new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'glTF') return null;
    const gltf = await loader.parseAsync(buf, url.substring(0, url.lastIndexOf('/') + 1));
    return { scene: gltf.scene };
  } catch (e) {
    console.warn(`🎨 讀不了 ${url}：`, e, '\n（如果是 Draco 壓縮，請在 Blender 匯出時關掉 Compression）');
    return null;
  }
}

export interface GlbModel {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  width: number;
  height: number;
  depth: number;
}

/** 把整個場景攤平成一個幾何（每種材質一個 group）。 */
export function glbToModel(file: GlbFile, slot: ArtSlot): GlbModel | null {
  const scene = file.scene;
  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) meshes.push(o as THREE.Mesh); });
  if (!meshes.length) return null;

  // 先把每個網格依材質拆開，同材質的放一起
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const mesh of meshes) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const src = mesh.geometry;
    const groups = src.groups.length && Array.isArray(mesh.material)
      ? src.groups
      : [{ start: 0, count: src.index ? src.index.count : src.attributes.position.count, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0];
      if (!mat) continue;
      const g = extractRange(src, gr.start, gr.count);
      g.applyMatrix4(mesh.matrixWorld);
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat)!.push(g);
    }
  }

  // 每個幾何的屬性要一致才能合併：position、normal、uv、color
  const all = [...byMat.values()].flat();
  const hasUv = all.some((g) => g.attributes.uv);
  const hasColor = all.some((g) => g.attributes.color);
  const parts: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  for (const [mat, geos] of byMat) {
    for (const g of geos) normalizeAttributes(g, hasUv, hasColor);
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    parts.push(merged);
    materials.push(prepareMaterial(mat, hasColor));
  }
  const geometry = mergeGeometries(parts, true);
  if (!geometry) return null;

  // 轉向、置中、腳底貼地、縮放到指定高度
  if (slot.modelYaw) geometry.rotateY(slot.modelYaw);
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  const s = slot.height / Math.max(1e-6, size.y);
  geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geometry.scale(s, s, s);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.art = true;

  const tris = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
  if (tris > 5000) console.warn(`🎨 ${slot.id}.glb 有 ${tris} 個三角形，單位建議 3000 以下（Blender：Decimate 修改器）`);

  return {
    geometry,
    material: materials.length === 1 ? materials[0] : materials,
    width: size.x * s,
    height: slot.height,
    depth: size.z * s,
  };
}

/** 取出幾何中的一段（一個材質 group），變成獨立的幾何。 */
function extractRange(src: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const a = src.attributes[name];
    if (a) g.setAttribute(name, a.clone());
  }
  if (src.index) {
    const idx = src.index.array.slice(start, start + count);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  } else if (start !== 0 || count !== src.attributes.position.count) {
    // 非索引：直接用連續的頂點範圍
    const out = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(g.attributes)) {
      const attr = a as THREE.BufferAttribute;
      out.setAttribute(name, new THREE.BufferAttribute(attr.array.slice(start * attr.itemSize, (start + count) * attr.itemSize), attr.itemSize, attr.normalized));
    }
    return out;
  }
  // 統一成非索引，避免有的有 index 有的沒有而無法合併
  return g.index ? g.toNonIndexed() : g;
}

function normalizeAttributes(g: THREE.BufferGeometry, hasUv: boolean, hasColor: boolean): void {
  const n = g.attributes.position.count;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (hasUv && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (hasColor) {
    const c = g.attributes.color;
    if (!c) {
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    } else if (c.itemSize !== 3 || c.normalized || !(c.array instanceof Float32Array)) {
      // 統一成 float RGB
      const out = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { out[i * 3] = c.getX(i); out[i * 3 + 1] = c.getY(i); out[i * 3 + 2] = c.getZ(i); }
      g.setAttribute('color', new THREE.BufferAttribute(out, 3));
    }
  }
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
  }
}

/** 統一成毛線風的霧面材質；保留原本的顏色和貼圖。 */
function prepareMaterial(src: THREE.Material, vertexColors: boolean): THREE.Material {
  const s = src as THREE.MeshStandardMaterial;
  const m = new THREE.MeshStandardMaterial({
    color: s.color ? s.color.clone() : new THREE.Color(0xffffff),
    map: s.map ?? null,
    normalMap: s.normalMap ?? null,
    alphaTest: s.alphaTest || (s.transparent && s.map ? 0.5 : 0),
    roughness: 0.95,
    metalness: 0,
    vertexColors: vertexColors && !!(s as THREE.MeshStandardMaterial).vertexColors,
    side: s.side,
  });
  m.name = s.name;
  return m;
}
