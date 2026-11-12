#!/usr/bin/env node
/**
 * 從一個大 .glb 切出其中一個物件，再減面 → 遊戲用的小 .glb
 * （例如 AI 工具把整張設定表做成一個模型時，只取其中一隻角色）
 *
 *   node tools/glb-extract.mjs <輸入.glb> --list
 *       列出模型裡的物件（相連的網格塊），依位置分群，方便決定要切哪一塊
 *   node tools/glb-extract.mjs <輸入.glb> <輸出.glb> --box=x0,x1,y0,y1 [--target=4000] [--error=0.02]
 *       保留「中心點落在 box 裡」的網格塊（X、Y 是模型座標），減面到約 target 個三角形
 *
 * 保留：位置、法線、UV、顏色貼圖、法線貼圖。粗糙度/金屬貼圖會丟掉（遊戲統一用霧面）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const [inFile, outFile] = positional;
if (!inFile) {
  console.error('用法：node tools/glb-extract.mjs <輸入.glb> --list\n      node tools/glb-extract.mjs <輸入.glb> <輸出.glb> --box=x0,x1,y0,y1 [--target=4000]');
  process.exit(1);
}

// ---------------------------------------------------------------- 讀 glb
const buf = readFileSync(inFile);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 glb 檔');
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
const binStart = 20 + jsonLen + 8;
const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));
if (gltf.extensionsRequired?.length) console.warn('⚠️ 這個檔案需要擴充：', gltf.extensionsRequired.join(', '));

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(i) {
  const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView], T = COMP[a.componentType], n = SIZE[a.type];
  const stride = bv.byteStride || n * T.BYTES_PER_ELEMENT;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new (T === Float32Array ? Float32Array : Uint32Array)(a.count * n);
  const view = new DataView(bin.buffer, bin.byteOffset);
  const read = { 5126: (o) => view.getFloat32(o, true), 5125: (o) => view.getUint32(o, true), 5123: (o) => view.getUint16(o, true), 5121: (o) => view.getUint8(o) }[a.componentType];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = read(base + k * stride + c * T.BYTES_PER_ELEMENT);
  return out;
}

// 把所有 primitive 合成一份（大多數 AI 模型只有一個）
let P = [], N = [], UV = [], I = [], vbase = 0, material = null;
for (const mesh of gltf.meshes) for (const prim of mesh.primitives) {
  const pos = accessor(prim.attributes.POSITION), cnt = pos.length / 3;
  const nor = prim.attributes.NORMAL !== undefined ? accessor(prim.attributes.NORMAL) : new Float32Array(cnt * 3);
  const uv = prim.attributes.TEXCOORD_0 !== undefined ? accessor(prim.attributes.TEXCOORD_0) : new Float32Array(cnt * 2);
  const idx = prim.indices !== undefined ? accessor(prim.indices) : Uint32Array.from({ length: cnt }, (_, i) => i);
  P.push(pos); N.push(nor); UV.push(uv); I.push(idx.map((v) => v + vbase));
  vbase += cnt;
  if (material === null && prim.material !== undefined) material = gltf.materials[prim.material];
}
const cat = (arrs, T) => { const out = new T(arrs.reduce((s, a) => s + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
const pos = cat(P, Float32Array), nor = cat(N, Float32Array), uv = cat(UV, Float32Array), idx = cat(I, Uint32Array);
const nTri = idx.length / 3;
console.log(`讀入：${nTri} 個三角形，${pos.length / 3} 個頂點`);

// ---------------------------------------------------------------- 找相連的網格塊（同位置的頂點視為同一點）
const weld = new Uint32Array(pos.length / 3);
let weldCount = 0;
{
  const map = new Map();
  for (let v = 0; v < weld.length; v++) {
    const key = `${Math.round(pos[v * 3] * 1e5)},${Math.round(pos[v * 3 + 1] * 1e5)},${Math.round(pos[v * 3 + 2] * 1e5)}`;
    let id = map.get(key);
    if (id === undefined) { id = map.size; map.set(key, id); }
    weld[v] = id;
  }
  weldCount = map.size;
}
const parent = new Int32Array(weldCount).map((_, i) => i);
const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
for (let t = 0; t < nTri; t++) {
  const a = find(weld[idx[t * 3]]), b = find(weld[idx[t * 3 + 1]]), c = find(weld[idx[t * 3 + 2]]);
  parent[b] = a; parent[find(c)] = a;
}
const comps = new Map();
for (let t = 0; t < nTri; t++) {
  const root = find(weld[idx[t * 3]]);
  let c = comps.get(root);
  if (!c) { c = { tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; comps.set(root, c); }
  c.tris.push(t);
  for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; for (let a = 0; a < 3; a++) { c.min[a] = Math.min(c.min[a], pos[v * 3 + a]); c.max[a] = Math.max(c.max[a], pos[v * 3 + a]); } }
}
const center = (c) => c.min.map((m, a) => (m + c.max[a]) / 2);

if (args.includes('--list')) {
  const list = [...comps.values()].sort((a, b) => b.tris.length - a.tris.length);
  console.log(`${list.length} 個網格塊（列出最大的 40 個）：`);
  for (const c of list.slice(0, 40)) {
    const [x, y, z] = center(c);
    console.log(`  中心 x=${x.toFixed(3)} y=${y.toFixed(3)} z=${z.toFixed(3)}  大小 ${(c.max[0] - c.min[0]).toFixed(3)}×${(c.max[1] - c.min[1]).toFixed(3)}  三角形 ${c.tris.length}`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------- 切出 box 裡的網格塊
const box = (opt('box') ?? '').split(',').map(Number);
if (box.length !== 4 || box.some(isNaN) || !outFile) { console.error('需要 <輸出.glb> 和 --box=x0,x1,y0,y1'); process.exit(1); }
const keepTris = [];
let keptComps = 0;
for (const c of comps.values()) {
  const [x, y] = center(c);
  if (x >= box[0] && x <= box[1] && y >= box[2] && y <= box[3]) { for (const t of c.tris) keepTris.push(t); keptComps++; }
}
if (!keepTris.length) { console.error('box 裡沒有任何網格塊，先用 --list 看位置'); process.exit(1); }
console.log(`切出：${keptComps} 個網格塊，${keepTris.length} 個三角形`);

// 壓縮成只含用到的頂點
function compact(triIndex) {
  const remap = new Map(), P2 = [], N2 = [], U2 = [], I2 = new Uint32Array(triIndex.length);
  for (let k = 0; k < triIndex.length; k++) {
    const v = triIndex[k];
    let nv = remap.get(v);
    if (nv === undefined) {
      nv = remap.size; remap.set(v, nv);
      P2.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); N2.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]); U2.push(uv[v * 2], uv[v * 2 + 1]);
    }
    I2[k] = nv;
  }
  return { P: new Float32Array(P2), N: new Float32Array(N2), U: new Float32Array(U2), I: I2 };
}
const sub = compact(keepTris.flatMap((t) => [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]]));

// ---------------------------------------------------------------- 減面（meshoptimizer；UV 接縫會保留）
await MeshoptSimplifier.ready;
const target = Number(opt('target') ?? 4000);
const errLimit = Number(opt('error') ?? 0.02);
let outIdx = sub.I;
if (sub.I.length / 3 > target) {
  const [simplified, err] = MeshoptSimplifier.simplifyWithAttributes(
    sub.I, sub.P, 3, sub.U, 2, [0.5, 0.5], null, target * 3, errLimit, [],
  );
  outIdx = simplified;
  console.log(`減面：${sub.I.length / 3} → ${outIdx.length / 3} 個三角形（相對誤差 ${err.toFixed(4)}）`);
}
// 再壓縮一次頂點
const remap = new Map(), FP = [], FN = [], FU = [], FI = new Uint32Array(outIdx.length);
for (let k = 0; k < outIdx.length; k++) {
  const v = outIdx[k];
  let nv = remap.get(v);
  if (nv === undefined) {
    nv = remap.size; remap.set(v, nv);
    FP.push(sub.P[v * 3], sub.P[v * 3 + 1], sub.P[v * 3 + 2]); FN.push(sub.N[v * 3], sub.N[v * 3 + 1], sub.N[v * 3 + 2]); FU.push(sub.U[v * 2], sub.U[v * 2 + 1]);
  }
  FI[k] = nv;
}

// ---------------------------------------------------------------- 寫出 glb（顏色貼圖 + 法線貼圖）
const chunks = [];
let offset = 0;
const addView = (data, target) => {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const view = { buffer: 0, byteOffset: offset, byteLength: b.length };
  if (target) view.target = target;
  chunks.push(b);
  offset += b.length;
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
  return view;
};
const bufferViews = [], accessors = [];
const addAccessor = (data, type, componentType, target, extra = {}) => {
  bufferViews.push(addView(data, target));
  accessors.push({ bufferView: bufferViews.length - 1, componentType, count: data.length / SIZE[type], type, ...extra });
  return accessors.length - 1;
};
const fp = new Float32Array(FP);
const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < fp.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], fp[i + a]); mx[a] = Math.max(mx[a], fp[i + a]); }
const aPos = addAccessor(fp, 'VEC3', 5126, 34962, { min: mn, max: mx });
const aNor = addAccessor(new Float32Array(FN), 'VEC3', 5126, 34962);
const aUv = addAccessor(new Float32Array(FU), 'VEC2', 5126, 34962);
const aIdx = addAccessor(FI, 'SCALAR', 5125, 34963);

// 貼圖：只帶顏色和法線
const images = [], textures = [];
const copyTexture = (texInfo) => {
  if (!texInfo) return undefined;
  const tex = gltf.textures[texInfo.index], img = gltf.images[tex.source], bv = gltf.bufferViews[img.bufferView];
  const data = new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength);
  bufferViews.push(addView(data));
  images.push({ bufferView: bufferViews.length - 1, mimeType: img.mimeType });
  textures.push({ source: images.length - 1, sampler: 0 });
  return { index: textures.length - 1 };
};
const mat = { name: 'extracted', pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 } };
const base = copyTexture(material?.pbrMetallicRoughness?.baseColorTexture);
if (base) mat.pbrMetallicRoughness.baseColorTexture = base;
if (material?.pbrMetallicRoughness?.baseColorFactor) mat.pbrMetallicRoughness.baseColorFactor = material.pbrMetallicRoughness.baseColorFactor;
const normal = copyTexture(material?.normalTexture);
if (normal) mat.normalTexture = normal;

const out = {
  asset: { version: '2.0', generator: 'Knitguard glb-extract' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: path.basename(outFile, '.glb') }],
  meshes: [{ primitives: [{ attributes: { POSITION: aPos, NORMAL: aNor, TEXCOORD_0: aUv }, indices: aIdx, material: 0 }] }],
  materials: [mat], accessors, bufferViews, buffers: [{ byteLength: offset }],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
  ...(images.length ? { images, textures } : {}),
};
const padTo4 = (b, fill) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);
const jsonBuf = padTo4(Buffer.from(JSON.stringify(out)), 0x20);
const binBuf = padTo4(Buffer.concat(chunks), 0);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
const chunk = (b, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, b]); };
mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
const file = Buffer.concat([header, chunk(jsonBuf, 0x4e4f534a), chunk(binBuf, 0x004e4942)]);
writeFileSync(outFile, file);
console.log(`輸出 ${outFile}：${FI.length / 3} 個三角形，${(file.length / 1024 / 1024).toFixed(1)} MB，大小 ${(mx[0] - mn[0]).toFixed(3)}×${(mx[1] - mn[1]).toFixed(3)}×${(mx[2] - mn[2]).toFixed(3)}`);
