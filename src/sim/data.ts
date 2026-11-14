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
 *   pierce  弩砲（尖刺弩砲、蛛人弩砲）：射出的刺沿直線貫穿，打到線上 width 範圍內的所有敵人（穿心）
 *   trap    陷阱工程師（村民，不攻擊）：每 cd 秒在敵人來的方向放一個陷阱（最多 max 個）；踩到受 dmg 傷害並變慢
 *   bark    吠叫兵：攻擊時對自己周圍 radius 內的敵人吼叫，讓它們變慢（移動、攻擊速度）
 *   heal    聖伯納救援犬：每 cd 秒治療範圍內最需要的我方 amount 血
 *   splash  水砲、投石車：落地時半徑 radius 內的敵人都受傷（水砲是水花、投石車是碎石）害
 *   anchor  船錨兵：被打中的敵人會被拖慢（和吠叫一樣的減速）
 *   guard   巨盾兵：塔盾擋箭，周圍 radius 內的隊友被遠程打時防禦 +def
 *   cleave  鏈錘兵：打目標時，目標周圍 radius 內的其他敵人也一起挨打
 *   pounce  快爪手：跑了至少 run 秒後的第一下攻擊（停下來前那一擊）多 bonus 傷害；打完要再跑起來才會重新蓄好
 *   rage    狂化狼人：血量低於 below（比例）時狂化，攻擊間隔 ×(1−atkSpeed)、移動 ×(1+moveSpeed)；
 *           低於 deep 時深度狂化：再加攻擊 ×(1+dmg)、每秒回 regen 血
 *   thorns  德魯伊：每 cd 秒在 range 內的敵人腳下長出樹枝，半徑 radius 內的敵人每秒受 dps 傷害、持續 dur 秒
 */
export type UnitSkill =
  | { type: 'horn'; radius: number; atk: number }
  | { type: 'curl'; radius: number; def: number; reflect: number; slow: number }
  | { type: 'pierce'; width: number }
  | { type: 'trap'; cd: number; dmg: number; max: number }
  | { type: 'bark'; radius: number }
  | { type: 'heal'; radius: number; amount: number; cd: number }
  | { type: 'thorns'; range: number; radius: number; dps: number; dur: number; cd: number }
  | { type: 'rage'; below: number; atkSpeed: number; moveSpeed: number; deep: number; dmg: number; regen: number }
  | { type: 'pounce'; bonus: number; run: number }
  | { type: 'splash'; radius: number }
  | { type: 'anchor' }
  | { type: 'cleave'; radius: number }
  | { type: 'guard'; radius: number; def: number };

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
export type ProjKind = 'arrow' | 'javelin' | 'stone' | 'spike' | 'pebble' | 'boulder' | 'water' | 'web';
export const PROJ: Record<ProjKind, { speed: number; arc: number }> = {
  arrow: { speed: 14, arc: 0.6 },
  javelin: { speed: 10, arc: 0.5 },
  stone: { speed: 7, arc: 2.2 },
  spike: { speed: 20, arc: 0 },
  pebble: { speed: 12, arc: 0.9 }, // 投石手的小石頭（畫面上用小一號的石頭）
  boulder: { speed: 6, arc: 3.2 },
  water: { speed: 9, arc: 1.4 },
  web: { speed: 10, arc: 0.8 }, // 蛛網兵的蛛網（畫面上畫一團白色的網） // 水砲的水彈（畫面上畫一團藍色的水） // 配重投石機的大石頭（拋得很高、畫得比較大）
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
  bonusCav?: number; // 打騎兵時多的傷害（參考世紀帝國 4：長槍克騎兵）
  bonusRanged?: number; // 打遠程單位時多的傷害（騎兵克弓箭手）
  bonusSiege?: number; // 打攻城器（有輪子的）時多的傷害
  /** 騎兵（被長槍類剋） */
  cavalry?: boolean;
  /** 兵工廠研究武器時，每一級多的傷害（預設 1；一下打很重的兵 2；攻城器 0，不吃武器研究） */
  upgAtk?: number;
  skill?: UnitSkill;
  /** 種族特色「出血」（魚人族）：打中的敵人每秒受 dps 傷害、持續 dur 秒（重複打中只會重新計時，不會疊加） */
  bleed?: { dps: number; dur: number };
  /** 種族特色「緩速」（蛛人族）：打中的敵人變慢（移動、攻擊 −40%），持續這麼多秒 */
  slowHit?: number;
  /** 種族特色「血厚」（樹人族）：血量高，但移動和攻擊都慢（數值已經算在 hp／speed／attackCd 裡，這裡只是標記給資訊欄顯示） */
  sturdy?: boolean;
  /** 拆建築的傷害倍率（骨頭車這類攻城器；預設 1） */
  bldMul?: number;
  /** 不主動攻擊，只待在崗位上（號角手、救援犬） */
  support?: boolean;
  /** 村民（不算戰鬥兵、不攻擊、不跟著小隊去打架；例如陷阱工程師） */
  villager?: boolean;
  /** 遠程丟出去的東西（畫面上會飛過去，飛到才扣血） */
  proj?: ProjKind;
  /** 有輪子的器具（投石車、弩砲）：移動時用滑的，不像步兵一跳一跳 */
  wheeled?: boolean;
  /** 會飛（蝙蝠、惡魔）：不和地面單位互相推擠，從上面越過去，用自己的速度走（不跟著群組行軍速度）；畫面上浮在空中 */
  flying?: boolean;
  /** 會跳（毛球族）：一跳一跳越過其他地面單位，和會飛的一樣不推擠、照自己的速度走 */
  jumping?: boolean;
}

export const UK = {
  Fuzz: 0, Runner: 1, Brute: 2, Sheep: 3,
  Lancer: 4, Archer: 5, Catapult: 6, Horn: 7,
  Spineball: 8, Javelin: 9, Ballista: 10, Trapper: 11,
  DogCav: 12, Barker: 13, StBernard: 14,
  PigHammer: 15, PigCrossbow: 16, PigGiant: 17, PigCatapult: 18,
  BullAxe: 19, BullArcher: 20, BullGreataxe: 21, BullRam: 22,
  DeerSaber: 23, DeerLongbow: 24, DeerRam: 25, DeerDruid: 26,
  WolfClaw: 27, WolfSlinger: 28, WolfTrebuchet: 29, WolfBerserker: 30,
  FishHarpoon: 31, FishSpear: 32, FishCannon: 33, FishAnchor: 34,
  SpiderDrop: 35, SpiderWeb: 36, SpiderBallista: 37, SpiderFlail: 38,
  TreantShield: 39, TreantJavelin: 40, TreantAxeCart: 41, TreantClub: 42,
  // ---- 敵人：骨頭族（最基本的敵人）
  BoneGrunt: 43, BoneSword: 44, BoneBow: 45, BoneFlag: 46, BoneCart: 47,
  // 毛球族第三階段（第一、二、四階段是最上面的 Fuzz、Runner、Brute）
  HornFuzz: 48,
} as const;

const P = Team.Player, L = Armor.Light, H = Armor.Heavy;
export const UNIT_KINDS: UnitKind[] = [
  // ---- 敵人
  // ---- 敵人：毛球族（會進化的野怪，四個階段：幼毛球 → 毛球獸 → 角毛球獸 → 巨角毛球王；階段越高越大、越耐打、撞得越痛）
  { name: '幼毛球', team: Team.Enemy, hp: 30, speed: 1.7, radius: 0.28, damage: 3, attackCd: 1, reach: 0.1, aggro: 3.5, reward: 1, color: 0xefe6d0, scale: 0.5, model: 'monster', armor: L, jumping: true },
  { name: '毛球獸', team: Team.Enemy, hp: 70, speed: 2.4, radius: 0.32, damage: 7, attackCd: 1.1, reach: 0.12, aggro: 4, reward: 2, color: 0xa9c46a, scale: 0.62, model: 'monster', armor: L, jumping: true },
  { name: '巨角毛球王', team: Team.Enemy, hp: 420, speed: 1.1, radius: 0.58, damage: 28, attackCd: 1.8, reach: 0.2, aggro: 3.5, reward: 15, color: 0x7a9a4a, scale: 1.2, model: 'monster', armor: H, meleeDef: 2, rangedDef: 2, jumping: true },
  // ---- 我方：羊圈產的村民兵（舊）
  { name: '綿羊兵', team: P, hp: 70, speed: 2.6, radius: 0.3, damage: 6, attackCd: 1.25, reach: 0.12, aggro: 4.5, reward: 0, color: 0xfffaf0, scale: 0.62, model: 'sheep', armor: L },
  // ---- 羊族
  { name: '長槍兵', team: P, hp: 105, speed: 2.2, radius: 0.32, damage: 11, attackCd: 1.3, reach: 0.35, aggro: 4.5, reward: 0, color: 0xfffaf0, scale: 0.7, model: 'sheep', armor: L, meleeDef: 2, rangedDef: 0, bonusLarge: 8, bonusCav: 17 },
  { name: '弓箭手', team: P, hp: 75, speed: 2.4, radius: 0.28, damage: 6, attackCd: 1.2, reach: 0.1, aggro: 7.5, reward: 0, color: 0xfffaf0, scale: 0.62, model: 'sheep', armor: L, range: 6, bonusLight: 6, proj: 'arrow' },
  { name: '投石車', team: P, hp: 180, speed: 1.2, radius: 0.5, damage: 34, attackCd: 3.2, reach: 0.1, aggro: 10.5, reward: 0, color: 0xfffaf0, scale: 1.15, model: 'sheep', armor: H, meleeDef: 0, rangedDef: 10, range: 9, bonusHeavy: 15, proj: 'stone', wheeled: true, upgAtk: 0, skill: { type: 'splash', radius: 1 } },
  { name: '號角手', team: P, hp: 60, speed: 2.4, radius: 0.28, damage: 0, attackCd: 1, reach: 0.1, aggro: 0, reward: 0, color: 0xfffaf0, scale: 0.62, model: 'sheep', armor: L, support: true, skill: { type: 'horn', radius: 4, atk: 3 } },
  // ---- 刺刺族
  { name: '刺球衛', team: P, hp: 125, speed: 1.8, radius: 0.38, damage: 7, attackCd: 1.25, reach: 0.15, aggro: 4, reward: 0, color: 0xfffaf0, scale: 0.75, model: 'sheep', armor: H, meleeDef: 3, rangedDef: 3, skill: { type: 'curl', radius: 2.2, def: 4, reflect: 2, slow: 0.8 }, upgAtk: 1 },
  { name: '豪豬標槍手', team: P, hp: 70, speed: 2.3, radius: 0.3, damage: 8, attackCd: 1.6, reach: 0.1, aggro: 5, reward: 0, color: 0xfffaf0, scale: 0.65, model: 'sheep', armor: L, range: 4, proj: 'javelin', bonusCav: 10 },
  { name: '尖刺弩砲', team: P, hp: 180, speed: 1.2, radius: 0.5, damage: 16, attackCd: 3, reach: 0.1, aggro: 10.5, reward: 0, color: 0xfffaf0, scale: 1.1, model: 'sheep', armor: H, rangedDef: 10, range: 9, proj: 'spike', skill: { type: 'pierce', width: 0.45 }, wheeled: true, upgAtk: 0, bonusSiege: 60 },
  { name: '陷阱工程師', team: P, hp: 70, speed: 2.2, radius: 0.3, damage: 0, attackCd: 1.2, reach: 0.1, aggro: 7, reward: 0, color: 0xfffaf0, scale: 0.65, model: 'sheep', armor: L, support: true, villager: true, skill: { type: 'trap', cd: 4, dmg: 15, max: 3 } },
  // ---- 狗族（全部輕甲）
  { name: '狗狗騎兵', team: P, hp: 135, speed: 4.2, radius: 0.32, damage: 11, attackCd: 1.3, reach: 0.15, aggro: 6, reward: 0, color: 0xfffaf0, scale: 0.65, model: 'sheep', armor: L, meleeDef: 0, rangedDef: 2, bonusRanged: 9, cavalry: true },
  { name: '吠叫兵', team: P, hp: 85, speed: 2.8, radius: 0.3, damage: 4, attackCd: 1.6, reach: 0.1, aggro: 5, reward: 0, color: 0xfffaf0, scale: 0.65, model: 'sheep', armor: L, range: 3, skill: { type: 'bark', radius: 3 } },
  { name: '聖伯納救援犬', team: P, hp: 110, speed: 2.4, radius: 0.36, damage: 0, attackCd: 1, reach: 0.1, aggro: 0, reward: 0, color: 0xfffaf0, scale: 0.75, model: 'sheep', armor: L, support: true, skill: { type: 'heal', radius: 5, amount: 12, cd: 1.5 } },
  // ---- 豬人族（打贏後救回的良善豬人；豬族軍營會輪流訓練）。還沒有圖，暫用羊人的模型
  // 槌頭兵：近戰，槌子打重甲有加成　弩兵：遠程，射程長、裝填慢、打重甲有加成　巨槌兵：大型重甲，單發高傷害　投石車：長程攻城
  { name: '槌頭兵', team: P, hp: 110, speed: 2.0, radius: 0.33, damage: 9, attackCd: 1.4, reach: 0.15, aggro: 4.5, reward: 0, color: 0xf4b6c2, scale: 0.7, model: 'sheep', armor: L, meleeDef: 1, bonusHeavy: 6, rangedDef: 1 },
  { name: '弩兵', team: P, hp: 75, speed: 2.1, radius: 0.3, damage: 11, attackCd: 1.8, reach: 0.1, aggro: 8, reward: 0, color: 0xf4b6c2, scale: 0.66, model: 'sheep', armor: L, range: 6, bonusHeavy: 14, proj: 'arrow', upgAtk: 2 },
  { name: '巨槌兵', team: P, hp: 180, speed: 1.5, radius: 0.45, damage: 16, attackCd: 1.9, reach: 0.2, aggro: 4.5, reward: 0, color: 0xf4b6c2, scale: 0.95, model: 'sheep', armor: H, meleeDef: 4, rangedDef: 3, bonusHeavy: 10, upgAtk: 2 },
  { name: '豬人投石車', team: P, hp: 180, speed: 1.1, radius: 0.5, damage: 32, attackCd: 3.4, reach: 0.1, aggro: 10.5, reward: 0, color: 0xf4b6c2, scale: 1.1, model: 'sheep', armor: H, meleeDef: 0, rangedDef: 10, range: 9, bonusHeavy: 15, proj: 'stone', wheeled: true, upgAtk: 0, skill: { type: 'splash', radius: 1 } },
  // ---- 牛人族（救回的良善牛人；牛族軍營輪流訓練）。還沒有圖，暫用羊人的模型
  // 輕型斧頭兵：快、打輕甲有加成　輕型弓箭手：便宜的遠程　重型巨斧兵：重甲，打大型有加成　重型衝撞車：很硬很慢的近戰攻城車，一撞傷害很高
  { name: '輕型斧頭兵', team: P, hp: 110, speed: 2.5, radius: 0.32, damage: 9, attackCd: 1.1, reach: 0.15, aggro: 5, reward: 0, color: 0xd9b48a, scale: 0.7, model: 'sheep', armor: L, meleeDef: 1, bonusLight: 4 },
  { name: '輕型弓箭手', team: P, hp: 70, speed: 2.4, radius: 0.3, damage: 5, attackCd: 1.3, reach: 0.1, aggro: 7.5, reward: 0, color: 0xd9b48a, scale: 0.66, model: 'sheep', armor: L, range: 6, bonusLight: 3, proj: 'arrow' },
  { name: '重型巨斧兵', team: P, hp: 220, speed: 1.6, radius: 0.44, damage: 16, attackCd: 1.6, reach: 0.25, aggro: 4.5, reward: 0, color: 0xd9b48a, scale: 0.95, model: 'sheep', armor: H, meleeDef: 3, rangedDef: 3, bonusLarge: 10, upgAtk: 2 },
  { name: '重型衝撞車', team: P, hp: 400, speed: 1.2, radius: 0.55, damage: 8, attackCd: 2.8, reach: 0.25, aggro: 4.5, reward: 0, color: 0xd9b48a, scale: 1.1, model: 'sheep', armor: H, meleeDef: 3, rangedDef: 30, wheeled: true, upgAtk: 0, bonusSiege: 60 },
  // ---- 鹿族（鹿族軍營輪流訓練）：全部輕甲、靈活。還沒有圖，暫用羊人的模型
  // 輕型彎刀手：出手快、打輕甲有加成　輕型長弓兵：射程最遠的弓　輕型鹿角衝撞車：比牛人衝撞車快、比較脆　輕型德魯伊：召喚樹枝，範圍持續傷害
  { name: '輕型彎刀手', team: P, hp: 90, speed: 2.8, radius: 0.3, damage: 6, attackCd: 0.75, reach: 0.15, aggro: 5, reward: 0, color: 0xc9a27a, scale: 0.68, model: 'sheep', armor: L, bonusLight: 3 },
  { name: '輕型長弓兵', team: P, hp: 65, speed: 2.5, radius: 0.28, damage: 6, attackCd: 1.5, reach: 0.1, aggro: 9, reward: 0, color: 0xc9a27a, scale: 0.66, model: 'sheep', armor: L, range: 7.5, bonusLight: 3, proj: 'arrow' },
  { name: '輕型鹿角衝撞車', team: P, hp: 260, speed: 1.9, radius: 0.5, damage: 6, attackCd: 2.2, reach: 0.25, aggro: 4.5, reward: 0, color: 0xc9a27a, scale: 1.0, model: 'sheep', armor: L, meleeDef: 2, rangedDef: 20, wheeled: true, upgAtk: 0, bonusSiege: 40 },
  { name: '輕型德魯伊', team: P, hp: 70, speed: 2.4, radius: 0.28, damage: 0, attackCd: 1, reach: 0.1, aggro: 7, reward: 0, color: 0xc9a27a, scale: 0.66, model: 'sheep', armor: L, support: true, skill: { type: 'thorns', range: 6.5, radius: 1.4, dps: 6, dur: 4, cd: 5 } },
  // ---- 狼人族（狼人族軍營輪流訓練）。還沒有圖，暫用羊人的模型
  // 輕型快爪手：最快的近戰、出手很快　輕型投石手：便宜的短程　巨型配重投石機：射程最遠、單發最重、非常慢　輕型狂化狼人：血少時狂化（攻擊、移動變快）
  { name: '輕型快爪手', team: P, hp: 105, speed: 3.4, radius: 0.3, damage: 7, attackCd: 0.6, reach: 0.12, aggro: 5.5, reward: 0, color: 0x9a9a9a, scale: 0.68, model: 'sheep', armor: L, skill: { type: 'pounce', bonus: 14, run: 0.6 }, bonusRanged: 4 },
  { name: '輕型投石手', team: P, hp: 70, speed: 2.6, radius: 0.28, damage: 8, attackCd: 1.3, reach: 0.1, aggro: 6.5, reward: 0, color: 0x9a9a9a, scale: 0.64, model: 'sheep', armor: L, range: 5, bonusHeavy: 3, proj: 'pebble' },
  { name: '巨型配重投石機', team: P, hp: 300, speed: 0.8, radius: 0.65, damage: 70, attackCd: 5, reach: 0.1, aggro: 12.5, reward: 0, color: 0x9a9a9a, scale: 1.3, model: 'sheep', armor: H, meleeDef: 0, rangedDef: 10, range: 11, bonusHeavy: 20, proj: 'boulder', wheeled: true, upgAtk: 0, skill: { type: 'splash', radius: 1.4 } },
  { name: '輕型狂化狼人', team: P, hp: 140, speed: 2.8, radius: 0.33, damage: 12, attackCd: 1.1, reach: 0.15, aggro: 5.5, reward: 0, color: 0x9a9a9a, scale: 0.72, model: 'sheep', armor: L, skill: { type: 'rage', below: 0.5, atkSpeed: 0.45, moveSpeed: 0.35, deep: 0.3, dmg: 0.2, regen: 4 }, meleeDef: 1 },
  // ---- 魚人族（魚人族軍營輪流訓練）。種族特色：出血（打中的敵人持續掉血）。還沒有圖，暫用羊人的模型
  // 輕型魚叉兵：短程丟魚叉、打大型有加成　輕型魚矛兵：長矛近戰、碰得比較遠　輕型水砲攻城器：水彈落地濺開、打一片　重型魚人船錨兵：重甲、慢，船錨打中會拖慢敵人
  { name: '輕型魚叉兵', team: P, hp: 65, speed: 2.4, radius: 0.29, damage: 7, attackCd: 1.5, reach: 0.1, aggro: 6, reward: 0, color: 0x7fb6e0, scale: 0.66, model: 'sheep', armor: L, range: 4.5, bonusLarge: 4, proj: 'javelin', bleed: { dps: 3, dur: 4 }, bonusCav: 8 },
  { name: '輕型魚矛兵', team: P, hp: 90, speed: 2.4, radius: 0.31, damage: 7, attackCd: 1.3, reach: 0.45, aggro: 5, reward: 0, color: 0x7fb6e0, scale: 0.68, model: 'sheep', armor: L, meleeDef: 1, bonusLarge: 6, bleed: { dps: 3, dur: 4 }, bonusCav: 15 },
  { name: '輕型水砲攻城器', team: P, hp: 160, speed: 1.4, radius: 0.5, damage: 10, attackCd: 3.0, reach: 0.1, aggro: 9.5, reward: 0, color: 0x7fb6e0, scale: 1.05, model: 'sheep', armor: L, rangedDef: 10, range: 8, proj: 'water', wheeled: true, skill: { type: 'splash', radius: 1.3 }, bleed: { dps: 2, dur: 3 }, upgAtk: 0, bonusRanged: 6 },
  { name: '重型魚人船錨兵', team: P, hp: 210, speed: 1.6, radius: 0.42, damage: 16, attackCd: 1.8, reach: 0.25, aggro: 4.5, reward: 0, color: 0x7fb6e0, scale: 0.92, model: 'sheep', armor: H, meleeDef: 3, rangedDef: 3, bonusHeavy: 6, skill: { type: 'anchor' }, bleed: { dps: 5, dur: 4 }, upgAtk: 2 },
  // ---- 蛛人族（蛛人族軍營輪流訓練）。種族特色：緩速（打中的敵人變慢；蛛網兵最久）。還沒有圖，暫用羊人的模型
  // 輕型近戰傘兵：吊著蛛絲從天而降，快、專挑遠程兵　輕型遠程蛛網兵：蛛網打中會減速　重型遠程弩砲：射程長、打重甲和攻城器　重型鏈錘兵：重甲，鏈錘橫掃周圍
  { name: '輕型近戰傘兵', team: P, hp: 95, speed: 3.3, radius: 0.3, damage: 8, attackCd: 0.9, reach: 0.15, aggro: 6.5, reward: 0, color: 0x6b5b7b, scale: 0.68, model: 'sheep', armor: L, bonusRanged: 8, slowHit: 1 },
  { name: '輕型遠程蛛網兵', team: P, hp: 70, speed: 2.4, radius: 0.29, damage: 5, attackCd: 1.4, reach: 0.1, aggro: 7, reward: 0, color: 0x6b5b7b, scale: 0.66, model: 'sheep', armor: L, range: 5.5, proj: 'web', slowHit: 2.5 },
  { name: '重型遠程弩砲', team: P, hp: 200, speed: 1.1, radius: 0.5, damage: 26, attackCd: 3.0, reach: 0.1, aggro: 11, reward: 0, color: 0x6b5b7b, scale: 1.1, model: 'sheep', armor: H, meleeDef: 0, rangedDef: 10, range: 10, bonusHeavy: 12, bonusSiege: 30, proj: 'spike', wheeled: true, upgAtk: 0, slowHit: 1.5, skill: { type: 'pierce', width: 0.45 } },
  { name: '重型鏈錘兵', team: P, hp: 190, speed: 1.7, radius: 0.42, damage: 11, attackCd: 1.9, reach: 0.4, aggro: 4.5, reward: 0, color: 0x6b5b7b, scale: 0.92, model: 'sheep', armor: H, meleeDef: 3, rangedDef: 3, upgAtk: 2, skill: { type: 'cleave', radius: 1.1 }, slowHit: 1.5 },
  // ---- 樹人族（樹人族軍營輪流訓練）。種族特色：血厚，但移動、攻擊速度慢（全部重甲）。還沒有圖，暫用羊人的模型
  // 重型巨盾兵：只有塔盾，幾乎不打人，擋箭保護周圍隊友　重型標槍兵：重型遠程，一下很重　重型斧頭車：近戰攻城器　重型巨棒兵（特殊）：一棒很重
  { name: '重型巨盾兵', team: P, hp: 260, speed: 1.25, radius: 0.42, damage: 4, attackCd: 2, reach: 0.15, aggro: 4.5, reward: 0, color: 0x7a9a5a, scale: 0.92, model: 'sheep', armor: H, meleeDef: 4, rangedDef: 8, upgAtk: 0, skill: { type: 'guard', radius: 2, def: 3 }, sturdy: true },
  { name: '重型標槍兵', team: P, hp: 160, speed: 1.3, radius: 0.38, damage: 10, attackCd: 2.6, reach: 0.1, aggro: 6, reward: 0, color: 0x7a9a5a, scale: 0.85, model: 'sheep', armor: H, meleeDef: 2, rangedDef: 2, range: 4.5, bonusLarge: 8, bonusCav: 8, proj: 'javelin', upgAtk: 2, sturdy: true },
  { name: '重型斧頭車', team: P, hp: 420, speed: 0.95, radius: 0.55, damage: 20, attackCd: 3.3, reach: 0.25, aggro: 4.5, reward: 0, color: 0x7a9a5a, scale: 1.1, model: 'sheep', armor: H, meleeDef: 3, rangedDef: 20, bonusHeavy: 10, bonusSiege: 40, wheeled: true, upgAtk: 0, sturdy: true },
  { name: '重型巨棒兵', team: P, hp: 240, speed: 1.25, radius: 0.48, damage: 18, attackCd: 3.1, reach: 0.3, aggro: 4.5, reward: 0, color: 0x7a9a5a, scale: 1.0, model: 'sheep', armor: H, meleeDef: 3, rangedDef: 2, upgAtk: 2, sturdy: true },
  // ---- 敵人：骨頭族（最基本的敵人，跟著屍潮來）。還沒有圖，暫用米白色的毛球
  // 骷髏雜兵：沒有武器，數量最多　骷髏劍兵：一般近戰，不持盾　骷髏弓兵：遠程　骷髏旗手：不打人，幫周圍骷髏加攻擊　骷髏骨頭車：近戰攻城器，拆建築 ×3
  { name: '骷髏雜兵', team: Team.Enemy, hp: 35, speed: 1.8, radius: 0.27, damage: 4, attackCd: 1.1, reach: 0.1, aggro: 3.5, reward: 1, color: 0xe8e2d0, scale: 0.62, model: 'monster', armor: L },
  { name: '骷髏劍兵', team: Team.Enemy, hp: 55, speed: 1.7, radius: 0.29, damage: 7, attackCd: 1.1, reach: 0.15, aggro: 4, reward: 2, color: 0xd8d0b8, scale: 0.66, model: 'monster', armor: L, meleeDef: 1 },
  { name: '骷髏弓兵', team: Team.Enemy, hp: 35, speed: 1.7, radius: 0.27, damage: 5, attackCd: 1.6, reach: 0.1, aggro: 6, reward: 2, color: 0xc8c0a8, scale: 0.64, model: 'monster', armor: L, range: 5, proj: 'arrow' },
  { name: '骷髏旗手', team: Team.Enemy, hp: 50, speed: 1.7, radius: 0.28, damage: 0, attackCd: 1, reach: 0.1, aggro: 0, reward: 3, color: 0xe0b0a0, scale: 0.66, model: 'monster', armor: L, support: true, skill: { type: 'horn', radius: 4, atk: 2 } },
  { name: '骷髏骨頭車', team: Team.Enemy, hp: 180, speed: 1.0, radius: 0.5, damage: 18, attackCd: 2.5, reach: 0.2, aggro: 3, reward: 6, color: 0xb8a888, scale: 1.05, model: 'monster', armor: H, meleeDef: 2, rangedDef: 6, wheeled: true, bldMul: 3 },
  // 毛球族第三階段：角毛球獸（衝鋒撞擊，打建築有加成）
  { name: '角毛球獸', team: Team.Enemy, hp: 150, speed: 1.9, radius: 0.42, damage: 14, attackCd: 1.3, reach: 0.15, aggro: 4, reward: 5, color: 0x8aa55a, scale: 0.85, model: 'monster', armor: H, meleeDef: 1, rangedDef: 1, bldMul: 1.5, jumping: true },
];

/**
 * 怪物族：每族三或四個階段（圖：public/sprites/<id>_1…/）。規則簡單：
 * 每族只寫第一階段的數值（size＝體型），階段越高照 MONSTER_TIER 的倍率變大、變耐打、打得更痛；最高階是重甲。
 * 三階段的族：第一階＝四階段的第一階、最高階＝四階段的第四階，中間那階取兩者之間（tierMul）。
 * 預設近戰；有 range 的是遠程。
 */
export interface MonsterFamily {
  id: string;
  name: string;
  /** 各階段名稱（3 或 4 個） */
  tiers: string[];
  hp: number;
  damage: number;
  speed: number;
  /** 體型（1＝和骷髏雜兵差不多） */
  size: number;
  color: number;
  /** 拆建築的傷害倍率（巨人類） */
  bldMul?: number;
  /** 和其他族合成同一個種族（MONSTER_TRIBES 的 id）；沒有就自己一族 */
  tribe?: string;
  /** 會飛（見 UnitKind.flying） */
  flying?: boolean;
  /** 遠程：射程（格）和丟出去的東西 */
  range?: number;
  proj?: ProjKind;
}
export const MONSTERS: MonsterFamily[] = [
  { id: 'goblin', name: '👺 哥布林', tiers: ['普通哥布林', '野性哥布林', '狂暴哥布林', '魔化哥布林'], hp: 30, damage: 4, speed: 2.0, size: 0.9, color: 0x8aa04a },
  { id: 'evil_pig', name: '🐗 墮落豬人', tiers: ['豬人暴徒', '獠牙豬人', '狂暴豬將', '豬魔霸王'], hp: 60, damage: 7, speed: 1.6, size: 1.1, color: 0xd98a8a, tribe: 'pig' },
  { id: 'evil_bull', name: '🐂 壞牛人', tiers: ['牛人暴徒', '鐵角牛人', '戰牛勇士', '牛魔霸主'], hp: 70, damage: 8, speed: 1.7, size: 1.15, color: 0x8a5a3a, tribe: 'bull' },
  { id: 'evil_treant', name: '🌳 樹人雜兵', tiers: ['樹精小兵', '森林樹兵', '藤甲樹兵', '古樹守衛'], hp: 75, damage: 6, speed: 1.2, size: 1.05, color: 0x7a9a4a, tribe: 'forest' },
  { id: 'evil_treant2', name: '🌲 壞樹人族', tiers: ['樹靈殘枝', '腐木樹人', '荊棘樹魔', '墮落樹王'], hp: 75, damage: 7, speed: 1.2, size: 1.05, color: 0x6a4a2a, tribe: 'forest' },
  { id: 'dryad', name: '🥀 壞樹妖族', tiers: ['樹妖幼體', '藤蔓樹妖', '荊棘樹妖', '墮落樹姬'], hp: 40, damage: 5, speed: 1.9, size: 0.95, color: 0x9ab06a, tribe: 'forest' },
  { id: 'earth_giant', name: '🪨 土巨人族', tiers: ['岩石巨人', '石護巨人', '地脈巨人', '大地巨人'], hp: 110, damage: 10, speed: 1.0, size: 1.25, color: 0x9a8a6a, bldMul: 2 },
  { id: 'fireling', name: '🔥 火人族', tiers: ['火熔人', '烈炎人', '火焰戰士', '炎獄領主'], hp: 30, damage: 5, speed: 2.2, size: 0.85, color: 0xf07a2a, tribe: 'fire' },
  { id: 'fire_giant', name: '🌋 火巨人族', tiers: ['火焰巨人', '熔岩巨人', '烈焰巨人', '黑炎巨人'], hp: 110, damage: 11, speed: 1.0, size: 1.25, color: 0xc0502a, bldMul: 2, tribe: 'fire' },
  { id: 'yeti', name: '❄️ 雪怪', tiers: ['雪幼怪', '雪毛怪', '冰角雪怪', '霜巔巨雪怪'], hp: 85, damage: 8, speed: 1.5, size: 1.15, color: 0xe8f0f8, tribe: 'snow' },
  { id: 'slime', name: '🫧 黏黏族', tiers: ['小黏黏', '膠質黏黏', '酸液黏黏', '變異黏王'], hp: 45, damage: 4, speed: 1.3, size: 0.9, color: 0x6ac0e0, tribe: 'slime' },
  { id: 'bat', name: '🦇 蝙蝠族', tiers: ['小蝙蝠', '血蝠', '魔蝠', '夜幕巨蝠'], hp: 25, damage: 3, speed: 2.8, size: 0.9, color: 0x6a3a5a, tribe: 'vampire', flying: true },
  { id: 'vampire', name: '🧛 吸血鬼族', tiers: ['初階吸血鬼', '菁英吸血鬼', '貴族吸血鬼', '血族始祖'], hp: 50, damage: 6, speed: 2.0, size: 1.0, color: 0x8a2a3a, tribe: 'vampire' },
  { id: 'vamp_girl', name: '🌹 吸血鬼族（少女）', tiers: ['吸血少女', '血裔少女', '夢魘少女', '血皇蘿莉'], hp: 45, damage: 6, speed: 2.1, size: 1.0, color: 0xc04a5a, tribe: 'vampire' },
  { id: 'imp', name: '😈 惡魔', tiers: ['初階惡魔', '強化惡魔', '魔化惡魔', '魔王惡魔'], hp: 35, damage: 5, speed: 2.3, size: 1.0, color: 0x5a2a3a, tribe: 'demon', flying: true },
  { id: 'imp2', name: '👿 惡魔（第二版）', tiers: ['惡魔 Ⅰ', '惡魔 Ⅱ', '惡魔 Ⅲ', '惡魔 Ⅳ'], hp: 35, damage: 5, speed: 2.3, size: 1.0, color: 0x4a2a3a, tribe: 'demon', flying: true },
  // ---- 三階段（2026-11-14 的圖；設定圖上沒有階段名稱，先用 Ⅰ／Ⅱ／Ⅲ）
  // 蜥蜴族：戰士、重甲戰士、弩手（遠程）、薩滿（遠程）、骸骨蜥蜴戰士
  { id: 'lizard_warrior', name: '🦎 蜥蜴戰士', tiers: ['蜥蜴戰士 Ⅰ', '蜥蜴戰士 Ⅱ', '蜥蜴戰士 Ⅲ'], hp: 55, damage: 7, speed: 1.7, size: 1.05, color: 0x6a8a3a, tribe: 'lizard' },
  { id: 'lizard_heavy', name: '🦎 蜥蜴重甲戰士', tiers: ['蜥蜴重甲戰士 Ⅰ', '蜥蜴重甲戰士 Ⅱ', '蜥蜴重甲戰士 Ⅲ'], hp: 85, damage: 7, speed: 1.4, size: 1.15, color: 0x5a6a3a, tribe: 'lizard' },
  { id: 'lizard_crossbow', name: '🦎 蜥蜴弩手', tiers: ['蜥蜴弩手 Ⅰ', '蜥蜴弩手 Ⅱ', '蜥蜴弩手 Ⅲ'], hp: 40, damage: 6, speed: 1.7, size: 1.0, color: 0x7a8a4a, tribe: 'lizard', range: 5.5, proj: 'arrow' },
  { id: 'lizard_shaman', name: '🦎 蜥蜴薩滿', tiers: ['蜥蜴薩滿 Ⅰ', '蜥蜴薩滿 Ⅱ', '蜥蜴薩滿 Ⅲ'], hp: 40, damage: 5, speed: 1.6, size: 1.0, color: 0x6a5a3a, tribe: 'lizard', range: 4.5, proj: 'pebble' },
  { id: 'bone_lizard', name: '🦴 骸骨蜥蜴戰士', tiers: ['骸骨蜥蜴戰士 Ⅰ', '骸骨蜥蜴戰士 Ⅱ', '骸骨蜥蜴戰士 Ⅲ'], hp: 50, damage: 8, speed: 1.8, size: 1.05, color: 0xd8c8a0, tribe: 'lizard' },
  // 黏黏族（和原本的黏黏一族）：冰晶史萊姆、彩虹史萊姆
  { id: 'ice_slime', name: '🧊 冰晶史萊姆', tiers: ['冰晶史萊姆 Ⅰ', '冰晶史萊姆 Ⅱ', '冰晶史萊姆 Ⅲ'], hp: 50, damage: 4, speed: 1.3, size: 0.95, color: 0x7ab8f0, tribe: 'slime' },
  { id: 'rainbow_slime', name: '🌈 彩虹史萊姆', tiers: ['彩虹史萊姆 Ⅰ', '彩虹史萊姆 Ⅱ', '彩虹史萊姆 Ⅲ'], hp: 45, damage: 5, speed: 1.4, size: 0.95, color: 0xd8a0e8, tribe: 'slime' },
  // 雪怪族（和原本的雪怪一族）：冰雪妖姬（遠程）、冰雪精靈（遠程）、冰雪巨獸、冰霜巨魔、雪團
  { id: 'ice_queen', name: '❄️ 冰雪妖姬', tiers: ['冰雪妖姬 Ⅰ', '冰雪妖姬 Ⅱ', '冰雪妖姬 Ⅲ'], hp: 45, damage: 6, speed: 1.6, size: 1.0, color: 0xc8d8f8, tribe: 'snow', range: 5, proj: 'water' },
  { id: 'snow_sprite', name: '❄️ 冰雪精靈', tiers: ['冰雪精靈 Ⅰ', '冰雪精靈 Ⅱ', '冰雪精靈 Ⅲ'], hp: 35, damage: 4, speed: 1.8, size: 0.9, color: 0xe0e8ff, tribe: 'snow', range: 4.5, proj: 'water' },
  { id: 'snow_beast', name: '❄️ 冰雪巨獸', tiers: ['冰雪巨獸 Ⅰ', '冰雪巨獸 Ⅱ', '冰雪巨獸 Ⅲ'], hp: 100, damage: 9, speed: 1.2, size: 1.25, color: 0xd8e4f4, tribe: 'snow', bldMul: 1.5 },
  { id: 'frost_troll', name: '❄️ 冰霜巨魔', tiers: ['冰霜巨魔 Ⅰ', '冰霜巨魔 Ⅱ', '冰霜巨魔 Ⅲ'], hp: 90, damage: 10, speed: 1.3, size: 1.15, color: 0x7890b8, tribe: 'snow' },
  { id: 'snowball', name: '❄️ 雪團', tiers: ['雪團 Ⅰ', '雪團 Ⅱ', '雪團 Ⅲ'], hp: 40, damage: 4, speed: 1.8, size: 0.9, color: 0xf0f4ff, tribe: 'snow' },
  // 殭屍：和吸血鬼族一起；木乃伊：先自己一族；火焰精靈：和火焰族一起
  { id: 'zombie', name: '🧟 殭屍', tiers: ['殭屍 Ⅰ', '殭屍 Ⅱ', '殭屍 Ⅲ'], hp: 50, damage: 6, speed: 1.3, size: 1.0, color: 0x8a9a7a, tribe: 'vampire' },
  { id: 'mummy', name: '🧟 木乃伊族', tiers: ['木乃伊 Ⅰ', '木乃伊 Ⅱ', '木乃伊 Ⅲ'], hp: 60, damage: 7, speed: 1.3, size: 1.05, color: 0xc8b890 },
  { id: 'fire_sprite', name: '🔥 火焰精靈', tiers: ['火焰精靈 Ⅰ', '火焰精靈 Ⅱ', '火焰精靈 Ⅲ'], hp: 30, damage: 5, speed: 2.0, size: 0.9, color: 0xf08a2a, tribe: 'fire' },
  // 2026-11-15：遠程牛頭擲斧兵（壞牛人族）、遠程豬人投擲者（墮落豬人族）、邪龍蜥蜴霸王（蜥蜴族，四階段）
  { id: 'bull_thrower', name: '🪓 牛頭擲斧兵', tiers: ['牛頭擲斧兵 Ⅰ', '牛頭擲斧兵 Ⅱ', '牛頭擲斧兵 Ⅲ'], hp: 50, damage: 7, speed: 1.6, size: 1.1, color: 0x8a5a3a, tribe: 'bull', range: 5, proj: 'javelin' },
  { id: 'pig_thrower', name: '🔮 豬人投擲者', tiers: ['豬人投擲者 Ⅰ', '豬人投擲者 Ⅱ', '豬人投擲者 Ⅲ'], hp: 50, damage: 6, speed: 1.5, size: 1.1, color: 0xd98a8a, tribe: 'pig', range: 5, proj: 'pebble' },
  { id: 'lizard_overlord', name: '🐉 邪龍蜥蜴霸王', tiers: ['邪龍蜥蜴霸王 Ⅰ', '邪龍蜥蜴霸王 Ⅱ', '邪龍蜥蜴霸王 Ⅲ', '邪龍蜥蜴霸王 Ⅳ'], hp: 70, damage: 8, speed: 1.5, size: 1.15, color: 0x5a7a3a, tribe: 'lizard' },
];
/** 合成一個種族的怪物族（圖鑑、對打測試都當同一族） */
export const MONSTER_TRIBES: Record<string, string> = {
  forest: '🌲 墮落森林', // 樹人雜兵、壞樹人族、壞樹妖族
  fire: '🔥 火焰族', // 火人族、火巨人族、火焰精靈
  vampire: '🦇 吸血鬼族', // 蝙蝠族、吸血鬼族、吸血鬼族（少女）、殭屍
  demon: '😈 惡魔族', // 惡魔、惡魔（第二版）
  lizard: '🦎 蜥蜴族', // 蜥蜴戰士、蜥蜴重甲戰士、蜥蜴弩手、蜥蜴薩滿、骸骨蜥蜴戰士、邪龍蜥蜴霸王
  bull: '🐂 壞牛人族', // 壞牛人、牛頭擲斧兵
  pig: '🐗 墮落豬人族', // 墮落豬人、豬人投擲者
  slime: '🫧 黏黏族', // 黏黏、冰晶史萊姆、彩虹史萊姆
  snow: '❄️ 雪怪族', // 雪怪、冰雪妖姬、冰雪精靈、冰雪巨獸、冰霜巨魔、雪團
};
/** 階段 1→4 的倍率（三階段的族用 tierMul 換算） */
export const MONSTER_TIER = {
  hp: [1, 2, 4, 8],
  damage: [1, 1.6, 2.6, 4.5],
  size: [0.8, 0.92, 1.05, 1.25],
  speed: [1, 1, 0.95, 0.85],
  reward: [1, 2, 5, 15],
};
/** 第 t 階（共 n 階）的倍率：n＝4 直接查表；n＝3 時把階段攤到 0–3 之間（0、1.5、3）內插 */
export function tierMul(table: number[], t: number, n: number): number {
  const pos = n <= 1 ? 0 : (t * (table.length - 1)) / (n - 1), i = Math.floor(pos), f = pos - i;
  return i + 1 < table.length ? table[i] + (table[i + 1] - table[i]) * f : table[i];
}
/** MONSTER_KIND[族][階段]＝兵種編號（接在 UNIT_KINDS 後面） */
export const MONSTER_KIND: number[][] = MONSTERS.map((m) =>
  m.tiers.map((name, t) => {
    const n = m.tiers.length, mul = (tb: number[]) => tierMul(tb, t, n);
    const lv = Math.round((t * 3) / Math.max(1, n - 1)); // 換算成 0–3 的等級（防禦、重甲）
    const s = m.size * mul(MONSTER_TIER.size);
    UNIT_KINDS.push({
      name, team: Team.Enemy,
      hp: Math.round(m.hp * mul(MONSTER_TIER.hp)), damage: Math.round(m.damage * mul(MONSTER_TIER.damage)),
      speed: +(m.speed * mul(MONSTER_TIER.speed)).toFixed(2), radius: +(0.3 * s).toFixed(2),
      attackCd: m.range ? 1.6 : 1.2, reach: 0.15, aggro: m.range ? m.range + 1 : 4, reward: Math.round(mul(MONSTER_TIER.reward)), color: m.color,
      scale: +(0.7 * s).toFixed(2), model: 'monster',
      armor: t === n - 1 ? H : L, meleeDef: lv, rangedDef: lv, bldMul: m.bldMul, flying: m.flying,
      range: m.range, proj: m.proj,
    });
    return UNIT_KINDS.length - 1;
  }));

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
  /** 軍營會訓練的兵種（輪流出），沒寫就是綿羊 */
  trains?: number[];
  /** 去背好的建築圖：public/sprites/buildings/<sprite>_<等級>.png（沒有就用程式畫的） */
  sprite?: string;
  /** 長方形建築的寬（x）和高（y）；沒寫就是 size × size。放置時可以轉 90 度 */
  w?: number;
  h?: number;
}

export const BK = {
  Base: 0, Wall: 1, Tower: 2, Barracks: 3,
  Warehouse: 4, House: 5, Granary: 6, Arsenal: 7, Farm: 8, Research: 9,
  Brewery: 10, Tavern: 11, Nursery: 12, Market: 13, Church: 14, Lumber: 15, Mine: 16,
  Castle: 17, Cemetery: 18, Woodworks: 19, Plankyard: 20, Diplomacy: 21,
  // 各種族軍營（羊族軍營就是上面的 Barracks）
  CampSpiky: 22, CampDog: 23, CampBird: 24, CampTreant: 25, CampFish: 26, CampSpider: 27,
  CampWolf: 28, CampBull: 29, CampPig: 30,
  StoneTower: 31, Gate: 32, Windmill: 33, Workshop: 34, CampDeer: 35, Sentry: 36,
} as const;
export const MAX_LEVEL = 3;

export const BUILDING_KINDS: BuildingKind[] = [
  // 世界樹・聯盟市鎮中心：五個階段（美術在 public/sprites/buildings/town_center_<階段>.png）
  { name: '世界樹市鎮中心', icon: '🌳', size: 3, hp: 2000, cost: 0, color: 0xf2a7b5, upgradeCost: [150, 300, 500, 800],
    levelNames: ['樹苗屋', '小樹屋', '繁榮樹城', '盟都', '永恆聖都'], sprite: 'town_center' },
  { name: '城牆', icon: '🧱', size: 1, hp: 250, cost: 4, color: 0xd9c4a0, upgradeCost: [6, 10], sprite: 'wall' },
  // 箭塔 2x2：會射箭的防禦塔（圖：藍色那組，設定圖第二階段就叫「箭塔」）
  { name: '箭塔', icon: '🏹', size: 2, hp: 360, cost: 45, color: 0x7fb6e0, upgradeCost: [50, 100], range: 7, damage: 12, cd: 0.6, sprite: 'watchtower' },
  { name: '羊族軍營', icon: '🐑', size: 2, hp: 400, cost: 60, color: 0xa9d494, upgradeCost: [60, 120], spawnCap: 3, sprite: 'barracks_sheep' },
  // ---- 新建築：目前只有圖（三個等級），功能和數值之後再定
  { name: '倉庫', icon: '📦', size: 2, hp: 400, cost: 50, color: 0xc9a27a, upgradeCost: [60, 120], sprite: 'warehouse' },
  { name: '房屋', icon: '🏠', size: 2, hp: 300, cost: 30, color: 0xc9a27a, upgradeCost: [40, 80], sprite: 'house' },
  { name: '穀倉', icon: '🌾', size: 2, hp: 350, cost: 50, color: 0xc9a27a, upgradeCost: [60, 120], sprite: 'granary' },
  { name: '兵工廠', icon: '⚒️', size: 2, hp: 450, cost: 80, color: 0xc9a27a, upgradeCost: [80, 160], sprite: 'arsenal' },
  { name: '農場', icon: '🚜', size: 2, hp: 250, cost: 40, color: 0xa9d494, upgradeCost: [40, 80], sprite: 'farm' },
  { name: '魔法研究院', icon: '🔮', size: 2, hp: 350, cost: 100, color: 0xb59ad9, upgradeCost: [100, 200], sprite: 'research' },
  { name: '釀酒廠', icon: '🍺', size: 2, hp: 350, cost: 60, color: 0xc9a27a, upgradeCost: [60, 120], sprite: 'brewery' },
  { name: '酒館', icon: '🍻', size: 2, hp: 300, cost: 50, color: 0xc9a27a, upgradeCost: [50, 100], sprite: 'tavern' },
  { name: '植樹場', icon: '🌲', size: 2, hp: 250, cost: 40, color: 0xa9d494, upgradeCost: [40, 80], sprite: 'nursery' },
  { name: '市場', icon: '⚖️', size: 3, hp: 400, cost: 80, color: 0xc9a27a, upgradeCost: [80, 160], sprite: 'market' },
  { name: '教堂', icon: '⛪', size: 3, hp: 450, cost: 100, color: 0xd9d4c4, upgradeCost: [100, 200], sprite: 'church' },
  { name: '伐木場', icon: '🪓', size: 2, hp: 300, cost: 30, color: 0xc9a27a, upgradeCost: [40, 80], sprite: 'lumber' },
  { name: '採礦場', icon: '⛏️', size: 2, hp: 400, cost: 50, color: 0x9a9a9a, upgradeCost: [60, 120], sprite: 'mine' },
  { name: '城堡', icon: '🏯', size: 4, hp: 1200, cost: 200, color: 0xd9d4c4, upgradeCost: [200, 400], sprite: 'castle' },
  { name: '墓園', icon: '🪦', size: 2, hp: 300, cost: 40, color: 0x9a9a9a, upgradeCost: [40, 80], sprite: 'cemetery' },
  { name: '木材加工廠', icon: '🪚', size: 2, hp: 350, cost: 60, color: 0xc9a27a, upgradeCost: [60, 120], sprite: 'woodworks' },
  { name: '木板場', icon: '🪵', size: 2, hp: 350, cost: 50, color: 0xc9a27a, upgradeCost: [50, 100], sprite: 'plankyard' },
  { name: '外交館', icon: '🤝', size: 3, hp: 400, cost: 120, color: 0xf2a7b5, upgradeCost: [120, 240], sprite: 'diplomacy' },
  // ---- 各種族軍營：目前只有圖，出兵之後再做
  { name: '刺刺族軍營', icon: '🦔', size: 2, hp: 450, cost: 60, color: 0xc9a27a, upgradeCost: [60, 120], sprite: 'barracks_spiky' },
  { name: '狗族軍營', icon: '🐕', size: 2, hp: 400, cost: 60, color: 0xc9a27a, upgradeCost: [60, 120], sprite: 'barracks_dog' },
  { name: '鳥人族軍營', icon: '🦅', size: 2, hp: 400, cost: 60, color: 0xc9a27a, upgradeCost: [60, 120], sprite: 'barracks_bird' },
  { name: '樹人族軍營', icon: '🌳', size: 2, hp: 450, cost: 60, color: 0xa9d494, upgradeCost: [60, 120], sprite: 'barracks_treant', spawnCap: 3, trains: [UK.TreantShield, UK.TreantJavelin, UK.TreantAxeCart, UK.TreantClub] },
  { name: '魚人族軍營', icon: '🐟', size: 2, hp: 400, cost: 60, color: 0x7fb6e0, upgradeCost: [60, 120], sprite: 'barracks_fish', spawnCap: 3, trains: [UK.FishHarpoon, UK.FishSpear, UK.FishCannon, UK.FishAnchor] },
  { name: '蛛人族軍營', icon: '🕷️', size: 2, hp: 400, cost: 60, color: 0xb59ad9, upgradeCost: [60, 120], sprite: 'barracks_spider', spawnCap: 3, trains: [UK.SpiderDrop, UK.SpiderWeb, UK.SpiderBallista, UK.SpiderFlail] },
  { name: '狼人族軍營', icon: '🐺', size: 2, hp: 400, cost: 60, color: 0x9a9a9a, upgradeCost: [60, 120], sprite: 'barracks_wolf', spawnCap: 3, trains: [UK.WolfClaw, UK.WolfSlinger, UK.WolfTrebuchet, UK.WolfBerserker] },
  { name: '牛族軍營', icon: '🐂', size: 2, hp: 500, cost: 60, color: 0xc9a27a, upgradeCost: [60, 120], sprite: 'barracks_bull', spawnCap: 3, trains: [UK.BullAxe, UK.BullArcher, UK.BullGreataxe, UK.BullRam] },
  { name: '豬族軍營', icon: '🐗', size: 2, hp: 450, cost: 60, color: 0xf2a7b5, upgradeCost: [60, 120], sprite: 'barracks_pig', spawnCap: 3, trains: [UK.PigHammer, UK.PigCrossbow, UK.PigGiant, UK.PigCatapult] },
  // 高塔 3x3：塔頂 2x2 之後可以放單位（站上去射得更遠）
  { name: '高塔', icon: '🗼', size: 3, hp: 900, cost: 120, color: 0xd9d4c4, upgradeCost: [120, 240], sprite: 'stone_tower' },
  // 城門 1×3：中間 2 格寬的通道，我方靠近自動開門通過；敵人過不去，要拆門（放置時按 R 轉向）
  { name: '城門', icon: '🚪', size: 3, w: 3, h: 1, hp: 600, cost: 30, color: 0xd9d4c4, upgradeCost: [40, 80], sprite: 'gate' },
  { name: '風車', icon: '🌬️', size: 2, hp: 300, cost: 50, color: 0xc9a27a, upgradeCost: [50, 100], sprite: 'windmill' },
  { name: '工程工坊', icon: '🛠️', size: 2, hp: 400, cost: 70, color: 0xc9a27a, upgradeCost: [70, 140], sprite: 'workshop' },
  { name: '鹿族軍營', icon: '🦌', size: 2, hp: 400, cost: 60, color: 0xa9d494, upgradeCost: [60, 120], sprite: 'barracks_deer', spawnCap: 3, trains: [UK.DeerSaber, UK.DeerLongbow, UK.DeerRam, UK.DeerDruid] },
  // 哨塔 1x1：小型瞭望台（功能之後再定，例如看得比較遠）
  { name: '哨塔', icon: '🗼', size: 1, hp: 150, cost: 20, color: 0xc9a27a, upgradeCost: [25, 50], sprite: 'archer_tower' },
];

/** 建造選單的分類（第二層）；道路不是建築，放在「經濟」最前面（id 'road'） */
export const BUILD_CATS: { id: string; icon: string; label: string; kinds: (number | 'road')[] }[] = [
  { id: 'defense', icon: '🛡️', label: '防禦', kinds: [BK.Wall, BK.Gate, BK.Sentry, BK.Tower, BK.StoneTower, BK.Castle] },
  { id: 'economy', icon: '🌾', label: '經濟', kinds: ['road', BK.Warehouse, BK.Granary, BK.Farm, BK.Windmill, BK.Lumber, BK.Nursery, BK.Mine, BK.Woodworks, BK.Plankyard, BK.Market, BK.Brewery] },
  { id: 'life', icon: '🏠', label: '生活', kinds: [BK.House, BK.Tavern, BK.Church, BK.Cemetery, BK.Diplomacy, BK.Research] },
  { id: 'military', icon: '⚔️', label: '軍事', kinds: [BK.Arsenal, BK.Workshop] },
  { id: 'camps', icon: '🏕️', label: '種族軍營', kinds: [BK.Barracks, BK.CampSpiky, BK.CampDog, BK.CampBird, BK.CampTreant, BK.CampFish, BK.CampSpider, BK.CampWolf, BK.CampBull, BK.CampPig, BK.CampDeer] },
];

/**
 * 兵工廠研究（參考世紀帝國 4 的鐵匠鋪）：四條線，每條 0～4 級。
 *   武器（近戰／遠程）：每一級，兵種的傷害 + upgAtk（大部分 +1，重擊兵 +2，攻城器不吃）
 *   護甲（近戰／遠程）：每一級，近戰防禦／遠程防禦 +1（所有兵）
 */
export type ResearchLine = 'meleeAtk' | 'rangedAtk' | 'meleeDef' | 'rangedDef';
export const RESEARCH: Record<ResearchLine, { icon: string; name: string }> = {
  meleeAtk: { icon: '🗡️', name: '近戰武器' },
  rangedAtk: { icon: '🏹', name: '遠程武器' },
  meleeDef: { icon: '🛡️', name: '近戰護甲' },
  rangedDef: { icon: '🪖', name: '遠程護甲' },
};
export const RESEARCH_MAX = 4;
/** 升到第 n 級（n＝1～4）的價錢和秒數 */
export const RESEARCH_COST = [60, 120, 200, 300];
export const RESEARCH_TIME = [20, 30, 40, 50];

/** 種族與兵種（圖鑑、兩族對打測試都用這份） */
export const TRIBES: { id: string; name: string; kinds: number[] }[] = [
  { id: 'sheep', name: '🐑 羊族', kinds: [UK.Lancer, UK.Archer, UK.Catapult, UK.Horn] },
  { id: 'spiky', name: '🦔 刺刺族', kinds: [UK.Spineball, UK.Javelin, UK.Ballista, UK.Trapper] },
  { id: 'dog', name: '🐕 狗族', kinds: [UK.DogCav, UK.Barker, UK.StBernard] },
  { id: 'pig', name: '🐗 豬人族', kinds: [UK.PigHammer, UK.PigCrossbow, UK.PigGiant, UK.PigCatapult] },
  { id: 'bull', name: '🐂 牛人族', kinds: [UK.BullAxe, UK.BullArcher, UK.BullGreataxe, UK.BullRam] },
  { id: 'deer', name: '🦌 鹿族', kinds: [UK.DeerSaber, UK.DeerLongbow, UK.DeerRam, UK.DeerDruid] },
  { id: 'wolf', name: '🐺 狼人族', kinds: [UK.WolfClaw, UK.WolfSlinger, UK.WolfTrebuchet, UK.WolfBerserker] },
  { id: 'fish', name: '🐟 魚人族', kinds: [UK.FishHarpoon, UK.FishSpear, UK.FishCannon, UK.FishAnchor] },
  { id: 'spider', name: '🕷️ 蛛人族', kinds: [UK.SpiderDrop, UK.SpiderWeb, UK.SpiderBallista, UK.SpiderFlail] },
  { id: 'treant', name: '🌳 樹人族', kinds: [UK.TreantShield, UK.TreantJavelin, UK.TreantAxeCart, UK.TreantClub] },
];

/** 敵人的種族（屍潮裡出現；圖鑑最下面一排、對打測試的 enemy 模式用） */
export const ENEMY_TRIBES: { id: string; name: string; kinds: number[] }[] = [
  { id: 'bone', name: '💀 骨頭族', kinds: [UK.BoneGrunt, UK.BoneSword, UK.BoneBow, UK.BoneFlag, UK.BoneCart] },
  { id: 'fuzz', name: '🌱 毛球族', kinds: [UK.Fuzz, UK.Runner, UK.HornFuzz, UK.Brute] },
  // 怪物族：有 tribe 的合成一族（放在那一族第一次出現的位置）
  ...MONSTERS.flatMap((m, f) => {
    if (!m.tribe) return [{ id: m.id, name: m.name, kinds: MONSTER_KIND[f] }];
    if (MONSTERS.findIndex((o) => o.tribe === m.tribe) !== f) return [];
    return [{ id: m.tribe, name: MONSTER_TRIBES[m.tribe], kinds: MONSTERS.flatMap((o, g) => (o.tribe === m.tribe ? MONSTER_KIND[g] : [])) }];
  }),
];

/**
 * 屍潮的組成：[兵種, 比例]。骨頭族是最基本的敵人，舊的毛球怪也混在裡面。
 * 比例加起來不用剛好是 1（會自動換算）。
 */
export const WAVE_MIX: [number, number][] = [
  [UK.BoneGrunt, 0.32], [UK.BoneSword, 0.2], [UK.BoneBow, 0.1], [UK.BoneFlag, 0.03], [UK.BoneCart, 0.03],
  [UK.Fuzz, 0.16], [UK.Runner, 0.09], [UK.HornFuzz, 0.04], [UK.Brute, 0.015],
];

/** 經濟 */
export const ECON = {
  startGold: 250,
  passiveIncome: 1.5, // 每秒
  refundRatio: 0.5,
  roadCost: 1, // 每格道路
  upgradeTime: 8, // 建築升級要花的秒數 × 目前等級（Lv1→2 要 8 秒、Lv2→3 要 16 秒）
};
