/**
 * 固定步長遊戲迴圈：
 * - 模擬固定 30 tick/秒（決定性、與畫面 FPS 無關）
 * - 繪圖每個畫面一次，用 alpha 在兩個 tick 間插值，畫面依然順暢
 */
export class GameLoop {
  readonly dt = 1 / 30;
  timeScale = 1;
  paused = false;
  /**
   * 畫面最多每秒幾張（0＝不限）。高更新率螢幕（120／144Hz）不用每一下都重畫，省一半以上的繪圖負擔；
   * 留 4ms 的寬容，60Hz 螢幕不會因為時間抖動而掉張
   */
  maxFps = 60;
  readonly stats = { fps: 0, simMs: 0, renderMs: 0, ticksPerFrame: 0 };

  private acc = 0;
  private last = 0;
  private stepRequests = 0;
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number) => void,
  ) {}

  start(): void {
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  /** 暫停時前進一個 tick（除錯用）。 */
  stepOnce(): void {
    this.stepRequests++;
  }

  private frame = (now: number): void => {
    if (this.maxFps > 0 && now - this.last < 1000 / this.maxFps - 4) { requestAnimationFrame(this.frame); return; }
    const frameDt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    const t0 = performance.now();
    let ticks = 0;
    if (!this.paused) {
      this.acc += frameDt * this.timeScale;
      const maxTicks = 4 * Math.max(1, Math.ceil(this.timeScale));
      while (this.acc >= this.dt && ticks < maxTicks) {
        this.update(this.dt);
        this.acc -= this.dt;
        ticks++;
      }
      if (ticks >= maxTicks) this.acc = 0; // 跟不上時丟棄，避免死亡螺旋
    } else {
      while (this.stepRequests > 0) {
        this.update(this.dt);
        this.stepRequests--;
        ticks++;
      }
      this.acc = 0;
    }
    this.stepRequests = 0;
    const t1 = performance.now();

    this.render(this.paused ? 1 : this.acc / this.dt, frameDt);
    const t2 = performance.now();

    const s = this.stats;
    s.simMs = s.simMs * 0.9 + (t1 - t0) * 0.1;
    s.renderMs = s.renderMs * 0.9 + (t2 - t1) * 0.1;
    s.ticksPerFrame = ticks;
    this.fpsFrames++;
    this.fpsTime += frameDt;
    if (this.fpsTime >= 0.5) {
      s.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    requestAnimationFrame(this.frame);
  };
}
