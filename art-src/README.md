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
| 🕷️ 蛛人族 | 重型鏈錘兵 | `spider/flail/` | ✅ 14 方向。第一排角色的鏈錘球壓在鄰居腳上切不乾淨，只用第二排（`views/row2_8…14`，`tools/split-touching.ps1` 切）：正面、右前、右側、右後、背面；往左的方向用鏡像 | `spider_flail/` |
| 🌳 樹人族 | 重型巨盾兵 | `treant/shield/` | ✅ 12 方向 | `treant_shield/` |
| 🌳 樹人族 | 重型標槍兵 | `treant/javelin/` | ✅ 7 方向（第二排攻擊動作還沒用） | `treant_javelin/` |
| 🌳 樹人族 | 重型斧頭車 | `treant/axecart/` | ✅ 11 方向 | `treant_axecart/` |
| 🌳 樹人族 | 重型巨棒兵 | `treant/club/` | ✅ 7 方向（第二排攻擊動作還沒用） | `treant_club/` |
| 💀 骨頭族（敵人） | 骷髏雜兵、劍兵、弓兵、旗手、骨頭車 | `bone/<grunt,sword,bow,flag,cart>/` | ✅ 只取第一排旋轉圖（劍兵白底 -FloodWhite） | `bone_<名字>/` |
| 🌱 毛球族（敵人） | 幼毛球、毛球獸、角毛球獸、巨角毛球王 | `enemies/fuzzball/` | ✅ 一張四階段設定圖，每階段 4 個角度（睡覺、倒地、攻擊姿勢、零件還沒用） | `fuzz/`、`runner/`、`fuzz_horn/`、`brute/` |
| 🚩 七族 | 掌旗手（豬人、牛人、狼人、蛛人、魚人、鹿、樹人） | `flagbearers/` | ✅ 一張七族，每族 6 個角度。**2026-11-14 從遊戲移除**（圖還留著，沒有在用） | `flag_<族>/`（沒在用） |
| 🐂 牛人族 | 重型衝撞車 | `bull/ram/` | ✅ 16 方向（原圖是半透明白底，切的時候去掉） | `bull_ram/` |
| 👺 哥布林（敵人） | 普通 → 野性 → 狂暴 → 魔化哥布林 | `enemies/goblin/` | ✅ 四階段 × 8 角度 | `goblin_1…4/` |
| 🐗 墮落豬人族（敵人） | 豬人暴徒 → 獠牙豬人 → 狂暴豬將 → 豬魔霸王 | `enemies/evil-pig/` | ✅ 四階段 × 8 角度 | `evil_pig_1…4/` |
| 🐂 壞牛人族（敵人） | 牛人暴徒 → 鐵角牛人 → 戰牛勇士 → 牛魔霸主 | `enemies/evil-bull/` | ✅ 四階段 × 8 角度 | `evil_bull_1…4/` |
| 🌳 樹人雜兵（敵人） | 樹精小兵 → 森林樹兵 → 藤甲樹兵 → 古樹守衛 | `enemies/evil-treant/` | ✅ 四階段 × 8 角度 | `evil_treant_1…4/` |
| 🌲 壞樹人族（敵人） | 樹靈殘枝 → 腐木樹人 → 荊棘樹魔 → 墮落樹王 | `enemies/evil-treant-2/` | ✅ 四階段 × 8 角度（淺灰底） | `evil_treant2_1…4/` |
| 🥀 壞樹妖族（敵人） | 樹妖幼體 → 藤蔓樹妖 → 荊棘樹妖 → 墮落樹姬 | `enemies/dryad/` | ✅ 四階段 × 8 角度 | `dryad_1…4/` |
| 🪨 土巨人族（敵人） | 岩石 → 石護 → 地脈 → 大地巨人 | `enemies/earth-giant/` | ✅ 四階段 × 8 角度 | `earth_giant_1…4/` |
| 🔥 火人族（敵人） | 火熔人 → 烈炎人 → 火焰戰士 → 炎獄領主 | `enemies/fireling/` | ✅ 四階段 × 8 角度 | `fireling_1…4/` |
| 🌋 火巨人族（敵人） | 火焰 → 熔岩 → 烈焰 → 黑炎巨人 | `enemies/fire-giant/` | ✅ 四階段 × 8 角度 | `fire_giant_1…4/` |
| ❄️ 雪怪族（敵人） | 雪幼怪 → 雪毛怪 → 冰角雪怪 → 霜巔巨雪怪 | `enemies/yeti/` | ✅ 四階段 × 8 角度（白底） | `yeti_1…4/` |
| 🫧 黏黏族（敵人） | 小黏黏 → 膠質 → 酸液 → 變異黏王 | `enemies/slime/` | ✅ 四階段 × 8 角度 | `slime_1…4/` |
| 🦇 蝙蝠族（敵人） | 小蝙蝠 → 血蝠 → 魔蝠 → 夜幕巨蝠 | `enemies/bat/` | ✅ 四階段 × 8 角度 | `bat_1…4/` |
| 🧛 吸血鬼族（敵人） | 初階 → 菁英 → 貴族吸血鬼 → 血族始祖 | `enemies/vampire/` | ✅ 四階段 × 8 角度 | `vampire_1…4/` |
| 🌹 吸血鬼族・少女（敵人） | 吸血少女 → 血裔少女 → 夢魘少女 → 血皇蘿莉 | `enemies/vampire-girl/` | ✅ 四階段 × 8 角度 | `vamp_girl_1…4/` |
| 😈 惡魔（敵人） | 初階 → 強化 → 魔化 → 魔王惡魔 | `enemies/imp/` | ✅ 四階段 × 7 角度 | `imp_1…4/` |
| 👿 惡魔第二版（敵人） | 四階段（設定圖沒有名字） | `enemies/imp-2/` | ✅ 四階段 × 7 角度 | `imp2_1…4/` |

敵人都是**四階段**（還沒放進遊戲）。`tools/cutout-enemy-sheets.ps1` 整批重切（`-Only <資料夾>` 只切一張）：去掉左邊的名稱標籤和上面的角度標籤，切成 4 排 × N 欄放進 `views/v_1…`，再照「臉朝畫面哪邊」複製到 `public/sprites/<名字>_<階段>/`（設定圖上的「右側」在畫面上是臉朝左；第一欄「俯角 45°」不用）。魔像那張設定圖已刪掉。

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

## 介面圖（`ui/`）
- `ui/numbers/<種類>數字.png`：一排「圖示 0–9 + −」→ `public/sprites/ui/numbers/<種類>/icon.png、0…9.png、plus.png、minus.png`（`tools/split-numbers.ps1`）
  種類：coin 金幣、food 食物、wood 木材、stone 石礦、coal 煤礦、gold_ore 金礦、fire 火焰、freeze 冰凍、wet 潮濕、poison 毒物、bleed 出血、slow 緩速
- `ui/tech/兵工廠科技.png`：兵工廠科技 6 條 × 3 級 → `public/sprites/ui/tech/<科技>_1…3.png`（含底下的 Ⅰ/Ⅱ/Ⅲ 牌子）
  melee_weapon 近戰武器、armor 護甲、ranged_weapon 遠程武器、ranged_armor 遠程護甲、forge 鍛造、metal 金屬

## 角色圖鑑
`npm run dev` 後開 `/characters.html`（遊戲本體是首頁；`?gallery` 單位圖鑑、`?enemies` 敵人圖鑑、`?buildings` 建築展示）：所有角色（我方十族、敵人）原地轉一圈；敵人每族四階段一排。點卡片看 8 個方向（灰字＝那個方向沒圖，用另一邊鏡像）。
