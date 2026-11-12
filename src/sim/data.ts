/**
 * 遊戲數值資料。平衡調整主要改這個檔案。
 */
export const Team = { Player: 0, Enemy: 1 } as const;

export type UnitModel = 'sheep' | 'monster';

/** 護甲：攻擊方可以對其中一種有固定加成 */
export const Armor = { Light: 0, Heavy: 1 } as const;

/**
 * 兵種技能（每種兵最多一個，全部自動發動）。數值都是固定值，之後用模擬調整。
 *   horn    號角手：附近我方攻擊 +atk（不疊加，取最大）
 *   curl    刺球衛：附近有敵人就自動縮球；縮著時防禦 +def、移動 ×(1−slow)、近戰打它的敵人受 reflect 反傷
 *   pierce  尖刺弩砲：射出的刺沿直線貫穿，打到線上 width 範圍內的所有敵人
 *   trap    陷阱工程師：每 cd 秒在敵人來的方向放一個陷阱（最多 max 個）；踩到受 dmg 傷害並變慢
 *   bark    吠叫兵：攻擊時對自己周圍 radius 內的敵人吼叫，讓它們變慢（移動、攻擊速度）
 *   heal    聖伯納救援犬：每 cd 秒治療範圍內最需要的我方 amount 血
 */
export type UnitSkill =
  | { type: 'horn'; radius: number; atk: number }
  | { type: 'curl'; radius: number; def: number; reflect: number; slow: number }
  | { type: 'pierce'; width: number }
  | { type: 'trap'; cd: number; dmg: number; max: number }
  | { type: 'bark'; radius: number }
  | { type: 'heal'; radius: number; amount: number; cd: number };

/**
 * 我方部隊的視野（格）：待命、攻擊移動、巡邏時，這個範圍內有敵人就會圍過去打（取兵種索敵範圍和這個的較大值）。
 * 隊友在 ASSIST 格內正在打架時，也會一起去打同一個目標。
 */
export const PLAYER_SIGHT = 7;
export const ASSIST = 3.5;
/**
 * 小隊（一起下令的單位）：有隊員開打，離戰鬥 pull 格內的隊員全部圍過去（在戰鬥點 fight 格內找敵人）；
 * 輔助兵（號角手、救援犬）跟到離戰鬥點 supportGap 格的地方
 */
export const SQUAD = { pull: 16, fight: 6, supportGap: 3 };

/** 被減速（吠叫、陷阱）時的效果：移動和攻擊速度都 −40%，持續 SLOW.dur 秒 */
export const SLOW = { move: 0.4, attack: 0.4, dur: 2.5 };

/** 彈道：飛行速度（格/秒）和拋物線高度（格）。spike（尖刺弩砲）是貫穿，傷害在發射時就算 */
export type ProjKind = 'arrow' | 'javelin' | 'stone' | 'spike';
export const PROJ: Record<ProjKind, { speed: number; arc: number }> = {
  arrow: { speed: 14, arc: 0.6 },
  javelin: { speed: 10, arc: 0.5 },
  stone: { speed: 7, arc: 2.2 },
  spike: { speed: 20, arc: 0 },
};

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
  /** 以下為選填（預設：輕甲、無防禦、近戰、無加成、無技能） */
  armor?: number;
  meleeDef?: number; // 被近戰打時減少的傷害（固定值）
  rangedDef?: number; // 被遠程打時減少的傷害（固定值）
  range?: number; // >0 表示遠程，射程（格）
  bonusLight?: number; // 打輕甲時多的傷害
  bonusHeavy?: number; // 打重甲時多的傷害
  bonusLarge?: number; // 打大型單位（半徑 ≥ 0.45）時多的傷害
  skill?: UnitSkill;
  /** 不主動攻擊，只待在崗位上（號角手、救援犬） */
  support?: boolean;
  /** 遠程丟出去的東西（畫面上會飛過去，飛到才扣血） */
  proj?: ProjKind;
  /** 有輪子的器具（投石車、弩砲）：移動時用滑的，不像步兵一跳一跳 */
  wheeled?: boolean;
}

export const UK = {
  Fuzz: 0, Runner: 1, Brute: 2, Sheep: 3,
  Lancer: 4, Archer: 5, Catapult: 6, Horn: 7,
  Spineball: 8, Javelin: 9, Ballista: 10, Trapper: 11,
  DogCav: 12, Barker: 13, StBernard: 14,
} as const;

const P = Team.Player, L = Armor.Light, H = Armor.Heavy;
export const UNIT_KINDS: UnitKind[] = [
  // ---- 敵人
  { name: '毛球怪', team: Team.Enemy, hp: 30, speed: 1.7, radius: 0.28, damage: 4, attackCd: 1, reach: 0.1, aggro: 3.5, reward: 1, color: 0x9b7fd4, scale: 0.55, model: 'monster', armor: L },
  { name: '飛毛蟲', team: Team.Enemy, hp: 16, speed: 3.2, radius: 0.22, damage: 3, attackCd: 0.7, reach: 0.1, aggro: 3.5, reward: 1, color: 0xf0a35e, scale: 0.42, model: 'monster', armor: L },
  { name: '大毛怪', team: Team.Enemy, hp: 220, speed: 1.0, radius: 0.5, damage: 22, attackCd: 1.6, reach: 0.15, aggro: 3, reward: 6, color: 0x5f4b8b, scale: 1.0, model: 'monster', armor: H, meleeDef: 2, rangedDef: 2 },
  // ---- 我方：羊圈產的村民兵（舊）
  { name: '綿羊兵', team: P, hp: 70, speed: 2.6, radius: 0.3, damage: 9, attackCd: 0.8, reach: 0.12, aggro: 4.5, reward: 0, color: 0xfffaf0, scale: 0.62, model: 'sheep', armor: L },
  // ---- 羊族
  { name: '長槍兵', team: P, hp: 110, speed: 2.2, radius: 0.32, damage: 9, attackCd: 0.9, reach: 0.35, aggro: 4.5, reward: 0, color: 0xfffaf0, scale: 0.7, model: 'sheep', armor: H, meleeDef: 4, rangedDef: 2, bonusLarge: 10 },
  { name: '弓箭手', team: P, hp: 50, speed: 2.4, radius: 0.28, damage: 6, attackCd: 1.0, reach: 0.1, aggro: 7.5, reward: 0, color: 0xfffaf0, scale: 0.62, model: 'sheep', armor: L, range: 6, bonusLight: 4, proj: 'arrow' },
  { name: '投石車', team: P, hp: 140, speed: 1.2, radius: 0.5, damage: 40, attackCd: 3.2, reach: 0.1, aggro: 10.5, reward: 0, color: 0xfffaf0, scale: 1.15, model: 'sheep', armor: H, meleeDef: 1, rangedDef: 5, range: 9, bonusHeavy: 20, proj: 'stone', wheeled: true },
  { name: '號角手', team: P, hp: 55, speed: 2.4, radius: 0.28, damage: 0, attackCd: 1, reach: 0.1, aggro: 0, reward: 0, color: 0xfffaf0, scale: 0.62, model: 'sheep', armor: L, support: true, skill: { type: 'horn', radius: 4, atk: 3 } },
  // ---- 刺刺族
  { name: '刺球衛', team: P, hp: 130, speed: 1.8, radius: 0.38, damage: 6, attackCd: 1.0, reach: 0.15, aggro: 4, reward: 0, color: 0xfffaf0, scale: 0.75, model: 'sheep', armor: H, meleeDef: 3, rangedDef: 3, skill: { type: 'curl', radius: 2.2, def: 6, reflect: 4, slow: 0.8 } },
  { name: '豪豬標槍手', team: P, hp: 60, speed: 2.3, radius: 0.3, damage: 10, attackCd: 1.2, reach: 0.1, aggro: 5, reward: 0, color: 0xfffaf0, scale: 0.65, model: 'sheep', armor: L, meleeDef: 1, range: 3.5, bonusHeavy: 5, proj: 'javelin' },
  { name: '尖刺弩砲', team: P, hp: 120, speed: 1.2, radius: 0.5, damage: 12, attackCd: 2.5, reach: 0.1, aggro: 10.5, reward: 0, color: 0xfffaf0, scale: 1.1, model: 'sheep', armor: H, rangedDef: 4, range: 9, proj: 'spike', skill: { type: 'pierce', width: 0.45 }, wheeled: true },
  { name: '陷阱工程師', team: P, hp: 60, speed: 2.2, radius: 0.3, damage: 3, attackCd: 1.2, reach: 0.1, aggro: 7, reward: 0, color: 0xfffaf0, scale: 0.65, model: 'sheep', armor: L, support: true, skill: { type: 'trap', cd: 4, dmg: 15, max: 3 } },
  // ---- 狗族（全部輕甲）
  { name: '狗狗騎兵', team: P, hp: 75, speed: 4.2, radius: 0.32, damage: 10, attackCd: 0.8, reach: 0.15, aggro: 6, reward: 0, color: 0xfffaf0, scale: 0.65, model: 'sheep', armor: L, meleeDef: 1 },
  { name: '吠叫兵', team: P, hp: 60, speed: 2.8, radius: 0.3, damage: 2, attackCd: 2.0, reach: 0.1, aggro: 5, reward: 0, color: 0xfffaf0, scale: 0.65, model: 'sheep', armor: L, range: 3, skill: { type: 'bark', radius: 3 } },
  { name: '聖伯納救援犬', team: P, hp: 90, speed: 2.4, radius: 0.36, damage: 0, attackCd: 1, reach: 0.1, aggro: 0, reward: 0, color: 0xfffaf0, scale: 0.75, model: 'sheep', armor: L, support: true, skill: { type: 'heal', radius: 5, amount: 12, cd: 1.5 } },
];

export interface BuildingKind {
  name: string;
  icon: string;
  size: number; // 佔地 size x size 格
  hp: number;
  cost: number;
  color: number;
  upgradeCost: number[]; // [升到 Lv2, 升到 Lv3, …]，長度決定最高等級
  /** 各等級的名稱（市鎮中心的五個階段） */
  levelNames?: string[];
  range?: number;
  damage?: number;
  cd?: number;
  spawnCap?: number;
}

export const BK = { Base: 0, Wall: 1, Tower: 2, Barracks: 3 } as const;
export const MAX_LEVEL = 3;

export const BUILDING_KINDS: BuildingKind[] = [
  // 世界樹・聯盟市鎮中心：五個階段（美術在 public/sprites/buildings/town_center_<階段>.png）
  { name: '世界樹市鎮中心', icon: '🌳', size: 3, hp: 2000, cost: 0, color: 0xf2a7b5, upgradeCost: [150, 300, 500, 800],
    levelNames: ['樹苗屋', '小樹屋', '繁榮樹城', '盟都', '永恆聖都'] },
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
