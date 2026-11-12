import GUI from 'lil-gui';
import type { GameLoop } from '../core/loop';
import type { GameRenderer } from '../render/renderer';
import type { World } from '../sim/world';

export interface DevContext {
  getWorld(): World;
  newWorld(seed?: number): void;
  loop: GameLoop;
  renderer: GameRenderer;
}

/** 開發者沙盒面板（右上角）。可隨時加新的除錯按鈕。 */
export function createDevPanel(ctx: DevContext): GUI {
  const gui = new GUI({ title: '🧶 開發者沙盒' });
  const p = { seed: ctx.getWorld().seed, horde: 300 };

  // 透過 getter/setter 綁定「目前的」world，換地圖後依然有效
  const wp = {
    get autoWaves() { return ctx.getWorld().autoWaves; },
    set autoWaves(v: boolean) { ctx.getWorld().autoWaves = v; },
    get freeBuild() { return ctx.getWorld().freeBuild; },
    set freeBuild(v: boolean) { ctx.getWorld().freeBuild = v; },
    get waveInterval() { return ctx.getWorld().waveInterval; },
    set waveInterval(v: number) { ctx.getWorld().waveInterval = v; },
  };

  const fMap = gui.addFolder('地圖');
  const seedCtl = fMap.add(p, 'seed').name('種子');
  fMap.add({ go: () => ctx.newWorld(p.seed) }, 'go').name('用此種子重建');
  fMap.add({ go: () => { p.seed = Math.floor(Math.random() * 1e6); seedCtl.updateDisplay(); ctx.newWorld(p.seed); } }, 'go').name('🎲 隨機新地圖');

  const fTime = gui.addFolder('時間');
  fTime.add(ctx.loop, 'paused').name('暫停 (P)').listen();
  fTime.add(ctx.loop, 'timeScale', 0.1, 10, 0.1).name('時間倍率').listen();
  fTime.add({ go: () => ctx.loop.stepOnce() }, 'go').name('單步（暫停時）');

  const fSpawn = gui.addFolder('生成 / 波次');
  fSpawn.add(p, 'horde', 10, 5000, 10).name('屍潮數量');
  fSpawn.add({ go: () => ctx.getWorld().spawnHorde(p.horde) }, 'go').name('👾 生成屍潮');
  fSpawn.add({ go: () => ctx.getWorld().spawnWave() }, 'go').name('🌊 立刻下一波 (空白)');
  fSpawn.add(wp, 'autoWaves').name('自動波次').listen();
  fSpawn.add(wp, 'waveInterval', 10, 120, 5).name('波次間隔(秒)').listen();

  const fEco = gui.addFolder('經濟');
  fEco.add(wp, 'freeBuild').name('免費建造').listen();
  fEco.add({ go: () => { ctx.getWorld().gold += 1000; } }, 'go').name('💰 +1000');

  const fView = gui.addFolder('顯示');
  fView.add(ctx.renderer, 'showFlow').name('流場箭頭 (F)').listen();
  fView.add(ctx.renderer, 'unitShadows').name('單位陰影');

  return gui;
}
