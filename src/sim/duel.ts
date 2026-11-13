/**
 * 兩軍對打測試（不開畫面，純模擬）：用來調兵種的加成、血量、傷害。
 * 在 tools/duel.mjs 用指令跑，或在瀏覽器 console：game.duel(...)
 *
 * 場地：64×64 全草地，城堡在正中間。A 隊（我方）站在城堡左邊，往左攻擊移動；
 * B 隊（變成敵人）從更左邊出發，敵人沒有目標時會走向城堡 → 半路遇上 A 開打。
 * 打到一邊全滅或時間到。近戰站前排（面向對方）、遠程和攻城器站後排。
 */
import { Team, UNIT_KINDS, type ResearchLine } from './data';
import { Tile } from './map';
import { World } from './world';

export interface DuelSide {
  /** 兵種，每種 count 隻；沒寫 count 就照一般軍隊的組成：士兵一共 18 隻（平分給各種士兵）、攻城器和輔助各 2 隻 */
  kinds: number[];
  count?: number;
  /** 隻數倍數（敵人用：骨頭族通常數量多） */
  mul?: number;
  /** 研究等級（0～4），沒寫就是 0 */
  research?: Partial<Record<ResearchLine, number>>;
}

export interface DuelResult {
  winner: 'A' | 'B' | 'draw';
  time: number;
  /** 剩下的隻數、剩下的血量比例（佔開場總血量） */
  aAlive: number; bAlive: number;
  aHp: number; bHp: number;
}

const SIZE = 64;

export function duel(a: DuelSide, b: DuelSide, seed = 1, maxTime = 180): DuelResult {
  const w = new World(seed, SIZE);
  w.autoWaves = false;
  for (let i = 0; i < w.map.tiles.length; i++) w.map.tiles[i] = Tile.Grass;
  w.terrainChanged();
  Object.assign(w.research[Team.Player], a.research ?? {});
  Object.assign(w.research[Team.Enemy], b.research ?? {});
  const u = w.units;
  const cy = SIZE / 2;
  const place = (side: DuelSide, team: number): number[] => {
    const ids: number[] = [];
    const soldier = (k: number) => !UNIT_KINDS[k].wheeled && !UNIT_KINDS[k].support;
    const nSoldier = side.kinds.filter(soldier).length || 1;
    const howMany = (k: number) => Math.round((side.count || (soldier(k) ? 18 / nSoldier : 2)) * (side.mul ?? 1));
    // 前排：近戰；後排：遠程、攻城器、輔助
    const front = side.kinds.filter((k) => !(UNIT_KINDS[k].range ?? 0) && !UNIT_KINDS[k].support && !UNIT_KINDS[k].wheeled);
    const back = side.kinds.filter((k) => !front.includes(k));
    const mid = SIZE / 2;
    // A 前排 x＝mid−10（後排往城堡那邊退）；B 前排 x＝mid−22（後排往外退）
    const fx = team === Team.Player ? mid - 10 : mid - 22, back1 = team === Team.Player ? 1 : -1;
    const rows = [front, back];
    rows.forEach((kinds, r) => {
      const total = kinds.reduce((s, k) => s + howMany(k), 0);
      let c = 0;
      for (const k of kinds) for (let q = 0; q < howMany(k); q++, c++) {
        const x = fx + back1 * r * 2.2, y = cy + (c - (total - 1) / 2) * 0.8;
        const i = u.spawn(k, x, y);
        if (i < 0) continue;
        u.team[i] = team;
        ids.push(i);
      }
    });
    return ids;
  };
  const A = place(a, Team.Player), B = place(b, Team.Enemy);
  const hpOf = (ids: number[]) => ids.reduce((s, i) => s + (u.alive[i] ? Math.max(0, u.hp[i]) : 0), 0);
  const a0 = hpOf(A), b0 = hpOf(B);
  w.command(A, 'attackMove', SIZE / 2 - 24, cy);
  // 只剩輔助兵（不會打）就算輸
  const alive = (ids: number[]) => ids.filter((i) => u.alive[i]).length;
  const fighters = (ids: number[]) => ids.filter((i) => u.alive[i] && !UNIT_KINDS[u.kind[i]].support).length;
  let t = 0;
  while (t < maxTime) {
    w.step(1 / 30);
    t += 1 / 30;
    if (fighters(A) === 0 || fighters(B) === 0) break;
  }
  const aA = alive(A), bA = alive(B), aF = fighters(A), bF = fighters(B);
  return {
    winner: aF && !bF ? 'A' : bF && !aF ? 'B' : 'draw',
    time: Math.round(t),
    aAlive: aA, bAlive: bA,
    aHp: Math.round((hpOf(A) / a0) * 100) / 100,
    bHp: Math.round((hpOf(B) / b0) * 100) / 100,
  };
}

/** 對打兩次（交換左右），回傳 A 的平均分數：1＝A 兩次都贏，0＝都輸；加上兩次剩下血量的差 */
export function duelBoth(a: DuelSide, b: DuelSide, seed = 1): { score: number; detail: [DuelResult, DuelResult] } {
  const r1 = duel(a, b, seed), r2 = duel(b, a, seed + 1);
  const s = (r: DuelResult, mine: 'A' | 'B') => (r.winner === mine ? 1 : r.winner === 'draw' ? 0.5 : 0);
  return { score: (s(r1, 'A') + s(r2, 'B')) / 2, detail: [r1, r2] };
}
