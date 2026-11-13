import { BK, MONSTER_KIND, MONSTERS, UK } from '../../sim/data';

/**
 * 美術插槽：把模型檔或圖片對應到遊戲裡的單位／建築／道具。
 *
 * 優先順序：`public/models/<id>.glb` → `public/art/<id>.png`（或 .webp）→ 程式產生的模型。
 * .glb 會自動縮放成 `height` 的高度；下面其他參數（depth、res、knit…）只用在圖片。
 * 選用的附加圖：
 *   `<id>_side.png`（主圖是正面時）/ `<id>_front.png`（主圖是側面時）：
 *   另一個角度的剪影，用來決定每一列的厚度（更像真的 3D）。只用形狀，不用顏色
 *   `<id>_back.png`：背面的花色（輪廓沿用正面）；沒有就用正面透過來的鏡像
 *
 * 詳細的生成規則與提示詞見 docs/art-pipeline.md。
 */
export type ArtView = 'front' | 'side';

export type ArtTarget =
  | { type: 'unit'; kind: number }
  | { type: 'building'; kind: number }
  | { type: 'tree' };

export interface ArtSlot {
  id: string;
  label: string;
  target: ArtTarget;
  /** front＝正面圖（寬→X、厚度→Z）；side＝側面圖，角色面向右邊（寬→Z 前進方向、厚度→X） */
  view: ArtView;
  /** 模型高度（世界單位，單位模型之後還會乘上 kind.scale） */
  height: number;
  /** 沒有第二張剪影時，最厚處的半厚度＝寬度 × depth */
  depth: number;
  /** 網格解析度（長邊切幾格）。單位數量多，要低一點 */
  res: number;
  /** 針織紋理疊加強度 0–1 */
  knit: number;
  /** 去背容差（圖片沒有透明背景時，從邊緣用洪水填充去掉底色） */
  bgTolerance: number;
  /** 建築：朝向（弧度）。預設面向開場鏡頭 */
  yaw?: number;
  /** .glb：模型本身面向不對時的修正旋轉（弧度，繞 Y 軸） */
  modelYaw?: number;
}

const unit = (id: string, label: string, kind: number, view: ArtView, extra: Partial<ArtSlot> = {}): ArtSlot => ({
  id, label, target: { type: 'unit', kind }, view, height: 1.1, depth: 0.32, res: 16, knit: 0.35, bgTolerance: 40, ...extra,
});
const building = (id: string, label: string, kind: number, height: number, extra: Partial<ArtSlot> = {}): ArtSlot => ({
  id, label, target: { type: 'building', kind }, view: 'front', height, depth: 0.3, res: 48, knit: 0.4, bgTolerance: 40, yaw: Math.PI / 4, ...extra,
});

export const ART_SLOTS: ArtSlot[] = [
  unit('sheep', '綿羊兵（羊人）', UK.Sheep, 'front', { height: 1.2, depth: 0.3, bgTolerance: 30 }),
  // 新兵種：2D 版用 public/sprites/<id>/ 的設定圖多視角（見 docs/art-pipeline.md）
  unit('lancer', '長槍兵', UK.Lancer, 'front', { height: 1.2, bgTolerance: 30 }),
  unit('archer', '弓箭手', UK.Archer, 'front', { height: 1.15, bgTolerance: 36 }),
  // 設定圖底色是米色漸層，26 去不乾淨（右上角殘留米色塊）→ 40
  unit('catapult', '投石車', UK.Catapult, 'front', { height: 1.1, bgTolerance: 40 }),
  unit('horn', '號角手', UK.Horn, 'front', { height: 1.15, bgTolerance: 26 }),
  unit('spineball', '刺球衛', UK.Spineball, 'front', { height: 1.1, bgTolerance: 26 }),
  unit('javelin', '豪豬標槍手', UK.Javelin, 'front', { height: 1.15, bgTolerance: 26 }),
  unit('ballista', '尖刺弩砲', UK.Ballista, 'front', { height: 1.0, bgTolerance: 36 }),
  unit('trapper', '陷阱工程師', UK.Trapper, 'front', { height: 1.1, bgTolerance: 26 }),
  unit('dogcav', '狗狗騎兵', UK.DogCav, 'front', { height: 1.0, bgTolerance: 26 }),
  unit('barker', '吠叫兵', UK.Barker, 'front', { height: 1.0, bgTolerance: 26 }),
  unit('stbernard', '聖伯納救援犬', UK.StBernard, 'front', { height: 1.0, bgTolerance: 26 }),
  // 豬人族：16 方向旋轉圖（已去背），挑 8 個方向放進 public/sprites/pig_<名字>/（原始切片在 art-src/pig/<名字>/views/）
  unit('pig_hammer', '槌頭兵', UK.PigHammer, 'front', { height: 1.15 }),
  unit('pig_crossbow', '弩兵', UK.PigCrossbow, 'front', { height: 1.15 }),
  unit('pig_giant', '巨槌兵', UK.PigGiant, 'front', { height: 1.15 }),
  unit('pig_catapult', '豬人投石車', UK.PigCatapult, 'front', { height: 1.05 }),
  // 牛人族：同樣是 16 方向旋轉圖挑 8 個方向（public/sprites/bull_<名字>/）
  unit('bull_axe', '輕型斧頭兵', UK.BullAxe, 'front', { height: 1.2 }),
  unit('bull_archer', '輕型弓箭手', UK.BullArcher, 'front', { height: 1.2 }),
  unit('bull_greataxe', '重型巨斧兵', UK.BullGreataxe, 'front', { height: 1.2 }),
  unit('bull_ram', '重型衝撞車', UK.BullRam, 'front', { height: 1.05 }),
  // 鹿族（德魯伊只有一邊側面，另一邊用鏡像）
  unit('deer_saber', '輕型彎刀手', UK.DeerSaber, 'front', { height: 1.25 }),
  unit('deer_longbow', '輕型長弓兵', UK.DeerLongbow, 'front', { height: 1.25 }),
  unit('deer_ram', '輕型鹿角衝撞車', UK.DeerRam, 'front', { height: 1.05 }),
  unit('deer_druid', '輕型德魯伊', UK.DeerDruid, 'front', { height: 1.25 }),
  // 狼人族（快爪手、狂化狼人是 18 方向；投石手、配重投石機的圖右邊有武器特寫，切之前先裁掉）
  unit('wolf_claw', '輕型快爪手', UK.WolfClaw, 'front', { height: 1.15 }),
  unit('wolf_slinger', '輕型投石手', UK.WolfSlinger, 'front', { height: 1.15 }),
  unit('wolf_trebuchet', '巨型配重投石機', UK.WolfTrebuchet, 'front', { height: 1.2 }),
  unit('wolf_berserker', '輕型狂化狼人', UK.WolfBerserker, 'front', { height: 1.2 }),
  // 魚人族（三叉戟魚人＝魚矛兵；原圖是半透明白霧底，切的時候 -MinAlpha 220）
  unit('fish_spear', '輕型魚矛兵', UK.FishSpear, 'front', { height: 1.2 }),
  unit('fish_harpoon', '輕型魚叉兵', UK.FishHarpoon, 'front', { height: 1.2 }),
  unit('fish_cannon', '輕型水砲攻城器', UK.FishCannon, 'front', { height: 1.05 }),
  unit('fish_anchor', '重型魚人船錨兵', UK.FishAnchor, 'front', { height: 1.2 }),
  // 蛛人族（傘兵原圖是白底，切的時候 -FloodWhite；弩砲兩排連在一起，分開切）
  unit('spider_drop', '輕型近戰傘兵', UK.SpiderDrop, 'front', { height: 1.1 }),
  unit('spider_web', '輕型遠程蛛網兵', UK.SpiderWeb, 'front', { height: 1.15 }),
  unit('spider_ballista', '重型遠程弩砲', UK.SpiderBallista, 'front', { height: 1.1 }),
  unit('spider_flail', '重型鏈錘兵', UK.SpiderFlail, 'front', { height: 1.15 }),
  // 樹人族（標槍兵、巨棒兵只取第一排的站姿，第二排是攻擊動作）
  unit('treant_shield', '重型巨盾兵', UK.TreantShield, 'front', { height: 1.2 }),
  unit('treant_javelin', '重型標槍兵', UK.TreantJavelin, 'front', { height: 1.25 }),
  unit('treant_axecart', '重型斧頭車', UK.TreantAxeCart, 'front', { height: 1.1 }),
  unit('treant_club', '重型巨棒兵', UK.TreantClub, 'front', { height: 1.3 }),
  // 敵人：骨頭族（只取第一排旋轉圖；劍兵原圖是白底，-FloodWhite）
  unit('bone_grunt', '骷髏雜兵', UK.BoneGrunt, 'front', { height: 1.15 }),
  unit('bone_sword', '骷髏劍兵', UK.BoneSword, 'front', { height: 1.15 }),
  unit('bone_bow', '骷髏弓兵', UK.BoneBow, 'front', { height: 1.15 }),
  unit('bone_flag', '骷髏旗手', UK.BoneFlag, 'front', { height: 1.35 }),
  unit('bone_cart', '骷髏骨頭車', UK.BoneCart, 'front', { height: 1.05 }),
  // 毛球族四個階段（設定圖每階段 4 個角度：正面、左前、背面、側面，其他方向鏡像）
  unit('fuzz', '幼毛球', UK.Fuzz, 'front', { depth: 0.4, height: 0.9 }),
  unit('runner', '毛球獸', UK.Runner, 'front', { height: 1.0 }),
  unit('fuzz_horn', '角毛球獸', UK.HornFuzz, 'front', { height: 1.05 }),
  unit('brute', '巨角毛球王', UK.Brute, 'front', { height: 1.1, depth: 0.38 }),
  // 怪物族四階段（public/sprites/<族>_1…4/）
  ...MONSTERS.flatMap((m, f) => m.tiers.map((label, t) => unit(`${m.id}_${t + 1}`, label, MONSTER_KIND[f][t], 'front', { height: 1.2 }))),
  building('base', '毛線城堡', BK.Base, 4.2),
  building('wall', '毛氈牆', BK.Wall, 1.0, { depth: 0.45, res: 24 }),
  building('tower', '線軸箭塔', BK.Tower, 2.2),
  building('barracks', '羊圈', BK.Barracks, 1.9),
  { id: 'tree', label: '樹', target: { type: 'tree' }, view: 'front', height: 1.5, depth: 0.4, res: 24, knit: 0.35, bgTolerance: 40 },
];
