# Knitguard: The Last Stitch

使用者自己玩的 3D 塔防遊戲，會長期慢慢開發。溝通使用繁體中文。

- **設計總覽在 `docs/design.md`**（整理過、有待決定問題和開發順序）；逐條原始想法在 `docs/ideas.md`。新想法先記進 ideas.md，再同步更新 design.md
- 使用者希望規則簡單、不要太細節

- 參考作品：They Are Billions（大量屍潮、拆牆）、要戰便戰、Wool at the Gates（毛線/針織手工風）
- 技術：TypeScript + Vite；畫面預設是 Canvas 2D 斜角（Three.js 只用來把 3D 模型拍成圖，`?3d` 時才是完整 3D），開發者面板用 lil-gui
- 執行：`npm run dev`，開啟 http://localhost:5173（`.claude/launch.json` 的 `game` 設定）
- 檢查：`npm run typecheck`
- Node 裝在 `C:\Program Files\nodejs`（舊的 shell 可能還沒有 PATH）

## 架構（模擬與繪圖分離）

- `src/core/` — 固定步長迴圈（30 tick/s，繪圖插值）、可設種子的亂數
- `src/sim/` — 純模擬，不碰 DOM/Three.js
  - `data.ts` — **所有數值**（單位、建築、經濟）；平衡調整改這裡
  - `units.ts` — 單位用 SoA typed arrays（不要改成每單位一個物件）
  - `spatialHash.ts` — 每 tick 重建的網格，碰撞/索敵都用它
  - `flowfield.ts` — 從城堡出發的 Dijkstra 流場，所有敵人共用；建築格成本高 → 會拆牆
  - `world.ts` — 遊戲規則、AI、波次、建築、碰撞
- `src/render2d/` — **預設的 2D 斜角繪圖**（Canvas 2D，方格地圖畫成菱形；網址加 `?3d` 改用 3D 版）
  - `iso.ts` — 斜角投影（世界 ↔ 螢幕）與 2D 鏡頭
  - `sprites2d.ts` — 直接用 Canvas 畫的建築、毛球怪、樹、石頭；`spritesFromViews` 把設定圖的 5 個角度變成 8 方向圖（`public/sprites/<插槽名>/`，羊人用這個）
  - `spriteBaker.ts` — 把 3D 模型拍成 8 方向的圖（羊人 `.glb`、有美術檔的插槽用這個）
  - `renderer2d.ts` — 地面分塊快取、依 x+y 排序畫圖、介面和 3D 版相同（`cam.pick`、`setGhost`、`selected`…）
- `src/render/` — 3D 版（只讀 World 狀態；單位用 InstancedMesh，每種一個 draw call）
  - `wool.ts` — 程式產生的針織貼圖與材質快取
  - `models.ts` — 單位/建築/樹的模型（程式產生；有圖片時改用圖片模型）
  - `art/` — **外部美術**：每個插槽依序找 `public/models/<id>.glb` → `public/art/<id>.png` → 程式模型。`manifest.ts` 列出插槽，`glb.ts` 把 .glb 攤平成一個幾何（每種材質一個 group，仍是 InstancedMesh），`imageTo3d.ts` 把圖片充氣成布偶，`library.ts` 讀檔與熱重載。流程見 `docs/art-pipeline.md`
- `src/debug/devPanel.ts` — 沙盒面板（種子、時間倍率、單步、生成屍潮、免費建造、流場顯示）
- `window.game` — 瀏覽器 console 可存取 world/loop/renderer
- `prototype/` — 最早的 2D 單檔原型，僅供參考

## 慣例

- 新增單位或建築種類：先在 `data.ts` 加資料，模型加在 `models.ts`，再到 `render/art/manifest.ts` 加美術插槽
- 遊戲邏輯一律寫在 sim 層，render 層不改遊戲狀態
- 效能目標：數千單位維持順暢；避免在每 tick 熱迴圈裡配置物件
- 內建瀏覽器面板的 rAF 上限約 30 FPS，測 FPS 要用一般瀏覽器
