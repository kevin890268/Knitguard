import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { UnitModel } from '../sim/data';
import { BK, BUILDING_KINDS } from '../sim/data';
import type { ArtModel } from './art/library';
import type { WoolMaterials } from './wool';

/** 把一個零件轉成非索引幾何、套上變換並寫入頂點色，方便合併成單一網格。 */
function part(g: THREE.BufferGeometry, color: number, m: THREE.Matrix4): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.applyMatrix4(m);
  const n = ng.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

const M = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry),
    new THREE.Vector3(sx, sy, sz),
  );

/** 和 M 一樣，但可以繞三個軸旋轉（XYZ 順序）。 */
const MR = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rx: number, ry: number, rz: number) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );

/** 羊人村民的配色（米白、奶油、淺棕、灰褐） */
const SV = {
  wool: 0xf3ead6, // 頭上羊毛
  woolShade: 0xe6d9bf, // 後面的羊毛，稍暗
  skin: 0xf2d6c4, // 臉
  ear: 0xe9bfa9, // 耳朵
  eye: 0x2e2420,
  nose: 0xd8908a,
  horn: 0x9b7552,
  shirt: 0xf1e4cb,
  shorts: 0x7d5c40,
  belt: 0x5e4330,
  leg: 0xeadcc4,
  hoof: 0x4a3426,
};

/**
 * 擬人化羊人村民（約 1.2 高，腳底在 y=0，面向 +Z）。
 * 頭身約 1:1.4，大頭但不到 Q 版。全部用低段數幾何體組合，最後合併成一個 BufferGeometry。
 */
function sheepVillager(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, c: number, m: THREE.Matrix4) => p.push(part(g, c, m));
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const blob = (r: number) => new THREE.IcosahedronGeometry(r, 0); // 20 面，邊角明顯

  // --- 腿與蹄（腳底貼地 y=0）
  for (const s of [-1, 1]) {
    add(box(0.13, 0.08, 0.16), SV.hoof, M(s * 0.09, 0.04, 0.01));
    add(box(0.11, 0.17, 0.12), SV.leg, M(s * 0.09, 0.165, 0));
  }
  // --- 短褲、腰帶
  add(new THREE.CylinderGeometry(0.17, 0.18, 0.13, 6), SV.shorts, M(0, 0.3, 0));
  add(new THREE.CylinderGeometry(0.165, 0.165, 0.035, 6), SV.belt, M(0, 0.375, 0));
  // --- 上衣（上窄下寬的六角柱）
  add(new THREE.CylinderGeometry(0.13, 0.165, 0.24, 6), SV.shirt, M(0, 0.5, 0));
  add(box(0.08, 0.05, 0.02), SV.belt, M(0, 0.56, 0.135)); // 領口的交叉綁帶（簡化成一條）
  // --- 手臂（袖子 + 蹄手），稍微往外張
  for (const s of [-1, 1]) {
    add(box(0.085, 0.2, 0.1), SV.shirt, MR(s * 0.19, 0.5, 0, 1, 1, 1, 0, 0, s * 0.28));
    add(box(0.075, 0.07, 0.085), SV.hoof, MR(s * 0.225, 0.375, 0.005, 1, 1, 1, 0, 0, s * 0.28));
  }
  // --- 小尾巴
  add(blob(0.06), SV.wool, M(0, 0.34, -0.19));

  // --- 頭：臉
  const hy = 0.86;
  add(blob(0.2), SV.skin, M(0, hy - 0.02, 0.02, 1.0, 0.92, 0.9));
  // 眼睛、鼻子
  for (const s of [-1, 1]) add(box(0.04, 0.07, 0.03), SV.eye, M(s * 0.075, hy - 0.02, 0.185));
  add(box(0.035, 0.02, 0.02), SV.nose, M(0, hy - 0.085, 0.19));
  // 羊毛：一圈蓬鬆的毛團包住頭頂、後腦和兩側，前面留出臉
  const tufts: [number, number, number, number, number][] = [
    // x, y, z, 半徑, 顏色(0=亮 1=暗)
    [0, hy + 0.15, 0.02, 0.15, 0],
    [-0.12, hy + 0.12, 0.05, 0.12, 0],
    [0.12, hy + 0.12, 0.05, 0.12, 0],
    [-0.05, hy + 0.11, 0.13, 0.09, 0], // 瀏海
    [0.06, hy + 0.1, 0.13, 0.085, 0],
    [0, hy + 0.08, -0.13, 0.16, 1], // 後腦
    [-0.17, hy - 0.04, -0.02, 0.11, 1],
    [0.17, hy - 0.04, -0.02, 0.11, 1],
    [-0.15, hy - 0.13, 0.03, 0.08, 0], // 臉頰兩側垂下的毛
    [0.15, hy - 0.13, 0.03, 0.08, 0],
    [0, hy - 0.08, -0.12, 0.12, 1],
  ];
  for (const [x, y, z, r, shade] of tufts) {
    add(blob(r), shade ? SV.woolShade : SV.wool, MR(x, y, z, 1, 0.9, 1, x * 3, y * 5, z * 4)); // 每團轉一點角度，不會太整齊
  }
  // 耳朵：往兩側伸出、稍微下垂的扁錐
  for (const s of [-1, 1]) {
    add(new THREE.ConeGeometry(0.085, 0.26, 4), SV.ear, MR(s * 0.31, hy - 0.01, 0.05, 1, 1, 0.4, 0, 0, -s * (Math.PI / 2 + 0.3)));
  }
  // 羊角：左右各一個 3/4 圈的捲角，低段數環，長在羊毛外側
  for (const s of [-1, 1]) {
    add(new THREE.TorusGeometry(0.075, 0.034, 4, 7, Math.PI * 1.5), SV.horn, MR(s * 0.235, hy + 0.12, -0.03, 1, 1, 1, 0, s * Math.PI / 2, s * 0.9));
  }

  const g = mergeGeometries(p)!;
  g.computeVertexNormals(); // 非索引幾何 → 每個三角形自己的法線 → 平面著色、邊角分明
  return g;
}

/** 單位模型（大小約 1 格，朝 +Z 方向）。白色部分會被 instance 顏色染色。 */
export function unitGeometry(model: UnitModel): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (model === 'sheep') {
    return sheepVillager();
  } else {
    parts.push(part(new THREE.IcosahedronGeometry(0.5, 1), 0xffffff, M(0, 0.5, 0, 1, 0.9, 1)));
    for (const s of [-1, 1]) {
      parts.push(part(new THREE.IcosahedronGeometry(0.13, 1), 0xffffff, M(s * 0.17, 0.66, 0.4)));
      parts.push(part(new THREE.IcosahedronGeometry(0.065, 1), 0x111111, M(s * 0.17, 0.66, 0.51)));
      parts.push(part(new THREE.ConeGeometry(0.08, 0.3, 5), 0xffffff, M(s * 0.25, 0.98, 0, 1, 1, 1)));
    }
  }
  return mergeGeometries(parts)!;
}

export function treeGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.08, 0.11, 0.5, 6), 0x8a6a4a, M(0, 0.25, 0)),
    part(new THREE.IcosahedronGeometry(0.4, 1), 0x6fae5c, M(0, 0.7, 0)),
    part(new THREE.IcosahedronGeometry(0.27, 1), 0x86c46e, M(0.05, 1.02, 0.03)),
  ])!;
}

/** 用圖片充氣出來的建築：縮放到剛好放進佔地範圍，等級越高稍微大一點。 */
function artBuilding(g: THREE.Group, art: ArtModel, size: number, level: number): void {
  const m = new THREE.Mesh(art.geometry, art.material);
  m.customDepthMaterial = art.depthMaterial;
  m.castShadow = m.receiveShadow = true;
  const fit = Math.min(1, (size * 1.02) / Math.max(art.width, art.depth));
  m.scale.setScalar(fit * (1 + (level - 1) * 0.08));
  m.rotation.y = art.slot.yaw ?? 0;
  g.add(m);
}

/** 建築模型：每棟一個 Group（建築數量少，不需要 instancing）。有圖片就用圖片做的模型。 */
export function buildingMesh(kind: number, level: number, color: number, mats: WoolMaterials, art?: ArtModel | null): THREE.Group {
  const g = new THREE.Group();
  if (art) {
    artBuilding(g, art, BUILDING_KINDS[kind].size, level);
    for (let i = 1; i < level; i++) {
      const bead = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), mats.get(0xffd54a));
      bead.position.set(-0.3 + i * 0.2, 0.12, BUILDING_KINDS[kind].size / 2 + 0.05);
      g.add(bead);
    }
    return g;
  }
  const add = (geo: THREE.BufferGeometry, c: number, x: number, y: number, z: number, flat = false) => {
    const m = new THREE.Mesh(geo, mats.get(c, { flat }));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const wood = 0xc9a27a;
  switch (kind) {
    case BK.Base: {
      add(new THREE.CylinderGeometry(1.45, 1.45, 0.3, 24), wood, 0, 0.15, 0);
      add(new THREE.CylinderGeometry(1.15, 1.15, 1.8, 24), color, 0, 1.2, 0);
      add(new THREE.CylinderGeometry(1.45, 1.45, 0.3, 24), wood, 0, 2.25, 0);
      add(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), 0x6b4a2a, 0, 3.1, 0);
      add(new THREE.BoxGeometry(0.6, 0.35, 0.04), 0xe24b5b, 0.32, 3.6, 0);
      break;
    }
    case BK.Wall: {
      add(new THREE.BoxGeometry(0.96, 0.7 + level * 0.12, 0.96), color, 0, (0.7 + level * 0.12) / 2, 0);
      break;
    }
    case BK.Tower: {
      const h = 1.0 + level * 0.35;
      add(new THREE.CylinderGeometry(0.45, 0.45, 0.18, 16), wood, 0, 0.09, 0);
      add(new THREE.CylinderGeometry(0.34, 0.34, h, 16), color, 0, 0.18 + h / 2, 0);
      add(new THREE.CylinderGeometry(0.45, 0.45, 0.14, 16), wood, 0, 0.25 + h, 0);
      add(new THREE.ConeGeometry(0.42, 0.5, 8), 0xe07a6a, 0, 0.57 + h, 0);
      break;
    }
    case BK.Barracks: {
      add(new THREE.BoxGeometry(1.8, 0.9, 1.8), color, 0, 0.45, 0);
      const roof = add(new THREE.ConeGeometry(1.45, 0.8 + level * 0.15, 4), 0xd98c5f, 0, 1.3 + level * 0.07, 0, true);
      roof.rotation.y = Math.PI / 4;
      add(new THREE.BoxGeometry(0.5, 0.55, 0.05), 0x6b4a2a, 0, 0.28, 0.91);
      break;
    }
  }
  // 等級標記：小毛球
  for (let i = 1; i < level; i++) {
    add(new THREE.IcosahedronGeometry(0.1, 1), 0xffd54a, -0.3 + i * 0.2, 0.12, kind === BK.Base ? 1.5 : 0.55);
  }
  return g;
}
