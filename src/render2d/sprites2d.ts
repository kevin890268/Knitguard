import { BK } from '../sim/data';
import { HEIGHT_PX, PX_PER_UNIT, TILE_H, TILE_W } from './iso';
import { SPRITE_SCALE, type Sprite } from './spriteBaker';

/**
 * 直接用 Canvas 畫的 2D 圖（斜角、手作毛氈風），不經過 3D。
 * 座標原點 = 物件在地面上的中心點；x/y 是世界單位的偏移，h 是高度。
 */
type G = CanvasRenderingContext2D;

const P = (x: number, y: number, h = 0): [number, number] => [(x - y) * (TILE_W / 2), (x + y) * (TILE_H / 2) - h * HEIGHT_PX];

function makeSprite(w: number, h: number, ax: number, ay: number, draw: (g: G) => void): Sprite {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * SPRITE_SCALE);
  c.height = Math.ceil(h * SPRITE_SCALE);
  const g = c.getContext('2d')!;
  g.scale(SPRITE_SCALE, SPRITE_SCALE);
  g.translate(ax, ay);
  g.lineJoin = g.lineCap = 'round';
  draw(g);
  return { canvas: c, ax: ax * SPRITE_SCALE, ay: ay * SPRITE_SCALE, top: ay };
}

export function flipSprite(s: Sprite): Sprite {
  const c = document.createElement('canvas');
  c.width = s.canvas.width; c.height = s.canvas.height;
  const g = c.getContext('2d')!;
  g.translate(c.width, 0); g.scale(-1, 1);
  g.drawImage(s.canvas, 0, 0);
  return { ...s, canvas: c, ax: c.width - s.ax };
}

// ---------------------------------------------------------------- 設定圖 → 8 方向
/**
 * 用畫好的多視角設定圖當單位的 8 方向圖（public/sprites/<名字>/front.png…）。
 * 第 d 個方向 = 世界中朝 (sin θ, cos θ)，θ = d×45°；鏡頭在 +x +y 方向。
 *   θ=45° 正對鏡頭 → front；90° 往畫面右下 → front45；135° 往右 → side；180° 往右上 → back45；225° → back
 *   左半邊有圖（frontLeft45、backLeft45）就直接用，沒有就用右半邊的圖鏡像
 *   沒有 side 時，往右用 front45、往左用 frontLeft45
 */
export const VIEW_FILES = ['front', 'front45', 'side', 'back45', 'back', 'frontLeft45', 'backLeft45', 'sideLeft'] as const;
export type ViewName = (typeof VIEW_FILES)[number];
/**
 * 每個方向依序嘗試的圖：[檔名, 是否鏡像]。檔名一律以「畫面上臉朝哪邊」為準：
 * front45＝臉朝右下、frontLeft45＝臉朝左下、side＝臉朝右、sideLeft＝臉朝左、back45＝背影往右上、backLeft45＝背影往左上
 */
const DIR_VIEWS: [ViewName, boolean][][] = [
  [['frontLeft45', false], ['front45', true], ['front', false]],
  [['front', false]],
  [['front45', false], ['frontLeft45', true], ['front', false]],
  [['side', false], ['sideLeft', true], ['front45', false], ['frontLeft45', true]],
  [['back45', false], ['backLeft45', true], ['back', false]],
  [['back', false], ['back45', false], ['backLeft45', false]],
  [['backLeft45', false], ['back45', true], ['back', false]],
  [['sideLeft', false], ['side', true], ['frontLeft45', false], ['front45', true]],
];

/** cutouts：各視角去背後的圖（同一隻角色、同樣的比例）；heightPx：角色在畫面上要多高（未乘 SPRITE_SCALE） */
export function spritesFromViews(cutouts: Partial<Record<ViewName, { w: number; h: number; rgba: Uint8ClampedArray }>>, heightPx: number): Sprite[] {
  const front = cutouts.front!;
  const k = (heightPx * SPRITE_SCALE) / front.h; // 所有視角用同一個縮放，比例才會一致
  const made = new Map<ViewName, Sprite>();
  const make = (name: ViewName): Sprite => {
    const c = cutouts[name]!;
    if (made.has(name)) return made.get(name)!;
    // 先放到原尺寸的 canvas，再一半一半縮小（一次縮太多會鋸齒）
    let src = document.createElement('canvas');
    src.width = c.w; src.height = c.h;
    src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(c.rgba), c.w, c.h), 0, 0);
    let w = c.w, h = c.h;
    const tw = Math.max(2, Math.round(c.w * k)), th = Math.max(2, Math.round(c.h * k));
    while (w / 2 > tw) {
      const nw = Math.round(w / 2), nh = Math.round(h / 2), n = document.createElement('canvas');
      n.width = nw; n.height = nh;
      const g = n.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, nw, nh);
      src = n; w = nw; h = nh;
    }
    const out = document.createElement('canvas');
    out.width = tw; out.height = th;
    const g = out.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, tw, th);
    const s: Sprite = { canvas: out, ax: tw / 2, ay: th - 1, top: th / SPRITE_SCALE };
    made.set(name, s);
    return s;
  };
  const flipped = new Map<ViewName, Sprite>();
  return DIR_VIEWS.map((choices) => {
    const [name, mirror] = choices.find(([n]) => cutouts[n]) ?? ['front', false];
    const s = make(name);
    if (!mirror) return s;
    if (!flipped.has(name)) flipped.set(name, flipSprite(s));
    return flipped.get(name)!;
  });
}

// ---------------------------------------------------------------- 顏色工具
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
function shade(c: number, k: number): string {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const f = (v: number) => Math.round(Math.max(0, Math.min(255, k >= 1 ? v + (255 - v) * (k - 1) : v * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
const STITCH = 'rgba(255,255,255,0.55)';
const OUTLINE = 'rgba(70,50,40,0.35)';

function poly(g: G, pts: [number, number][], fill: string, stroke = OUTLINE): void {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
  g.closePath();
  g.fillStyle = fill; g.fill();
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
}

/** 方塊：底面 [-hx,hx]×[-hy,hy]，高度 h0~h1；只畫看得到的三面 */
function prism(g: G, hx: number, hy: number, h0: number, h1: number, color: number, dashed = true): void {
  poly(g, [P(hx, -hy, h0), P(hx, hy, h0), P(hx, hy, h1), P(hx, -hy, h1)], shade(color, 0.82)); // 右側面
  poly(g, [P(-hx, hy, h0), P(hx, hy, h0), P(hx, hy, h1), P(-hx, hy, h1)], shade(color, 0.92)); // 左側面
  poly(g, [P(-hx, -hy, h1), P(hx, -hy, h1), P(hx, hy, h1), P(-hx, hy, h1)], shade(color, 1.08)); // 頂面
  if (dashed) {
    // 縫線：頂面內縮一圈的虛線
    g.setLineDash([3, 3]); g.strokeStyle = STITCH; g.lineWidth = 1;
    const k = 0.82;
    g.beginPath();
    const q = [P(-hx * k, -hy * k, h1), P(hx * k, -hy * k, h1), P(hx * k, hy * k, h1), P(-hx * k, hy * k, h1)];
    g.moveTo(q[0][0], q[0][1]); for (const p of q.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); g.stroke();
    g.setLineDash([]);
  }
}

/** 圓柱：半徑 r（世界單位），高度 h0~h1，可以畫上一圈圈的毛線紋 */
function cylinder(g: G, r: number, h0: number, h1: number, color: number, yarn = false): void {
  const rx = r * PX_PER_UNIT, ry = rx / 2, y0 = -h0 * HEIGHT_PX, y1 = -h1 * HEIGHT_PX;
  const grd = g.createLinearGradient(-rx, 0, rx, 0);
  grd.addColorStop(0, shade(color, 0.86)); grd.addColorStop(0.45, shade(color, 1.08)); grd.addColorStop(1, shade(color, 0.72));
  g.beginPath();
  g.moveTo(-rx, y1); g.lineTo(-rx, y0); g.ellipse(0, y0, rx, ry, 0, Math.PI, 0, true); g.lineTo(rx, y1);
  g.closePath(); g.fillStyle = grd; g.fill(); g.strokeStyle = OUTLINE; g.lineWidth = 1; g.stroke();
  if (yarn) {
    g.strokeStyle = shade(color, 0.78); g.lineWidth = 1.2;
    const n = Math.max(2, Math.round((h1 - h0) * 7));
    for (let i = 1; i < n; i++) {
      const y = y0 + ((y1 - y0) * i) / n;
      g.beginPath(); g.ellipse(0, y, rx, ry, 0, 0.15, Math.PI - 0.15); g.stroke();
    }
  }
  g.beginPath(); g.ellipse(0, y1, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = shade(color, 1.12); g.fill(); g.strokeStyle = OUTLINE; g.stroke();
}

function levelBeads(g: G, level: number, y: number): void {
  for (let i = 1; i < level; i++) {
    g.beginPath(); g.arc(-8 + i * 8 - 4, y, 3, 0, Math.PI * 2);
    g.fillStyle = '#ffd54a'; g.fill(); g.strokeStyle = OUTLINE; g.stroke();
  }
}

// ---------------------------------------------------------------- 建築
export function paintBuilding(kind: number, level: number, color: number): Sprite {
  const wood = 0xc9a27a;
  switch (kind) {
    case BK.Base: return makeSprite(220, 260, 110, 200, (g) => {
      cylinder(g, 1.45, 0, 0.3, wood);
      cylinder(g, 1.15, 0.3, 2.1, color, true);
      cylinder(g, 1.45, 2.1, 2.4, wood);
      // 旗子
      const [px, py] = P(0, 0, 2.4);
      g.strokeStyle = '#6b4a2a'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px, py - 52); g.stroke();
      poly(g, [[px, py - 52], [px + 26, py - 46], [px, py - 38]], '#e24b5b');
    });
    case BK.Wall: {
      const h = 0.7 + level * 0.12;
      return makeSprite(70, 90, 35, 55, (g) => { prism(g, 0.48, 0.48, 0, h, color); levelBeads(g, level, 10); });
    }
    case BK.Tower: {
      const h = 1.0 + level * 0.35;
      return makeSprite(80, 170, 40, 140, (g) => {
        cylinder(g, 0.45, 0, 0.18, wood);
        cylinder(g, 0.34, 0.18, 0.18 + h, color, true);
        cylinder(g, 0.45, 0.18 + h, 0.32 + h, wood);
        // 圓錐屋頂
        const [, ty] = P(0, 0, 0.32 + h), rx = 0.42 * PX_PER_UNIT;
        g.beginPath(); g.moveTo(-rx, ty); g.lineTo(0, ty - 0.6 * HEIGHT_PX); g.lineTo(rx, ty);
        g.ellipse(0, ty, rx, rx / 2, 0, 0, Math.PI); g.closePath();
        const grd = g.createLinearGradient(-rx, 0, rx, 0);
        grd.addColorStop(0, '#e98c7c'); grd.addColorStop(1, '#c4604f');
        g.fillStyle = grd; g.fill(); g.strokeStyle = OUTLINE; g.stroke();
        levelBeads(g, level, 12);
      });
    }
    case BK.Barracks: return makeSprite(150, 150, 75, 105, (g) => {
      const h = 0.9;
      prism(g, 0.9, 0.9, 0, h, color);
      // 門（左側面上）
      const d = [P(-0.2, 0.9, 0), P(0.2, 0.9, 0), P(0.2, 0.9, 0.55), P(-0.2, 0.9, 0.55)];
      poly(g, d, '#6b4a2a');
      // 四角錐屋頂
      const top = P(0, 0, h + 0.8 + level * 0.15), e = 1.05;
      const c = [P(-e, -e, h), P(e, -e, h), P(e, e, h), P(-e, e, h)];
      poly(g, [c[1], c[2], top], '#c97a50'); // 右
      poly(g, [c[2], c[3], top], '#e0956a'); // 左
      levelBeads(g, level, 14);
    });
  }
  return makeSprite(10, 10, 5, 5, () => {});
}

// ---------------------------------------------------------------- 怪物（毛球）
/** 面向畫面右邊；左邊用 flipSprite。scale 和 3D 版的 kind.scale 一樣 */
export function paintMonster(color: number, scale: number): Sprite {
  const R = 0.5 * scale * PX_PER_UNIT; // 身體半徑（像素）
  const cy = -R * 1.05;
  const W = R * 3, H = R * 3.4;
  return makeSprite(W, H, W / 2, H - R * 0.4, (g) => {
    // 腳
    g.fillStyle = shade(color, 0.55);
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * R * 0.4, -R * 0.08, R * 0.22, R * 0.14, 0, 0, Math.PI * 2); g.fill(); }
    // 毛茸茸的身體：一圈小毛球＋中間大圓
    const n = 14;
    g.fillStyle = shade(color, 0.85);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.beginPath(); g.arc(Math.cos(a) * R * 0.82, cy + Math.sin(a) * R * 0.78, R * 0.3, 0, Math.PI * 2); g.fill();
    }
    const grd = g.createRadialGradient(-R * 0.3, cy - R * 0.35, R * 0.1, 0, cy, R);
    grd.addColorStop(0, shade(color, 1.25)); grd.addColorStop(1, hex(color));
    g.beginPath(); g.arc(0, cy, R * 0.86, 0, Math.PI * 2); g.fillStyle = grd; g.fill();
    // 角
    g.fillStyle = shade(color, 1.35);
    for (const s of [-1, 1]) poly(g, [[s * R * 0.35 - R * 0.12, cy - R * 0.7], [s * R * 0.5, cy - R * 1.25], [s * R * 0.35 + R * 0.14, cy - R * 0.7]], shade(color, 1.35), '');
    // 眼睛（看向右邊）
    for (const s of [-1, 1]) {
      const ex = R * 0.22 + s * R * 0.24, ey = cy - R * 0.12;
      g.beginPath(); g.arc(ex, ey, R * 0.2, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
      g.beginPath(); g.arc(ex + R * 0.07, ey + R * 0.02, R * 0.1, 0, Math.PI * 2); g.fillStyle = '#1e1414'; g.fill();
    }
    // 嘴
    g.strokeStyle = '#3a2020'; g.lineWidth = Math.max(1, R * 0.07);
    g.beginPath(); g.arc(R * 0.25, cy + R * 0.22, R * 0.2, 0.2, Math.PI - 0.2); g.stroke();
  });
}

// ---------------------------------------------------------------- 樹、石頭
export function paintTree(hue: number): Sprite {
  return makeSprite(60, 90, 30, 78, (g) => {
    g.fillStyle = '#8a6a4a';
    g.beginPath(); g.moveTo(-3.5, 0); g.lineTo(-2.5, -20); g.lineTo(2.5, -20); g.lineTo(3.5, 0); g.closePath(); g.fill();
    const blobs: [number, number, number, number][] = [[-9, -30, 13, 0.9], [9, -31, 12, 0.85], [0, -40, 15, 1], [-2, -54, 11, 1.12]];
    for (const [x, y, r, l] of blobs) {
      const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.2, x, y, r);
      grd.addColorStop(0, `hsl(${hue * 360}, 42%, ${Math.min(80, 60 * l + 8)}%)`);
      grd.addColorStop(1, `hsl(${hue * 360}, 40%, ${46 * l}%)`);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = grd; g.fill();
      g.strokeStyle = 'rgba(40,60,30,0.25)'; g.lineWidth = 1; g.stroke();
    }
  });
}

export function paintRock(seed: number): Sprite {
  const rnd = (i: number) => { const x = Math.sin((seed + 1) * 91.7 + i * 12.9898) * 43758.5453; return x - Math.floor(x); };
  return makeSprite(70, 70, 35, 50, (g) => {
    const n = 7, pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = 20 + rnd(i) * 8;
      pts.push([Math.cos(a) * r, -14 + Math.sin(a) * r * 0.75]);
    }
    poly(g, pts, '#a79e91');
    // 亮面
    poly(g, [pts[4], pts[5], pts[6], [4, -20]], '#c3bbaf', '');
    g.setLineDash([2, 3]); g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.moveTo(pts[4][0] * 0.7, pts[4][1] * 0.7 - 4); g.lineTo(pts[6][0] * 0.7, pts[6][1] * 0.7 - 4); g.stroke();
    g.setLineDash([]);
  });
}
