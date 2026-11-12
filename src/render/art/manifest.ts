import { BK, UK } from '../../sim/data';

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
  unit('fuzz', '毛球怪', UK.Fuzz, 'front', { depth: 0.4 }),
  unit('runner', '飛毛蟲', UK.Runner, 'side'),
  unit('brute', '大毛怪', UK.Brute, 'front', { height: 1.3, depth: 0.38 }),
  building('base', '毛線城堡', BK.Base, 4.2),
  building('wall', '毛氈牆', BK.Wall, 1.0, { depth: 0.45, res: 24 }),
  building('tower', '線軸箭塔', BK.Tower, 2.2),
  building('barracks', '羊圈', BK.Barracks, 1.9),
  { id: 'tree', label: '樹', target: { type: 'tree' }, view: 'front', height: 1.5, depth: 0.4, res: 24, knit: 0.35, bgTolerance: 40 },
];
