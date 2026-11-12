# 美術原始素材

依「種族／兵種」分資料夾。遊戲實際讀的是 `public/sprites/<插槽名>/` 裡裁好的角度圖；這裡是原始設定圖和裁切來源。

| 種族 | 兵種 | 資料夾 | 設定圖 | 遊戲圖 `public/sprites/` |
|---|---|---|---|---|
| 🐑 羊族 | 村民（羊人） | `sheep/villager/` | 概念圖、平視／俯角三視圖、3D 模型（`concepts/`、`models/`） | `sheep/` |
| 🐑 羊族 | 長槍兵 | `sheep/lancer/` | ✅ | `lancer/` |
| 🐑 羊族 | 弓箭手 | `sheep/archer/` | ✅ | `archer/` |
| 🐑 羊族 | 投石車 | `sheep/catapult/` | ✅ | `catapult/` |
| 🐑 羊族 | 號角手 | — | ❌ 還沒畫（暫用村民的圖） | `horn/` |
| 🦔 刺刺族 | 刺球衛 | `spiky/ball-guard/` | ✅（含縮球形態） | `spineball/`、`spineball_curl/` |
| 🦔 刺刺族 | 豪豬標槍手 | `spiky/javelinier/` | ✅ | `javelin/` |
| 🦔 刺刺族 | 尖刺弩砲 | `spiky/ballista/` | ✅ | `ballista/` |
| 🦔 刺刺族 | 陷阱工程師 | `spiky/trap-engineer/` | ✅ | `trapper/` |
| 🐕 狗族 | 騎兵 | `dog/cavalry/` | ✅ | `dogcav/` |
| 🐕 狗族 | 吠叫兵 | `dog/bark/` | ✅ | `barker/` |
| 🐕 狗族 | 聖伯納救援犬 | `dog/rescue/` | ✅ | `stbernard/` |
| 🐕 狗族 | 運輸兵 | `dog/transporter/` | ✅（還沒裁成遊戲圖；等有物資系統再做） | — |

## 每個兵種資料夾
- 設定圖原檔
- `views/v0.png…`：從設定圖「多視角」那一排依序裁下的每個角度（裁切位置記在 tools 以外的暫存腳本裡，之後要重裁可以照著設定圖的版面再做）

## 對應到 8 個方向
`public/sprites/<名字>/` 的檔名一律以**畫面上臉朝哪邊**為準（設定圖上的「右側」有時畫成臉朝左，以實際畫面為準）：

| 檔名 | 臉朝 |
|---|---|
| `front.png` | 正對鏡頭（必要） |
| `front45.png` / `frontLeft45.png` | 右下 / 左下 |
| `side.png` / `sideLeft.png` | 右 / 左 |
| `back45.png` / `backLeft45.png` | 背影往右上 / 左上 |
| `back.png` | 背對鏡頭 |

缺的方向會用另一邊鏡像代替（見 `src/render2d/sprites2d.ts` 的 `DIR_VIEWS`）。
