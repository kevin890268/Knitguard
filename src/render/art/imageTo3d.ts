import * as THREE from 'three';
import type { ArtSlot } from './manifest';

/**
 * 把一張 2D 圖片「充氣」成 3D 布偶模型。
 *
 * 1. 去背：有透明背景就直接用；沒有就從圖片邊緣用洪水填充去掉底色
 * 2. 只留主體：去掉零星小雜點，裁到剛好包住角色
 * 3. 距離場：每個像素離剪影邊緣多遠
 * 4. 充氣：離邊緣越遠越厚（圓弧剖面）→ 像塞了棉花的毛氈布偶；正反兩面貼同一張圖
 * 5. 有第二張角度的剪影時，每一列的厚度改用那張圖的寬度 → 比例更像真的 3D
 * 6. 邊緣用 alpha 測試切出精準輪廓，網格本身可以很粗（單位數量多也不卡）
 */

const MAX_PX = 768;
const STITCH_WORLD = 0.09; // 一針在世界中的寬度，讓所有模型針目大小一致

export interface Cutout {
  w: number;
  h: number;
  /** RGBA，透明處的顏色已向外延伸（避免縮圖時邊緣出現底色） */
  rgba: Uint8ClampedArray;
}

// ---------------------------------------------------------------- 1–2. 去背、裁切
export function makeCutout(img: HTMLImageElement, bgTolerance: number): Cutout | null {
  const s = Math.min(1, MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * s));
  const H = Math.max(1, Math.round(img.naturalHeight * s));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;

  let transparent = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) transparent++;
  if (transparent < W * H * 0.01) removeBackground(d, W, H, bgTolerance);

  keepMainParts(d, W, H);

  // 包圍盒
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] >= 128) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const pad = 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const src = ((y + y0) * W + x0) * 4;
    out.set(d.subarray(src, src + cw * 4), y * cw * 4);
  }
  bleedColors(out, cw, ch, 8);
  return { w: cw, h: ch, rgba: out };
}

/** 從邊緣洪水填充，把和底色相近、且和邊緣連通的像素變透明；邊緣做柔化。 */
function removeBackground(d: Uint8ClampedArray, W: number, H: number, tol: number): void {
  // 底色＝邊框像素的中位數
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const pushPx = (x: number, y: number) => { const o = (y * W + x) * 4; rs.push(d[o]); gs.push(d[o + 1]); bs.push(d[o + 2]); };
  for (let x = 0; x < W; x++) { pushPx(x, 0); pushPx(x, H - 1); }
  for (let y = 0; y < H; y++) { pushPx(0, y); pushPx(W - 1, y); }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  const br = med(rs), bg = med(gs), bb = med(bs);
  const dist = (i: number) => {
    const o = i * 4, dr = d[o] - br, dg = d[o + 1] - bg, db = d[o + 2] - bb;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  // 擴散規則：
  //   1. 和底色差不超過 tol × 2（容許背景漸層和淡淡的地面陰影）
  //   2. 和「旁邊那個背景像素」的色差很小（≤ step）
  // 背景和陰影都是平滑漸層，可以一路擴散；角色邊緣就算顏色接近（例如米白羊毛），也會有一點落差而擋住
  const step = Math.max(2, tol / 10);
  // 地面陰影：和底色同色調、只是比較暗（各色版比例一致），而且在圖的下半部
  const shadowLike = (j: number) => {
    if (((j / W) | 0) < H * 0.6) return false;
    const o = j * 4, rr = d[o] / Math.max(1, br), rg = d[o + 1] / Math.max(1, bg), rb = d[o + 2] / Math.max(1, bb);
    const m = (rr + rg + rb) / 3;
    return m > 0.5 && m < 1.02 && Math.abs(rr - m) < 0.035 && Math.abs(rg - m) < 0.035 && Math.abs(rb - m) < 0.035;
  };
  const stepDist = (i: number, j: number) => {
    const a = i * 4, b = j * 4;
    return Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]);
  };
  const isBg = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) for (const i of [x, (H - 1) * W + x]) if (!isBg[i] && dist(i) <= tol) { isBg[i] = 1; stack.push(i); }
  for (let y = 0; y < H; y++) for (const i of [y * W, y * W + W - 1]) if (!isBg[i] && dist(i) <= tol) { isBg[i] = 1; stack.push(i); }
  const grow = (from: number, j: number) => {
    if (isBg[j]) return;
    const sd = stepDist(from, j);
    if ((dist(j) <= tol * 2 && sd <= step) || (sd <= step * 2.5 && shadowLike(j))) { isBg[j] = 1; stack.push(j); }
  };
  while (stack.length) {
    const i = stack.pop()!, x = i % W, y = (i / W) | 0;
    if (x > 0) grow(i, i - 1);
    if (x < W - 1) grow(i, i + 1);
    if (y > 0) grow(i, i - W);
    if (y < H - 1) grow(i, i + W);
  }
  for (let i = 0; i < W * H; i++) {
    if (isBg[i]) { d[i * 4 + 3] = 0; continue; }
    // 緊鄰背景、顏色又接近底色的像素 → 半透明（去掉反鋸齒留下的白邊）
    const x = i % W, y = (i / W) | 0;
    const nearBg = (x > 0 && isBg[i - 1]) || (x < W - 1 && isBg[i + 1]) || (y > 0 && isBg[i - W]) || (y < H - 1 && isBg[i + W]);
    if (nearBg) {
      const t = (dist(i) - tol) / tol;
      if (t < 1) d[i * 4 + 3] = Math.round(255 * Math.max(0, t));
    }
  }
}

/** 只保留主要的連通區塊（面積 ≥ 最大塊的 3%），去掉零星雜點。 */
function keepMainParts(d: Uint8ClampedArray, W: number, H: number): void {
  const label = new Int32Array(W * H);
  const areas: number[] = [0];
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (label[start] || d[start * 4 + 3] < 128) continue;
    const id = areas.length;
    let area = 0;
    label[start] = id; stack.push(start);
    while (stack.length) {
      const i = stack.pop()!, x = i % W, y = (i / W) | 0;
      area++;
      const visit = (j: number) => { if (!label[j] && d[j * 4 + 3] >= 128) { label[j] = id; stack.push(j); } };
      if (x > 0) visit(i - 1);
      if (x < W - 1) visit(i + 1);
      if (y > 0) visit(i - W);
      if (y < H - 1) visit(i + W);
    }
    areas.push(area);
  }
  const maxA = Math.max(...areas);
  for (let i = 0; i < W * H; i++) {
    const l = label[i];
    if (l && areas[l] < maxA * 0.03) d[i * 4 + 3] = 0;
    else if (!l && d[i * 4 + 3] > 0 && d[i * 4 + 3] < 128) {
      // 半透明的邊：只有緊鄰主體才保留
      const x = i % W, y = (i / W) | 0;
      const ok = (x > 0 && label[i - 1]) || (x < W - 1 && label[i + 1]) || (y > 0 && label[i - W]) || (y < H - 1 && label[i + W]);
      if (!ok) d[i * 4 + 3] = 0;
    }
  }
}

/** 把不透明像素的顏色往透明區延伸幾圈，縮圖取樣時邊緣才不會混到底色。 */
function bleedColors(d: Uint8ClampedArray, W: number, H: number, passes: number): void {
  let filled = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) filled[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const next = filled.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (filled[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!filled[j]) continue;
        r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; n++;
      }
      if (n) { d[i * 4] = r / n; d[i * 4 + 1] = g / n; d[i * 4 + 2] = b / n; next[i] = 1; }
    }
    filled = next;
  }
}

// ---------------------------------------------------------------- 3. 距離場
/** 兩趟 chamfer 距離轉換：每個在剪影內的像素到最近外部像素的距離（像素）。 */
function distanceField(c: Cutout, oob = 0): Float32Array {
  const { w: W, h: H, rgba } = c;
  const INF = 1e9, a = 1, b = Math.SQRT2;
  const f = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) f[i] = rgba[i * 4 + 3] >= 128 ? INF : 0;
  const get = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? oob : f[y * W + x]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!f[i]) continue;
    f[i] = Math.min(f[i], get(x - 1, y) + a, get(x, y - 1) + a, get(x - 1, y - 1) + b, get(x + 1, y - 1) + b);
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    if (!f[i]) continue;
    f[i] = Math.min(f[i], get(x + 1, y) + a, get(x, y + 1) + a, get(x + 1, y + 1) + b, get(x - 1, y + 1) + b);
  }
  return f;
}

/** 剪影外的像素到剪影的距離（和 distanceField 相反），用來把外圈頂點貼到輪廓上。 */
function outsideField(c: Cutout): Float32Array {
  const inv: Cutout = { w: c.w, h: c.h, rgba: new Uint8ClampedArray(c.rgba.length) };
  for (let i = 3; i < c.rgba.length; i += 4) inv.rgba[i] = c.rgba[i] >= 128 ? 0 : 255;
  return distanceField(inv, 1e9); // 影像邊界外也是剪影外，不能當成距離的起點
}

/**
 * 外圈頂點：沿距離場的梯度往內移到輪廓上，再多進去一點點（inset 像素），
 * 確保取到的貼圖是不透明的 → 側牆不會被 alpha 測試切出縫。回傳新的像素座標。
 */
const CONTOUR_INSET = 2.5;
function snapToContour(out: Float32Array, W: number, H: number, px: number, py: number, maxD: number): [number, number] {
  const d = sampleBilinear(out, W, H, px, py);
  if (d <= 0 || d > maxD) return [px, py];
  const gx = sampleBilinear(out, W, H, px + 1, py) - sampleBilinear(out, W, H, px - 1, py);
  const gy = sampleBilinear(out, W, H, px, py + 1) - sampleBilinear(out, W, H, px, py - 1);
  const len = Math.hypot(gx, gy);
  if (len < 1e-4) return [px, py];
  const step = d + CONTOUR_INSET;
  return [px - (gx / len) * step, py - (gy / len) * step];
}

function sampleBilinear(f: Float32Array, W: number, H: number, px: number, py: number): number {
  const x = Math.min(W - 1, Math.max(0, px - 0.5)), y = Math.min(H - 1, Math.max(0, py - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const top = f[y0 * W + x0] * (1 - tx) + f[y0 * W + x1] * tx;
  const bot = f[y1 * W + x0] * (1 - tx) + f[y1 * W + x1] * tx;
  return top * (1 - ty) + bot * ty;
}

// ---------------------------------------------------------------- 5. 第二張剪影 → 每列厚度
interface RowProfile { half: Float32Array; center: Float32Array } // 以「高度比例」取樣，單位：世界

function rowProfile(c: Cutout, worldH: number, rows: number): RowProfile {
  const { w: W, h: H, rgba } = c;
  const scale = worldH / H;
  const raw = new Float32Array(H), cen = new Float32Array(H), has = new Uint8Array(H);
  for (let y = 0; y < H; y++) {
    let mn = W, mx = -1;
    for (let x = 0; x < W; x++) if (rgba[(y * W + x) * 4 + 3] >= 128) { if (x < mn) mn = x; mx = x; }
    if (mx >= 0) { raw[y] = ((mx - mn + 1) / 2) * scale; cen[y] = ((mn + mx + 1) / 2 - W / 2) * scale; has[y] = 1; }
  }
  // 空的列用最近的有效列補上
  let last = -1;
  for (let y = 0; y < H; y++) if (has[y]) { if (last < 0) for (let k = 0; k < y; k++) { raw[k] = raw[y]; cen[k] = cen[y]; } last = y; }
  else if (last >= 0) { raw[y] = raw[last]; cen[y] = cen[last]; }
  // 依需要的列數重新取樣並稍微平滑
  const half = new Float32Array(rows), center = new Float32Array(rows);
  const rad = Math.max(1, Math.round(H * 0.02));
  for (let r = 0; r < rows; r++) {
    const yc = Math.round((r / Math.max(1, rows - 1)) * (H - 1));
    let sh = 0, sc = 0, n = 0;
    for (let y = Math.max(0, yc - rad); y <= Math.min(H - 1, yc + rad); y++) { sh += raw[y]; sc += cen[y]; n++; }
    half[r] = Math.max(sh / n, worldH * 0.03);
    center[r] = sc / n;
  }
  return { half, center };
}

// ---------------------------------------------------------------- 背面圖
/**
 * 把正面和背面拼成一張貼圖（左半正面、右半背面）。
 * 背面圖縮放到和正面同大小並左右翻轉（從背後看，角色的左手在畫面左邊），
 * 顏色用背面圖，輪廓（alpha）一律用正面的 → 兩面外形一定一致，不會破洞。
 */
export function combineFrontBack(front: Cutout, back: Cutout): Cutout {
  const { w: W, h: H } = front;
  const out = new Uint8ClampedArray(W * 2 * H * 4);
  const filled = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fo = (y * W + x) * 4, oo = (y * W * 2 + x) * 4, bo = oo + W * 4;
    for (let k = 0; k < 4; k++) out[oo + k] = front.rgba[fo + k];
    const bx = Math.min(back.w - 1, Math.floor(((W - 1 - x) / W) * back.w));
    const by = Math.min(back.h - 1, Math.floor((y / H) * back.h));
    const so = (by * back.w + bx) * 4;
    out[bo] = back.rgba[so]; out[bo + 1] = back.rgba[so + 1]; out[bo + 2] = back.rgba[so + 2];
    out[bo + 3] = front.rgba[fo + 3];
    if (back.rgba[so + 3] >= 128) filled[y * W + x] = 1;
  }
  // 背面圖沒蓋到、但正面輪廓有的地方：用附近的背面顏色補上
  let todo = filled;
  for (let pass = 0; pass < 40; pass++) {
    const next = todo.slice();
    let changed = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (todo[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !todo[ny * W + nx]) continue;
        const o = (ny * W * 2 + nx + W) * 4;
        r += out[o]; g += out[o + 1]; b += out[o + 2]; n++;
      }
      if (n) {
        const o = (y * W * 2 + x + W) * 4;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
        next[i] = 1; changed = true;
      }
    }
    todo = next;
    if (!changed) break;
  }
  return { w: W * 2, h: H, rgba: out };
}

// ---------------------------------------------------------------- 貼圖（疊上針織紋理）
export function makeTexture(c: Cutout, knitCanvas: HTMLCanvasElement, strength: number, worldH: number): THREE.DataTexture {
  const data = new Uint8ClampedArray(c.rgba);
  if (strength > 0) {
    const kw = knitCanvas.width, kh = knitCanvas.height;
    const kd = knitCanvas.getContext('2d')!.getImageData(0, 0, kw, kh).data;
    let mean = 0;
    for (let i = 0; i < kw * kh; i++) mean += kd[i * 4];
    mean /= kw * kh * 255;
    const pxPerWorld = c.h / worldH;
    const k = 16 / (STITCH_WORLD * pxPerWorld); // 貼圖像素 → 針織圖像素（一針 16px）
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const o = (y * c.w + x) * 4;
      const kx = Math.floor(x * k) % kw, ky = Math.floor(y * k) % kh;
      const blend = Math.min(1, Math.max(0, 0.5 + (kd[(ky * kw + kx) * 4] / 255 - mean) * 1.6));
      for (let ch = 0; ch < 3; ch++) {
        const base = data[o + ch] / 255;
        const soft = (1 - 2 * blend) * base * base + 2 * blend * base; // soft-light
        data[o + ch] = 255 * (base + (soft - base) * strength);
      }
    }
  }
  const tex = new THREE.DataTexture(data, c.w, c.h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- 4. 充氣網格
export interface InflateResult {
  geometry: THREE.BufferGeometry;
  width: number;
  height: number;
  depth: number;
}

/**
 * main：主要那張圖；depthImg：另一個角度的剪影（可為 null）。
 * atlas：貼圖是 combineFrontBack 拼出來的（左半正面、右半背面）。
 * 模型原點在腳底中心；front 圖面向 +Z，side 圖（角色面向右）的前進方向是 +Z。
 */
export function inflate(main: Cutout, depthImg: Cutout | null, slot: ArtSlot, atlas = false): InflateResult {
  const { w: W, h: H, rgba } = main;
  const worldH = slot.height, worldW = worldH * (W / H);
  const df = distanceField(main);
  const outF = outsideField(main);
  let dmax = 0;
  for (let i = 0; i < df.length; i++) if (df[i] > dmax) dmax = df[i];

  const cellPx = Math.max(W, H) / Math.max(2, slot.res);
  const nx = Math.max(1, Math.ceil(W / cellPx)), ny = Math.max(1, Math.ceil(H / cellPx));
  const profile = depthImg ? rowProfile(depthImg, worldH, ny + 1) : null;
  const halfGlobal = worldW * slot.depth;
  // 有剪影時厚度主要跟著剪影走，只在邊緣附近收圓；沒有時整體是圓鼓鼓的枕頭形
  const dSat = profile ? Math.min(dmax, H * 0.06) : dmax * 0.85;

  // 哪些格子要生成：格內有任何主體像素，再往外擴一格（實際輪廓交給 alpha 測試切）
  const cell = new Uint8Array(nx * ny);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (rgba[(y * W + x) * 4 + 3] >= 128) cell[Math.min(ny - 1, (y / cellPx) | 0) * nx + Math.min(nx - 1, (x / cellPx) | 0)] = 1;
  }
  const use = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!cell[j * nx + i]) continue;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < nx && b < ny) use[b * nx + a] = 1;
    }
  }

  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const vf = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
  const vb = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
  let maxHalf = 0;
  const vert = (i: number, j: number): void => {
    const k = j * (nx + 1) + i;
    if (vf[k] >= 0) return;
    // 剪影外的頂點貼到輪廓上：側牆才會取到不透明的顏色，從側面看不會透空
    const gx0 = Math.min(W, i * cellPx), gy0 = Math.min(H, j * cellPx);
    const [px, py] = snapToContour(outF, W, H, gx0, gy0, cellPx * 1.5);
    const snapped = px !== gx0 || py !== gy0;
    // 貼到輪廓的頂點厚度為 0：正反兩面在這裡接起來，不會留縫
    const d = snapped ? 0 : sampleBilinear(df, W, H, px, py);
    const t = Math.min(1, d / Math.max(1e-3, dSat));
    const shape = Math.sqrt(t * (2 - t));
    const row = ny - j; // 0＝底部
    const half = profile ? profile.half[row] : halfGlobal;
    const zc = profile ? profile.center[row] * (slot.view === 'side' ? -1 : 1) : 0;
    const hz = half * shape;
    if (hz > maxHalf) maxHalf = hz;
    const x = (px / W - 0.5) * worldW, y = (1 - py / H) * worldH;
    const u = px / W, v = py / H; // DataTexture 不翻轉：第 0 列＝圖片頂端
    vf[k] = pos.length / 3; pos.push(x, y, zc + hz); uv.push(atlas ? u * 0.5 : u, v);
    vb[k] = pos.length / 3; pos.push(x, y, zc - hz); uv.push(atlas ? 0.5 + u * 0.5 : u, v);
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!use[j * nx + i]) continue;
    vert(i, j); vert(i + 1, j); vert(i, j + 1); vert(i + 1, j + 1);
    const A = j * (nx + 1) + i, B = A + 1, C = A + nx + 1, D = C + 1; // A 左上、B 右上、C 左下、D 右下
    idx.push(vf[C], vf[D], vf[B], vf[C], vf[B], vf[A]); // 正面（+Z 看是逆時針）
    idx.push(vb[C], vb[B], vb[D], vb[C], vb[A], vb[B]); // 背面
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  if (slot.view === 'side') geo.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2)); // 圖片右方 → +Z
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.art = true;
  return { geometry: geo, width: worldW, height: worldH, depth: maxHalf * 2 };
}
