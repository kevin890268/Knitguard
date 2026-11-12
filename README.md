# Knitguard: The Last Stitch

毛線手工風格的 3D 塔防 × 即時戰略遊戲。用羊毛、刺蝟和農民的雙手，守住山谷不被火燒毀。

## 執行

需要 [Node.js](https://nodejs.org/)（LTS 版）。

```bash
npm install
npm run dev
```

開啟 http://localhost:5173

## 操作

**部隊（參考世紀帝國 4）**
- 左鍵點選／拖曳框選、`Shift` 加選、雙擊選同兵種、`Ctrl+A` 全選
- 右鍵：移動（點在敵人上＝攻擊）；`Shift`＋右鍵：排路線
- `A` 攻擊移動、`R` 巡邏（再點地面）、`S` 停止、`H` 堅守；面板上可以換陣型（橫列／縱隊／散開）
- `Ctrl+數字` 設編隊、`數字` 選隊（按兩下鏡頭跳過去）、`Shift+數字` 加入

**建造與其他**
- `Z` 毛氈牆（可拖曳連續蓋）、`T` 箭塔、`B` 羊圈、`X` 拆除、`U` 升級、`Delete` 拆掉選到的建築
- 方向鍵、右鍵拖曳、或沒選部隊時的 WASD：移動鏡頭　滾輪：縮放（3D 版：右鍵拖曳旋轉、Q/E 轉向）
- 空白鍵：下一波　P：暫停　F：顯示流場

右上角的「開發者沙盒」可以換地圖種子、調整時間倍率、生成大量敵人等。

## 技術

TypeScript + Vite + Three.js。架構說明見 [CLAUDE.md](CLAUDE.md)，遊戲設計總覽見 [docs/design.md](docs/design.md)，逐條原始想法見 [docs/ideas.md](docs/ideas.md)。
