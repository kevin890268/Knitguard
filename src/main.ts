import './style.css';
import { GameLoop } from './core/loop';
import { createDevPanel } from './debug/devPanel';
import { isTyping } from './render/camera';
import { makeCutout } from './render/art/imageTo3d';
import { GameRenderer } from './render/renderer';
import { Renderer2D } from './render2d/renderer2d';
import { BK, BUILDING_KINDS, UK } from './sim/data';
import { MAX_UNITS, World } from './sim/world';

/** 預設是 2D 斜角；網址加 ?3d 用 3D 版 */
const USE_3D = new URLSearchParams(location.search).has('3d');
export type AnyRenderer = GameRenderer | Renderer2D;

// ---------------------------------------------------------------- 工具列定義
type ToolId = 'select' | 'wall' | 'tower' | 'barracks' | 'erase' | 'rally' | 'sheep' | 'enemy';
interface Tool { id: ToolId; key: string; icon: string; label: string; building?: number; debug?: boolean; }
const TOOLS: Tool[] = [
  { id: 'select', key: 'Esc', icon: '👆', label: '選取' },
  { id: 'wall', key: '1', icon: '🧱', label: '毛氈牆', building: BK.Wall },
  { id: 'tower', key: '2', icon: '🧵', label: '線軸箭塔', building: BK.Tower },
  { id: 'barracks', key: '3', icon: '🐑', label: '羊圈', building: BK.Barracks },
  { id: 'erase', key: 'X', icon: '✂️', label: '拆除' },
  { id: 'sheep', key: '8', icon: '🐏', label: '放綿羊', debug: true },
  { id: 'enemy', key: '9', icon: '👾', label: '放怪物', debug: true },
];

const $ = (id: string) => document.getElementById(id)!;
const app = $('app');

let world = new World(Math.floor(Math.random() * 1e6));
const renderer: AnyRenderer = USE_3D ? new GameRenderer(app, MAX_UNITS) : new Renderer2D(app, MAX_UNITS);
renderer.setWorld(world);
$('help').innerHTML = USE_3D
  ? '左鍵：使用工具（牆可拖曳）<br>右鍵拖曳：旋轉　滾輪：縮放<br>WASD：移動　Q/E：轉向<br>空白：下一波　P：暫停　F：流場　U：升級'
  : '左鍵：使用工具（牆可拖曳）<br>右鍵拖曳：平移　滾輪：縮放<br>WASD：移動<br>空白：下一波　P：暫停　F：流場　U：升級';

let tool: ToolId = 'select';
let mouse = { x: 0, y: 0, in: false };
let held = false;
let lastPaintTile = -1;
let lastSpray = 0;

// ---------------------------------------------------------------- DEMO 設定
/** DEMO：撐過 5 波就贏。網址加 ?dev 顯示開發者沙盒和除錯工具（或按 ` 鍵） */
const DEV = new URLSearchParams(location.search).has('dev');
/**
 * DEMO：新兵種每種各 10 隻擺在城堡旁邊，防守 2 波（第 1 波大、第 2 波小）。
 * 排法：近戰最外圈、短程和輔助中間、長程最內圈。
 */
const DEMO = {
  waves: [900, 300], // 第 1 波大、第 2 波小
  mix: [0.55, 0.3, 0.15] as [number, number, number], // 毛球怪、飛毛蟲、大毛怪
  firstWave: 25,
  interval: 45,
  perKind: 10,
  rings: [
    { r: 5.4, kinds: [UK.Lancer, UK.Spineball, UK.DogCav] },
    { r: 4.2, kinds: [UK.Javelin, UK.Barker, UK.Trapper] },
    { r: 3.4, kinds: [UK.Horn, UK.StBernard] },
    { r: 2.7, kinds: [UK.Archer, UK.Catapult, UK.Ballista] },
  ],
};
let started = false;

function setupWorld(w: World): void {
  w.victoryWave = DEMO.waves.length;
  w.waveSizes = DEMO.waves;
  w.waveMix = DEMO.mix;
  w.waveTimer = DEMO.firstWave;
  w.waveInterval = DEMO.interval;
  const cx = w.map.baseX + 1.5, cy = w.map.baseY + 1.5;
  for (const ring of DEMO.rings) {
    const n = ring.kinds.length * DEMO.perKind;
    for (let s = 0; s < n; s++) {
      const kind = ring.kinds[s % ring.kinds.length]; // 不同兵種交錯排
      const a = (s / n) * Math.PI * 2;
      // 落在石頭、水、樹上就往外挪一點
      let r = ring.r, x = cx, y = cy;
      for (let tries = 0; tries < 6; tries++, r += 0.5) {
        x = cx + Math.cos(a) * r; y = cy + Math.sin(a) * r;
        if (!w.isSolid(Math.floor(x), Math.floor(y))) break;
      }
      w.spawnUnitAt(kind, x, y);
    }
  }
}
setupWorld(world);

function newWorld(seed?: number): void {
  world = new World(seed ?? Math.floor(Math.random() * 1e6));
  setupWorld(world);
  renderer.setWorld(world);
  $('over').style.display = 'none';
}

const loop = new GameLoop(
  (dt) => { if (started && !world.gameOver && !world.victory) world.step(dt); },
  (alpha, frameDt) => {
    renderer.cam.update(frameDt);
    updateGhost();
    renderer.render(alpha);
    if ((world.gameOver || world.victory) && $('over').style.display !== 'flex') {
      $('overTxt').innerHTML = world.victory
        ? `🎉 守住山谷了！<br><small>撐過 ${world.wave} 波，擊殺 ${world.kills}，城堡還剩 ${Math.ceil(world.base.hp)} 耐久</small>`
        : `💔 城堡被拆了！<br><small>撐到第 ${world.wave} 波，擊殺 ${world.kills}</small>`;
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

// ---------------------------------------------------------------- 工具列 UI
const toolbar = $('toolbar');
for (const t of TOOLS) {
  const b = document.createElement('button');
  b.id = 'tool_' + t.id;
  b.className = 'tool' + (t.debug ? ' debug' : '');
  const cost = t.building !== undefined ? `<span class="cost">💰${BUILDING_KINDS[t.building].cost}</span>` : '';
  b.innerHTML = `<span class="ico">${t.icon}</span><span class="lbl">${t.label}</span>${cost}<span class="key">${t.key}</span>`;
  b.onclick = () => setTool(t.id);
  toolbar.appendChild(b);
}
function setTool(id: ToolId): void {
  tool = id;
  for (const t of TOOLS) $('tool_' + t.id).classList.toggle('on', t.id === id);
}
setTool('select');

// ---------------------------------------------------------------- 滑鼠
const canvas = renderer.canvas;
canvas.addEventListener('pointermove', (e) => {
  mouse = { x: e.clientX, y: e.clientY, in: true };
  if (held) act(false);
});
canvas.addEventListener('pointerleave', () => { mouse.in = false; });
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  held = true;
  lastPaintTile = -1;
  act(true);
});
addEventListener('pointerup', (e) => { if (e.button === 0) held = false; });

function hoverTile(size: number): { tx: number; ty: number; x: number; y: number } | null {
  const p = renderer.cam.pick(mouse.x, mouse.y);
  if (!p) return null;
  return { tx: Math.floor(p.x - size / 2 + 0.5), ty: Math.floor(p.z - size / 2 + 0.5), x: p.x, y: p.z };
}

function act(first: boolean): void {
  if (world.gameOver) return;
  const t = TOOLS.find((o) => o.id === tool)!;
  if (t.building !== undefined) {
    const size = BUILDING_KINDS[t.building].size;
    const h = hoverTile(size);
    if (!h) return;
    // 牆可以拖曳連續蓋；其他建築只在按下時蓋一次
    if (!first && t.building !== BK.Wall) return;
    const key = h.ty * world.map.w + h.tx;
    if (key === lastPaintTile) return;
    lastPaintTile = key;
    const b = world.tryPlace(t.building, h.tx, h.ty);
    if (b && t.building !== BK.Wall) { renderer.selected = b; }
    return;
  }
  const h = hoverTile(1);
  if (!h) return;
  switch (tool) {
    case 'select': {
      if (!first) return;
      renderer.selected = world.buildingAtTile(h.tx, h.ty) ?? null;
      break;
    }
    case 'erase': {
      const b = world.buildingAtTile(h.tx, h.ty);
      if (b) { world.removeBuilding(b, true); if (renderer.selected === b) renderer.selected = null; }
      break;
    }
    case 'rally': {
      if (!first) return;
      const b = renderer.selected;
      if (b && b.kind === BK.Barracks && !world.isSolid(h.tx, h.ty)) world.setRally(b, h.x, h.y);
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
  const t = TOOLS.find((o) => o.id === tool)!;
  if (t.building === undefined || !mouse.in) { renderer.setGhost(false); return; }
  const k = BUILDING_KINDS[t.building];
  const h = hoverTile(k.size);
  if (!h) { renderer.setGhost(false); return; }
  renderer.setGhost(true, h.tx, h.ty, k.size, world.canPlace(t.building, h.tx, h.ty) && world.canAfford(k.cost));
}

// ---------------------------------------------------------------- 鍵盤
addEventListener('keydown', (e) => {
  if (isTyping(e)) return;
  const k = e.key.toLowerCase();
  const t = TOOLS.find((o) => o.key.toLowerCase() === k);
  if (t) { setTool(t.id); return; }
  if (k === 'escape') { setTool('select'); renderer.selected = null; }
  else if (k === ' ') { e.preventDefault(); if (started) world.spawnWave(); }
  else if (k === 'p') loop.paused = !loop.paused;
  else if (k === 'f') renderer.showFlow = !renderer.showFlow;
  else if (k === 'u' && renderer.selected) world.upgrade(renderer.selected);
  else if (k === 'delete' && renderer.selected) { world.removeBuilding(renderer.selected, true); renderer.selected = null; }
});

// ---------------------------------------------------------------- 選取面板（按鈕固定、只更新文字）
$('selUp').onclick = () => { if (renderer.selected) world.upgrade(renderer.selected); };
$('selSell').onclick = () => { if (renderer.selected) { world.removeBuilding(renderer.selected, true); renderer.selected = null; } };
$('selRally').onclick = () => setTool('rally');
$('overBtn').onclick = () => newWorld();

function updatePanels(): void {
  $('hGold').textContent = String(Math.floor(world.gold));
  $('hBase').textContent = `${Math.ceil(world.base.hp)}/${world.base.maxHp}`;
  $('hWave').textContent = world.victoryWave ? `${world.wave} / ${world.victoryWave}` : String(world.wave);
  const lastWave = world.victoryWave > 0 && world.wave >= world.victoryWave;
  $('hNext').textContent = lastWave ? `最後一波！剩 ${world.enemyCount + world.pendingSpawns} 隻`
    : !started ? '準備中' : world.autoWaves ? `下一波 ${Math.ceil(world.waveTimer)}s` : '自動波次關閉';
  $('hKills').textContent = String(world.kills);
  const s = loop.stats;
  $('stats').textContent =
    `FPS ${s.fps}  模擬 ${s.simMs.toFixed(2)}ms  繪圖 ${s.renderMs.toFixed(2)}ms\n` +
    `單位 ${world.units.count}  待生成 ${world.pendingSpawns}  ${renderer.drawStats()}\n` +
    `速度 x${loop.timeScale}${loop.paused ? '（暫停）' : ''}  種子 ${world.seed}`;

  for (const t of TOOLS) {
    if (t.building !== undefined) $('tool_' + t.id).classList.toggle('poor', !world.canAfford(BUILDING_KINDS[t.building].cost));
  }

  const b = renderer.selected;
  const panel = $('selPanel');
  if (!b || b.dead) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  const k = BUILDING_KINDS[b.kind];
  let stats = `耐久 ${Math.ceil(b.hp)} / ${b.maxHp}`;
  if (b.kind === BK.Tower) stats += `<br>傷害 ${world.towerDamage(b).toFixed(0)}　射程 ${world.towerRange(b).toFixed(1)}`;
  if (b.kind === BK.Barracks) stats += `<br>綿羊 ${b.units} / ${world.barracksCap(b)}`;
  $('selInfo').innerHTML = `<b>${k.icon} ${k.name}</b>　Lv.${b.level}<br>${stats}`;
  const cost = world.upgradeCost(b);
  const up = $('selUp') as HTMLButtonElement;
  up.style.display = b.kind === BK.Base ? 'none' : '';
  up.textContent = cost === null ? '已滿級' : `升級 💰${cost} (U)`;
  up.disabled = cost === null || !world.canAfford(cost);
  const sell = $('selSell') as HTMLButtonElement;
  sell.style.display = b.kind === BK.Base ? 'none' : '';
  sell.textContent = `拆除 +${Math.floor(b.invested * 0.5)} (Del)`;
  const rally = $('selRally') as HTMLButtonElement;
  rally.style.display = b.kind === BK.Barracks ? '' : 'none';
  rally.classList.toggle('on', tool === 'rally');
}
setInterval(updatePanels, 200);

loop.start();

// 方便在瀏覽器 console 除錯：window.game.world
(window as unknown as { game: unknown }).game = { get world() { return world; }, loop, renderer };
