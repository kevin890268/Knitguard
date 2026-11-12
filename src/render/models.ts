import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { UnitModel } from '../sim/data';
import { BK } from '../sim/data';
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

/** 單位模型（大小約 1 格，朝 +Z 方向）。白色部分會被 instance 顏色染色。 */
export function unitGeometry(model: UnitModel): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (model === 'sheep') {
    parts.push(part(new THREE.IcosahedronGeometry(0.5, 1), 0xffffff, M(0, 0.5, 0, 0.9, 0.75, 1.1)));
    parts.push(part(new THREE.IcosahedronGeometry(0.22, 1), 0x3a3030, M(0, 0.62, 0.55, 1, 1.1, 1)));
    for (const [x, z] of [[-0.22, 0.25], [0.22, 0.25], [-0.22, -0.25], [0.22, -0.25]]) {
      parts.push(part(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 5), 0x3a3030, M(x, 0.15, z)));
    }
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

/** 建築模型：每棟一個 Group（建築數量少，不需要 instancing）。 */
export function buildingMesh(kind: number, level: number, color: number, mats: WoolMaterials): THREE.Group {
  const g = new THREE.Group();
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
