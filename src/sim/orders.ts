import { UNIT_KINDS } from './data';

/**
 * 部隊指令（參考世紀帝國 4）。純資料與陣型計算，實際執行在 World.updateUnits。
 *
 *   Idle        待命：守在自己的位置，敵人進入索敵範圍就去打，打完回來（堅守時不移動、只打射程內）
 *   Move        移動：一路不理敵人，走到陣型位置
 *   AttackMove  攻擊移動：邊走邊打，遇到敵人先打，打完繼續走
 *   Attack      攻擊指定目標：追著打到死為止
 *   Patrol      巡邏：在兩點之間來回攻擊移動
 */
export const Ord = { Idle: 0, Move: 1, AttackMove: 2, Attack: 3, Patrol: 4 } as const;

export type CommandType = 'move' | 'attackMove' | 'attack' | 'patrol' | 'stop' | 'hold';

/** 陣型：橫列（預設）、縱隊（穿過窄路）、散開（怕範圍攻擊） */
export type Formation = 'line' | 'column' | 'spread';
export const FORMATIONS: { id: Formation; icon: string; label: string }[] = [
  { id: 'line', icon: '▬', label: '橫列' },
  { id: 'column', icon: '▮', label: '縱隊' },
  { id: 'spread', icon: '⁘', label: '散開' },
];

/** Shift 排進佇列的下一個指令 */
export interface QueuedOrder {
  ord: number; x: number; y: number;
  /** 攻擊目標（Attack） */
  t: number;
  path: number;
  /** 巡邏的另一端和回程路徑 */
  px: number; py: number; path2: number;
}

/** 陣型排位：0 近戰最前、1 遠程、2 輔助、3 長程（攻城器）最後 */
export function roleOf(kind: number): number {
  const k = UNIT_KINDS[kind];
  if (k.support) return 2;
  const r = k.range ?? 0;
  if (r >= 7) return 3;
  if (r > 0) return 1;
  return 0;
}

/**
 * 算每個單位在陣型中的位置。陣型中心在 (cx, cy)，面向 (fx, fy)（單位向量）。
 * 近戰站最前排、遠程在後、攻城器最後；同一排依左右位置分配，減少交錯。
 * 回傳 slots[2k], slots[2k+1] = ids[k] 的位置。
 */
export function formationSlots(
  ids: number[], xs: Float32Array, ys: Float32Array, kinds: Uint8Array, rads: Float32Array,
  cx: number, cy: number, fx: number, fy: number, form: Formation,
): Float32Array {
  const n = ids.length, out = new Float32Array(n * 2);
  if (n === 1) { out[0] = cx; out[1] = cy; return out; }
  const lx = -fy, ly = fx; // 左右方向
  const spreadK = form === 'spread' ? 1.8 : 1;
  const cols = form === 'column' ? Math.min(n, 3) : Math.max(2, Math.round(Math.sqrt(n * (form === 'spread' ? 2 : 2.6))));

  // 依定位分組，每組切成一排一排
  const groups: number[][] = [[], [], [], []];
  ids.forEach((id, k) => groups[roleOf(kinds[id])].push(k));
  const rows: { ks: number[]; sp: number }[] = [];
  for (const g of groups) {
    if (!g.length) continue;
    let diam = 0;
    for (const k of g) diam = Math.max(diam, rads[ids[k]] * 2);
    const sp = (diam + 0.3) * spreadK;
    // 先依前後位置排序 → 本來就在前面的單位排前排
    g.sort((a, b) => ((xs[ids[b]] - cx) * fx + (ys[ids[b]] - cy) * fy) - ((xs[ids[a]] - cx) * fx + (ys[ids[a]] - cy) * fy));
    for (let s = 0; s < g.length; s += cols) rows.push({ ks: g.slice(s, s + cols), sp });
  }

  // 每排的前後位置：第一排在最前面，最後置中
  const depth: number[] = [0];
  for (let r = 1; r < rows.length; r++) depth.push(depth[r - 1] - (rows[r - 1].sp + rows[r].sp) / 2);
  const shift = -(depth[0] + depth[depth.length - 1]) / 2;

  rows.forEach((row, r) => {
    const d = depth[r] + shift;
    // 同一排依左右位置排序，分配到由左到右的位置
    row.ks.sort((a, b) => ((xs[ids[a]] - cx) * lx + (ys[ids[a]] - cy) * ly) - ((xs[ids[b]] - cx) * lx + (ys[ids[b]] - cy) * ly));
    const m = row.ks.length;
    row.ks.forEach((k, j) => {
      const lat = (j - (m - 1) / 2) * row.sp;
      out[k * 2] = cx + fx * d + lx * lat;
      out[k * 2 + 1] = cy + fy * d + ly * lat;
    });
  });
  return out;
}
