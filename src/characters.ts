import { ENEMY_TRIBES, MONSTER_KIND, MONSTER_TRIBES, MONSTERS, TRIBES } from './sim/data';
import { ART_SLOTS } from './render/art/manifest';
import { makeCutout } from './render/art/imageTo3d';
import { DIR_VIEWS, VIEW_FILES, type ViewName } from './render2d/sprites2d';

/**
 * 角色圖鑑（characters.html）：public/sprites 裡所有角色的圖，一個種族一區。
 * 卡片會原地轉一圈（8 個方向，缺的方向照遊戲的規則用另一邊鏡像）；點卡片看 8 個方向的大圖。
 * 只讀圖片，不跑遊戲。
 */

interface Char { id: string; name: string; tier?: string }
interface Group { title: string; note?: string; kind: 'player' | 'enemy' | 'new'; chars: Char[] }

const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'];

/** 還沒畫、暫時借別人圖的角色：卡片上標出來，免得以為就是這個樣子 */
const PLACEHOLDER: Record<string, string> = {
  horn: '還沒畫，暫用村民的圖',
};

const slotOf = (kind: number) => ART_SLOTS.find((s) => s.target.type === 'unit' && s.target.kind === kind);
const fromTribes = (tribes: typeof TRIBES, kind: 'player' | 'enemy'): Group[] =>
  tribes.map((t) => ({
    title: t.name, kind,
    chars: t.kinds.map(slotOf).filter((s) => !!s).map((s) => ({ id: s!.id, name: s!.label })),
  }));
/** 怪物族（單獨一族，或幾族合成的種族，例如墮落森林） */
const isMonster = (id: string) => MONSTERS.some((m) => m.id === id) || id in MONSTER_TRIBES;
/** 兵種編號 → 第幾階段（0–3） */
const tierOf = (kind: number) => { for (const tiers of MONSTER_KIND) { const t = tiers.indexOf(kind); if (t >= 0) return t; } return -1; };
const GROUPS: Group[] = [
  ...fromTribes(TRIBES, 'player'),
  ...fromTribes(ENEMY_TRIBES.filter((t) => !isMonster(t.id)), 'enemy'),
  // 怪物族：每族四階段 Ⅰ→Ⅳ（數值在 data.ts 的 MONSTERS）；合成的種族裡每族一排四張
  ...ENEMY_TRIBES.filter((t) => isMonster(t.id)).map((t): Group => {
    const fams = t.kinds.length / 4;
    return {
      title: t.name, note: fams > 1 ? `${fams} 族合成・各四階段 Ⅰ→Ⅳ` : '四階段 Ⅰ→Ⅳ', kind: 'new',
      chars: t.kinds.map((k) => ({ id: slotOf(k)!.id, name: slotOf(k)!.label, tier: ROMAN[tierOf(k)] })),
    };
  }),
];

// ---------------------------------------------------------------- 讀圖
type Views = Partial<Record<ViewName, HTMLCanvasElement>>;
const BASE = import.meta.env.BASE_URL + 'sprites/';
const cache = new Map<string, Promise<Views>>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
}
function loadViews(id: string): Promise<Views> {
  if (!cache.has(id)) cache.set(id, (async () => {
    const tol = ART_SLOTS.find((s) => s.id === id)?.bgTolerance ?? 40;
    const out: Views = {};
    await Promise.all(VIEW_FILES.map(async (v) => {
      const im = await loadImage(`${BASE}${id}/${v}.png`);
      const c = im && makeCutout(im, tol);
      if (!c) return;
      const cv = document.createElement('canvas');
      cv.width = c.w; cv.height = c.h;
      cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(c.rgba), c.w, c.h), 0, 0);
      out[v] = cv;
    }));
    return out;
  })());
  return cache.get(id)!;
}

/** 方向 d（遊戲的 0–7）要用哪張圖、要不要鏡像 */
function pick(views: Views, d: number): { img: HTMLCanvasElement; flip: boolean; exact: boolean } | null {
  for (const [name, flip] of DIR_VIEWS[d]) {
    const img = views[name];
    if (img) return { img, flip, exact: name === DIR_VIEWS[d][0][0] && !flip };
  }
  return null;
}

/** 同一隻角色的所有方向用同一個縮放（以最大的圖為準），轉起來大小才不會跳 */
function draw(cv: HTMLCanvasElement, views: Views, d: number): boolean {
  const g = cv.getContext('2d')!;
  const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  g.clearRect(0, 0, W, H);
  const p = pick(views, d);
  if (!p) return false;
  const all = Object.values(views);
  const mw = Math.max(...all.map((c) => c!.width)), mh = Math.max(...all.map((c) => c!.height));
  const s = Math.min((W * 0.94) / mw, (H * 0.94) / mh);
  const w = p.img.width * s, h = p.img.height * s;
  g.save();
  g.translate(W / 2, H - H * 0.03);
  if (p.flip) g.scale(-1, 1);
  g.imageSmoothingQuality = 'high';
  g.drawImage(p.img, -w / 2, -h, w, h);
  g.restore();
  return p.exact;
}

// ---------------------------------------------------------------- 畫面
const $ = (id: string) => document.getElementById(id)!;
const list = $('list');
const cards: { cv: HTMLCanvasElement; views: Views | null; group: Group }[] = [];

for (const grp of GROUPS) {
  const sec = document.createElement('section');
  sec.className = grp.kind === 'player' ? 'player' : 'enemy';
  sec.dataset.kind = grp.kind;
  sec.innerHTML = `<h2>${grp.title}<small>${grp.note ?? grp.chars.length + ' 種'}</small></h2>`;
  const grid = document.createElement('div');
  grid.className = grp.kind === 'new' ? 'grid grid4' : 'grid'; // 怪物族：一排 4 張＝一族的 Ⅰ→Ⅳ
  for (const ch of grp.chars) {
    const card = document.createElement('div');
    card.className = 'card';
    const cv = document.createElement('canvas');
    const name = document.createElement('div');
    name.className = 'name';
    name.innerHTML = (ch.tier ? `<span class="tier">${ch.tier}</span>` : '') + ch.name +
      (PLACEHOLDER[ch.id] ? `<br><small style="color:#c0566a">⚠ ${PLACEHOLDER[ch.id]}</small>` : '');
    if (PLACEHOLDER[ch.id]) { card.style.borderColor = '#e8798a'; cv.style.opacity = '0.45'; }
    card.append(cv, name);
    grid.appendChild(card);
    const entry = { cv, views: null as Views | null, group: grp };
    cards.push(entry);
    loadViews(ch.id).then((v) => { entry.views = v; draw(cv, v, 1); if (!v.front) name.innerHTML += '<br><small>（沒有圖）</small>'; });
    card.onclick = () => openBig(ch, grp);
  }
  sec.appendChild(grid);
  list.appendChild(sec);
}
$('count').textContent = `我方 ${GROUPS.filter((g) => g.kind === 'player').reduce((n, g) => n + g.chars.length, 0)} 種・敵人 ${GROUPS.filter((g) => g.kind !== 'player').length} 族`;

// 篩選
let filter = 'all';
document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) => {
  b.onclick = () => {
    filter = b.dataset.filter!;
    document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll<HTMLElement>('section').forEach((s) => {
      const k = s.dataset.kind;
      s.style.display = filter === 'all' || k === filter || (filter === 'enemy' && k === 'new') ? '' : 'none';
    });
  };
});

// 轉動：正面 → 右下 → 右 → 右上 → 背面 → 左上 → 左 → 左下
const SPIN = [1, 2, 3, 4, 5, 6, 7, 0];
let spinning = true, step = 0;
$('spin').onclick = () => { spinning = !spinning; $('spin').classList.toggle('on', spinning); if (!spinning) { step = 0; redraw(); } };
function redraw(): void {
  for (const c of cards) {
    if (!c.views || c.cv.offsetParent === null) continue; // 被篩掉的不畫
    draw(c.cv, c.views, SPIN[step]);
  }
}
setInterval(() => { if (spinning) { step = (step + 1) % 8; redraw(); } }, 650);
addEventListener('resize', redraw);

// 大圖：8 個方向
const DIR_NAMES = ['左下', '正面', '右下', '右', '右上', '背面', '左上', '左'];
async function openBig(ch: Char, grp: Group): Promise<void> {
  $('bigTitle').innerHTML = `${grp.title}・${ch.tier ? ch.tier + ' ' : ''}${ch.name} <small style="color:#8a7666">${ch.id}</small>`;
  const box = $('bigDirs');
  box.innerHTML = '';
  $('big').classList.add('open');
  const views = await loadViews(ch.id);
  for (const d of SPIN) {
    const cell = document.createElement('div');
    const cv = document.createElement('canvas');
    const label = document.createElement('span');
    cell.append(cv, label);
    box.appendChild(cell);
    const exact = draw(cv, views, d);
    label.textContent = DIR_NAMES[d] + (exact ? '' : '（鏡像／代用）');
    if (!exact) label.style.color = '#b9a898';
  }
}
$('big').onclick = (e) => { if (e.target === $('big')) $('big').classList.remove('open'); };
addEventListener('keydown', (e) => { if (e.key === 'Escape') $('big').classList.remove('open'); });
