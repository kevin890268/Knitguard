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
- `views/v0.png…`：從設定圖「多視角」那一排依序裁下的每個角度（要重裁用 `tools/recrop-views.ps1`：在設定圖上找到原本的位置、照主體重裁，隔壁的東西和文字塗成底色）

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

## 建築（`buildings/`）

| 建築 | 資料夾 | 設定圖 | 遊戲圖 |
|---|---|---|---|
| 🌳 世界樹市鎮中心 | `buildings/town-center/` | ✅ 五個階段（`stage1`…`stage5`；被換掉的舊版在 `old/`） | `public/sprites/buildings/town_center_1…5.png` |
其他建築都是三個階段，遊戲圖在 `public/sprites/buildings/<遊戲圖名>_1…3.png`，都已經放進遊戲（目前只有圖，功能之後再做）。

| 建築 | 資料夾 | 遊戲圖名 | 佔地 |
|---|---|---|---|
| 📦 倉庫 | `warehouse/` | `warehouse` | 2x2 |
| 🏠 房屋 | `house/` | `house` | 2x2 |
| 🌾 穀倉 | `granary/` | `granary` | 2x2 |
| ⚒️ 兵工廠 | `arsenal/` | `arsenal` | 2x2 |
| 🚜 農場 | `farm/` | `farm` | 2x2 |
| 🔮 魔法研究院 | `research/` | `research` | 2x2 |
| 🍺 釀酒廠 | `brewery/` | `brewery` | 2x2 |
| 🍻 酒館 | `tavern/` | `tavern` | 2x2 |
| 🌲 植樹場 | `nursery/` | `nursery` | 2x2 |
| ⚖️ 市場 | `market/` | `market` | 3x3 |
| ⛪ 教堂 | `church/` | `church` | 3x3 |
| 🏹 箭塔 | `watchtower/` | `watchtower` | 1x1 |
| 🪓 伐木場 | `lumber/` | `lumber` | 2x2 |
| ⛏️ 採礦場 | `mine/` | `mine` | 2x2 |
| 🏯 城堡 | `castle/` | `castle` | 3x3 |
| 🪦 墓園 | `cemetery/` | `cemetery` | 2x2 |
| 🪚 木材加工廠 | `woodworks/` | `woodworks` | 2x2 |
| 🪵 木板場 | `plankyard/` | `plankyard` | 2x2 |
| 🤝 外交館 | `diplomacy/` | `diplomacy` | 3x3 |
| 🗼 高塔 | `stone-tower/` | `stone_tower` | 3x3（設定圖上標明；塔頂 2x2 可用空間） |
| 🧱 城牆 | `wall/` | `wall` | 1x1（取代原本程式畫的毛氈牆） |
| 🏹 箭塔 | `archer-tower/` | `archer_tower` | 1x1（取代藍色的 `watchtower`，那組先留著沒用） |
| 🚪 城門 | `gate/` | `gate` | 2x2 |
| 🌬️ 風車 | `windmill/` | `windmill` | 2x2 |
| 🛠️ 工程工坊 | `workshop/` | `workshop` | 2x2 |
| 🦌 鹿族軍營 | `barracks-deer/` | `barracks_deer` | 2x2 |

上面最後 6 組是已經去背的橫條圖，用 `tools/split-strip.ps1` 依透明的地方切成三張（順便清掉邊緣的紅色殘影；連在一起時從最空的欄切開）。

## 樹木（`props/`）
- `props/trees/`：16 種樹 → `public/sprites/props/tree_1…16.png`（1–4 綠樹、5–8 秋天、9–12 松樹、13–16 櫻花）
- `props/orchard/`：16 種果樹 → `fruit_1…16.png`（蘋果、桃、橘、櫻桃，各 4 個樹形）
- 地圖上的樹林每 7×7 格一區用同一種樹，偶爾夾一棵天然果樹；用 `tools/cutout-props-batch.ps1` 重裁
| 軍營：羊、刺刺、狗、鳥人、樹人、魚人、蛛人、狼人、牛、豬 | `barracks-<族>/` | `barracks_<族>` | 2x2 |

建築只用設定圖上的「45° 俯視（主視角）」一張：`tools/cutout-building.ps1` 裁下來並去背成透明 PNG（背景是模糊的漸層光暈，用「顏色平滑延伸」判斷背景；會丟掉旁邊的標籤碎片和被裁到的細橫線）。
`tools/cutout-buildings-batch.ps1` 記錄每張設定圖三個階段的裁切位置，可以整批重裁（`-Only <資料夾>` 只裁一個）。
遊戲裡的大小：最高等級的寬度 = 佔地菱形寬 × 1.3，低等級照原圖比例。
