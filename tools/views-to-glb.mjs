#!/usr/bin/env node
/**
 * 多視角設定圖 → 低多邊形 .glb（不需要任何套件，只用 Node 內建模組）
 *
 *   node tools/views-to-glb.mjs <圖片資料夾> <輸出.glb> [--res=30] [--fine=5] [--tol=32] [--slack=2]
 *   node tools/views-to-glb.mjs <圖片資料夾> <輸出.glb> --mesh=<沒貼圖的模型.glb> [--yaw=0]
 *       只上色：形狀用現成的模型（例如 AI 工具做的低面數模型），顏色從各角度的圖投影上去
 *
 * 資料夾裡放同一個角色、同一個大小的正交視圖（缺的可以省略，front 和 side 至少要有）：
 *   front.png    正面
 *   front45.png  右前 45°（臉朝畫面右邊）
 *   side.png     右側（臉朝畫面右邊）
 *   back45.png   右後 45°
 *   back.png     背面
 * 左半邊的角度用右半邊的圖鏡像補上（假設角色大致左右對稱）。
 *
 * 做法：
 *   1. 每張圖去背、裁到剛好包住角色、縮放到同樣高度
 *   2. 雕刻：在空間裡放滿小方塊，從每個角度看，落在剪影外的就削掉（visual hull）
 *   3. 把細方塊平均成粗網格的密度，用 surface nets 取出表面 → 面數可控的低多邊形
 *   4. 每個面從「最正對它」的那幾張圖取顏色（頂點色、平面著色）→ 像紙雕的低多邊形
 *   5. 輸出 glTF Binary：面向 +Z、腳底 y=0、高度 1
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';

// ---------------------------------------------------------------- 參數
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : def;
};
if (positional.length < 2) {
  console.error('用法：node tools/views-to-glb.mjs <圖片資料夾> <輸出.glb> [--res=30] [--fine=5] [--tol=32] [--slack=2]');
  process.exit(1);
}
const [srcDir, outFile] = positional;
const RES = flag('res', 30); // 粗網格高度（決定面數）
const FINE = flag('fine', 5); // 雕刻時每個粗格切幾份（越高形狀越準）
const TOL = flag('tol', 32); // 去背容差
const SLACK = flag('slack', 2); // 剪影放寬幾個像素（各角度對不齊時避免削太多）
const BLUR = flag('blur', 2); // 取色前模糊半徑（像素）
const FOOT = flag('foot', 0.04); // 腳底這段高度內，只保留和上方腳掌同寬的部分（去掉圖上的地面陰影）

// ---------------------------------------------------------------- PNG 解碼
function readPng(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} 不是 PNG`);
  let o = 8, w = 0, h = 0, bd = 0, ct = 0, il = 0, plte = null, trns = null;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8), data = b.subarray(o + 8, o + 8 + len);
    o += 12 + len;
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; il = data[12]; }
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (bd !== 8 || il !== 0) throw new Error(`${file}：只支援 8-bit、非交錯的 PNG`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch, px = new Uint8Array(w * h * ch);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, up = prev[i], c = i >= ch ? prev[i - ch] : 0, x = line[i];
      let v;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + up; break;
        case 3: v = x + ((a + up) >> 1); break;
        default: {
          const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
        }
      }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch, d = i * 4;
    if (ct === 6) { rgba[d] = px[s]; rgba[d + 1] = px[s + 1]; rgba[d + 2] = px[s + 2]; rgba[d + 3] = px[s + 3]; }
    else if (ct === 2) { rgba[d] = px[s]; rgba[d + 1] = px[s + 1]; rgba[d + 2] = px[s + 2]; rgba[d + 3] = 255; }
    else if (ct === 0) { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = 255; }
    else if (ct === 4) { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = px[s + 1]; }
    else { const k = px[s]; rgba[d] = plte[k * 3]; rgba[d + 1] = plte[k * 3 + 1]; rgba[d + 2] = plte[k * 3 + 2]; rgba[d + 3] = trns && k < trns.length ? trns[k] : 255; }
  }
  return { w, h, rgba };
}

// ---------------------------------------------------------------- 去背、主體、裁切
function cutout(img) {
  const { w: W, h: H, rgba: d } = img;
  let transparent = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) transparent++;
  const inside = new Uint8Array(W * H);
  if (transparent > W * H * 0.01) {
    for (let i = 0; i < W * H; i++) inside[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
  } else {
    // 底色＝邊框中位數；從邊框洪水填充
    const rs = [], gs = [], bs = [];
    const push = (x, y) => { const o = (y * W + x) * 4; rs.push(d[o]); gs.push(d[o + 1]); bs.push(d[o + 2]); };
    for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
    for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
    const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    const br = med(rs), bg = med(gs), bb = med(bs);
    const near = (i) => { const o = i * 4; return Math.hypot(d[o] - br, d[o + 1] - bg, d[o + 2] - bb) <= TOL; };
    const bgMask = new Uint8Array(W * H), stack = [];
    const seed = (i) => { if (!bgMask[i] && near(i)) { bgMask[i] = 1; stack.push(i); } };
    for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      if (x > 0) seed(i - 1); if (x < W - 1) seed(i + 1); if (y > 0) seed(i - W); if (y < H - 1) seed(i + W);
    }
    for (let i = 0; i < W * H; i++) inside[i] = bgMask[i] ? 0 : 1;
  }
  // 只留最大的連通塊和不小的塊
  const label = new Int32Array(W * H), areas = [0], stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!inside[s] || label[s]) continue;
    const id = areas.length; let area = 0;
    label[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0; area++;
      const v = (j) => { if (inside[j] && !label[j]) { label[j] = id; stack.push(j); } };
      if (x > 0) v(i - 1); if (x < W - 1) v(i + 1); if (y > 0) v(i - W); if (y < H - 1) v(i + W);
    }
    areas.push(area);
  }
  const maxA = Math.max(...areas);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < W * H; i++) {
    if (inside[i] && areas[label[i]] < maxA * 0.03) inside[i] = 0;
    if (inside[i]) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new Error('圖片裡找不到角色');
  // 顏色往外延伸幾圈（取色時剛好落在輪廓外也拿得到邊緣顏色）
  const col = new Uint8ClampedArray(d);
  let filled = inside.slice();
  for (let p = 0; p < 12; p++) {
    const next = filled.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (filled[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !filled[ny * W + nx]) continue;
        const o = (ny * W + nx) * 4; r += col[o]; g += col[o + 1]; b += col[o + 2]; n++;
      }
      if (n) { const o = i * 4; col[o] = r / n; col[o + 1] = g / n; col[o + 2] = b / n; next[i] = 1; }
    }
    filled = next;
  }
  // 放寬的剪影（雕刻用）
  let loose = inside.slice();
  for (let p = 0; p < SLACK; p++) {
    const next = loose.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (loose[i]) continue;
      if ((x > 0 && loose[i - 1]) || (x < W - 1 && loose[i + 1]) || (y > 0 && loose[i - W]) || (y < H - 1 && loose[i + W])) next[i] = 1;
    }
    loose = next;
  }
  // 取色前先稍微模糊：只留大色塊，避免每個面取到畫上的細小筆觸而變得雜亂
  const blurred = boxBlur(col, W, H, BLUR);
  const scale = y1 - y0 + 1; // 像素 / 世界單位（模型高度 = 1）
  return { W, H, inside, loose, col: blurred, sharp: col, cx: (x0 + x1 + 1) / 2, bottom: y1 + 1, scale, halfW: (x1 - x0 + 1) / 2 / scale };
}

function boxBlur(src, W, H, r) {
  if (r <= 0) return src;
  const tmp = new Float32Array(W * H * 3), out = new Uint8ClampedArray(src);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = 0, b = 0, c = 0, n = 0;
    for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) { const o = (y * W + k) * 4; a += src[o]; b += src[o + 1]; c += src[o + 2]; n++; }
    const t = (y * W + x) * 3; tmp[t] = a / n; tmp[t + 1] = b / n; tmp[t + 2] = c / n;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = 0, b = 0, c = 0, n = 0;
    for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) { const t = (k * W + x) * 3; a += tmp[t]; b += tmp[t + 1]; c += tmp[t + 2]; n++; }
    const o = (y * W + x) * 4; out[o] = a / n; out[o + 1] = b / n; out[o + 2] = c / n;
  }
  return out;
}

// ---------------------------------------------------------------- 視角
const S = Math.SQRT1_2;
// r：畫面右方在世界中的方向；d：鏡頭在哪個方向（從角色看出去）；mirror：用右半邊的圖鏡像
const VIEW_DEFS = [
  { file: 'front', r: [1, 0, 0], d: [0, 0, 1] },
  { file: 'back', r: [-1, 0, 0], d: [0, 0, -1] },
  { file: 'side', r: [0, 0, 1], d: [-1, 0, 0] },
  { file: 'side', r: [0, 0, -1], d: [1, 0, 0], mirror: true },
  { file: 'front45', r: [S, 0, S], d: [-S, 0, S] },
  { file: 'front45', r: [S, 0, -S], d: [S, 0, S], mirror: true },
  { file: 'back45', r: [-S, 0, S], d: [-S, 0, -S] },
  { file: 'back45', r: [-S, 0, -S], d: [S, 0, -S], mirror: true },
];
const cache = new Map();
const views = [];
for (const def of VIEW_DEFS) {
  const file = path.join(srcDir, `${def.file}.png`);
  if (!existsSync(file)) continue;
  if (!cache.has(file)) cache.set(file, cutout(readPng(file)));
  views.push({ ...def, img: cache.get(file) });
}
if (!views.some((v) => v.file === 'front') || !views.some((v) => v.file === 'side')) {
  console.error('至少要有 front.png 和 side.png');
  process.exit(1);
}
console.log(`視角：${[...new Set(views.map((v) => v.file))].join('、')}（含鏡像共 ${views.length} 個方向）`);

/** 世界座標 → 某張圖的像素座標 */
const project = (v, x, y, z) => {
  const u = x * v.r[0] + z * v.r[2];
  const img = v.img;
  return [v.mirror ? img.cx - u * img.scale : img.cx + u * img.scale, img.bottom - y * img.scale];
};
const maskAt = (v, mask, px, py) => {
  const xi = Math.floor(px), yi = Math.floor(py), img = v.img;
  if (xi < 0 || yi < 0 || xi >= img.W || yi >= img.H) return 0;
  return mask[yi * img.W + xi];
};

// ---------------------------------------------------------------- 2. 雕刻（visual hull）
async function carve() {
const half = Math.max(...views.map((v) => v.img.halfW)) * 1.05;
const NF_Y = RES * FINE, cellF = 1 / NF_Y;
const NF_XZ = Math.ceil((2 * half) / cellF);
// 粗網格：四周留一格空白，表面才封得起來
const NX = Math.ceil(NF_XZ / FINE) + 2, NY = RES + 2, NZ = NX;
const density = new Float32Array(NX * NY * NZ);
const idx = (x, y, z) => (z * NY + y) * NX + x;
const toWorldX = (cx) => (cx - 1) * FINE * cellF - half; // 粗格 cx 的起點（世界座標）
let filledCount = 0;
for (let fz = 0; fz < (NZ - 2) * FINE; fz++) {
  const z = -half + (fz + 0.5) * cellF;
  for (let fx = 0; fx < (NX - 2) * FINE; fx++) {
    const x = -half + (fx + 0.5) * cellF;
    for (let fy = 0; fy < NF_Y; fy++) {
      const y = (fy + 0.5) * cellF;
      let ok = true;
      // 腳底那一小段改用「腳掌高度」的剪影判斷 → 圖上的地面陰影不會變成一塊薄板
      const yy = Math.max(y, FOOT);
      for (const v of views) {
        const [px, py] = project(v, x, yy, z);
        if (!maskAt(v, v.img.loose, px, py)) { ok = false; break; }
      }
      if (!ok) continue;
      filledCount++;
      density[idx(1 + Math.floor(fx / FINE), 1 + Math.floor(fy / FINE), 1 + Math.floor(fz / FINE))] += 1 / FINE ** 3;
    }
  }
}
console.log(`雕刻：${filledCount} 個細方塊，粗網格 ${NX}×${NY}×${NZ}`);

// --debug=<檔案.png>：把雕出來的形狀從正面（左）和側面（右）投影成圖，方便和原圖比對
const debugArg = args.find((a) => a.startsWith('--debug='));
if (debugArg) {
  const { deflateSync } = await import('node:zlib');
  const sx = NX, sy = NY, w = sx * 2 + 1, h = sy;
  const px = new Uint8Array(w * h);
  for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    let mf = 0, ms = 0;
    for (let z = 0; z < NZ; z++) { mf = Math.max(mf, density[idx(x, y, z)]); ms = Math.max(ms, density[idx(z, y, x)]); }
    const row = sy - 1 - y;
    px[row * w + x] = Math.round(mf * 255);
    px[row * w + sx + 1 + x] = Math.round(ms * 255);
  }
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; Buffer.from(px.subarray(y * w, (y + 1) * w)).copy(raw, y * (w + 1) + 1); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  writeFileSync(debugArg.split('=')[1], Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// ---------------------------------------------------------------- 3. Surface nets
const ISO = 0.5, CS = FINE * cellF; // 粗格的世界大小
// 取樣點在粗格中心
const sampleWorld = (x, y, z) => [toWorldX(x) + CS / 2, (y - 1) * CS + CS / 2, toWorldX(z) + CS / 2];
const vertIndex = new Int32Array(NX * NY * NZ).fill(-1);
const verts = [];
const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
for (let z = 0; z < NZ - 1; z++) for (let y = 0; y < NY - 1; y++) for (let x = 0; x < NX - 1; x++) {
  const vals = CORNERS.map(([dx, dy, dz]) => density[idx(x + dx, y + dy, z + dz)]);
  let inside = 0;
  for (const v of vals) if (v >= ISO) inside++;
  if (inside === 0 || inside === 8) continue;
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const [a, b] of EDGES) {
    const va = vals[a], vb = vals[b];
    if ((va >= ISO) === (vb >= ISO)) continue;
    const t = (ISO - va) / (vb - va);
    const pa = CORNERS[a], pb = CORNERS[b];
    sx += pa[0] + (pb[0] - pa[0]) * t; sy += pa[1] + (pb[1] - pa[1]) * t; sz += pa[2] + (pb[2] - pa[2]) * t; n++;
  }
  const [wx, wy, wz] = sampleWorld(x, y, z);
  vertIndex[idx(x, y, z)] = verts.length;
  verts.push([wx + (sx / n) * CS, wy + (sy / n) * CS, wz + (sz / n) * CS]);
}
// 每條穿過表面的取樣邊 → 一個四邊形（兩個三角形）
const tris = [];
const quad = (a, b, c, d, nx, ny, nz) => {
  if ([a, b, c, d].some((i) => i < 0)) return;
  for (const t of [[a, b, c], [a, c, d]]) {
    const [p, q, r] = t.map((i) => verts[i]);
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    tris.push(cx * nx + cy * ny + cz * nz >= 0 ? t : [t[0], t[2], t[1]]);
  }
};
for (let z = 1; z < NZ - 1; z++) for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
  const v0 = density[idx(x, y, z)] >= ISO;
  // X 方向的邊
  if (x < NX - 1 && v0 !== (density[idx(x + 1, y, z)] >= ISO)) {
    const s = v0 ? 1 : -1;
    quad(vertIndex[idx(x, y - 1, z - 1)], vertIndex[idx(x, y, z - 1)], vertIndex[idx(x, y, z)], vertIndex[idx(x, y - 1, z)], s, 0, 0);
  }
  if (y < NY - 1 && v0 !== (density[idx(x, y + 1, z)] >= ISO)) {
    const s = v0 ? 1 : -1;
    quad(vertIndex[idx(x - 1, y, z - 1)], vertIndex[idx(x, y, z - 1)], vertIndex[idx(x, y, z)], vertIndex[idx(x - 1, y, z)], 0, s, 0);
  }
  if (z < NZ - 1 && v0 !== (density[idx(x, y, z + 1)] >= ISO)) {
    const s = v0 ? 1 : -1;
    quad(vertIndex[idx(x - 1, y - 1, z)], vertIndex[idx(x, y - 1, z)], vertIndex[idx(x, y, z)], vertIndex[idx(x - 1, y, z)], 0, 0, s);
  }
}
return { verts, tris };
}

// ---------------------------------------------------------------- 2'. 讀現成的模型（--mesh）
/** 讀 glb 的形狀（只取位置和索引），縮放成高度 1、腳底 y=0、XZ 置中；--yaw 可先轉向 */
function loadMesh(file) {
  const b = readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} 不是 glb`);
  const jl = b.readUInt32LE(12), j = JSON.parse(b.toString('utf8', 20, 20 + jl));
  const binOff = 20 + jl + 8, dv = new DataView(b.buffer, b.byteOffset + binOff);
  const read = (ai) => {
    const a = j.accessors[ai], bv = j.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
    const sz = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType], stride = bv.byteStride || n * sz, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const get = { 5126: (o) => dv.getFloat32(o, true), 5125: (o) => dv.getUint32(o, true), 5123: (o) => dv.getUint16(o, true), 5121: (o) => dv.getUint8(o) }[a.componentType];
    const out = new Array(a.count * n);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = get(base + k * stride + c * sz);
    return out;
  };
  const verts = [], tris = [];
  const yaw = flag('yaw', 0) * Math.PI / 180, cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (const mesh of j.meshes) for (const prim of mesh.primitives) {
    const p = read(prim.attributes.POSITION), base = verts.length;
    for (let i = 0; i < p.length; i += 3) verts.push([p[i] * cy + p[i + 2] * sy, p[i + 1], -p[i] * sy + p[i + 2] * cy]);
    const ix = prim.indices !== undefined ? read(prim.indices) : Array.from({ length: p.length / 3 }, (_, i) => i);
    for (let i = 0; i < ix.length; i += 3) tris.push([base + ix[i], base + ix[i + 1], base + ix[i + 2]]);
  }
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], v[a]); mx[a] = Math.max(mx[a], v[a]); }
  const s = 1 / (mx[1] - mn[1]), cxm = (mn[0] + mx[0]) / 2, czm = (mn[2] + mx[2]) / 2;
  for (const v of verts) { v[0] = (v[0] - cxm) * s; v[1] = (v[1] - mn[1]) * s; v[2] = (v[2] - czm) * s; }
  console.log(`模型：${file}，${tris.length} 個三角形`);

  // --shrink-back=y0,y1,z0,k[,deg]：高度 y0–y1 之間、凸出到 z0 後面的部分（例如尾巴）往 z0 縮成 k 倍，
  // 再以接點為軸往下轉 deg 度（垂下來）。越過 z0 一點點的地方慢慢過渡，接縫不會斷開
  const sb = args.find((a) => a.startsWith('--shrink-back='));
  if (sb) {
    const [y0, y1, z0, k, deg = 0] = sb.split('=')[1].split(',').map(Number);
    const yc = (y0 + y1) / 2, fade = 0.04, th = (deg * Math.PI) / 180;
    let moved = 0;
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      if (v[1] < y0 || v[1] > y1 || v[2] >= z0) continue;
      const w = Math.min(1, (z0 - v[2]) / fade); // 剛越過 z0 時權重小，越後面越接近完全變形
      const t = 1 - (1 - k) * w;
      v[0] *= t; v[1] = yc + (v[1] - yc) * t; v[2] = z0 + (v[2] - z0) * t;
      if (th) {
        const a = th * w, dy = v[1] - yc, dz = v[2] - z0;
        v[1] = yc + dy * Math.cos(a) + dz * Math.sin(a);
        v[2] = z0 + dz * Math.cos(a) - dy * Math.sin(a);
      }
      if (w >= 0.5) backPart.add(i);
      moved++;
    }
    console.log(`後方凸出：${moved} 個頂點，縮成 ${k} 倍${deg ? `、往下轉 ${deg} 度` : ''}`);
  }
  return { verts, tris };
}

/** --shrink-back 移動過的頂點；三個頂點都在裡面的面可以用 --back-color 指定顏色 */
const backPart = new Set();
const backHex = args.find((a) => a.startsWith('--back-color='))?.split('=')[1]?.replace('#', '');
const BACK_COLOR = backHex
  ? [0, 2, 4].map((o) => { const c = parseInt(backHex.slice(o, o + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
  : null;
const MESH = args.find((a) => a.startsWith('--mesh='))?.split('=').slice(1).join('=');
const { verts, tris } = MESH ? loadMesh(MESH) : await carve();

// ---------------------------------------------------------------- 4'. 貼圖模式（--mesh 時預設）
/**
 * 頂點色的解析度受面數限制（三千面放不下眼睛的形狀）。改成「投影貼圖」：
 * 每個三角形挑最正對它的那張圖，UV 直接指到那張圖上 → 五官用的是原圖的解析度。
 * 所有圖拼成一張貼圖；法線做平滑（不再一面一面的木頭感），顏色稍微柔化。
 */
if (MESH && !args.includes('--vertex-colors')) {
  const SOFTEN = flag('soften', 0.12); // 往柔和的奶油色靠一點、降低對比
  const SMOOTH = !args.includes('--flat');
  // 拼貼圖：每張不同的圖放一格（鏡像的視角共用同一張）
  const imgs = [...new Set(views.map((v) => v.img))];
  const PAD = 4;
  const slots = new Map();
  let AW = PAD, AH = 0;
  for (const im of imgs) { slots.set(im, AW); AW += im.W + PAD; AH = Math.max(AH, im.H); }
  const patchX = AW; AW += 8 + PAD; // 指定顏色用的小色塊
  AH += PAD * 2;
  const atlas = new Uint8ClampedArray(AW * AH * 4);
  const cream = [244, 234, 218];
  for (const im of imgs) {
    const ox = slots.get(im);
    for (let y = 0; y < im.H; y++) for (let x = 0; x < im.W; x++) {
      const s = (y * im.W + x) * 4, d = ((y + PAD) * AW + ox + x) * 4;
      for (let c = 0; c < 3; c++) atlas[d + c] = im.sharp[s + c] + (cream[c] - im.sharp[s + c]) * SOFTEN;
      atlas[d + 3] = 255;
    }
  }
  // ---- 五官重畫（--no-face 可關掉）
  // 模型比例和設定圖不一定一樣，直接投影時眼睛會跑到額頭。改成：在模型上找鼻尖定位，
  // 擦掉正面圖上原本的五官，再依模型的臉重新畫上去；臉部的面一律用正面圖。
  let faceBox = null;
  const front = views.find((v) => v.file === 'front' && !v.mirror);
  if (!args.includes('--no-face') && front) {
    // 找臉的上緣：沿著中線由下往上，前緣突然往前凸一階的地方就是瀏海；鼻子在它下面一點
    // （直接找最前面的點會找到瀏海）。--nose-y 可以手動指定
    const band = 0.02, prof = [];
    for (let y = 0.45; y < 0.95; y += band) {
      let z = -Infinity;
      for (const v of verts) if (Math.abs(v[0]) < 0.06 && v[1] >= y && v[1] < y + band) z = Math.max(z, v[2]);
      // 低面數模型有些高度剛好沒有前面的頂點（只取到後腦勺），跳過
      if (z > -Infinity && (!prof.length || z > prof[prof.length - 1][1] - 0.08)) prof.push([y, z]);
    }
    let faceTop = null;
    for (let i = 1; i < prof.length; i++) if (prof[i][0] > 0.55 && prof[i][1] - prof[i - 1][1] > 0.025) { faceTop = prof[i][0]; break; }
    if (args.includes('--verbose')) console.log('中線前緣：', prof.map(([y, z]) => `${y.toFixed(2)}:${z.toFixed(3)}`).join(' '));
    const noseY = flag('nose-y', faceTop !== null ? faceTop - 0.08 : NaN);
    let nose = null;
    if (!isNaN(noseY)) for (const v of verts) if (Math.abs(v[0]) < 0.06 && Math.abs(v[1] - noseY) < 0.03 && (!nose || v[2] > nose[2])) nose = v;
    if (nose) {
      const [ny, nz] = [noseY, nose[2]];
      faceBox = { y0: ny - 0.09, y1: ny + 0.15, z0: nz - 0.14, x: 0.2 };
      const im = front.img, ox = slots.get(im), s = im.scale;
      const toPx = (x, y) => [ox + im.cx + x * s, PAD + im.bottom - y * s];
      const put = (x, y, rgb, a) => {
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < ox || xi >= ox + im.W || yi < PAD || yi >= PAD + im.H) return;
        const d = (yi * AW + xi) * 4;
        for (let c = 0; c < 3; c++) atlas[d + c] = atlas[d + c] + (rgb[c] - atlas[d + c]) * a;
      };
      // 1. 擦掉原本的五官：臉部範圍裡偏暗或偏粉紅的像素，用周圍的膚色補上
      const [fx0, fy0] = toPx(-faceBox.x, faceBox.y1 + 0.08), [fx1, fy1] = toPx(faceBox.x, faceBox.y0 - 0.02);
      const lum = (d) => 0.3 * atlas[d] + 0.59 * atlas[d + 1] + 0.11 * atlas[d + 2];
      const holes = [];
      for (let y = Math.max(PAD, fy0 | 0); y < Math.min(PAD + im.H, fy1); y++) for (let x = Math.max(ox, fx0 | 0); x < Math.min(ox + im.W, fx1); x++) {
        const d = (y * AW + x) * 4;
        const pinkish = atlas[d] - atlas[d + 2] > 70 && lum(d) < 200;
        if (lum(d) < 120 || pinkish) holes.push(d);
      }
      const isHole = new Set(holes);
      for (let pass = 0; pass < 30 && isHole.size; pass++) {
        for (const d of [...isHole]) {
          let r = 0, g = 0, b = 0, n = 0;
          for (const o2 of [4, -4, AW * 4, -AW * 4]) if (!isHole.has(d + o2)) { r += atlas[d + o2]; g += atlas[d + o2 + 1]; b += atlas[d + o2 + 2]; n++; }
          if (n) { atlas[d] = r / n; atlas[d + 1] = g / n; atlas[d + 2] = b / n; isHole.delete(d); }
        }
      }
      // 2. 依模型的臉重新畫：眼睛（深棕＋反光）、腮紅、鼻子
      const ellipse = (cx, cy, rx, ry, rgb, alpha, soft = 0) => {
        const [px, py] = toPx(cx, cy), Rx = rx * s, Ry = ry * s;
        for (let y = Math.floor(py - Ry - 2); y <= py + Ry + 2; y++) for (let x = Math.floor(px - Rx - 2); x <= px + Rx + 2; x++) {
          const e = Math.hypot((x - px) / Rx, (y - py) / Ry);
          const a = soft ? Math.max(0, Math.min(1, (1 - e) / soft)) : e <= 1 ? 1 : Math.max(0, 1 - (e - 1) * Rx);
          if (a > 0) put(x, y, rgb, a * alpha);
        }
      };
      const ey = ny + 0.055, ex = 0.072;
      for (const sx of [-1, 1]) {
        ellipse(sx * 0.115, ny - 0.005, 0.04, 0.022, [240, 160, 155], 0.55, 0.6); // 腮紅
        ellipse(sx * ex, ey, 0.019, 0.032, [52, 38, 34], 1); // 眼睛
        ellipse(sx * ex + 0.006, ey + 0.012, 0.006, 0.007, [255, 250, 245], 0.9); // 反光
      }
      ellipse(0, ny + 0.005, 0.014, 0.009, [222, 140, 135], 1); // 鼻子
      console.log(`五官：鼻尖在 y=${ny.toFixed(3)}，重新畫上眼睛、腮紅、鼻子`);
    }
  }
  const inFace = (c, n) => faceBox && Math.abs(c[0]) < faceBox.x && c[1] > faceBox.y0 && c[1] < faceBox.y1 && c[2] > faceBox.z0 && n[2] > 0.2;

  const backRGB = backHex ? [0, 2, 4].map((o) => parseInt(backHex.slice(o, o + 2), 16)) : cream;
  for (let y = PAD; y < PAD + 8; y++) for (let x = patchX; x < patchX + 8; x++) {
    const d = (y * AW + x) * 4; atlas[d] = backRGB[0]; atlas[d + 1] = backRGB[1]; atlas[d + 2] = backRGB[2]; atlas[d + 3] = 255;
  }

  // 平滑法線：同位置的頂點合在一起，面積加權平均
  const key = (v) => `${Math.round(v[0] * 1e4)},${Math.round(v[1] * 1e4)},${Math.round(v[2] * 1e4)}`;
  const acc = new Map();
  const faceN = tris.map((t) => {
    const [p, q, r] = t.map((i) => verts[i]);
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const v of [p, q, r]) { const k2 = key(v); const a = acc.get(k2) ?? [0, 0, 0]; a[0] += n[0]; a[1] += n[1]; a[2] += n[2]; acc.set(k2, a); }
    const l = Math.hypot(...n) || 1;
    return n.map((c) => c / l);
  });

  // 可見度：每個角度用模型自己算一張深度圖。某個面在那個角度被擋住（例如羊毛被羊角擋住）就不從那張圖取色
  const depthMaps = new Map();
  for (const v of views) {
    const W2 = v.img.W, H2 = v.img.H, zb = new Float32Array(W2 * H2).fill(-Infinity);
    const dep = (p) => p[0] * v.d[0] + p[2] * v.d[2]; // 越大越靠近鏡頭
    for (const t of tris) {
      const pts = t.map((i) => { const p = verts[i]; const [x, y] = project(v, p[0], p[1], p[2]); return [x, y, dep(p)]; });
      const [a, b, c] = pts;
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(W2 - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(H2 - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
        if (z > zb[y * W2 + x]) zb[y * W2 + x] = z;
      }
    }
    depthMaps.set(v, { zb, dep });
  }
  /** 這個點在這個角度看得到嗎（取周圍幾個像素的最大深度，容許一點誤差） */
  const visible = (v, p) => {
    const { zb, dep } = depthMaps.get(v), [x, y] = project(v, p[0], p[1], p[2]);
    const W2 = v.img.W, H2 = v.img.H, xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= W2 || yi >= H2) return false;
    return dep(p) >= zb[yi * W2 + xi] - 0.015;
  };

  const N = tris.length * 3;
  const P = new Float32Array(N * 3), NR = new Float32Array(N * 3), UV = new Float32Array(N * 2);
  let o = 0, faceCount = new Map();
  tris.forEach((t, ti) => {
    const fn = faceN[ti];
    let best = null, bw = -1;
    let hx = fn[0], hz = fn[2];
    const hl = Math.hypot(hx, hz);
    if (hl < 0.15) { hx = 0; hz = 1; } else { hx /= hl; hz /= hl; }
    const cen = [0, 1, 2].map((a) => (verts[t[0]][a] + verts[t[1]][a] + verts[t[2]][a]) / 3);
    // 先在「看得到這個面」的角度裡挑最正對的；全部都被擋住才退回只看方向
    for (const v of views) { const w = hx * v.d[0] + hz * v.d[2]; if (w > bw && w > -0.2 && visible(v, cen)) { bw = w; best = v; } }
    if (!best) for (const v of views) { const w = hx * v.d[0] + hz * v.d[2]; if (w > bw) { bw = w; best = v; } }
    if (inFace(cen, fn)) best = front;
    const special = BACK_COLOR && t.every((i) => backPart.has(i));
    faceCount.set(special ? 'back-color' : best.file + (best.mirror ? '(鏡像)' : ''), (faceCount.get(special ? 'back-color' : best.file + (best.mirror ? '(鏡像)' : '')) ?? 0) + 1);
    for (const i of t) {
      const v = verts[i];
      P[o * 3] = v[0]; P[o * 3 + 1] = v[1]; P[o * 3 + 2] = v[2];
      const n = SMOOTH ? acc.get(key(v)) : fn, nl = Math.hypot(...n) || 1;
      NR[o * 3] = n[0] / nl; NR[o * 3 + 1] = n[1] / nl; NR[o * 3 + 2] = n[2] / nl;
      if (special) { UV[o * 2] = (patchX + 4) / AW; UV[o * 2 + 1] = (PAD + 4) / AH; }
      else {
        const [px, py] = project(best, v[0], v[1], v[2]);
        const cx = Math.min(best.img.W - 0.5, Math.max(0.5, px)), cy = Math.min(best.img.H - 0.5, Math.max(0.5, py));
        UV[o * 2] = (slots.get(best.img) + cx) / AW; UV[o * 2 + 1] = (cy + PAD) / AH;
      }
      o++;
    }
  });
  console.log('每個角度用了幾個面：', Object.fromEntries(faceCount));

  // PNG 編碼
  const { deflateSync } = await import('node:zlib');
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const pngChunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((AW * 4 + 1) * AH);
  for (let y = 0; y < AH; y++) { raw[y * (AW * 4 + 1)] = 0; Buffer.from(atlas.buffer, y * AW * 4, AW * 4).copy(raw, y * (AW * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(AW, 0); ihdr.writeUInt32BE(AH, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);

  // 寫 glb
  const parts = [P, NR, UV].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  parts.push(png);
  const views4 = [];
  let off = 0;
  const chunks = [];
  for (const b of parts) { views4.push({ buffer: 0, byteOffset: off, byteLength: b.length }); chunks.push(b); off += b.length; const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } }
  for (let i = 0; i < 3; i++) views4[i].target = 34962;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], P[i + a]); mx[a] = Math.max(mx[a], P[i + a]); }
  const json = {
    asset: { version: '2.0', generator: 'Knitguard views-to-glb (texture)' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: path.basename(outFile, '.glb') }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, material: 0 }] }],
    materials: [{ name: 'projected', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    textures: [{ source: 0, sampler: 0 }], images: [{ bufferView: 3, mimeType: 'image/png' }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: N, type: 'VEC3', min: mn, max: mx },
      { bufferView: 1, componentType: 5126, count: N, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: N, type: 'VEC2' },
    ],
    bufferViews: views4, buffers: [{ byteLength: off }],
  };
  const pad4 = (b, fill) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);
  const jsonBuf = pad4(Buffer.from(JSON.stringify(json)), 0x20), binBuf = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const ch = (b, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, b]); };
  mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  const file = Buffer.concat([header, ch(jsonBuf, 0x4e4f534a), ch(binBuf, 0x004e4942)]);
  writeFileSync(outFile, file);
  console.log(`輸出 ${outFile}（投影貼圖 ${AW}×${AH}${SMOOTH ? '、平滑法線' : ''}）：${tris.length} 個三角形，${(file.length / 1024).toFixed(0)} KB`);
  process.exit(0);
}

// ---------------------------------------------------------------- 4. 取色
const srgbToLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
function colorAt(v, x, y, z) {
  const [px, py] = project(v, x, y, z);
  const img = v.img;
  const xi = Math.min(img.W - 1, Math.max(0, Math.floor(px))), yi = Math.min(img.H - 1, Math.max(0, Math.floor(py)));
  const o = (yi * img.W + xi) * 4;
  return [img.col[o], img.col[o + 1], img.col[o + 2]];
}
const positions = new Float32Array(tris.length * 9);
const normals = new Float32Array(tris.length * 9);
const colors = new Float32Array(tris.length * 9);
let k = 0;
for (const t of tris) {
  const [p, q, r] = t.map((i) => verts[i]);
  const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
  // 權重：面越正對某個鏡頭，越採用那張圖的顏色；朝上/朝下的面只看水平分量
  let hx = nx, hz = nz;
  const hl = Math.hypot(hx, hz);
  if (hl < 0.15) { hx = 0; hz = 1; } else { hx /= hl; hz /= hl; }
  let wsum = 0, cr = 0, cg = 0, cb = 0;
  const samples = [[(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3]];
  for (const s of [p, q, r]) samples.push([(s[0] * 2 + samples[0][0]) / 3, (s[1] * 2 + samples[0][1]) / 3, (s[2] * 2 + samples[0][2]) / 3]);
  for (const v of views) {
    const w = Math.pow(Math.max(0, hx * v.d[0] + hz * v.d[2]), 6);
    if (w < 1e-4) continue;
    for (const s of samples) {
      const c = colorAt(v, s[0], s[1], s[2]);
      cr += srgbToLinear(c[0]) * w; cg += srgbToLinear(c[1]) * w; cb += srgbToLinear(c[2]) * w;
    }
    wsum += w * samples.length;
  }
  // --back-color=#rrggbb：變形過的部位（例如尾巴）直接用指定顏色，不從圖上取（移動後會取到別的部位的顏色）
  if (BACK_COLOR && t.every((i) => backPart.has(i))) {
    const shade = 0.92 + 0.08 * Math.max(0, ny); // 一點點明暗，保留低多邊形的面感
    cr = BACK_COLOR[0] * shade; cg = BACK_COLOR[1] * shade; cb = BACK_COLOR[2] * shade; wsum = 1;
  }
  for (const vtx of [p, q, r]) {
    positions[k] = vtx[0]; positions[k + 1] = vtx[1]; positions[k + 2] = vtx[2];
    normals[k] = nx; normals[k + 1] = ny; normals[k + 2] = nz;
    colors[k] = cr / wsum; colors[k + 1] = cg / wsum; colors[k + 2] = cb / wsum;
    k += 3;
  }
}

// ---------------------------------------------------------------- 5. 輸出 glb
function writeGlb(file) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], positions[i + a]); max[a] = Math.max(max[a], positions[i + a]); }
  const bufs = [positions, normals, colors].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  const count = positions.length / 3;
  let offset = 0;
  const bufferViews = bufs.map((b) => { const v = { buffer: 0, byteOffset: offset, byteLength: b.length, target: 34962 }; offset += b.length; return v; });
  const json = {
    asset: { version: '2.0', generator: 'Knitguard views-to-glb' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: path.basename(file, '.glb') }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, material: 0 }] }],
    materials: [{ name: 'vertexColor', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count, type: 'VEC3' },
    ],
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const pad = (b, fill) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);
  const jsonBuf = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const binBuf = pad(Buffer.concat(bufs), 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const chunk = (b, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, b]); };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([header, chunk(jsonBuf, 0x4e4f534a), chunk(binBuf, 0x004e4942)]));
  return { min, max };
}
const { min, max } = writeGlb(outFile);
console.log(`輸出 ${outFile}：${tris.length} 個三角形，大小 ${(max[0] - min[0]).toFixed(2)} × ${(max[1] - min[1]).toFixed(2)} × ${(max[2] - min[2]).toFixed(2)}（寬×高×深）`);
