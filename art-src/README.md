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
| 🐗 豬人族 | 槌頭兵 | `pig/hammer/` | ✅ 16 方向旋轉圖（已去背） | `pig_hammer/` |
| 🐗 豬人族 | 弩兵 | `pig/crossbow/` | ✅ 16 方向 | `pig_crossbow/` |
| 🐗 豬人族 | 巨槌兵 | `pig/giant/` | ✅ 15 方向 | `pig_giant/` |
| 🐗 豬人族 | 投石車 | `pig/catapult/` | ✅ 16 方向 | `pig_catapult/` |
| 🐂 牛人族 | 輕型斧頭兵 | `bull/axe/` | ✅ 16 方向 | `bull_axe/` |
| 🐂 牛人族 | 輕型弓箭手 | `bull/archer/` | ✅ 16 方向 | `bull_archer/` |
| 🐂 牛人族 | 重型巨斧兵 | `bull/greataxe/` | ✅ 16 方向 | `bull_greataxe/` |
| 🦌 鹿族 | 輕型彎刀手 | `deer/saber/` | ✅ 16 方向 | `deer_saber/` |
| 🦌 鹿族 | 輕型長弓兵 | `deer/longbow/` | ✅ 16 方向（右邊的長弓、箭矢 8 視角還沒用） | `deer_longbow/` |
| 🦌 鹿族 | 輕型鹿角衝撞車 | `deer/ram/` | ✅ 16 方向 | `deer_ram/` |
| 🦌 鹿族 | 輕型德魯伊 | `deer/druid/` | ✅ 14 方向（只有一邊側面）＋樹根特效 | `deer_druid/`、`effects/roots_1…4.png` |
| 🐺 狼人族 | 輕型快爪手 | `wolf/claw/` | ✅ 18 方向 | `wolf_claw/` |
| 🐺 狼人族 | 輕型投石手 | `wolf/slinger/` | ✅ 16 方向（右邊的投石索、石頭特寫還沒用） | `wolf_slinger/` |
| 🐺 狼人族 | 巨型配重投石機 | `wolf/trebuchet/` | ✅ 14 方向（右邊的石彈、配重特寫還沒用） | `wolf_trebuchet/` |
| 🐺 狼人族 | 輕型狂化狼人 | `wolf/berserker/` | ✅ 18 方向 | `wolf_berserker/` |
| 🐟 魚人族 | 輕型魚叉兵 | `fish/harpoon/` | ✅ 14 方向（右邊的魚叉特寫還沒用） | `fish_harpoon/` |
| 🐟 魚人族 | 輕型魚矛兵 | `fish/spear/` | ✅ 14 方向（半透明白霧底，-MinAlpha 220） | `fish_spear/` |
| 🐟 魚人族 | 輕型水砲攻城器 | `fish/cannon/` | ✅ 13 方向（右邊的水彈、水花特寫還沒用） | `fish_cannon/` |
| 🐟 魚人族 | 重型魚人船錨兵 | `fish/anchor/` | ✅ 12 方向 | `fish_anchor/` |
| 🕷️ 蛛人族 | 輕型近戰傘兵 | `spider/drop/` | ✅ 14 方向（白底，-FloodWhite） | `spider_drop/` |
| 🕷️ 蛛人族 | 輕型遠程蛛網兵 | `spider/web/` | ✅ 14 方向 | `spider_web/` |
| 🕷️ 蛛人族 | 重型遠程弩砲 | `spider/ballista/` | ✅ 10 方向（兩排分開切；下面一排零件還沒用） | `spider_ballista/` |
| 🕷️ 蛛人族 | 重型鏈錘兵 | `spider/flail/` | ✅ 14 方向 | `spider_flail/` |
| 🌳 樹人族 | 重型巨盾兵 | `treant/shield/` | ✅ 12 方向 | `treant_shield/` |
| 🌳 樹人族 | 重型標槍兵 | `treant/javelin/` | ✅ 7 方向（第二排攻擊動作還沒用） | `treant_javelin/` |
| 🌳 樹人族 | 重型斧頭車 | `treant/axecart/` | ✅ 11 方向 | `treant_axecart/` |
| 🌳 樹人族 | 重型巨棒兵 | `treant/club/` | ✅ 7 方向（第二排攻擊動作還沒用） | `treant_club/` |
| 💀 骨頭族（敵人） | 骷髏雜兵、劍兵、弓兵、旗手、骨頭車 | `bone/<grunt,sword,bow,flag,cart>/` | ✅ 只取第一排旋轉圖（劍兵白底 -FloodWhite） | `bone_<名字>/` |
| 🌱 毛球族（敵人） | 幼毛球、毛球獸、角毛球獸、巨角毛球王 | `enemies/fuzzball/` | ✅ 一張四階段設定圖，每階段 4 個角度（睡覺、倒地、攻擊姿勢、零件還沒用） | `fuzz/`、`runner/`、`fuzz_horn/`、`brute/` |
| 🐂 牛人族 | 重型衝撞車 | `bull/ram/` | ✅ 16 方向（原圖是半透明白底，切的時候去掉） | `bull_ram/` |

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

豬人族的圖是 2 排的旋轉圖：`tools/split-grid.ps1 -Cols 8,8` 切成一張張（放在 `views/`），再挑 8 個方向複製到 `public/sprites/pig_<名字>/`。

## 樹木（`props/`）
- `props/trees/`：16 種樹 → `public/sprites/props/tree_1…16.png`（1–4 綠樹、5–8 秋天、9–12 松樹、13–16 櫻花）
- `props/orchard/`：16 種果樹 → `fruit_1…16.png`（蘋果、桃、橘、櫻桃，各 4 個樹形）
- 地圖上的樹林每 7×7 格一區用同一種樹，偶爾夾一棵天然果樹；用 `tools/cutout-props-batch.ps1` 重裁
- `props/rocks/`：32 種石頭 → `rock_1…32.png`（每 8 個一組：灰石、砂岩、青苔、水晶）；地圖上每 6×6 格一區用同一種
- `props/ores/`：24 種礦石 → `ore_1…24.png`（鐵、金、煤）；目前只是石頭堆裡偶爾出現的外觀，還不能採
- 已去背的網格圖用 `tools/split-grid.ps1 -Cols 8,8,8,8` 切
| 軍營：羊、刺刺、狗、鳥人、樹人、魚人、蛛人、狼人、牛、豬 | `barracks-<族>/` | `barracks_<族>` | 2x2 |

建築只用設定圖上的「45° 俯視（主視角）」一張：`tools/cutout-building.ps1` 裁下來並去背成透明 PNG（背景是模糊的漸層光暈，用「顏色平滑延伸」判斷背景；會丟掉旁邊的標籤碎片和被裁到的細橫線）。
`tools/cutout-buildings-batch.ps1` 記錄每張設定圖三個階段的裁切位置，可以整批重裁（`-Only <資料夾>` 只裁一個）。
遊戲裡的大小：最高等級的寬度 = 佔地菱形寬 × 1.3，低等級照原圖比例。
