import './style.css';
import { GameLoop } from './core/loop';
import { createDevPanel } from './debug/devPanel';
import { isTyping } from './render/camera';
import { GameRenderer } from './render/renderer';
import { BK, BUILDING_KINDS, UK } from './sim/data';
import { MAX_UNITS, World } from './sim/world';

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
const renderer = new GameRenderer(app, MAX_UNITS);
renderer.setWorld(world);

let tool: ToolId = 'select';
let mouse = { x: 0, y: 0, in: false };
let held = false;
let lastPaintTile = -1;
let lastSpray = 0;

function newWorld(seed?: number): void {
  world = new World(seed ?? Math.floor(Math.random() * 1e6));
  renderer.setWorld(world);
  $('over').style.display = 'none';
}

const loop = new GameLoop(
  (dt) => { if (!world.gameOver) world.step(dt); },
  (alpha, frameDt) => {
    renderer.cam.update(frameDt);
    updateGhost();
    renderer.render(alpha);
    if (world.gameOver && $('over').style.display !== 'flex') {
      $('overTxt').textContent = `💔 城堡被拆了！撐過 ${world.wave} 波，擊殺 ${world.kills}`;
      $('over').style.display = 'flex';
    }
  },
);

createDevPanel({ getWorld: () => world, newWorld, loop, renderer });

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
  else if (k === ' ') { e.preventDefault(); world.spawnWave(); }
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
  $('hWave').textContent = String(world.wave);
  $('hNext').textContent = world.autoWaves ? `下一波 ${Math.ceil(world.waveTimer)}s` : '自動波次關閉';
  $('hKills').textContent = String(world.kills);
  const s = loop.stats, info = renderer.gl.info.render;
  $('stats').textContent =
    `FPS ${s.fps}  模擬 ${s.simMs.toFixed(2)}ms  繪圖 ${s.renderMs.toFixed(2)}ms\n` +
    `單位 ${world.units.count}  待生成 ${world.pendingSpawns}  draw calls ${info.calls}  三角形 ${(info.triangles / 1000).toFixed(0)}k\n` +
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
