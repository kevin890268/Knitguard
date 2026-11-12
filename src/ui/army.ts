import { Team, UNIT_KINDS } from '../sim/data';
import type { CommandType, Formation } from '../sim/orders';
import type { World } from '../sim/world';

/** main.ts 用的繪圖層介面（2D、3D 都有這些欄位） */
interface ArmyView {
  unitSel: Uint8Array | null;
  pings: { x: number; y: number; t: number; color: string }[];
  readonly canvas: HTMLCanvasElement;
  readonly cam: {
    pick(cx: number, cy: number): { x: number; z: number } | null;
    worldToClient(x: number, y: number, h?: number): [number, number];
    readonly target: { set(x: number, y: number, z: number): unknown };
  };
}

const PING = { move: '#7dff7d', attack: '#ff5a5a', patrol: '#5aa0f0' };

/**
 * 部隊的選取與指令（參考世紀帝國 4）：
 *   左鍵點／框選、Shift 加選、Ctrl＋點或雙擊選同兵種、Ctrl+A 全選
 *   右鍵：移動（點在敵人上＝攻擊）；Shift＋右鍵排進佇列
 *   A 攻擊移動、R 巡邏（再點地面）、S 停止、H 堅守
 *   Ctrl+數字 設編隊、數字 選編隊、Shift+數字 加入、連按兩下鏡頭跳過去
 * 只處理輸入和選取；指令的實際效果在 World.command（模擬層）。
 */
export class ArmyControl {
  /** 選取的單位索引 */
  sel: number[] = [];
  /** 等待點地面的指令（按了 A 或 R） */
  mode: 'attackMove' | 'patrol' | null = null;
  form: Formation = 'line';

  private mask: Uint8Array;
  private selGen: Uint32Array;
  private groups: [number, number][][] = Array.from({ length: 10 }, () => []);
  private lastGroupKey = { n: -1, t: 0 };

  constructor(private readonly getWorld: () => World, private readonly view: ArmyView, cap: number) {
    this.mask = new Uint8Array(cap);
    this.selGen = new Uint32Array(cap);
    view.unitSel = this.mask;
  }

  private get world(): World { return this.getWorld(); }

  /** 換新地圖：清掉選取和編隊 */
  reset(): void {
    this.setSelection([], false);
    for (const g of this.groups) g.length = 0;
    this.mode = null;
  }

  // ---------------------------------------------------------------- 選取
  private valid(i: number, gen: number): boolean {
    const u = this.world.units;
    return u.alive[i] === 1 && u.gen[i] === gen && u.team[i] === Team.Player;
  }

  /** 每幀呼叫：死掉的單位移出選取 */
  prune(): void {
    if (!this.sel.length) return;
    const keep = this.sel.filter((i) => this.valid(i, this.selGen[i]));
    if (keep.length === this.sel.length) return;
    for (const i of this.sel) this.mask[i] = 0;
    for (const i of keep) this.mask[i] = 1;
    this.sel = keep;
    if (!keep.length) this.mode = null;
  }

  setSelection(ids: number[], add: boolean): void {
    const u = this.world.units;
    this.inspect = -1;
    if (!add) { for (const i of this.sel) this.mask[i] = 0; this.sel = []; }
    for (const i of ids) {
      if (this.mask[i] || !u.alive[i] || u.team[i] !== Team.Player) continue;
      this.mask[i] = 1;
      this.selGen[i] = u.gen[i];
      this.sel.push(i);
    }
  }

  /** 螢幕上這一點的單位（任何陣營），沒有回傳 -1 */
  pickUnit(cx: number, cy: number): number {
    const u = this.world.units, cam = this.view.cam;
    let best = -1, bd = Infinity;
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i]) continue;
      const k = UNIT_KINDS[u.kind[i]];
      const [fx, fy] = cam.worldToClient(u.x[i], u.y[i]);
      if (Math.abs(fx - cx) > 60 || Math.abs(fy - cy) > 120) continue;
      const [, hy] = cam.worldToClient(u.x[i], u.y[i], k.scale * 1.3);
      const half = Math.max(9, (fy - hy) * 0.4);
      if (Math.abs(cx - fx) > half || cy > fy + 6 || cy < hy - 4) continue;
      const d = (cx - fx) ** 2 + (cy - (fy + hy) / 2) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** 框選：腳在框內的我方單位 */
  boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    const u = this.world.units, cam = this.view.cam;
    const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
    const ids: number[] = [];
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i] || u.team[i] !== Team.Player) continue;
      const [sx, sy] = cam.worldToClient(u.x[i], u.y[i], 0.3);
      if (sx >= l && sx <= r && sy >= t && sy <= b) ids.push(i);
    }
    this.setSelection(ids, add);
  }

  /** 選畫面上所有同兵種（雙擊或 Ctrl＋點） */
  selectSameKind(i: number, add: boolean): void {
    const u = this.world.units, kind = u.kind[i];
    const rc = this.view.canvas.getBoundingClientRect();
    const ids: number[] = [];
    for (let j = 0; j < u.hi; j++) {
      if (!u.alive[j] || u.team[j] !== Team.Player || u.kind[j] !== kind) continue;
      const [sx, sy] = this.view.cam.worldToClient(u.x[j], u.y[j]);
      if (sx >= rc.left && sx <= rc.right && sy >= rc.top && sy <= rc.bottom) ids.push(j);
    }
    this.setSelection(ids, add);
  }

  /** 選取裡只留下（或去掉）某個兵種（點選取格子用） */
  filterKind(kind: number, keep: boolean): void {
    const u = this.world.units;
    this.setSelection(this.sel.filter((i) => (u.kind[i] === kind) === keep), false);
  }

  /** 查看的敵人（只看資訊，不能下指令）；-1 = 沒有 */
  inspect = -1;
  private inspectGen = 0;
  setInspect(i: number): void {
    this.setSelection([], false);
    this.inspect = i;
    this.inspectGen = i >= 0 ? this.world.units.gen[i] : 0;
  }
  /** 查看的敵人還活著嗎 */
  inspected(): number {
    const u = this.world.units, i = this.inspect;
    if (i >= 0 && (!u.alive[i] || u.gen[i] !== this.inspectGen)) this.inspect = -1;
    return this.inspect;
  }

  selectAll(): void {
    const u = this.world.units, ids: number[] = [];
    for (let i = 0; i < u.hi; i++) if (u.alive[i] && u.team[i] === Team.Player) ids.push(i);
    this.setSelection(ids, false);
  }

  // ---------------------------------------------------------------- 編隊
  /** 數字鍵：ctrl＝設定、shift＝加入、單按＝選取、連按兩下＝鏡頭跳過去 */
  groupKey(n: number, ctrl: boolean, shift: boolean): void {
    const u = this.world.units;
    const g = this.groups[n];
    if (ctrl || shift) {
      if (ctrl) g.length = 0;
      for (const i of this.sel) if (!g.some(([j]) => j === i)) g.push([i, u.gen[i]]);
      return;
    }
    const live = g.filter(([i, gen]) => this.valid(i, gen));
    this.groups[n] = live;
    this.setSelection(live.map(([i]) => i), false);
    const now = performance.now();
    if (this.lastGroupKey.n === n && now - this.lastGroupKey.t < 350 && live.length) {
      let x = 0, y = 0;
      for (const [i] of live) { x += u.x[i]; y += u.y[i]; }
      this.view.cam.target.set(x / live.length, 0, y / live.length);
    }
    this.lastGroupKey = { n, t: now };
  }

  /** 每個編隊目前有幾隻（介面顯示用） */
  groupSizes(): number[] {
    return this.groups.map((g) => g.filter(([i, gen]) => this.valid(i, gen)).length);
  }

  // ---------------------------------------------------------------- 指令
  command(type: CommandType, x = 0, y = 0, queue = false, target = -1): void {
    if (!this.sel.length) return;
    this.world.command(this.sel, type, x, y, { queue, form: this.form, target });
    if (type === 'move' || type === 'attackMove' || type === 'patrol') {
      this.view.pings.push({ x, y, t: 0.6, color: type === 'move' ? PING.move : type === 'patrol' ? PING.patrol : PING.attack });
    } else if (type === 'attack') {
      const u = this.world.units;
      this.view.pings.push({ x: u.x[target], y: u.y[target], t: 0.6, color: PING.attack });
    }
  }

  /** 右鍵：點在敵人上＝攻擊，其他＝移動。回傳是否有處理（有選部隊） */
  rightClick(cx: number, cy: number, shift: boolean): boolean {
    if (this.mode) { this.mode = null; return true; } // 右鍵取消等待中的指令
    if (!this.sel.length) return false;
    const t = this.pickUnit(cx, cy);
    if (t >= 0 && this.world.units.team[t] !== Team.Player) { this.command('attack', 0, 0, shift, t); return true; }
    const p = this.view.cam.pick(cx, cy);
    if (p) this.command('move', p.x, p.z, shift);
    return true;
  }

  /** 按了 A／R 之後的左鍵：攻擊移動（點在敵人上＝攻擊）或巡邏 */
  modeClick(cx: number, cy: number, shift: boolean): void {
    const mode = this.mode;
    if (!mode) return;
    if (!shift) this.mode = null; // Shift 按著可以連續下
    if (mode === 'attackMove') {
      const t = this.pickUnit(cx, cy);
      if (t >= 0 && this.world.units.team[t] !== Team.Player) { this.command('attack', 0, 0, shift, t); return; }
    }
    const p = this.view.cam.pick(cx, cy);
    if (p) this.command(mode, p.x, p.z, shift);
  }
}
