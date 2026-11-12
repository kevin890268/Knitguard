/**
 * 遊戲數值資料。平衡調整主要改這個檔案。
 */
export const Team = { Player: 0, Enemy: 1 } as const;

export type UnitModel = 'sheep' | 'monster';

export interface UnitKind {
  name: string;
  team: number;
  hp: number;
  speed: number; // 格/秒
  radius: number; // 碰撞半徑（格）
  damage: number;
  attackCd: number; // 秒
  reach: number; // 近戰距離（加在雙方半徑之外）
  aggro: number; // 索敵半徑
  reward: number; // 擊殺給的金幣
  color: number;
  scale: number; // 模型大小
  model: UnitModel;
}

export const UK = { Fuzz: 0, Runner: 1, Brute: 2, Sheep: 3 } as const;

export const UNIT_KINDS: UnitKind[] = [
  { name: '毛球怪', team: Team.Enemy, hp: 30, speed: 1.7, radius: 0.28, damage: 4, attackCd: 1, reach: 0.1, aggro: 3.5, reward: 1, color: 0x9b7fd4, scale: 0.55, model: 'monster' },
  { name: '飛毛蟲', team: Team.Enemy, hp: 16, speed: 3.2, radius: 0.22, damage: 3, attackCd: 0.7, reach: 0.1, aggro: 3.5, reward: 1, color: 0xf0a35e, scale: 0.42, model: 'monster' },
  { name: '大毛怪', team: Team.Enemy, hp: 220, speed: 1.0, radius: 0.5, damage: 22, attackCd: 1.6, reach: 0.15, aggro: 3, reward: 6, color: 0x5f4b8b, scale: 1.0, model: 'monster' },
  { name: '綿羊兵', team: Team.Player, hp: 70, speed: 2.6, radius: 0.3, damage: 9, attackCd: 0.8, reach: 0.12, aggro: 4.5, reward: 0, color: 0xfffaf0, scale: 0.62, model: 'sheep' },
];

export interface BuildingKind {
  name: string;
  icon: string;
  size: number; // 佔地 size x size 格
  hp: number;
  cost: number;
  color: number;
  upgradeCost: number[]; // [升到 Lv2, 升到 Lv3]
  range?: number;
  damage?: number;
  cd?: number;
  spawnCap?: number;
}

export const BK = { Base: 0, Wall: 1, Tower: 2, Barracks: 3 } as const;
export const MAX_LEVEL = 3;

export const BUILDING_KINDS: BuildingKind[] = [
  { name: '毛線城堡', icon: '🏰', size: 3, hp: 2000, cost: 0, color: 0xf2a7b5, upgradeCost: [] },
  { name: '毛氈牆', icon: '🧱', size: 1, hp: 250, cost: 4, color: 0xd9c4a0, upgradeCost: [6, 10] },
  { name: '線軸箭塔', icon: '🧵', size: 1, hp: 180, cost: 35, color: 0x7fb6e0, upgradeCost: [40, 80], range: 6.5, damage: 10, cd: 0.6 },
  { name: '羊圈', icon: '🐑', size: 2, hp: 400, cost: 60, color: 0xa9d494, upgradeCost: [60, 120], spawnCap: 3 },
];

/** 經濟 */
export const ECON = {
  startGold: 250,
  passiveIncome: 1.5, // 每秒
  refundRatio: 0.5,
};
