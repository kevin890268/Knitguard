import './style.css';
import { GameLoop } from './core/loop';
import { createDevPanel } from './debug/devPanel';
import { isTyping } from './render/camera';
import { makeCutout } from './render/art/imageTo3d';
import { GameRenderer } from './render/renderer';
import { Renderer2D } from './render2d/renderer2d';
import { BK, BUILD_CATS, BUILDING_KINDS, ECON, ENEMY_TRIBES, RESEARCH, RESEARCH_MAX, Team, TRIBES, UK, UNIT_KINDS, type ResearchLine } from './sim/data';
import { Tile } from './sim/map';
import { MAX_UNITS, World } from './sim/world';
import { ArmyControl } from './ui/army';
import { Hud, type CardCmd } from './ui/hud';
import { Minimap } from './ui/minimap';
import { FuncBar } from './ui/funcBar';

/** 預設是 2D 斜角；網址加 ?3d 用 3D 版 */
const USE_3D = new URLSearchParams(location.search).has('3d');
export type AnyRenderer = GameRenderer | Renderer2D;

// ---------------------------------------------------------------- 工具列定義
// 數字鍵留給編隊、A/S/H/R 留給部隊指令（參考世紀帝國 4），建造改用 Z/T/B
type ToolId = string; // 'select' | 'wall' | 'road' | 'erase' | 'rally' | 'sheep' | 'enemy' | 'b<建築種類>'
interface Tool { id: ToolId; key: string; icon: string; label: string; building?: number; debug?: boolean; }
const KEYED: Record<number, string> = { [BK.Wall]: 'Z', [BK.Tower]: 'T', [BK.Barracks]: 'B' };
const TOOLS: Tool[] = [
  { id: 'select', key: 'Esc', icon: '👆', label: '選取' },
  { id: 'road', key: 'G', icon: '🟫', label: '道路' },
  // 每種建築一個（市鎮中心除外）；牆、箭塔、羊族軍營有快捷鍵
  ...BUILDING_KINDS.map((k, kind): Tool | null => kind === BK.Base ? null
    : { id: kind === BK.Wall ? 'wall' : `b${kind}`, key: KEYED[kind] ?? '', icon: k.icon, label: k.name, building: kind })
    .filter((t): t is Tool => t !== null),
  { id: 'erase', key: 'X', icon: '✂️', label: '拆除' },
  { id: 'sheep', key: 'N', icon: '🐏', label: '放綿羊', debug: true },
  { id: 'enemy', key: 'M', icon: '👾', label: '放怪物', debug: true },
];

/** 工具 → 功能表按鈕 */
function toolCmd(t: Tool): CardCmd {
  const k = t.building !== undefined ? BUILDING_KINDS[t.building] : null;
  const rect = k && (k.w ?? k.size) !== (k.h ?? k.size);
  return {
    icon: t.icon, label: t.label, key: t.key, debug: t.debug,
    cost: k ? k.cost : undefined,
    tip: k ? `建造${t.label}（${k.w ?? k.size}×${k.h ?? k.size}${rect ? '，R 轉向' : ''}；右鍵取消）` : t.label,
    on: () => setTool(tool === t.id ? 'select' : t.id),
    active: () => tool === t.id,
  };
}
/** 這個工具在建造選單的哪個分類 */
function toolGroup(t: Tool): string {
  if (t.id === 'road') return 'economy';
  return BUILD_CATS.find((c) => t.building !== undefined && c.kinds.includes(t.building))?.id ?? 'tools';
}

const $ = (id: string) => document.getElementById(id)!;
const app = $('app');

const PARAMS = new URLSearchParams(location.search);
const BUILDING_DEMO = PARAMS.has('buildings');
/** ?enemies：敵人圖鑑（只排敵人，介面藏起來；和單位圖鑑同一套） */
const ENEMY_DEMO = PARAMS.has('enemies');
/** ?gallery：單位圖鑑（我方十族＋敵人，介面藏起來） */
const GALLERY_DEMO = PARAMS.has('gallery') || ENEMY_DEMO;
/** 預設（或 ?units）：遊戲本體——兵種 DEMO，有完整介面 */
const UNIT_DEMO = !GALLERY_DEMO && !BUILDING_DEMO;
/** 單位圖鑑用小地圖（至少 48×48，排數多就放大到放得下），其他 DEMO 用一般大小 */
const GALLERY_ROWS = ENEMY_DEMO ? ENEMY_TRIBES.length : TRIBES.length + ENEMY_TRIBES.length;
const GALLERY_SIZE = Math.max(48, Math.ceil(ENEMY_DEMO ? 6.5 + (GALLERY_ROWS - 1) * 3.8 : 4 + (GALLERY_ROWS - 1) * 2.6) + 28);
const mapSize = () => (UNIT_DEMO || BUILDING_DEMO ? undefined : GALLERY_SIZE);
/** 遊戲本體：市鎮中心在最下方；圖鑑、展示：在正中間 */
const mapLayout = (): 'south' | 'center' => (UNIT_DEMO ? 'south' : 'center');
let world = new World(Math.floor(Math.random() * 1e6), mapSize(), mapLayout());
const renderer: AnyRenderer = USE_3D ? new GameRenderer(app, MAX_UNITS) : new Renderer2D(app, MAX_UNITS);
renderer.setWorld(world);
const army = new ArmyControl(() => world, renderer, MAX_UNITS);
// 沒選部隊時 WASD 移動鏡頭；選了部隊 A＝攻擊移動、S＝停止
renderer.cam.allowWasd = () => army.sel.length === 0;
// 選了部隊：右鍵按住是預覽站位、拖曳轉向（不拖鏡頭）；沒選部隊時右鍵拖曳照舊移動鏡頭
renderer.cam.allowRightDrag = () => army.sel.length === 0 || tool !== 'select';
$('help').innerHTML =
  '<b>部隊</b>　左鍵點選／框選　Shift 加選　雙擊選同兵種　Ctrl+A 全選<br>' +
  '右鍵：移動／攻擊　Shift+右鍵：排路線<br>' +
  '右鍵按住：看站位（綠圈）　按住繞著拖：轉陣型方向（A 之後左鍵按住＝紅圈，攻擊移動）<br>' +
  'A 攻擊移動　R 巡邏　S 停止　H 堅守<br>' +
  'Ctrl+數字 編隊　數字 選隊（按兩下跳過去）<br>' +
  '<b>建造</b>　Z 牆　T 箭塔　B 羊圈　X 拆除　U 升級<br>' +
  (USE_3D ? '方向鍵（沒選部隊時 WASD）移動　右鍵拖曳旋轉　Q/E 轉向　滾輪縮放<br>' : '方向鍵（沒選部隊時 WASD、右鍵拖曳）平移　滾輪縮放<br>') +
  '空白：下一波　P：暫停　Esc：取消／暫停選單';

let tool: ToolId = 'select';
let mouse = { x: 0, y: 0, in: false };
let held = false;
let lastPaintTile = -1;
let lastSpray = 0;

// ---------------------------------------------------------------- DEMO 設定
/** DEMO：撐過 5 波就贏。網址加 ?dev 顯示開發者沙盒和除錯工具（或按 ` 鍵） */
const DEV = new URLSearchParams(location.search).has('dev');
/**
 * 兵種 DEMO（預設／?units）：十族（羊、刺刺、狗、豬人、牛人、鹿、狼人、魚人、蛛人、樹人）每種兵各 10 隻擺在城堡旁邊，防守 1 波大的。
 * 排法：貼著市鎮中心擠成一團（遠程和攻城器在最內圈、近戰在最外圈），每隻面朝外。
 * 我方每種兵各 10 隻（包含攻城武器：投石車、弩砲、衝撞車…）。
 */
const DEMO = {
  waves: [3000], // 只有一波 3000 隻
  // 屍潮組成用預設（data.ts 的 WAVE_MIX：骨頭族為主，混一些毛球族）
  // 地圖 256×256、敵人從上方邊緣走到最下方的市鎮中心要 100–160 秒 → 開場 3 秒就出第一波（約 2 分鐘後抵達）
  firstWave: 3,
  interval: 45,
  perKind: 10,
  rings: [
    { r: 6.2, kinds: [UK.Lancer, UK.Spineball, UK.DogCav, UK.PigHammer, UK.PigGiant, UK.BullAxe, UK.BullGreataxe, UK.DeerSaber, UK.WolfClaw, UK.WolfBerserker, UK.FishSpear, UK.FishAnchor, UK.SpiderDrop, UK.SpiderFlail, UK.TreantShield, UK.TreantClub] },
    { r: 4.9, kinds: [UK.Javelin, UK.Barker, UK.BullRam, UK.DeerRam, UK.WolfSlinger, UK.FishHarpoon, UK.SpiderWeb, UK.TreantJavelin, UK.TreantAxeCart] },
    { r: 3.9, kinds: [UK.Horn, UK.StBernard, UK.DeerDruid] },
    { r: 2.9, kinds: [UK.Archer, UK.Catapult, UK.Ballista, UK.PigCrossbow, UK.PigCatapult, UK.BullArcher, UK.DeerLongbow, UK.WolfTrebuchet, UK.FishCannon, UK.SpiderBallista] },
  ],
};
let started = false;

/**
 * 三種 DEMO（網址決定）：
 *   預設（?units）  遊戲本體／兵種 DEMO：十族圍在城堡旁防守 2 波，有完整介面（資訊列、功能表）
 *   ?gallery        單位圖鑑：一個種族一排、每種兵 3 隻面向鏡頭站好；沒有介面、波次（?enemies 只排敵人）
 *   ?buildings      建築展示：所有建築的每個等級
 */

/** 單位圖鑑的排法：一個種族一排 */
const GALLERY = (ENEMY_DEMO
  ? ENEMY_TRIBES
  : [...TRIBES, ...ENEMY_TRIBES]).map((t) => ({ tribe: t.name, kinds: t.kinds }));

function setupGallery(w: World): void {
  w.autoWaves = false;
  // 小地圖（GALLERY_SIZE），整張清成草地；市鎮中心在正中間（一定要有，被拆就輸），圖鑑排在它前面（畫面下方）
  const mw = w.map.w;
  for (let i = 0; i < w.map.tiles.length; i++) {
    const x = i % mw, y = (i / mw) | 0;
    w.map.tiles[i] = x === 0 || y === 0 || x === mw - 1 || y === mw - 1 ? Tile.Tree : Tile.Grass; // 邊緣一圈樹當框
  }
  w.terrainChanged();
  // 斜角畫面：x−y 是左右、x+y 是上下 → 一排沿 (1,−1) 方向排開，排與排沿 (1,1) 往下
  const cx = w.map.baseX + 1.5, cy = w.map.baseY + 1.5;
  GALLERY.forEach((row, r) => {
    const n = row.kinds.length * 3;
    let c = 0;
    for (const kind of row.kinds) for (let k = 0; k < 3; k++, c++) {
      const along = (c - (n - 1) / 2) * 0.75 + (Math.floor(c / 3) - (row.kinds.length - 1) / 2) * 0.6; // 同一種兵靠近一點，種類之間空一點
      const down = ENEMY_DEMO ? 6.5 + r * 3.8 : 4 + r * 2.6; // 每排之間要夠遠（斜角畫面上往下 1 格只有半格高）
      const gx = cx + down / 2 + along, gy = cy + down / 2 - along;
      const i = w.spawnUnitAt(kind, gx, gy);
      if (i < 0) continue;
      const u = w.units;
      u.team[i] = Team.Player; // 敵人（骨頭族）也排進來展示：當成我方，才不會去拆城堡
      u.homeX[i] = gx; u.homeY[i] = gy;
      u.face[i] = Math.PI / 4; // 面向鏡頭
      u.hold[i] = 1;
    }
  });
}

/** 單位圖鑑：鏡頭對準圖鑑中間 */
function lookAtGallery(): void {
  if (UNIT_DEMO || BUILDING_DEMO) return;
  const c = world.map.baseX + 1.5 + (ENEMY_DEMO ? 6.5 + (GALLERY.length - 1) * 3.8 : 4 + (GALLERY.length - 1) * 2.6) / 4 + (ENEMY_DEMO ? 1 : 0);
  renderer.cam.target.set(c, 0, c);
}

function setupShowcase(w: World): void {
  w.autoWaves = false;
  w.freeBuild = true;
  const { w: mw, h: mh } = w.map, by = w.map.baseY;
  // 展示區清成草地（樹和石頭會擋住建築）
  for (let y = by + 4; y < mh - 1; y++)
    for (let x = 1; x < mw - 1; x++) w.map.tiles[y * mw + x] = Tile.Grass;
  // 每種建築一組（等級 1、2、3 排一排），一排 7 組；每排建築的下緣貼著一條橫向道路
  const kinds = BUILDING_KINDS.map((_, i) => i).filter((k) => k !== BK.Base && k !== BK.Wall);
  kinds.forEach((kind, n) => {
    const s = w.dims(kind)[1];
    const row = Math.floor(n / 7), x0 = 3 + 13 * (n % 7), roadY = by + 8 + 5 * row;
    for (let lv = 1; lv <= 3; lv++) {
      const b = w.tryPlace(kind, x0 + 4 * (lv - 1), roadY - s);
      if (b) { b.level = lv; w.buildingsVersion++; }
    }
  });
  const rows = Math.ceil(kinds.length / 7);
  for (let r = 0; r < rows; r++) for (let x = 2; x < mw - 2; x++) w.placeRoad(x, by + 8 + 5 * r);
  // 市鎮中心旁邊：用牆圍住一隻綿羊，示範「無法移動」
  const px = w.map.baseX - 6, py = by;
  for (let y = py; y <= py + 2; y++)
    for (let x = px; x <= px + 2; x++) {
      if (!w.map.inBounds(x, y)) continue;
      w.map.tiles[y * mw + x] = Tile.Grass;
      if (x !== px + 1 || y !== py + 1) w.tryPlace(BK.Wall, x, y);
    }
  w.spawnUnitAt(UK.Sheep, px + 1.5, py + 1.5);
  // 市鎮中心右邊：其他四個階段（原本的市鎮中心是階段 1）
  const bx = w.map.baseX;
  for (let y = by - 2; y <= by + 3; y++)
    for (let x = bx + 3; x < Math.min(mw - 1, bx + 26); x++) w.map.tiles[y * mw + x] = Tile.Grass;
  for (let s = 2; s <= 5; s++) {
    const b = w.tryPlace(BK.Base, bx + 5 * (s - 1), by);
    if (b) { b.level = s; w.buildingsVersion++; }
  }
  // 圍羊的牆左邊：城牆三個等級各一小段
  for (let lv = 1; lv <= 3; lv++)
    for (let k = 0; k < 3; k++) {
      const x = px - 4 * lv, y = py + k;
      if (!w.map.inBounds(x, y)) continue;
      w.map.tiles[y * mw + x] = Tile.Grass;
      const b = w.tryPlace(BK.Wall, x, y);
      if (b) { b.level = lv; w.buildingsVersion++; }
    }
}

function setupWorld(w: World): void {
  if (BUILDING_DEMO) { setupShowcase(w); return; }
  if (!UNIT_DEMO) { setupGallery(w); return; }
  w.victoryWave = DEMO.waves.length;
  w.waveSizes = DEMO.waves;
  w.waveTimer = DEMO.firstWave;
  w.waveInterval = DEMO.interval;
  const cx = w.map.baseX + 1.5, cy = w.map.baseY + 1.5;
  // 全部我方貼著市鎮中心擠成一團（六角形最密排法，從市鎮中心外圍一圈一圈往外塞）：
  // 最內圈是遠程和攻城器、往外是輔助、短程，最外圈是近戰；每隻面朝外
  const kinds: number[] = [];
  for (const ring of [...DEMO.rings].reverse()) for (const kind of ring.kinds) for (let s = 0; s < DEMO.perKind; s++) kinds.push(kind);
  const step = 0.62, half = 1.5 + 0.35; // 點和點的間距；市鎮中心佔 3×3，外面留一點點
  const pts: [number, number, number][] = [];
  for (let row = -40; row <= 40; row++) { // 整片掃完再照距離排（81×81 個點，很快）
    const y = cy + row * step * 0.866;
    for (let col = -40; col <= 40; col++) {
      const x = cx + (col + (row & 1 ? 0.5 : 0)) * step;
      if (Math.abs(x - cx) < half && Math.abs(y - cy) < half) continue; // 市鎮中心上面
      if (w.isSolid(Math.floor(x), Math.floor(y))) continue;
      pts.push([x, y, Math.hypot(x - cx, y - cy)]);
    }
  }
  pts.sort((p, q) => p[2] - q[2]);
  kinds.forEach((kind, k) => {
    const [x, y] = pts[k];
    const i = w.spawnUnitAt(kind, x, y);
    if (i >= 0) w.units.face[i] = w.units.endFace[i] = Math.atan2(x - cx, y - cy); // 面朝外
  });
}
setupWorld(world);
renderer.setWorld(world); // 展示區清過地形，重建樹和石頭
lookAtGallery();

function newWorld(seed?: number): void {
  world = new World(seed ?? Math.floor(Math.random() * 1e6), mapSize(), mapLayout());
  setupWorld(world);
  renderer.setWorld(world);
  lookAtGallery();
  army.reset();
  hud.invalidate();
  $('over').style.display = 'none';
}

const dragBox = $('dragBox');
const loop = new GameLoop(
  (dt) => { if (started && !world.gameOver && !world.victory) world.step(dt); },
  (alpha, frameDt) => {
    renderer.cam.update(frameDt);
    army.prune();
    army.holdUpdate(); // 右鍵按住時的站位預覽
    updateGhost();
    renderer.render(alpha);
    if ((world.gameOver || world.victory) && $('over').style.display !== 'flex') {
      $('overTxt').innerHTML = world.victory
        ? `🎉 守住山谷了！<br><small>撐過 ${world.wave} 波，擊殺 ${world.kills}，市鎮中心還剩 ${Math.ceil(world.base.hp)} 耐久</small>`
        : `💔 市鎮中心被拆了！<br><small>撐到第 ${world.wave} 波，擊殺 ${world.kills}</small>`;
      $('over').style.display = 'flex';
    }
  },
);

const gui = createDevPanel({ getWorld: () => world, newWorld, loop, renderer });
if (!DEV) {
  gui.hide();
  document.body.classList.add('demo');
}
addEventListener('keydown', (e) => {
  if (e.key === '`') { gui._hidden ? gui.show() : gui.hide(); document.body.classList.toggle('demo', gui._hidden); }
});

// 標題畫面：羊人圖是綠底的設定圖，載入時去背
{
  const hero = document.querySelector<HTMLImageElement>('#title .hero')!;
  hero.style.visibility = 'hidden';
  const src = new Image();
  src.onload = () => {
    const c = makeCutout(src, 30);
    if (!c) return;
    const cv = document.createElement('canvas');
    cv.width = c.w; cv.height = c.h;
    cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(c.rgba), c.w, c.h), 0, 0);
    hero.src = cv.toDataURL();
    hero.style.visibility = '';
  };
  src.src = hero.getAttribute('src')!;
}
$('titleStart').onclick = () => {
  $('title').style.display = 'none';
  started = true;
};
if (!UNIT_DEMO) $('titleStart').click(); // 單位圖鑑、建築展示：不用標題畫面
// 單位圖鑑：只看單位，不顯示任何操作介面（資源列、功能表、資訊列、操作說明）
if (!UNIT_DEMO && !BUILDING_DEMO) document.body.classList.add('gallery');

// ---------------------------------------------------------------- 暫停選單（ESC）
let pausedBeforeMenu = false;
function pauseOpen(): boolean { return $('pauseMenu').classList.contains('open'); }
function setPauseMenu(open: boolean): void {
  if (open === pauseOpen()) return;
  if (open) { pausedBeforeMenu = loop.paused; loop.paused = true; }
  else loop.paused = pausedBeforeMenu;
  $('pauseMenu').classList.toggle('open', open);
  $('pmHelpText').classList.remove('show');
}
$('pmResume').onclick = () => setPauseMenu(false);
$('pmHelp').onclick = () => { $('pmHelpText').innerHTML = $('help').innerHTML; $('pmHelpText').classList.toggle('show'); };
$('pmRestart').onclick = () => { setPauseMenu(false); loop.paused = false; newWorld(); };
$('pmTitle').onclick = () => {
  setPauseMenu(false); loop.paused = false;
  newWorld();
  started = false;
  $('title').style.display = '';
};
$('pauseMenu').addEventListener('pointerdown', (e) => { if (e.target === $('pauseMenu')) setPauseMenu(false); }); // 點外面也關掉

// ---------------------------------------------------------------- 最下方資訊列（參考世紀帝國 4）＋小地圖
function setTool(id: ToolId): void {
  tool = id;
  if (id !== 'select') army.mode = null;
}
const hud = new Hud({
  getWorld: () => world,
  army,
  getBuilding: () => renderer.selected,
  setBuilding: (b) => { renderer.selected = b; },
  getDeposit: () => renderer.selectedDeposit,
  setDeposit: (d) => { renderer.selectedDeposit = d; },
  portrait: (k) => renderer.portrait(k),
  // 沒選東西：指令卡空著（建造在上面的功能表）
  buildCmds: () => [],
  // 選到建築：升級、拆除、集結點
  buildingCmds: (b) => {
    const cost = world.upgradeCost(b);
    const names = BUILDING_KINDS[b.kind].levelNames;
    const next = names?.[b.level]; // 市鎮中心：下一個階段的名字
    const up: CardCmd = { icon: '⬆️', label: b.job ? '升級中…' : cost === null ? '已滿級' : next ? `進化：${next}` : '升級', key: 'U', cost: cost ?? undefined,
      tip: next ? `進化成「${next}」：更耐打` : '升級：更耐打、更強',
      on: () => { world.upgrade(b); hud.invalidate(); }, disabled: () => cost === null || !world.canAfford(cost) };
    if (b.kind === BK.Base) return [up];
    const cmds: CardCmd[] = [
      up,
      { icon: '✂️', label: `拆除 +${Math.floor(b.invested * 0.5)}`, key: 'Del', tip: '拆掉，退一半的錢',
        on: () => { world.removeBuilding(b, true); renderer.selected = null; } },
    ];
    // 兵工廠：四條研究線（0～4 級）
    if (b.kind === BK.Arsenal) {
      for (const line of Object.keys(RESEARCH) as ResearchLine[]) {
        const r = RESEARCH[line], lv = world.research[0][line], c = world.researchCost(b, line);
        cmds.push({ icon: r.icon, label: lv >= RESEARCH_MAX ? `${r.name} 滿級` : `${r.name} ${lv}→${lv + 1}`, cost: c ?? undefined,
          tip: line.endsWith('Atk') ? `${r.name}：每一級傷害 +1（重擊兵 +2，攻城器不吃）` : `${r.name}：每一級防禦 +1`,
          on: () => { world.startResearch(b, line, r.name); hud.invalidate(); },
          disabled: () => c === null || !world.canAfford(c) });
      }
    }
    if (BUILDING_KINDS[b.kind].spawnCap) cmds.push({ icon: '🚩', label: '集結點', tip: '再點地面設集結點（也可以直接右鍵點地面）', on: () => setTool('rally'), active: () => tool === 'rally' });
    return cmds;
  },
});
// ---------------------------------------------------------------- 功能表（資訊列上面一小排；點分類，上面再多一排它的功能）
/** 閒置的部隊：待命、沒在打、沒有堅守 */
function idleUnits(): number[] {
  const u = world.units, ids: number[] = [];
  for (let i = 0; i < u.hi; i++) if (u.alive[i] && u.team[i] === 0 && u.order[i] === 0 && u.target[i] < 0 && !u.hold[i] && !UNIT_KINDS[u.kind[i]].support) ids.push(i);
  return ids;
}
function lookAt(ids: number[]): void {
  if (!ids.length) return;
  const u = world.units;
  let x = 0, y = 0;
  for (const i of ids) { x += u.x[i]; y += u.y[i]; }
  renderer.cam.target.set(x / ids.length, 0, y / ids.length);
}
const funcBar = new FuncBar([
  {
    id: 'build', icon: '🏗️', label: '建造',
    // 第二層分類（data.ts 的 BUILD_CATS）＋最後一個「工具」放拆除和除錯用的
    groups: [
      ...BUILD_CATS.map((c) => ({
        id: c.id, icon: c.icon, label: c.label,
        items: () => c.kinds.map((kind) => toolCmd(TOOLS.find((t) => kind === 'road' ? t.id === 'road' : t.building === kind)!)),
      })),
      { id: 'tools', icon: '🧰', label: '工具', items: () => TOOLS.filter((t) => t.building === undefined && t.id !== 'select' && t.id !== 'road').map(toolCmd) },
    ],
  },
  {
    id: 'army', icon: '⚔️', label: '部隊',
    items: () => [
      { icon: '🛡️', label: '全選部隊', key: 'Ctrl+A', on: () => { army.selectAll(); renderer.selected = null; } },
      { icon: '💤', label: `閒置部隊 ${idleUnits().length}`, tip: '選取沒在做事的部隊（再點一次鏡頭跳過去）',
        on: () => { const ids = idleUnits(); if (army.sel.length && army.sel.every((i) => ids.includes(i))) lookAt(ids); army.setSelection(ids, false); renderer.selected = null; } },
      { icon: '🎯', label: '跳到選取的部隊', on: () => lookAt(army.sel), disabled: () => !army.sel.length },
    ],
  },
  {
    id: 'town', icon: '🌳', label: '市鎮中心',
    items: () => {
      const b = world.base, cost = world.upgradeCost(b), next = BUILDING_KINDS[b.kind].levelNames?.[b.level];
      return [
        { icon: '👆', label: '選取（鏡頭跳回）', on: () => { army.setSelection([], false); renderer.selected = b; renderer.cam.target.set(b.tx + 1.5, 0, b.ty + 1.5); } },
        { icon: '⬆️', label: next ? `進化：${next}` : '已是最高階段', cost: cost ?? undefined,
          on: () => { world.upgrade(b); hud.invalidate(); }, disabled: () => cost === null || !world.canAfford(cost) },
      ];
    },
  },
  {
    id: 'system', icon: '⚙️', label: '系統',
    items: () => [
      { icon: '🌊', label: '叫下一波', key: '空白', on: () => { if (started && UNIT_DEMO) world.spawnWave(); } },
      ...[1, 2, 3].map((s): CardCmd => ({ icon: '⏩', label: `速度 ×${s}`, on: () => { loop.timeScale = s; }, active: () => loop.timeScale === s })),
      { icon: '⏸', label: '暫停選單', key: 'Esc', on: () => setPauseMenu(true) },
    ],
  },
], () => (c) => world.canAfford(c));

const minimap = new Minimap($('minimap') as HTMLCanvasElement, () => world, renderer, army);
setInterval(() => minimap.render(), 100);

// ---------------------------------------------------------------- 滑鼠
const canvas = renderer.canvas;
/** 左鍵按下的位置（框選用）；右鍵按下的位置（分辨「點一下下指令」和「拖曳平移」） */
let boxStart: { x: number; y: number } | null = null;
let rightDown: { x: number; y: number } | null = null;
let leftDown: { x: number; y: number } | null = null; // A 攻擊移動：左鍵按下的位置（按住拖曳轉方向用）
let lastClick = { t: 0, unit: -1 };

canvas.addEventListener('pointermove', (e) => {
  mouse = { x: e.clientX, y: e.clientY, in: true };
  if (boxStart) {
    const l = Math.min(boxStart.x, e.clientX), t = Math.min(boxStart.y, e.clientY);
    const w = Math.abs(e.clientX - boxStart.x), h = Math.abs(e.clientY - boxStart.y);
    const show = w > 5 || h > 5;
    dragBox.style.display = show ? 'block' : 'none';
    if (show) Object.assign(dragBox.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px` });
  }
  if (held) act(false);
});
canvas.addEventListener('pointerleave', () => { mouse.in = false; });
canvas.addEventListener('pointermove', (e) => { if (army.holding) army.holdMove(e.clientX, e.clientY); }); // 右鍵按住拖曳：轉陣型
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 2) {
    rightDown = { x: e.clientX, y: e.clientY };
    if (tool === 'select') army.holdStart(e.clientX, e.clientY); // 有選部隊：開始預覽站位
    return;
  }
  if (e.button !== 0) return;
  if (army.mode) {
    // A 攻擊移動：左鍵按住和右鍵一樣可以看站位（紅圈）、繞著拖轉方向；巡邏照舊點一下
    if (army.mode === 'attackMove') { leftDown = { x: e.clientX, y: e.clientY }; if (army.holdStart(e.clientX, e.clientY, true)) return; leftDown = null; }
    army.modeClick(e.clientX, e.clientY, e.shiftKey);
    return;
  }
  if (tool === 'select') { boxStart = { x: e.clientX, y: e.clientY }; return; }
  held = true;
  lastPaintTile = -1;
  act(true);
});
addEventListener('pointerup', (e) => {
  if (e.button === 2 && rightDown) {
    const moved = Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y);
    rightDown = null;
    // 右鍵按住拖過：照預覽的站位和朝向移動
    if (army.holding && moved >= 6) { army.holdEnd(e.shiftKey); return; }
    army.holdCancel(); // 沒拖：取消預覽，交給一般右鍵（點敵人＝攻擊、點地面＝移動）
    if (moved < 6 && e.target === canvas) rightClick(e.clientX, e.clientY, e.shiftKey);
    return;
  }
  if (e.button === 0 && leftDown) {
    // A 攻擊移動按住：拖過＝照預覽的站位和方向攻擊移動；沒拖＝和以前一樣點一下（點在敵人上＝攻擊）
    const moved = Math.hypot(e.clientX - leftDown.x, e.clientY - leftDown.y);
    leftDown = null;
    if (army.holding && moved >= 6) { army.holdEnd(e.shiftKey); return; }
    army.holdCancel();
    army.modeClick(e.clientX, e.clientY, e.shiftKey);
    return;
  }
  if (e.button !== 0) return;
  held = false;
  if (boxStart) {
    const start = boxStart;
    boxStart = null;
    dragBox.style.display = 'none';
    if (Math.abs(e.clientX - start.x) > 5 || Math.abs(e.clientY - start.y) > 5) {
      army.boxSelect(start.x, start.y, e.clientX, e.clientY, e.shiftKey);
      if (army.sel.length) renderer.selected = null;
    } else clickSelect(e.clientX, e.clientY, e.shiftKey, e.ctrlKey);
    hud.update(); // 選取一換，下方資訊列馬上更新
  }
});

/** 左鍵點一下：單位 → 選單位（雙擊或 Ctrl 選同兵種）；不然選建築；再不然選資源聚落（礦、果樹） */
function clickSelect(cx: number, cy: number, shift: boolean, ctrl: boolean): void {
  const i = army.pickUnit(cx, cy);
  if (!shift) renderer.selectedDeposit = -1;
  const u = world.units;
  if (i >= 0 && u.team[i] === 0) {
    const now = performance.now();
    const dbl = lastClick.unit === i && now - lastClick.t < 350;
    lastClick = { t: now, unit: i };
    if (dbl || ctrl) army.selectSameKind(i, shift);
    else if (shift && army.sel.includes(i)) army.setSelection(army.sel.filter((j) => j !== i), false); // Shift 再點一次 = 取消
    else army.setSelection([i], shift);
    renderer.selected = null;
    return;
  }
  if (i >= 0) { army.setInspect(i); renderer.selected = null; return; } // 敵人：只看資訊
  if (shift) return;
  army.setSelection([], false);
  const h = hoverTile(1);
  renderer.selected = h ? world.buildingAtTile(h.tx, h.ty) ?? null : null;
  // 點到石頭／樹（圖比格子高，點到圖的上半部也算）→ 選那一整個聚落
  if (!renderer.selected && h) renderer.selectedDeposit = world.map.depositNear(h.tx, h.ty);
}

/** 右鍵點一下：部隊 → 移動／攻擊；兵營 → 設集結點 */
function rightClick(cx: number, cy: number, shift: boolean): void {
  if (tool !== 'select') { setTool('select'); return; } // 右鍵取消建造
  if (army.rightClick(cx, cy, shift)) return;
  const b = renderer.selected;
  const p = renderer.cam.pick(cx, cy);
  if (b && BUILDING_KINDS[b.kind].spawnCap && p && !world.isSolid(Math.floor(p.x), Math.floor(p.z))) world.setRally(b, p.x, p.z);
}

function hoverTile(size: number, hgt = size): { tx: number; ty: number; x: number; y: number } | null {
  const p = renderer.cam.pick(mouse.x, mouse.y);
  if (!p) return null;
  return { tx: Math.floor(p.x - size / 2 + 0.5), ty: Math.floor(p.z - hgt / 2 + 0.5), x: p.x, y: p.z };
}

/** 放長方形建築（城門）時按 R 轉 90 度 */
let placeRot = false;

function act(first: boolean): void {
  if (world.gameOver) return;
  const t = TOOLS.find((o) => o.id === tool);
  if (t && t.building !== undefined) {
    const [bw, bh] = world.dims(t.building, placeRot);
    const h = hoverTile(bw, bh);
    if (!h) return;
    // 牆可以拖曳連續蓋；其他建築只在按下時蓋一次
    if (!first && t.building !== BK.Wall) return;
    const key = h.ty * world.map.w + h.tx;
    if (key === lastPaintTile) return;
    lastPaintTile = key;
    const b = world.tryPlace(t.building, h.tx, h.ty, placeRot);
    if (b && t.building !== BK.Wall) { renderer.selected = b; army.setSelection([], false); }
    return;
  }
  const h = hoverTile(1);
  if (!h) return;
  switch (tool) {
    case 'road': {
      // 可以拖曳連續鋪
      const key = h.ty * world.map.w + h.tx;
      if (key === lastPaintTile) return;
      lastPaintTile = key;
      world.placeRoad(h.tx, h.ty);
      break;
    }
    case 'erase': {
      const b = world.buildingAtTile(h.tx, h.ty);
      if (b) { world.removeBuilding(b, true); if (renderer.selected === b) renderer.selected = null; }
      else world.removeRoad(h.tx, h.ty);
      break;
    }
    case 'rally': {
      if (!first) return;
      const b = renderer.selected;
      if (b && BUILDING_KINDS[b.kind].spawnCap && !world.isSolid(h.tx, h.ty)) world.setRally(b, h.x, h.y);
      setTool('select');
      break;
    }
    case 'sheep':
    case 'enemy': {
      const now = performance.now();
      if (!first && now - lastSpray < 30) return;
      lastSpray = now;
      if (world.isSolid(h.tx, h.ty)) return;
      world.spawnUnitAt(tool === 'sheep' ? UK.Sheep : UK.Fuzz, h.x, h.y);
      break;
    }
  }
}

function updateGhost(): void {
  canvas.style.cursor = army.mode ? 'crosshair' : '';
  const t = TOOLS.find((o) => o.id === tool);
  if (tool === 'road' && mouse.in) {
    const h = hoverTile(1);
    if (h) { renderer.setGhost(true, h.tx, h.ty, 1, world.canRoad(h.tx, h.ty) && world.canAfford(ECON.roadCost)); return; }
  }
  if (!t || t.building === undefined || !mouse.in) { renderer.setGhost(false); return; }
  const k = BUILDING_KINDS[t.building], [bw, bh] = world.dims(t.building, placeRot);
  const h = hoverTile(bw, bh);
  if (!h) { renderer.setGhost(false); return; }
  renderer.setGhost(true, h.tx, h.ty, bw, world.canPlace(t.building, h.tx, h.ty, placeRot) && world.canAfford(k.cost), bh);
}

// ---------------------------------------------------------------- 鍵盤
addEventListener('keydown', (e) => {
  if (isTyping(e)) return;
  const k = e.key.toLowerCase();
  // 暫停選單開著：只有 ESC 有用（關掉選單）
  if (pauseOpen()) { if (k === 'escape') setPauseMenu(false); return; }
  // 編隊：用 e.code，Shift+數字 時 e.key 會變成符號
  const digit = /^Digit(\d)$/.exec(e.code);
  if (digit) {
    e.preventDefault();
    army.groupKey(Number(digit[1]), e.ctrlKey || e.metaKey, e.shiftKey);
    if (army.sel.length) renderer.selected = null;
    return;
  }
  if ((e.ctrlKey || e.metaKey) && k === 'a') { e.preventDefault(); army.selectAll(); renderer.selected = null; return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // 部隊指令（有選部隊時）
  if (army.sel.length) {
    if (k === 'a') { army.mode = 'attackMove'; setTool('select'); return; }
    if (k === 'r') { army.mode = 'patrol'; setTool('select'); return; }
    if (k === 's') { army.command('stop'); return; }
    if (k === 'h') { army.command('hold'); return; }
  }
  // 放長方形建築（城門）時：R 轉 90 度
  const cur = TOOLS.find((o) => o.id === tool);
  if (k === 'r' && cur?.building !== undefined) { placeRot = !placeRot; return; }
  const t = TOOLS.find((o) => o.key.toLowerCase() === k);
  if (t) { setTool(t.id); if (t.id !== 'select') funcBar.show('build', toolGroup(t)); return; } // 按建造快捷鍵：功能表跟著打開「建造」
  if (k === 'escape') {
    // ESC：先取消「等待點地面的指令」或建造工具；沒有可以取消的就打開暫停選單
    if (army.mode) { army.mode = null; return; }
    if (tool !== 'select') { setTool('select'); return; }
    if (army.sel.length || army.inspect >= 0 || renderer.selected || renderer.selectedDeposit >= 0) {
      army.setSelection([], false); renderer.selected = null; renderer.selectedDeposit = -1; return;
    }
    if (started && !world.gameOver && !world.victory) setPauseMenu(true);
  }
  else if (k === ' ') { e.preventDefault(); if (started && UNIT_DEMO) world.spawnWave(); }
  else if (k === 'p') loop.paused = !loop.paused;
  else if (k === 'f') renderer.showFlow = !renderer.showFlow;
  else if (k === 'u' && renderer.selected) { world.upgrade(renderer.selected); hud.invalidate(); }
  else if (k === 'delete' && renderer.selected) { world.removeBuilding(renderer.selected, true); renderer.selected = null; }
});

$('overBtn').onclick = () => newWorld();

function updatePanels(): void {
  const sec = Math.floor(world.time), mm = Math.floor(sec / 60), ss = sec % 60;
  $('hClock').textContent = (mm >= 60 ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}` : String(mm).padStart(2, '0')) + ':' + String(ss).padStart(2, '0');
  $('hGold').textContent = String(Math.floor(world.gold));
  $('hBase').textContent = `${Math.ceil(world.base.hp)}/${world.base.maxHp}`;
  $('hWave').textContent = world.victoryWave ? `${world.wave} / ${world.victoryWave}` : String(world.wave);
  const lastWave = world.victoryWave > 0 && world.wave >= world.victoryWave;
  const tribe = world.waveTribe ? `（${world.waveTribe}）` : '';
  $('hNext').textContent = lastWave ? `最後一波${tribe}！剩 ${world.enemyCount + world.pendingSpawns} 隻`
    : !started ? '準備中' : world.autoWaves ? `下一波 ${Math.ceil(world.waveTimer)}s` : '自動波次關閉';
  $('hKills').textContent = String(world.kills);
  const s = loop.stats;
  $('stats').textContent =
    `FPS ${s.fps}  模擬 ${s.simMs.toFixed(2)}ms  繪圖 ${s.renderMs.toFixed(2)}ms\n` +
    `單位 ${world.units.count}  待生成 ${world.pendingSpawns}  ${renderer.drawStats()}\n` +
    `速度 x${loop.timeScale}${loop.paused ? '（暫停）' : ''}  種子 ${world.seed}`;
  hud.update();
  funcBar.update();
}
setInterval(updatePanels, 200);

loop.start();

// 方便在瀏覽器 console 除錯：window.game.world
(window as unknown as { game: unknown }).game = { get world() { return world; }, loop, renderer, army };
