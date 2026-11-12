import GUI from 'lil-gui';
import type { GameLoop } from '../core/loop';
import { ART_SLOTS } from '../render/art/manifest';
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

  // ---------------------------------------------------------------- 美術（GPT 圖片 → 3D）
  const art = ctx.renderer.art;
  const fArt = gui.addFolder('🎨 美術（public/models、art）');
  const ap = { status: art.summary(), slot: ART_SLOTS[0].id };
  const statusCtl = fArt.add(ap, 'status').name('狀態').disable();
  const refresh = () => { ap.status = art.summary(); statusCtl.updateDisplay(); };
  fArt.add({ go: async () => { ap.status = '讀取中…'; statusCtl.updateDisplay(); await art.loadAll(true); refresh(); } }, 'go').name('🔄 重新載入模型和圖片');
  fArt.add({ go: () => console.table(art.status()) }, 'go').name('📋 狀態表（console）');
  setTimeout(refresh, 1500);

  // 選一個插槽即時調整；調好後按「印出數值」貼回 manifest.ts
  const cur = () => ART_SLOTS.find((s) => s.id === ap.slot)!;
  const sp = {
    get height() { return cur().height; }, set height(v: number) { cur().height = v; },
    get depth() { return cur().depth; }, set depth(v: number) { cur().depth = v; },
    get res() { return cur().res; }, set res(v: number) { cur().res = v; },
    get knit() { return cur().knit; }, set knit(v: number) { cur().knit = v; },
    get bgTolerance() { return cur().bgTolerance; }, set bgTolerance(v: number) { cur().bgTolerance = v; },
    get modelYaw() { return Math.round(((cur().modelYaw ?? 0) * 180) / Math.PI); },
    set modelYaw(v: number) { cur().modelYaw = (v * Math.PI) / 180; },
  };
  const fSlot = fArt.addFolder('調整模型');
  const ctls = [
    fSlot.add(sp, 'height', 0.3, 8, 0.05).name('高度'),
    fSlot.add(sp, 'modelYaw', -180, 180, 90).name('.glb 轉向（度）'),
    fSlot.add(sp, 'depth', 0.05, 1, 0.01).name('厚度（無第二張圖時）'),
    fSlot.add(sp, 'res', 6, 96, 1).name('網格解析度'),
    fSlot.add(sp, 'knit', 0, 1, 0.05).name('針織紋理'),
  ];
  for (const c of ctls) c.onFinishChange(() => art.rebuild(ap.slot));
  const tolCtl = fSlot.add(sp, 'bgTolerance', 5, 150, 1).name('去背容差').onFinishChange(() => art.rebuild(ap.slot, true));
  fSlot.add(ap, 'slot', Object.fromEntries(ART_SLOTS.map((s) => [`${s.label}（${s.id}）`, s.id]))).name('插槽').onChange(() => {
    for (const c of [...ctls, tolCtl]) c.updateDisplay();
  });
  fSlot.add({ go: () => {
    const s = cur();
    console.log(`${s.id}: { height: ${s.height}, modelYaw: ${(s.modelYaw ?? 0).toFixed(4)}, depth: ${s.depth}, res: ${s.res}, knit: ${s.knit}, bgTolerance: ${s.bgTolerance} }`);
  } }, 'go').name('🖨️ 印出數值（console）');
  fArt.close();

  return gui;
}
