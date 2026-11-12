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

- 左鍵：使用工具（牆可以拖曳連續蓋）
- 右鍵拖曳：旋轉視角　滾輪：縮放　WASD：移動　Q/E：轉向
- 空白鍵：下一波　P：暫停　F：顯示流場　U：升級　Delete：拆除

右上角的「開發者沙盒」可以換地圖種子、調整時間倍率、生成大量敵人等。

## 技術

TypeScript + Vite + Three.js。架構說明見 [CLAUDE.md](CLAUDE.md)，遊戲設計總覽見 [docs/design.md](docs/design.md)，逐條原始想法見 [docs/ideas.md](docs/ideas.md)。
