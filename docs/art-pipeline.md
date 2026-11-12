# 美術流程：3D 模型與圖片

## 2D 版（預設）：單位用設定圖的多視角

2D 斜角版的單位最優先用**畫好的設定圖**：把同一隻角色的 5 個角度放進 `public/sprites/<名字>/`

| 檔名 | 角度 | 用在畫面上的哪個朝向 |
|---|---|---|
| `front.png` | 正面（必要） | 正對鏡頭 |
| `front45.png` | 右前 45°（臉朝右） | 右下；鏡像後當左下 |
| `side.png` | 右側（臉朝右） | 右；鏡像後當左 |
| `back45.png` | 右後 45° | 右上；鏡像後當左上 |
| `back.png` | 背面 | 背對鏡頭 |
| `frontLeft45.png` | 左前 45°（選用） | 左下（沒有就鏡像 front45） |
| `backLeft45.png` | 左後 45°（選用） | 左上（沒有就鏡像 back45） |

- **最好是 45 度俯角畫的設定圖**（和遊戲鏡頭同角度），平視的圖放進斜角地圖會有點怪
- 沒有 `side.png` 時：往右走用 front45、往左走用 frontLeft45；其他缺的角度用正面代替
- 背景會自動去掉（容差用 manifest 的 `bgTolerance`）
- 高度依 manifest 的 `height` × 單位大小縮放，所有角度用同一個比例
- **背景用和角色差很多的純色、不要畫地面陰影**：米白羊毛放在米色背景上，去背會吃掉頭頂；灰綠色背景就很乾淨
- 羊人目前用 `Low-Poly Chibi Sheep Turnaround Sheet2`（45 度俯角、灰綠背景）裁出的 5 張（`art-src/sheep-topdown2/`）；米色背景版在 `art-src/sheep-topdown/`，平視版在 `art-src/sheep/`
- 沒有這組圖時，才用下面的 `.glb` 拍成 8 方向；都沒有就用程式畫的 2D 圖

---

每個美術插槽（單位、建築、樹）依序找：

1. **`public/models/<名字>.glb`**：真正的 3D 模型（Blender 手工做，或 AI 圖片轉 3D 工具做）← 主角種族用這個
2. **`public/art/<名字>.png`**：一張圖片，自動「充氣」成毛氈布偶 ← 適合小怪、道具、建築
3. 都沒有 → 用 `src/render/models.ts` 的程式模型

---

## A. 3D 模型（.glb）

### 推薦流程：概念圖 → AI 轉 3D → Blender 修整

1. **用 GPT 生單隻角色的圖**：一隻、正面、手臂稍微張開（A 字站姿）、全身入鏡、純色背景。設定集（一張很多隻）不行
2. **丟進圖片轉 3D 工具**（Tripo、Meshy、Hunyuan3D 等），下載 `.glb`
3. **在 Blender 修整**（下面的檢查清單）
4. 存成 `public/models/sheep.glb`（檔名對照下方表格），在開發者面板「🎨 美術」按 **🔄 重新載入模型和圖片**

### Blender 檢查清單

| 項目 | 怎麼做 | 為什麼 |
|---|---|---|
| 面數 | 加 **Decimate** 修改器，單位壓到 **3000 個三角形以下**（建築可以多一點） | 上千隻同時在場 |
| 面向 | 角色的臉朝 **-Y**（按數字鍵 1 的正視圖看得到臉） | 匯出後就是遊戲的 +Z 前方 |
| 大小、位置 | 不用管 | 遊戲會自動置中、腳底貼地、縮放到插槽的高度 |
| 骨架、動畫 | 不需要；有也會被忽略（用綁定姿勢） | 單位用 instancing，不跑骨架 |
| 材質 | 越少越好（理想是 1 張貼圖） | **每種材質多 1 個 draw call** |
| 匯出 | File → Export → glTF 2.0，格式選 **glTF Binary (.glb)**，**關掉 Compression（Draco）** | 遊戲目前不支援 Draco 壓縮 |

### 專案裡的模型工具（tools/，用 Node 執行，不需要 Blender）

| 情況 | 指令 |
|---|---|
| AI 模型**沒有貼圖**（只有形狀） | `node tools/views-to-glb.mjs art-src/sheep public/models/sheep.glb --mesh=<模型.glb>`：用 `art-src/sheep/` 裡的各角度圖投影上色 |
| （上一行的細節） | 預設輸出「投影貼圖」：每個面從看得到它、又最正對它的角度取原圖，五官會依模型的臉重新畫（位置不對用 `--nose-y=0.65` 指定，`--no-face` 關掉）；法線平滑、顏色往奶油色柔化（`--soften=0.12`）。要舊版的頂點色用 `--vertex-colors`，要稜角分明用 `--flat` |
| 某個部位太大（例如尾巴） | 同上再加 `--shrink-back=y0,y1,z0,k[,度數]`：高度 y0–y1、凸出到 z0 後面的部分縮成 k 倍，再往下轉幾度（垂下來）；模型高度當 1 |
| 變形後顏色不對 | 再加 `--back-color=#rrggbb`：變形的部位直接用這個顏色 |
| AI 把**整張設定表**做成一個模型 | `node tools/glb-extract.mjs <模型.glb> --list` 看有哪些塊，再用 `--box=x0,x1,y0,y1 --target=4000` 切出一隻並減面 |

羊人目前的做法：Tripo 低面數模型（2996 面、無貼圖）+ 設定表上色 + 尾巴縮成 0.45 倍、往下垂 70 度、米白色：
```
node tools/views-to-glb.mjs art-src/sheep public/models/sheep.glb "--mesh=low-poly ram 3d model.glb" --shrink-back=0.13,0.45,0.0,0.45,70 --back-color=#f1e4cf
```

### 支援的內容
- 多個網格、多種材質、巢狀變換：會自動攤平成一個模型
- 貼圖（顏色貼圖、法線貼圖）、頂點色
- 材質會統一成霧面（毛線風），保留原本的顏色和貼圖
- 臉朝錯方向：開發者面板「調整模型」→「.glb 轉向」用 90 度一格修正，再按「印出數值」把 `modelYaw` 貼回 `manifest.ts`
- 太多三角形（超過 5000）時，console 會出現警告

---

## B. 圖片充氣成布偶（.png）

用 GPT 生成 2D 圖片，丟進 `public/art/`，遊戲會自動把它「充氣」成 3D 毛氈布偶模型。

## 怎麼運作

1. **去背**：圖片有透明背景就直接用；沒有的話，從圖片邊緣把底色去掉
2. **只留主體**：去掉零星雜點，裁到剛好包住角色
3. **充氣**：離輪廓越遠越厚，做出圓鼓鼓、像塞了棉花的布偶；正反兩面貼同一張圖
4. **第二張剪影（選用）**：如果多給一張另一個角度的圖，每一層的厚度就照那張圖的形狀 → 比例更像真的 3D
5. **針織紋理**：自動疊上一層針目，和遊戲其他東西的質感一致
6. 輪廓用貼圖切得很精準，網格本身很粗 → 一個單位約 800 個三角形，上千隻同時在場也不卡

沒有圖片的插槽會繼續用程式產生的模型，所以可以一張一張慢慢換。

## 放圖片

| 檔名 | 用在 | 建議角度 |
|---|---|---|
| `sheep.png` | 綿羊兵 | 側面，面向右 |
| `fuzz.png` | 毛球怪 | 正面 |
| `runner.png` | 飛毛蟲 | 側面，面向右 |
| `brute.png` | 大毛怪 | 正面 |
| `base.png` | 毛線城堡 | 正面 |
| `wall.png` | 毛氈牆 | 正面 |
| `tower.png` | 線軸箭塔 | 正面 |
| `barracks.png` | 羊圈 | 正面 |
| `tree.png` | 樹 | 正面 |

- 支援 `.png`、`.webp`
- **第二張剪影**（選用）：主圖是正面 → 加 `<名字>_side.png`（側面、面向右）；主圖是側面 → 加 `<名字>_front.png`。厚度照這張的輪廓做，側面就不會是薄片
- **背面圖**（選用）：`<名字>_back.png`。顏色用這張，輪廓沿用正面；沒有的話背面是正面的鏡像（後腦會看到臉）
- 有「三視圖設定表」時，直接把正面、右側、背面各裁一張就好（羊人就是這樣做的：`sheep.png`、`sheep_side.png`、`sheep_back.png`）
- 換圖後，在開發者面板「🎨 美術」按 **🔄 重新載入圖片**，不用重新整理
- 插槽清單和預設參數在 [src/render/art/manifest.ts](../src/render/art/manifest.ts)；新增單位或建築時在這裡加一行

## 生圖規則（很重要）

圖片好不好轉成 3D，主要看這幾點：

- ✅ **透明背景 PNG**（最好）；做不到的話，用**單一純色背景**，而且要和角色顏色差很多（例如白色綿羊用洋紅色或綠色背景，不要用白色）
- ✅ **一張圖只有一個角色**，全身入鏡，置中，四周留一點空白
- ✅ **正側面或正正面**，不要斜角、不要透視（像設計圖的三視圖）
- ✅ 側面圖一律**面向右邊**
- ❌ 不要地面、不要投影、不要文字、不要外框、不要背景裝飾
- ❌ 不要讓角色碰到圖片邊緣

## 固定的風格提示詞

每張圖都套這段，畫風才會一致（和事件卡共用同一種風格）：

```
Cute handmade plush toy made of knitted wool and felt, soft pastel colors, visible yarn stitches, stitched seams, cozy craft style, simple readable silhouette, flat even lighting, orthographic view, no perspective, single character, full body, centered with margin, isolated on a fully transparent background, no ground, no shadow, no text, no border
```

（敵人改成：`...warm ember orange, charcoal black and deep red yarn...` 讓陣營顏色一眼分得出來）

## 每個插槽的提示詞

把「風格提示詞」接在後面即可。

| 檔名 | 提示詞 |
|---|---|
| `sheep.png` | `Side view facing right of a chubby anthropomorphic sheep soldier walking on four legs, cream white fluffy wool body, dark brown face and legs, tiny felt helmet,` |
| `sheep_front.png` | `Front view of the same chubby sheep soldier, same proportions and scale,` |
| `fuzz.png` | `Front view of a small round fuzzy pom-pom monster with two horns and big eyes, ember orange and charcoal yarn, mischievous,` |
| `runner.png` | `Side view facing right of a fast fuzzy caterpillar creature made of fiery orange yarn, small legs,` |
| `brute.png` | `Front view of a big hulking fuzzy yarn monster, dark purple and charcoal wool, heavy arms, small horns,` |
| `base.png` | `Front view of a giant wooden thread spool castle wrapped in pink yarn, little red felt flag on top,` |
| `wall.png` | `Front view of a short thick felt wall block, beige felt with stitched edges,` |
| `tower.png` | `Front view of a tall wooden spool archer tower wrapped in light blue yarn, red felt cone roof,` |
| `barracks.png` | `Front view of a cozy sheep pen hut with a felt roof and small wooden door, green and cream yarn,` |
| `tree.png` | `Front view of a round fluffy tree with a felt trunk and pom-pom green leaves,` |

## 之後新增種族

新的我方種族（羊族、刺蝟族、狗族…）或敵人（惡魔人、龍人、不死族、黏黏怪…）照同樣格式：

1. 在 `src/sim/data.ts` 加單位資料
2. 在 `src/render/art/manifest.ts` 加一個插槽
3. 用「風格提示詞＋角色描述」生圖，存成 `public/art/<名字>.png`

## 調整模型

開發者面板 → 🎨 美術 → 調整模型，選插槽後可以即時調：

| 參數 | 作用 |
|---|---|
| 高度 | 模型多高（單位還會乘上自己的大小） |
| 厚度 | 沒有第二張剪影時，布偶有多鼓 |
| 網格解析度 | 越高越圓滑，但三角形越多（單位建議 12–20） |
| 針織紋理 | 疊上去的針目有多明顯 |
| 去背容差 | 底色沒去乾淨就調高；角色被吃掉就調低 |

調好後按「🖨️ 印出數值」，把 console 印出的數值貼回 `manifest.ts`。
