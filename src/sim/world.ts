import { Rng } from '../core/rng';
import { GameMap, Tile, type MapLayout } from './map';
import { Units } from './units';
import { SpatialHash } from './spatialHash';
import { FlowField } from './flowfield';
import { ENEMY_TRIBES, RESEARCH_COST, RESEARCH_MAX, RESEARCH_TIME, WAVE_MIX, type ResearchLine } from './data';
import { Armor, ASSIST, BK, BUILDING_KINDS, ECON, MAX_LEVEL, PLAYER_SIGHT, PROJ, SLOW, SQUAD, Team, UK, UNIT_KINDS, type ProjKind } from './data';
import { formationSlots, Ord, type CommandType, type Formation, type QueuedOrder } from './orders';

/** 玩家部隊的一條路徑：一張流場，終點是陣型的所有位置 */
interface UnitPath { field: FlowField; goals: number[]; }
const MAX_PATHS = 48;
const MAX_GROUPS = 4096;
/** 每種兵在哪一層（碰撞用；0 地面、1 會飛、2 會跳）：不同層不互推（UNIT_KINDS 在 data.ts 載入時就已經包含怪物族） */
const LAYER = new Uint8Array(UNIT_KINDS.map((k) => (k.flying ? 1 : k.jumping ? 2 : 0)));

export interface Building {
  id: number;
  kind: number;
  tx: number;
  ty: number;
  size: number; // 長寬較大的那邊（正方形建築就是邊長）
  /** 佔地寬（x 方向）和高（y 方向）；正方形建築 w = h = size，城門是 3×1 或 1×3 */
  w: number;
  h: number;
  /** 城門：開著（我方可以從中間通過） */
  open: boolean;
  /** 進行中的工作（升級；之後的研究、製作也放這裡）。t＝已經做了幾秒，dur＝總共要幾秒 */
  job: { type: 'upgrade' | 'research'; label: string; t: number; dur: number; cost: number; line?: ResearchLine } | null;
  /** 軍營：已經訓練過幾隻（決定下一隻是哪個兵種） */
  trained: number;
  hp: number;
  maxHp: number;
  level: number;
  cd: number;
  spawnT: number;
  units: number; // 兵營：目前存活的士兵數
  rallyX: number;
  rallyY: number;
  invested: number;
  hitT: number;
  dead: boolean;
}

/**
 * 飛行中的彈道（只給繪圖用；傷害由 flights 在飛到時結算）。
 * t＝剩下的秒數，dur＝總飛行時間 → 進度 = 1 − t/dur
 */
export interface Shot {
  x1: number; y1: number; x2: number; y2: number; t: number;
  dur: number;
  /** 起點高度（預設 1.8＝箭塔頂） */
  h1?: number;
  kind: ProjKind;
}

/** 已發射、還沒飛到的遠程攻擊：到 at 時間時，如果攻擊者和目標都還活著就扣血 */
interface Flight { at: number; i: number; t: number; }

/** 陷阱工程師放的陷阱 */
export interface Trap { x: number; y: number; owner: number; }
/** 德魯伊召喚的樹枝：半徑 r 內的敵人每秒受 dps 傷害，t＝剩下的秒數 */
export interface Thorns { x: number; y: number; r: number; dps: number; t: number; dur: number; team: number; }

/** 一閃而過的範圍效果（吠叫、治療、號角），只給繪圖用 */
export interface Fx { x: number; y: number; r: number; t: number; kind: 'bark' | 'heal' | 'horn' | 'trap' | 'splash'; }

export const MAX_UNITS = 12000;

/**
 * 整個遊戲世界的模擬。完全不碰繪圖 → 之後可以做重播、無頭測試、或搬到 Worker。
 * 座標：1 單位 = 1 格，(x, y) 對應 3D 的 (x, z)。
 */
export class World {
  readonly map: GameMap;
  readonly units = new Units(MAX_UNITS);
  readonly hash: SpatialHash;
  readonly flow: FlowField;
  readonly occ: Int32Array; // 每格的建築 id，-1 = 無
  /** 道路（1 = 有）：不擋路，建築的人從旁邊的道路進出 */
  readonly roads: Uint8Array;
  roadsVersion = 0;
  /** 我方單位走得到的格子（從市鎮中心往外），走不到 = 被關住 */
  readonly reach: Uint8Array;
  readonly byId = new Map<number, Building>();
  buildings: Building[] = [];
  base: Building;

  gold = ECON.startGold;
  /** 兵工廠研究等級（每隊一份）：0～4 */
  research: Record<ResearchLine, number>[] = [
    { meleeAtk: 0, rangedAtk: 0, meleeDef: 0, rangedDef: 0 },
    { meleeAtk: 0, rangedAtk: 0, meleeDef: 0, rangedDef: 0 },
  ];
  freeBuild = false;
  wave = 0;
  waveInterval = 45;
  waveTimer = 60;
  autoWaves = true;
  gameOver = false;
  /** 撐過幾波就贏（0 = 無限模式）。打到這一波後不再出新的波次，清光場上的敵人就勝利 */
  victoryWave = 0;
  victory = false;
  time = 0;
  tick = 0;
  kills = 0;

  buildingsVersion = 0;
  shots: Shot[] = [];
  traps: Trap[] = [];
  thorns: Thorns[] = [];
  fx: Fx[] = [];
  private flights: Flight[] = [];
  /** 自訂每一波的敵人數量（DEMO 用）；沒設定就用公式 */
  waveSizes: number[] | null = null;
  /** 屍潮的組成：[兵種, 比例]（預設見 data.ts 的 WAVE_MIX） */
  waveMix: [number, number][] = WAVE_MIX;
  /**
   * 每一波只來一個族群（ENEMY_TRIBES 隨機抽一族），由這族的 3–5 種兵組成：一定有最弱的那種（雜兵），
   * 越弱的越多、越強的越少；最強的 1–2 種是「大型」，照到達節奏在中後段才出現。關掉就用 waveMix。
   */
  tribeWaves = true;
  /** 這一波是哪個族群（畫面顯示用；不是族群波次時是空字串） */
  waveTribe = '';
  /** 這一波的「大型」兵種（到達節奏用） */
  private waveBig = new Set<number>();
  spawnPoints: number[] = [];

  private costs: Float32Array;
  /** 玩家部隊走路的成本：建築和地形都不能穿過 */
  private pathCosts: Float32Array;
  private paths: (UnitPath | null)[] = [];
  /** Shift 排進佇列的後續指令（只有排了指令的單位才有） */
  private queues = new Map<number, QueuedOrder[]>();
  private flowDirty = true;
  /** 小隊：每次下指令一個新編號（循環使用）；engX/engY＝這一隊正在打的地方，engTick＝最後一次有隊員在打的 tick */
  private nextGrp = 0;
  private readonly engX = new Float32Array(MAX_GROUPS);
  private readonly engY = new Float32Array(MAX_GROUPS);
  private readonly engTick = new Int32Array(MAX_GROUPS).fill(-100);
  /** 等著出生的敵人：kind, x, y, 行軍速度, 出生時間 五個一組（依出生時間排好） */
  private spawnQueue: number[] = [];
  /**
   * 一波敵人分散在這麼多秒內出生，到達的節奏：先只有雜兵 → 開始有大型 → 大型越來越多 → 最後零零星星收尾。
   * 大家用同一個行軍速度，所以出生順序≈到達順序。
   */
  waveSpread = 80;
  private nextBid = 1;
  private tmp = new Int32Array(4096);
  /** 給 hit() 裡面查周圍用（hit 常在用 tmp 的迴圈裡被呼叫，不能共用） */
  private tmp2 = new Int32Array(4096);
  private steerOut: [number, number] = [0, 0];
  private rng: Rng;

  /** 地圖預設 256×256 */
  constructor(readonly seed: number, size = 256, layout: MapLayout = 'south') {
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.map = new GameMap(size, size, seed, layout);
    this.hash = new SpatialHash(size, size, 1.25, MAX_UNITS);
    this.flow = new FlowField(size, size);
    this.occ = new Int32Array(size * size).fill(-1);
    this.roads = new Uint8Array(size * size);
    this.reach = new Uint8Array(size * size);
    this.costs = new Float32Array(size * size);
    this.pathCosts = new Float32Array(size * size);
    this.base = this.addBuilding(BK.Base, this.map.baseX, this.map.baseY);
    this.recomputeFlow();
    const { w, h } = this.map;
    const edge: number[] = [];
    // south：只從上方兩條邊（畫面上的左、上、右）來；center：四邊都會來
    if (layout === 'south') {
      for (let x = 0; x < w; x++) edge.push(x);
      for (let y = 1; y < h; y++) edge.push(y * w);
    } else {
      for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
      for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);
    }
    this.spawnPoints = edge.filter((i) => this.flow.dist[i] < Infinity);
    if (this.spawnPoints.length < 8) {
      // 有些地圖的邊緣全被石頭或水擋住，走不到城堡 → 改用走得到、而且離城堡最遠的格子
      const reach: number[] = [];
      for (let i = 0; i < w * h; i++) if (this.flow.dist[i] < Infinity && !this.isSolid(i % w, Math.floor(i / w))) reach.push(i);
      reach.sort((a, b) => this.flow.dist[b] - this.flow.dist[a]);
      this.spawnPoints.push(...reach.slice(0, 60));
    }
  }

  // ---------------------------------------------------------------- 主更新
  step(dt: number): void {
    this.tick++;
    this.time += dt;
    const u = this.units;
    for (let i = 0; i < u.hi; i++) {
      if (u.alive[i]) { u.px[i] = u.x[i]; u.py[i] = u.y[i]; }
    }
    if (this.flowDirty) this.recomputeFlow();
    if (this.tick % 6 === 0) this.updateGates();
    if (this.tick % 30 === 0) this.gcPaths();
    this.gold += ECON.passiveIncome * dt;
    const lastWave = this.victoryWave > 0 && this.wave >= this.victoryWave;
    if (this.autoWaves && !lastWave) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.spawnWave();
    }
    this.processSpawns();
    this.hash.build(u);
    this.updateUnits(dt);
    this.updateBuildings(dt);
    this.resolveCollisions();
    this.cleanup(dt);
    if (lastWave && !this.gameOver && this.pendingSpawns === 0 && this.enemyCount === 0) this.victory = true;
  }

  /** 場上活著的敵人數量 */
  get enemyCount(): number {
    const u = this.units;
    let n = 0;
    for (let i = 0; i < u.hi; i++) if (u.alive[i] && u.team[i] === Team.Enemy) n++;
    return n;
  }

  // ---------------------------------------------------------------- 波次 / 生成
  spawnWave(): void {
    if (this.victoryWave > 0 && this.wave >= this.victoryWave) return; // 已經是最後一波
    this.wave++;
    this.waveTimer = this.waveInterval;
    const w = this.wave;
    if (this.tribeWaves) this.pickTribeMix();
    const custom = this.waveSizes?.[w - 1];
    this.spawnHorde(custom ?? Math.round(12 + w * 8 + w * w * 1.5), custom !== undefined);
  }

  /** 抽這一波的族群和 3–5 種兵，設定 waveMix（比例：越弱越多）和 waveBig（最強的 1–2 種） */
  private pickTribeMix(): void {
    const tribe = ENEMY_TRIBES[this.rng.int(0, ENEMY_TRIBES.length - 1)];
    const byHp = [...tribe.kinds].sort((a, b) => UNIT_KINDS[a].hp - UNIT_KINDS[b].hp);
    const n = Math.min(byHp.length, this.rng.int(3, 5));
    const pick = [byHp[0]]; // 最弱的一定有（雜兵）
    const rest = byHp.slice(1);
    while (pick.length < n && rest.length) pick.push(rest.splice(this.rng.int(0, rest.length - 1), 1)[0]);
    pick.sort((a, b) => UNIT_KINDS[a].hp - UNIT_KINDS[b].hp);
    const share = [0.45, 0.27, 0.15, 0.09, 0.04]; // 由弱到強
    this.waveMix = pick.map((k, i) => [k, share[i]]);
    this.waveBig = new Set(pick.slice(n >= 4 ? -2 : -1));
    this.waveTribe = tribe.name;
  }

  spawnHorde(count: number, useMix = false): void {
    if (!this.spawnPoints.length) return;
    const clusters: number[] = [];
    const nc = 1 + Math.min(3, Math.floor(this.wave / 3));
    for (let c = 0; c < nc; c++) clusters.push(this.spawnPoints[this.rng.int(0, this.spawnPoints.length - 1)]);
    const w = this.map.w;
    // 先抽好每一隻的兵種；同一群（同一個出生點）的地面敵人用這群的平均速度一起行軍：
    // 大型的不會脫隊、快的也不會衝太前面（會飛、會跳的照自己的速度）
    const total = this.waveMix.reduce((s, [, p]) => s + p, 0);
    const kinds: number[] = [];
    for (let n = 0; n < count; n++) {
      let r = this.rng.next() * total, kind = this.waveMix[0][0];
      for (const [k, p] of this.waveMix) { if (r < p) { kind = k; break; } r -= p; }
      kinds.push(kind);
    }
    const march = clusters.map((_, c) => {
      let s = 0, n = 0;
      for (let i = c; i < count; i += clusters.length) { const k = UNIT_KINDS[kinds[i]]; if (!k.flying && !k.jumping) { s += k.speed; n++; } }
      return n ? s / n : 0;
    });
    void useMix;
    // 出生時間（0–1，乘上 waveSpread）：雜兵前面多、越後面越少；大型 20% 才開始出現、越後面越多；
    // 最後約 8% 的敵人（不分大小）放到 85%–100% 之間，零零星星收尾
    const D = this.waveSpread, entries: number[][] = [];
    const big = (k: number) => (this.waveBig.size ? this.waveBig.has(k) : UNIT_KINDS[k].radius >= 0.4);
    for (let n = 0; n < count; n++) {
      const r = this.rng.next();
      let at = big(kinds[n]) ? 0.2 + 0.65 * Math.sqrt(r) : 0.85 * Math.pow(r, 1.4);
      if (this.rng.next() < 0.08) at = 0.85 + 0.15 * Math.sqrt(this.rng.next());
      entries.push([n, this.time + at * D]);
    }
    entries.sort((a, b) => a[1] - b[1]);
    for (const [n, at] of entries) {
      const sp = clusters[n % clusters.length];
      let x = (sp % w) + 0.5 + this.rng.range(-2, 2);
      let y = Math.floor(sp / w) + 0.5 + this.rng.range(-2, 2);
      // 隨機偏移後要確認還走得到城堡：偏移可能把敵人丟進被石頭圍住的封閉小區域，那裡流場沒有方向，敵人會卡住
      const ti = Math.floor(y) * w + Math.floor(x);
      if (this.isSolid(Math.floor(x), Math.floor(y)) || !(this.flow.dist[ti] < Infinity)) { x = (sp % w) + 0.5; y = Math.floor(sp / w) + 0.5; }
      this.spawnQueue.push(kinds[n], x, y, march[n % clusters.length], at);
    }
  }

  spawnUnitAt(kind: number, x: number, y: number): number {
    return this.units.spawn(kind, x, y);
  }

  private processSpawns(): void {
    const q = this.spawnQueue;
    let n = 0; // 時間到了的才出生（一 tick 最多 60 隻）
    while (n < 60 && n * 5 < q.length && q[n * 5 + 4] <= this.time) n++;
    for (let k = 0; k < n; k++) {
      const i = this.units.spawn(q[k * 5], q[k * 5 + 1], q[k * 5 + 2]);
      if (i >= 0) this.units.spdCap[i] = q[k * 5 + 3]; // 敵人借 spdCap 存群組行軍速度
    }
    q.splice(0, n * 5);
  }

  get pendingSpawns(): number {
    return this.spawnQueue.length / 5;
  }

  // ---------------------------------------------------------------- 建築
  /**
   * 蓋建築的條件：
   *  1. 佔地內是空的草地（不能蓋在道路上）
   *  2. 建築（2x2 以上）一定要留至少一個「出入口」：旁邊有一格不是其他建築
   *  3. 蓋下去不能把旁邊建築的最後一個出入口堵住
   */
  /** 建築佔地（寬, 高）；rot＝轉 90 度（只有長方形的城門有差） */
  dims(kind: number, rot = false): [number, number] {
    const k = BUILDING_KINDS[kind], w = k.w ?? k.size, h = k.h ?? k.size;
    return rot ? [h, w] : [w, h];
  }

  canPlace(kind: number, tx: number, ty: number, rot = false): boolean {
    const [bw, bh] = this.dims(kind, rot), w = this.map.w;
    for (let y = ty; y < ty + bh; y++)
      for (let x = tx; x < tx + bw; x++) {
        if (!this.map.inBounds(x, y) || this.map.solidTerrain(x, y) || this.occ[y * w + x] >= 0 || this.roads[y * w + x]) return false;
      }
    const block = { tx, ty, w: bw, h: bh };
    if (this.needsExit(kind, bw, bh) && this.exits(tx, ty, bw, bh, block) === 0) return false;
    // 旁邊的建築還有沒有出入口
    const seen = new Set<number>();
    for (let y = ty - 1; y <= ty + bh; y++)
      for (let x = tx - 1; x <= tx + bw; x++) {
        if (!this.map.inBounds(x, y)) continue;
        const id = this.occ[y * w + x];
        if (id < 0 || seen.has(id)) continue;
        seen.add(id);
        const o = this.byId.get(id)!;
        if (this.needsExit(o.kind, o.w, o.h) && this.exits(o.tx, o.ty, o.w, o.h, block) === 0) return false;
      }
    return true;
  }

  /** 要留出入口的建築：2x2 以上（牆、箭塔不用；城門自己就是通道） */
  private needsExit(kind: number, w: number, h: number): boolean {
    return kind !== BK.Gate && w >= 2 && h >= 2;
  }

  /** 建築四邊（不含斜角）可以進出的格子數；block＝假裝這塊也蓋了東西 */
  private exits(tx: number, ty: number, bw: number, bh: number, block?: { tx: number; ty: number; w: number; h: number }): number {
    let n = 0;
    const free = (x: number, y: number) => {
      if (this.isSolid(x, y) && !this.isGatePass(x, y)) return false;
      return !(block && x >= block.tx && x < block.tx + block.w && y >= block.ty && y < block.ty + block.h);
    };
    for (let i = 0; i < bw; i++) { if (free(tx + i, ty - 1)) n++; if (free(tx + i, ty + bh)) n++; }
    for (let i = 0; i < bh; i++) { if (free(tx - 1, ty + i)) n++; if (free(tx + bw, ty + i)) n++; }
    return n;
  }

  /**
   * 建築的出入口：旁邊的道路優先（離 (nx, ny) 最近的），沒有道路就用旁邊的空地。回傳格子中心；完全被堵住回傳 null
   */
  exitPoint(b: Building, nx: number, ny: number): [number, number] | null {
    let best: [number, number] | null = null, bestScore = Infinity;
    const check = (x: number, y: number) => {
      if (this.isSolid(x, y)) return;
      const d = Math.hypot(x + 0.5 - nx, y + 0.5 - ny) + (this.roads[y * this.map.w + x] ? 0 : 1000);
      if (d < bestScore) { bestScore = d; best = [x + 0.5, y + 0.5]; }
    };
    for (let i = 0; i < b.w; i++) { check(b.tx + i, b.ty - 1); check(b.tx + i, b.ty + b.h); }
    for (let i = 0; i < b.h; i++) { check(b.tx - 1, b.ty + i); check(b.tx + b.w, b.ty + i); }
    return best;
  }

  // ---------------------------------------------------------------- 城門
  /**
   * 城門（3×1 或 1×3）：中間那格加上兩邊各靠中間的半格是 2 格寬的通道。
   * 開著時我方可以通過（只被兩端各半格的塔擋住）；敵人永遠過不去，要拆門。
   * 自動開關：附近有我方、沒有敵人就開；敵人靠近就關。
   */
  isGatePass(tx: number, ty: number): boolean {
    if (!this.map.inBounds(tx, ty)) return false;
    const id = this.occ[ty * this.map.w + tx];
    if (id < 0) return false;
    const b = this.byId.get(id)!;
    if (b.kind !== BK.Gate) return false;
    return b.w > b.h ? tx === b.tx + 1 : ty === b.ty + 1;
  }

  /** 城門兩端的塔（各半格）：[x0, y0, x1, y1] × 2 */
  private gateTowers(b: Building): number[] {
    return b.w > b.h
      ? [b.tx, b.ty, b.tx + 0.5, b.ty + 1, b.tx + 2.5, b.ty, b.tx + 3, b.ty + 1]
      : [b.tx, b.ty, b.tx + 1, b.ty + 0.5, b.tx, b.ty + 2.5, b.tx + 1, b.ty + 3];
  }

  private updateGates(): void {
    const u = this.units;
    for (const b of this.buildings) {
      if (b.kind !== BK.Gate) continue;
      const cx = b.tx + b.w / 2, cy = b.ty + b.h / 2;
      let friend = false, foe = false;
      for (let i = 0; i < u.hi; i++) {
        if (!u.alive[i]) continue;
        const d2 = (u.x[i] - cx) ** 2 + (u.y[i] - cy) ** 2;
        if (u.team[i] === Team.Enemy) { if (d2 < 3.5 * 3.5) { foe = true; break; } }
        else if (d2 < 3 * 3) friend = true;
      }
      const open = friend && !foe;
      if (open !== b.open) { b.open = open; this.buildingsVersion++; }
    }
  }

  // ---------------------------------------------------------------- 道路
  /** 道路：只鋪在空草地上，不擋路；建築的人從旁邊的道路進出 */
  canRoad(tx: number, ty: number): boolean {
    if (!this.map.inBounds(tx, ty) || this.map.solidTerrain(tx, ty)) return false;
    const i = ty * this.map.w + tx;
    return this.occ[i] < 0 && !this.roads[i];
  }

  placeRoad(tx: number, ty: number): boolean {
    if (!this.canRoad(tx, ty) || !this.canAfford(ECON.roadCost)) return false;
    if (!this.freeBuild) this.gold -= ECON.roadCost;
    this.roads[ty * this.map.w + tx] = 1;
    this.roadsVersion++;
    return true;
  }

  removeRoad(tx: number, ty: number): boolean {
    if (!this.map.inBounds(tx, ty)) return false;
    const i = ty * this.map.w + tx;
    if (!this.roads[i]) return false;
    this.roads[i] = 0;
    this.roadsVersion++;
    return true;
  }

  /** 我方單位被建築或地形關在中間（走不到市鎮中心）→ 畫面上顯示「無法移動」 */
  isTrapped(i: number): boolean {
    const u = this.units;
    const tx = Math.floor(u.x[i]), ty = Math.floor(u.y[i]);
    if (!this.map.inBounds(tx, ty)) return false;
    const k = ty * this.map.w + tx;
    return this.occ[k] < 0 && !this.reach[k];
  }

  canAfford(cost: number): boolean {
    return this.freeBuild || this.gold >= cost;
  }

  tryPlace(kind: number, tx: number, ty: number, rot = false): Building | null {
    const cost = BUILDING_KINDS[kind].cost;
    if (!this.canPlace(kind, tx, ty, rot) || !this.canAfford(cost)) return null;
    if (!this.freeBuild) this.gold -= cost;
    return this.addBuilding(kind, tx, ty, rot);
  }

  private addBuilding(kind: number, tx: number, ty: number, rot = false): Building {
    const k = BUILDING_KINDS[kind], [bw, bh] = this.dims(kind, rot);
    const b: Building = {
      id: this.nextBid++, kind, tx, ty, size: Math.max(bw, bh), w: bw, h: bh, open: false, job: null, trained: 0, hp: k.hp, maxHp: k.hp, level: 1,
      cd: 0, spawnT: 1, units: 0, rallyX: 0, rallyY: 0, invested: k.cost, hitT: 0, dead: false,
    };
    for (let y = ty; y < ty + bh; y++)
      for (let x = tx; x < tx + bw; x++) this.occ[y * this.map.w + x] = b.id;
    if (k.spawnCap) {
      const cx = tx + k.size / 2, cy = ty + k.size / 2;
      const bx = this.map.baseX + 1.5, by = this.map.baseY + 1.5;
      let dx = cx - bx, dy = cy - by;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      b.rallyX = cx + dx * (k.size / 2 + 1.5);
      b.rallyY = cy + dy * (k.size / 2 + 1.5);
      if (this.isSolid(Math.floor(b.rallyX), Math.floor(b.rallyY))) { b.rallyX = cx; b.rallyY = ty + k.size + 0.8; }
    }
    this.buildings.push(b);
    this.byId.set(b.id, b);
    this.buildingsVersion++;
    this.flowDirty = true;
    return b;
  }

  removeBuilding(b: Building, refund: boolean): void {
    if (b.kind === BK.Base || b.dead) return;
    for (let y = b.ty; y < b.ty + b.h; y++)
      for (let x = b.tx; x < b.tx + b.w; x++) this.occ[y * this.map.w + x] = -1;
    b.dead = true;
    if (refund) this.gold += Math.floor(b.invested * ECON.refundRatio);
    this.byId.delete(b.id);
    this.buildings = this.buildings.filter((o) => o !== b);
    this.buildingsVersion++;
    this.flowDirty = true;
  }

  upgradeCost(b: Building): number | null {
    const k = BUILDING_KINDS[b.kind];
    if (b.job) return null; // 正在升級

    // 一般建築最高 MAX_LEVEL 級；有更多升級費用的（市鎮中心）照費用的數量
    if (b.level >= Math.max(MAX_LEVEL, k.upgradeCost.length + 1)) return null;
    return k.upgradeCost[b.level - 1] ?? null;
  }

  /** 升級：先付錢，花一段時間（ECON.upgradeTime × 目前等級 秒）才完成（免費建造也要等） */
  upgrade(b: Building): boolean {
    const cost = this.upgradeCost(b);
    if (cost === null || !this.canAfford(cost)) return false;
    if (!this.freeBuild) this.gold -= cost;
    const names = BUILDING_KINDS[b.kind].levelNames;
    const label = names ? `進化：${names[b.level]}` : `升級到 Lv.${b.level + 1}`;
    b.job = { type: 'upgrade', label, t: 0, dur: ECON.upgradeTime * b.level, cost };
    this.buildingsVersion++;
    return true;
  }

  /** 研究下一級要多少錢；滿級或正在做別的事 → null */
  researchCost(b: Building, line: ResearchLine): number | null {
    if (b.kind !== BK.Arsenal || b.job) return null;
    const lv = this.research[Team.Player][line];
    return lv >= RESEARCH_MAX ? null : RESEARCH_COST[lv];
  }

  /** 兵工廠開始研究（先付錢，花時間才完成） */
  startResearch(b: Building, line: ResearchLine, label: string): boolean {
    const cost = this.researchCost(b, line);
    if (cost === null || !this.canAfford(cost)) return false;
    if (!this.freeBuild) this.gold -= cost;
    const lv = this.research[Team.Player][line];
    b.job = { type: 'research', label: `${label} ${lv + 1} 級`, t: 0, dur: RESEARCH_TIME[lv], cost, line };
    this.buildingsVersion++;
    return true;
  }

  /** 取消進行中的工作：全額退錢 */
  cancelJob(b: Building): void {
    if (!b.job) return;
    if (!this.freeBuild) this.gold += b.job.cost;
    b.job = null;
    this.buildingsVersion++;
  }

  private finishJob(b: Building): void {
    const job = b.job;
    if (!job) return;
    b.job = null;
    if (job.type === 'upgrade') this.levelUp(b, job.cost);
    else if (job.type === 'research' && job.line) this.research[Team.Player][job.line]++;
  }

  private levelUp(b: Building, cost: number): void {
    b.invested += cost;
    b.level++;
    b.maxHp = Math.round(b.maxHp * 1.4);
    b.hp = b.maxHp;
    if (BUILDING_KINDS[b.kind].spawnCap) {
      const u = this.units;
      for (let i = 0; i < u.hi; i++) {
        if (u.alive[i] && u.owner[i] === b.id) this.applySheepLevel(i, b.level, true);
      }
    }
    this.buildingsVersion++;
  }

  setRally(b: Building, x: number, y: number): void {
    b.rallyX = x;
    b.rallyY = y;
    const u = this.units;
    for (let i = 0; i < u.hi; i++) {
      // 正在執行玩家指令的不動
      if (u.alive[i] && u.owner[i] === b.id && u.order[i] === Ord.Idle) {
        u.homeX[i] = x + this.rng.range(-0.8, 0.8);
        u.homeY[i] = y + this.rng.range(-0.8, 0.8);
      }
    }
  }

  towerDamage(b: Building): number {
    return (BUILDING_KINDS[b.kind].damage ?? 0) * (1 + 0.6 * (b.level - 1));
  }
  towerRange(b: Building): number {
    return (BUILDING_KINDS[b.kind].range ?? 0) + (b.level - 1) * 1.5;
  }
  /** 巨盾兵的盾牆：t 周圍有己方巨盾兵（不含自己）→ 被遠程打時多的防禦 */
  private shieldCover(t: number): number {
    const u = this.units;
    const n = this.hash.queryInto(u.x[t], u.y[t], 2.5, this.tmp2);
    let best = 0;
    for (let q = 0; q < n; q++) {
      const j = this.tmp2[q];
      if (j === t || !u.alive[j] || u.team[j] !== u.team[t]) continue;
      const s = UNIT_KINDS[u.kind[j]].skill;
      if (s?.type !== 'guard') continue;
      if ((u.x[j] - u.x[t]) ** 2 + (u.y[j] - u.y[t]) ** 2 > s.radius * s.radius) continue;
      best = Math.max(best, s.def);
    }
    return best;
  }

  /** 狂化狼人：血量低於門檻時狂化（攻擊、移動變快） */
  raging(i: number): boolean {
    const s = UNIT_KINDS[this.units.kind[i]].skill;
    return s?.type === 'rage' && this.units.hp[i] < this.units.maxHp[i] * s.below;
  }

  /** 深度狂化（血量更低）：攻擊再提高、會回血 */
  deepRage(i: number): boolean {
    const s = UNIT_KINDS[this.units.kind[i]].skill;
    return s?.type === 'rage' && this.units.hp[i] < this.units.maxHp[i] * s.deep;
  }

  /** 軍營下一隻要訓練的兵種 */
  nextTrainee(b: Building): number {
    const t = BUILDING_KINDS[b.kind].trains ?? [UK.Sheep];
    return t[b.trained % t.length];
  }

  barracksCap(b: Building): number {
    return (BUILDING_KINDS[b.kind].spawnCap ?? 0) + (b.level - 1);
  }

  private applySheepLevel(i: number, level: number, heal: boolean): void {
    const k = UNIT_KINDS[this.units.kind[i]];
    const mul = 1 + 0.5 * (level - 1);
    this.units.maxHp[i] = k.hp * mul;
    this.units.dmg[i] = k.damage * mul;
    if (heal) this.units.hp[i] = this.units.maxHp[i];
  }

  buildingAtTile(tx: number, ty: number): Building | undefined {
    if (!this.map.inBounds(tx, ty)) return undefined;
    const id = this.occ[ty * this.map.w + tx];
    return id >= 0 ? this.byId.get(id) : undefined;
  }

  /** 直接改了地形（例如 DEMO 清出空地）之後呼叫：重算流場和可走區域 */
  terrainChanged(): void {
    this.flowDirty = true;
    this.recomputeFlow();
  }

  isSolid(tx: number, ty: number): boolean {
    if (!this.map.inBounds(tx, ty)) return true;
    return this.map.tiles[ty * this.map.w + tx] !== Tile.Grass || this.occ[ty * this.map.w + tx] >= 0;
  }

  private recomputeFlow(): void {
    const n = this.map.w * this.map.h;
    for (let i = 0; i < n; i++) {
      if (this.map.tiles[i] !== Tile.Grass) { this.costs[i] = Infinity; continue; }
      const id = this.occ[i];
      if (id < 0) { this.costs[i] = 1; continue; }
      const b = this.byId.get(id)!;
      this.costs[i] = b.kind === BK.Base ? 1 : 1 + b.hp / 25;
    }
    const goals: number[] = [];
    for (let y = this.base.ty; y < this.base.ty + this.base.size; y++)
      for (let x = this.base.tx; x < this.base.tx + this.base.size; x++) goals.push(y * this.map.w + x);
    this.flow.compute(this.costs, goals);
    // 玩家部隊的路徑：建築擋路 → 蓋了或拆了建築就重算
    for (let i = 0; i < n; i++) this.pathCosts[i] = this.map.tiles[i] === Tile.Grass && (this.occ[i] < 0 || this.isGatePass(i % this.map.w, (i / this.map.w) | 0)) ? 1 : Infinity;
    for (const p of this.paths) if (p) p.field.compute(this.pathCosts, p.goals);
    this.computeReach();
    this.flowDirty = false;
  }

  /** 從市鎮中心旁邊的空地往外走得到的格子（我方單位能走的區域）；走不到的地方 = 被關住 */
  private computeReach(): void {
    const w = this.map.w, reach = this.reach, b = this.base;
    reach.fill(0);
    const q: number[] = [];
    for (let y = b.ty - 1; y <= b.ty + b.size; y++)
      for (let x = b.tx - 1; x <= b.tx + b.size; x++) {
        if (!this.map.inBounds(x, y) || this.isSolid(x, y)) continue;
        reach[y * w + x] = 1; q.push(y * w + x);
      }
    while (q.length) {
      const i = q.pop()!, x = i % w, y = (i / w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!this.map.inBounds(nx, ny)) continue;
        const j = ny * w + nx;
        if (reach[j] || this.pathCosts[j] === Infinity) continue;
        reach[j] = 1; q.push(j);
      }
    }
  }

  // ---------------------------------------------------------------- 部隊指令（參考世紀帝國 4，見 orders.ts）
  /**
   * 對一群我方單位下指令。
   * (x, y)：目的地（移動／攻擊移動／巡邏）；target：攻擊的敵人（attack）
   * queue：Shift 排在目前指令之後；form：陣型
   */
  command(ids: number[], type: CommandType, x: number, y: number, opts: { queue?: boolean; form?: Formation; target?: number } = {}): void {
    const u = this.units;
    ids = ids.filter((i) => u.alive[i] && u.team[i] === Team.Player);
    if (!ids.length) return;
    const queue = !!opts.queue;
    // 一起下令的就是同一個小隊（Shift 排指令時沿用原本的小隊）
    if (!queue || ids.some((i) => u.grp[i] < 0)) {
      const g = this.nextGrp++ % MAX_GROUPS;
      this.engTick[g] = -100;
      for (const i of ids) u.grp[i] = g;
    }

    if (type === 'stop' || type === 'hold') {
      for (const i of ids) {
        this.queues.delete(i);
        this.goIdle(i, u.x[i], u.y[i]);
        u.hold[i] = type === 'hold' ? 1 : 0;
      }
      return;
    }
    if (type === 'attack') {
      const t = opts.target ?? -1;
      if (t < 0 || !u.alive[t] || u.team[t] === Team.Player) return;
      for (const i of ids) this.issue(i, { ord: Ord.Attack, x: u.x[t], y: u.y[t], t, path: -1, px: 0, py: 0, path2: -1 }, queue);
      return;
    }

    // 移動類：先算陣型。起點用「排完佇列後的位置」（Shift 時）或目前位置
    const n = ids.length, sx = new Float32Array(u.cap), sy = new Float32Array(u.cap);
    let cx = 0, cy = 0, minSpeed = Infinity;
    for (const i of ids) {
      const [px, py] = queue ? this.lastDest(i) : [u.x[i], u.y[i]];
      sx[i] = px; sy[i] = py; cx += px; cy += py;
      minSpeed = Math.min(minSpeed, UNIT_KINDS[u.kind[i]].speed);
    }
    cx /= n; cy /= n;
    let fx = x - cx, fy = y - cy;
    const fd = Math.hypot(fx, fy);
    if (fd < 0.01) { fx = 1; fy = 0; } else { fx /= fd; fy /= fd; }
    const slots = formationSlots(ids, sx, sy, u.kind, u.rad, x, y, fx, fy, opts.form ?? 'line');

    // 從起點能走到哪裡（點在水裡、對岸、石頭上 → 改成最近走得到的地方）；巡邏的回程也用它
    const W = this.map.w, startGoals = new Set<number>();
    for (const i of ids) startGoals.add(Math.floor(sy[i]) * W + Math.floor(sx[i]));
    const reach = new FlowField(W, this.map.h);
    reach.compute(this.pathCosts, [...startGoals]);
    // 路徑走到陣型中心；每個位置都要從中心看得到（中間沒有石頭、樹），走到看得到自己的位置就直走過去
    const [ccx, ccy] = this.snapReachable(x, y, reach);
    for (let k = 0; k < n; k++) {
      let [px, py] = this.snapReachable(slots[k * 2], slots[k * 2 + 1], reach);
      if (!this.clearLine(ccx, ccy, px, py, 0.3)) [px, py] = this.nearestVisible(px, py, ccx, ccy, reach);
      slots[k * 2] = px; slots[k * 2 + 1] = py;
    }
    const path = this.newPath([Math.floor(ccy) * W + Math.floor(ccx)]);
    const path2 = type === 'patrol' ? this.newPath([...startGoals], reach) : -1;
    const ord = type === 'move' ? Ord.Move : type === 'patrol' ? Ord.Patrol : Ord.AttackMove;
    ids.forEach((i, k) => {
      this.issue(i, { ord, x: slots[k * 2], y: slots[k * 2 + 1], t: -1, path, px: sx[i], py: sy[i], path2 }, queue);
      u.spdCap[i] = n > 1 ? minSpeed : 0; // 陣型一起走：配合最慢的
    });
  }

  /** 單位的佇列指令（給畫面顯示路線用） */
  queuedOrders(i: number): readonly QueuedOrder[] {
    return this.queues.get(i) ?? [];
  }

  /** 排完所有指令後會在哪裡 */
  private lastDest(i: number): [number, number] {
    const u = this.units, q = this.queues.get(i);
    if (q?.length) { const o = q[q.length - 1]; return [o.x, o.y]; }
    if (u.order[i] !== Ord.Idle) return [u.ordX[i], u.ordY[i]];
    return [u.x[i], u.y[i]];
  }

  private issue(i: number, o: QueuedOrder, queue: boolean): void {
    if (queue && this.units.order[i] !== Ord.Idle) {
      let q = this.queues.get(i);
      if (!q) this.queues.set(i, q = []);
      q.push(o);
      return;
    }
    this.queues.delete(i);
    this.applyOrder(i, o);
  }

  private applyOrder(i: number, o: QueuedOrder): void {
    const u = this.units;
    u.order[i] = o.ord;
    u.ordX[i] = o.x; u.ordY[i] = o.y;
    u.ordT[i] = o.t;
    u.target[i] = o.t;
    u.path[i] = o.path;
    u.path2[i] = o.path2;
    u.patX[i] = o.px; u.patY[i] = o.py;
    u.hold[i] = 0;
    u.waitT[i] = 0;
    u.bestD[i] = Infinity;
  }

  /** 目前的指令做完了 → 下一個佇列指令，沒有就在 (x, y) 待命 */
  private finishOrder(i: number, x: number, y: number): void {
    const q = this.queues.get(i);
    const next = q?.shift();
    if (q && !q.length) this.queues.delete(i);
    if (next) this.applyOrder(i, next);
    else this.goIdle(i, x, y);
  }

  private goIdle(i: number, x: number, y: number): void {
    const u = this.units;
    u.order[i] = Ord.Idle;
    u.homeX[i] = x; u.homeY[i] = y;
    u.target[i] = u.ordT[i] = -1;
    u.path[i] = u.path2[i] = -1;
    u.spdCap[i] = 0;
  }

  /** (x, y) 走不到（石頭、水、建築、對岸）→ 最近一個走得到的格子 */
  private snapReachable(x: number, y: number, reach: FlowField): [number, number] {
    const W = this.map.w, tx = Math.floor(x), ty = Math.floor(y);
    const ok = (cx: number, cy: number) => this.map.inBounds(cx, cy) && !this.isSolid(cx, cy) && reach.dist[cy * W + cx] < Infinity;
    if (ok(tx, ty)) return [x, y];
    let best: [number, number] = [x, y], bd = Infinity, found = -1;
    for (let r = 1; r <= 60; r++) {
      if (found >= 0 && r > found + 2) break; // 找到後再多看兩圈，取直線最近的
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !ok(tx + dx, ty + dy)) continue;
        const px = tx + dx + 0.5, py = ty + dy + 0.5, d = (px - x) ** 2 + (py - y) ** 2;
        if (d < bd) { bd = d; best = [px, py]; if (found < 0) found = r; }
      }
    }
    return best;
  }

  /** 兩點之間有沒有被擋住（以寬 2r 的帶子檢查石頭、樹、水、建築） */
  private clearLine(x0: number, y0: number, x1: number, y1: number, r: number): boolean {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < 1e-3) return true;
    const px = (-dy / len) * r, py = (dx / len) * r, steps = Math.ceil(len / 0.25);
    for (let s = 1; s <= steps; s++) {
      const x = x0 + (dx * s) / steps, y = y0 + (dy * s) / steps;
      if (this.isSolid(Math.floor(x), Math.floor(y)) || this.isSolid(Math.floor(x + px), Math.floor(y + py)) || this.isSolid(Math.floor(x - px), Math.floor(y - py))) return false;
    }
    return true;
  }

  /** 離 (x, y) 最近、走得到、而且從 (cx, cy) 看得到的格子；都沒有就回傳 (cx, cy) */
  private nearestVisible(x: number, y: number, cx: number, cy: number, reach: FlowField): [number, number] {
    const W = this.map.w, tx = Math.floor(x), ty = Math.floor(y);
    let best: [number, number] = [cx, cy], bd = Infinity;
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const gx = tx + dx, gy = ty + dy;
        if (!this.map.inBounds(gx, gy) || this.isSolid(gx, gy) || !(reach.dist[gy * W + gx] < Infinity)) continue;
        const px = gx + 0.5, py = gy + 0.5, d = (px - x) ** 2 + (py - y) ** 2;
        if (d < bd && this.clearLine(cx, cy, px, py, 0.3)) { bd = d; best = [px, py]; }
      }
      if (bd < Infinity) break;
    }
    return best;
  }

  private newPath(goals: number[], field?: FlowField): number {
    let id = this.paths.indexOf(null);
    if (id < 0) {
      if (this.paths.length >= MAX_PATHS) return -1; // 太多條了：直線走
      id = this.paths.length;
      this.paths.push(null);
    }
    if (!field) {
      field = new FlowField(this.map.w, this.map.h);
      field.compute(this.pathCosts, goals);
    }
    this.paths[id] = { field, goals };
    return id;
  }

  /** 沒有單位在用的路徑丟掉 */
  private gcPaths(): void {
    if (!this.paths.length) return;
    const used = new Uint8Array(this.paths.length), u = this.units;
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i]) continue;
      if (u.path[i] >= 0) used[u.path[i]] = 1;
      if (u.path2[i] >= 0) used[u.path2[i]] = 1;
    }
    for (const q of this.queues.values()) for (const o of q) {
      if (o.path >= 0) used[o.path] = 1;
      if (o.path2 >= 0) used[o.path2] = 1;
    }
    for (let p = 0; p < this.paths.length; p++) if (!used[p]) this.paths[p] = null;
  }

  /**
   * 走向指令目的地：遠的時候跟著路徑（流場）走，快到了直接走過去。
   * 回傳是否到了（被擠住、在附近待太久也算到了）。
   */
  private steerToOrder(i: number, dt: number, out: [number, number]): boolean {
    const u = this.units, x = u.x[i], y = u.y[i];
    const ex = u.ordX[i] - x, ey = u.ordY[i] - y, d = Math.hypot(ex, ey);
    out[0] = out[1] = 0;
    if (d < 0.2) return true;
    const p = u.path[i] >= 0 ? this.paths[u.path[i]] : null;
    const ti = Math.floor(y) * this.map.w + Math.floor(x);
    // 路徑通往陣型中心 → 看不到自己的位置時跟著路徑走，看得到了（中間沒東西擋）再直接走過去
    const pd = p ? p.field.dist[ti] : Infinity;
    const follow = !!p && pd < Infinity && (p.field.dirX[ti] !== 0 || p.field.dirY[ti] !== 0)
      && !(d < 14 && this.clearLine(x, y, u.ordX[i], u.ordY[i], u.rad[i] * 0.9));
    // 沒有更接近（沿路徑的距離；繞路不算後退）：快到了（被擠住）1 秒、其他（窄路排隊、卡住）8 秒 → 算到了
    // 跟著路徑時用「1000＋路徑距離」，切換成直走時一定算進步
    const m = follow ? 1000 + pd : d;
    if (m < u.bestD[i] - 0.3) { u.bestD[i] = m; u.waitT[i] = 0; }
    else if ((u.waitT[i] += dt) > (d < 1.5 ? 1 : 8)) return true;
    if (follow) {
      // 朝「下一格的中心」走，而不是直接用方向：站在格子邊緣時照方向走會卡在石頭角上
      const nx = Math.floor(x) + 0.5 + Math.sign(p!.field.dirX[ti]), ny = Math.floor(y) + 0.5 + Math.sign(p!.field.dirY[ti]);
      const ax = nx - x, ay = ny - y, al = Math.hypot(ax, ay) || 1;
      out[0] = ax / al; out[1] = ay / al;
      return false;
    }
    const s = Math.min(1, d * 2);
    out[0] = (ex / d) * s; out[1] = (ey / d) * s;
    return false;
  }

  // ---------------------------------------------------------------- 單位 AI
  private findTarget(i: number): number {
    const u = this.units;
    const k = UNIT_KINDS[u.kind[i]];
    // 待命的我方士兵以「自己的崗位」為中心索敵 → 守住位置，不會被引走；
    // 攻擊移動、巡邏時以自己為中心；堅守時只找射程內的
    const guard = u.team[i] === Team.Player && u.order[i] === Ord.Idle && !u.hold[i];
    const cx = guard ? u.homeX[i] : u.x[i];
    const cy = guard ? u.homeY[i] : u.y[i];
    const player = u.team[i] === Team.Player;
    const r = u.hold[i] ? (k.range ?? k.reach) + u.rad[i] + 0.6 : player ? Math.max(k.aggro, PLAYER_SIGHT) : k.aggro;
    const n = this.hash.queryInto(cx, cy, r, this.tmp);
    let best = -1, bd = r * r;
    const team = u.team[i];
    for (let q = 0; q < n; q++) {
      const j = this.tmp[q];
      if (!u.alive[j] || u.team[j] === team) continue;
      const dx = u.x[j] - u.x[i], dy = u.y[j] - u.y[i];
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = j; }
    }
    if (best >= 0 || !player || u.hold[i]) return best;
    // 同一小隊有人在打 → 全隊圍過去：在戰鬥點附近找離自己最近的敵人
    const g = this.squadFight(i);
    if (g >= 0) {
      const m = this.hash.queryInto(this.engX[g], this.engY[g], SQUAD.fight, this.tmp);
      let sb = -1, sd = Infinity;
      for (let q = 0; q < m; q++) {
        const j = this.tmp[q];
        if (!u.alive[j] || u.team[j] === team) continue;
        const d2 = (u.x[j] - u.x[i]) ** 2 + (u.y[j] - u.y[i]) ** 2;
        if (d2 < sd) { sd = d2; sb = j; }
      }
      if (sb >= 0) return sb;
    }
    // 自己看不到敵人，但旁邊的隊友在打 → 一起去打它的目標（圍過去）
    const m = this.hash.queryInto(u.x[i], u.y[i], ASSIST, this.tmp);
    for (let q = 0; q < m; q++) {
      const j = this.tmp[q], t = u.target[j];
      if (j === i || !u.alive[j] || u.team[j] !== team || t < 0 || !u.alive[t] || u.team[t] === team) continue;
      if ((u.x[t] - cx) ** 2 + (u.y[t] - cy) ** 2 > (r + ASSIST) ** 2) continue; // 太遠就不被拉走
      return t;
    }
    return -1;
  }

  /** 這隻所屬的小隊剛剛有人在打、而且戰鬥點不太遠 → 回傳小隊編號；不然 -1 */
  private squadFight(i: number): number {
    const u = this.units, g = u.grp[i];
    if (g < 0 || u.order[i] === Ord.Move || u.hold[i] || this.engTick[g] < this.tick - 3) return -1;
    return (this.engX[g] - u.x[i]) ** 2 + (this.engY[g] - u.y[i]) ** 2 <= SQUAD.pull * SQUAD.pull ? g : -1;
  }

  // ---------------------------------------------------------------- 傷害
  /**
   * i 打 t 一下。傷害 = 攻擊 + 對護甲加成 + 對大型加成 + 號角加成 − 對應的防禦（至少 1）。
   * 近戰打到縮著的刺球衛會被反傷。
   */
  private hit(i: number, t: number, ranged: boolean): void {
    const u = this.units, ka = UNIT_KINDS[u.kind[i]], kt = UNIT_KINDS[u.kind[t]];
    const ra = this.research[u.team[i]], rt = this.research[u.team[t]];
    // 武器研究：每一級 + upgAtk（預設 1；攻城器 0）
    let dmg = u.dmg[i] + u.buff[i] + (ranged ? ra.rangedAtk : ra.meleeAtk) * (ka.upgAtk ?? 1);
    if (ka.skill?.type === 'rage' && this.deepRage(i)) dmg *= 1 + ka.skill.dmg;
    // 兵種加成（參考世紀帝國 4 的剋制）
    if ((kt.armor ?? Armor.Light) === Armor.Heavy) dmg += ka.bonusHeavy ?? 0;
    else dmg += ka.bonusLight ?? 0;
    if (u.rad[t] >= 0.45) dmg += ka.bonusLarge ?? 0;
    if (kt.cavalry) dmg += ka.bonusCav ?? 0;
    if ((kt.range ?? 0) > 0) dmg += ka.bonusRanged ?? 0;
    if (kt.wheeled) dmg += ka.bonusSiege ?? 0;
    let def = (ranged ? kt.rangedDef ?? 0 : kt.meleeDef ?? 0) + (ranged ? rt.rangedDef : rt.meleeDef);
    if (ranged) def += this.shieldCover(t);
    const curl = kt.skill?.type === 'curl' && u.curled[t] ? kt.skill : null;
    if (curl) def += curl.def;
    // 快爪手的飛撲：跑起來後的第一下多一些傷害（skillT＝已經跑了幾秒，它沒有別的技能，借來用）
    if (ka.skill?.type === 'pounce' && !ranged && u.skillT[i] >= ka.skill.run) {
      dmg += ka.skill.bonus;
      this.fx.push({ x: u.x[t], y: u.y[t], r: 0.45, t: 0.25, kind: 'horn' });
    }
    if (ka.skill?.type === 'pounce') u.skillT[i] = 0;
    u.hp[t] -= Math.max(1, dmg - def);
    u.hitT[t] = 0.12;
    if (ka.skill?.type === 'anchor') u.slowT[t] = SLOW.dur; // 船錨：拖慢
    if (ka.slowHit) u.slowT[t] = Math.max(u.slowT[t], ka.slowHit); // 蛛人族：緩速
    if (ka.bleed) { u.bleedT[t] = Math.max(u.bleedT[t], ka.bleed.dur); u.bleedDps[t] = Math.max(u.bleedDps[t], ka.bleed.dps); } // 魚人族：出血
    if (curl && !ranged) { u.hp[i] -= curl.reflect; u.hitT[i] = 0.12; }
  }

  /** 尖刺弩砲：從 i 往 t 的方向射一根刺，打中整條線上的敵人 */
  private pierce(i: number, t: number, range: number, width: number): void {
    const u = this.units, x = u.x[i], y = u.y[i];
    let dx = u.x[t] - x, dy = u.y[t] - y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    range = Math.max(range, d + u.rad[t] + 0.5); // 開火距離算上兩邊半徑，刺至少要飛過目標
    const mx = x + dx * range / 2, my = y + dy * range / 2;
    const n = this.hash.queryInto(mx, my, range / 2 + width, this.tmp);
    for (let q = 0; q < n; q++) {
      const j = this.tmp[q];
      if (!u.alive[j] || u.team[j] === u.team[i]) continue;
      const rx = u.x[j] - x, ry = u.y[j] - y;
      const along = rx * dx + ry * dy;
      if (along < 0 || along > range) continue;
      if (Math.abs(rx * dy - ry * dx) > width + u.rad[j]) continue;
      this.hit(i, j, true);
    }
    const dur = range / PROJ.spike.speed;
    this.shots.push({ x1: x, y1: y, x2: x + dx * range, y2: y + dy * range, t: dur, dur, h1: 0.5, kind: 'spike' });
  }

  /** 遠程發射：畫面上飛一段時間，飛到才扣血 */
  private launch(i: number, t: number, kind: ProjKind): void {
    const u = this.units;
    const d = Math.hypot(u.x[t] - u.x[i], u.y[t] - u.y[i]);
    const dur = Math.max(0.08, d / PROJ[kind].speed);
    this.shots.push({ x1: u.x[i], y1: u.y[i], x2: u.x[t], y2: u.y[t], t: dur, dur, h1: 0.6, kind });
    this.flights.push({ at: this.time + dur, i, t });
  }

  /** 飛到的遠程攻擊結算 */
  private landFlights(): void {
    if (!this.flights.length) return;
    const u = this.units;
    this.flights = this.flights.filter((f) => {
      if (f.at > this.time) return true;
      const sk = u.alive[f.i] ? UNIT_KINDS[u.kind[f.i]].skill : undefined;
      if (sk?.type === 'splash' && u.alive[f.i]) {
        // 水砲：落點周圍的敵人都受傷（目標死了也照樣濺開，落點用目標最後的位置）
        const x = u.x[f.t], y = u.y[f.t];
        const n = this.hash.queryInto(x, y, sk.radius, this.tmp);
        for (let q = 0; q < n; q++) {
          const j = this.tmp[q];
          if (!u.alive[j] || u.team[j] === u.team[f.i]) continue;
          if ((u.x[j] - x) ** 2 + (u.y[j] - y) ** 2 > sk.radius * sk.radius) continue;
          this.hit(f.i, j, true);
        }
        this.fx.push({ x, y, r: sk.radius, t: 0.35, kind: 'splash' });
      } else if (u.alive[f.i] && u.alive[f.t] && u.team[f.i] !== u.team[f.t]) this.hit(f.i, f.t, true);
      return false;
    });
  }

  /** 每 tick 先算的技能狀態：號角加成、刺球衛縮球、治療、陷阱、減速倒數 */
  private updateSkills(dt: number): void {
    const u = this.units;
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i]) continue;
      u.buff[i] = 0;
      if (u.slowT[i] > 0) u.slowT[i] -= dt;
      if (u.bleedT[i] > 0) {
        u.hp[i] -= u.bleedDps[i] * dt;
        if ((u.bleedT[i] -= dt) <= 0) u.bleedDps[i] = 0;
      }
    }
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i]) continue;
      const s = UNIT_KINDS[u.kind[i]].skill;
      if (!s) continue;
      const x = u.x[i], y = u.y[i], team = u.team[i];
      if (s.type === 'rage') {
        if (this.deepRage(i)) u.hp[i] = Math.min(u.maxHp[i], u.hp[i] + s.regen * dt);
        continue;
      }
      if (s.type === 'horn') {
        const n = this.hash.queryInto(x, y, s.radius, this.tmp);
        let fighting = false;
        for (let q = 0; q < n; q++) {
          const j = this.tmp[q];
          if (!u.alive[j]) continue;
          if (u.team[j] === team) { if (j !== i) u.buff[j] = Math.max(u.buff[j], s.atk); }
          else fighting = true;
        }
        // 號角聲的圈：只有附近有敵人（正在打仗）才閃，平常不吵
        if (fighting && ((this.tick + i) % 45) === 0) this.fx.push({ x, y, r: s.radius, t: 0.4, kind: 'horn' });
      } else if (s.type === 'curl') {
        // 附近有敵人就縮球；敵人離開 1.5 秒後才張開
        let near = false;
        const n = this.hash.queryInto(x, y, s.radius, this.tmp);
        for (let q = 0; q < n && !near; q++) {
          const j = this.tmp[q];
          if (u.alive[j] && u.team[j] !== team) near = true;
        }
        if (near) { u.curled[i] = 1; u.curlT[i] = 1.5; }
        else if (u.curled[i] && (u.curlT[i] -= dt) <= 0) u.curled[i] = 0;
      } else if (s.type === 'heal') {
        if ((u.skillT[i] -= dt) > 0) continue;
        const n = this.hash.queryInto(x, y, s.radius, this.tmp);
        let best = -1, lack = 1;
        for (let q = 0; q < n; q++) {
          const j = this.tmp[q];
          if (!u.alive[j] || u.team[j] !== team) continue;
          const l = u.maxHp[j] - u.hp[j];
          if (l > lack) { lack = l; best = j; }
        }
        if (best >= 0) {
          u.hp[best] = Math.min(u.maxHp[best], u.hp[best] + s.amount);
          this.fx.push({ x: u.x[best], y: u.y[best], r: 0.5, t: 0.4, kind: 'heal' });
          u.skillT[i] = s.cd;
        } else u.skillT[i] = 0.3;
      } else if (s.type === 'thorns') {
        if ((u.skillT[i] -= dt) > 0) continue;
        u.skillT[i] = 0.4;
        // 射程內離自己最近的敵人，在它腳下長出樹枝
        const n = this.hash.queryInto(x, y, s.range, this.tmp);
        let best = -1, bd = s.range * s.range;
        for (let q = 0; q < n; q++) {
          const j = this.tmp[q];
          if (!u.alive[j] || u.team[j] === team) continue;
          const d2 = (u.x[j] - x) ** 2 + (u.y[j] - y) ** 2;
          if (d2 < bd) { bd = d2; best = j; }
        }
        if (best < 0) continue;
        u.face[i] = Math.atan2(u.x[best] - x, u.y[best] - y);
        this.thorns.push({ x: u.x[best], y: u.y[best], r: s.radius, dps: s.dps, t: s.dur, dur: s.dur, team });
        u.skillT[i] = s.cd;
      } else if (s.type === 'trap') {
        if ((u.skillT[i] -= dt) > 0) continue;
        u.skillT[i] = 0.5;
        let mine = 0;
        for (const tr of this.traps) if (tr.owner === i) mine++;
        if (mine >= s.max) continue;
        // 往最近的敵人方向，在 40% 的地方放陷阱
        const r = UNIT_KINDS[u.kind[i]].aggro;
        const n = this.hash.queryInto(u.homeX[i], u.homeY[i], r, this.tmp);
        let best = -1, bd = r * r;
        for (let q = 0; q < n; q++) {
          const j = this.tmp[q];
          if (!u.alive[j] || u.team[j] === team) continue;
          const d2 = (u.x[j] - x) ** 2 + (u.y[j] - y) ** 2;
          if (d2 < bd) { bd = d2; best = j; }
        }
        if (best < 0) continue;
        const tx = x + (u.x[best] - x) * 0.4, ty = y + (u.y[best] - y) * 0.4;
        if (this.isSolid(Math.floor(tx), Math.floor(ty))) continue;
        this.traps.push({ x: tx, y: ty, owner: i });
        this.fx.push({ x: tx, y: ty, r: 0.6, t: 0.3, kind: 'trap' });
        u.skillT[i] = s.cd;
      }
    }
    // 樹枝：範圍內的敵人持續受傷
    if (this.thorns.length) {
      for (const th of this.thorns) {
        th.t -= dt;
        const n = this.hash.queryInto(th.x, th.y, th.r, this.tmp);
        for (let q = 0; q < n; q++) {
          const j = this.tmp[q];
          if (!u.alive[j] || u.team[j] === th.team) continue;
          if ((u.x[j] - th.x) ** 2 + (u.y[j] - th.y) ** 2 > th.r * th.r) continue;
          u.hp[j] -= th.dps * dt;
        }
      }
      this.thorns = this.thorns.filter((th) => th.t > 0);
    }
    // 陷阱：敵人踩到就觸發（受傷＋減速），陷阱消失
    if (this.traps.length) {
      this.traps = this.traps.filter((tr) => {
        if (!u.alive[tr.owner]) return false;
        const s = UNIT_KINDS[u.kind[tr.owner]].skill;
        const n = this.hash.queryInto(tr.x, tr.y, 0.6, this.tmp);
        for (let q = 0; q < n; q++) {
          const j = this.tmp[q];
          if (!u.alive[j] || u.team[j] === u.team[tr.owner]) continue;
          if ((u.x[j] - tr.x) ** 2 + (u.y[j] - tr.y) ** 2 > (0.35 + u.rad[j]) ** 2) continue;
          u.hp[j] -= s?.type === 'trap' ? s.dmg : 10;
          u.hitT[j] = 0.12;
          u.slowT[j] = SLOW.dur;
          this.fx.push({ x: tr.x, y: tr.y, r: 0.8, t: 0.3, kind: 'trap' });
          return false;
        }
        return true;
      });
    }
  }

  /** 附近（由近到遠，最多 6 格）第一圈裡流場距離最短、可走的格子索引；找不到回傳 -1 */
  private escapeTile(x: number, y: number, maxR = 6): number {
    const w = this.map.w, tx0 = Math.floor(x), ty0 = Math.floor(y);
    if (this.buildingAtTile(tx0, ty0) === this.base) return -1;
    let best = -1, bestD = Infinity;
    for (let r = 1; r <= maxR && best < 0; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // 只看這一圈
        const tx = tx0 + dx, ty = ty0 + dy;
        if (!this.map.inBounds(tx, ty) || this.isSolid(tx, ty)) continue;
        const d = this.flow.dist[ty * w + tx];
        if (d < bestD) { bestD = d; best = ty * w + tx; }
      }
    }
    return best;
  }

  /** 往 escapeTile 的方向 */
  private escapeDir(x: number, y: number): [number, number] | null {
    const w = this.map.w, best = this.escapeTile(x, y);
    if (best < 0) return null;
    const ex = (best % w) + 0.5 - x, ey = Math.floor(best / w) + 0.5 - y, d = Math.hypot(ex, ey) || 1;
    return [ex / d, ey / d];
  }

  private updateUnits(dt: number): void {
    const u = this.units, flow = this.flow, w = this.map.w, h = this.map.h;
    const blend = Math.min(1, dt * 8);
    const baseCx = this.base.tx + 1.5, baseCy = this.base.ty + 1.5;
    this.updateSkills(dt);
    this.landFlights();

    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i]) continue;
      const k = UNIT_KINDS[u.kind[i]];
      const slowed = u.slowT[i] > 0;
      u.cd[i] -= slowed ? dt * (1 - SLOW.attack) : dt;
      if (u.hitT[i] > 0) u.hitT[i] -= dt;

      const x = u.x[i], y = u.y[i];
      // 指定攻擊的目標死了 → 下一個指令
      if (u.order[i] === Ord.Attack) {
        const ot = u.ordT[i];
        if (ot < 0 || !u.alive[ot] || u.team[ot] === u.team[i]) this.finishOrder(i, x, y);
      }
      const ord = u.order[i];

      let t = u.target[i];
      if (k.support || ord === Ord.Move) t = -1; // 移動指令：一路不理敵人
      else if (ord === Ord.Attack) t = u.ordT[i];
      else {
        if (t >= 0 && (!u.alive[t] || u.team[t] === u.team[i])) t = -1;
        // 錯開每個單位的索敵時機，分散 CPU 負擔
        if (t < 0 ? ((this.tick + i) & 7) === 0 : ((this.tick + i) & 15) === 0) t = this.findTarget(i);
      }
      u.target[i] = t;
      // 小隊有人在打：記下戰鬥點，給其他隊員參考
      const grp = u.grp[i];
      if (t >= 0 && grp >= 0 && u.team[i] === Team.Player) {
        this.engX[grp] = u.x[t]; this.engY[grp] = u.y[t]; this.engTick[grp] = this.tick;
      }

      let dx = 0, dy = 0, attacking = false;
      const holding = u.hold[i] === 1 && ord === Ord.Idle;
      if (t >= 0) u.bestD[i] = Infinity; // 打完再重新判斷有沒有在前進

      if (t >= 0) {
        const ex = u.x[t] - x, ey = u.y[t] - y;
        const d = Math.hypot(ex, ey) || 0.001;
        const ranged = (k.range ?? 0) > 0;
        const reach = ranged ? k.range! : k.reach;
        if (d <= u.rad[i] + u.rad[t] + reach) {
          attacking = true;
          u.face[i] = Math.atan2(ex, ey);
          if (u.cd[i] <= 0) {
            u.cd[i] = k.attackCd * (this.raging(i) ? 1 - (k.skill as { atkSpeed: number }).atkSpeed : 1);
            if (k.skill?.type === 'pierce') this.pierce(i, t, k.range!, k.skill.width);
            else if (k.skill?.type === 'bark') {
              // 對自己周圍吼叫：範圍內的敵人都變慢，並受到一點傷害
              const n = this.hash.queryInto(x, y, k.skill.radius, this.tmp);
              for (let q = 0; q < n; q++) {
                const j = this.tmp[q];
                if (!u.alive[j] || u.team[j] === u.team[i]) continue;
                u.slowT[j] = SLOW.dur;
                this.hit(i, j, true);
              }
              this.fx.push({ x, y, r: k.skill.radius, t: 0.35, kind: 'bark' });
            } else if (ranged && k.proj) this.launch(i, t, k.proj);
            else if (k.skill?.type === 'cleave') {
              // 鏈錘橫掃：目標和它周圍的敵人都挨一下
              this.hit(i, t, false);
              const n = this.hash.queryInto(u.x[t], u.y[t], k.skill.radius, this.tmp);
              for (let q = 0; q < n; q++) {
                const j = this.tmp[q];
                if (j === t || !u.alive[j] || u.team[j] === u.team[i]) continue;
                if ((u.x[j] - u.x[t]) ** 2 + (u.y[j] - u.y[t]) ** 2 > k.skill.radius * k.skill.radius) continue;
                this.hit(i, j, false);
              }
              this.fx.push({ x: u.x[t], y: u.y[t], r: k.skill.radius, t: 0.25, kind: 'trap' });
            }
            else this.hit(i, t, ranged);
          }
        } else if (holding) u.target[i] = -1; // 堅守：跑出射程就不追
        else { dx = ex / d; dy = ey / d; }
      } else if (u.team[i] === Team.Enemy) {
        const tx = Math.min(w - 1, Math.max(0, Math.floor(x)));
        const ty = Math.min(h - 1, Math.max(0, Math.floor(y)));
        let fx = flow.dirX[ty * w + tx], fy = flow.dirY[ty * w + tx];
        // 平滑：用周圍 4 格的方向依距離混合（不然每過一格方向就突然轉 45°，走起來一扭一扭）
        if (this.moveTuning.smoothFlow && (fx !== 0 || fy !== 0)) { this.smoothFlow(x, y, fx, fy); fx = this.flowOut[0]; fy = this.flowOut[1]; }
        if (fx !== 0 || fy !== 0) {
          u.skillT[i] = 0;
          // 卡在窄縫：大隻的（例如大毛怪）擠不過只有一格寬的縫，流場又一直指向那裡。
          // 4 秒都沒有更接近城堡 → 直接放到流場方向的下一格（前面是建築就不管，讓它去拆）
          // bestD／waitT 是我方指令用的欄位，敵人沒有指令，借來用（spawn 時 waitT＝0、bestD＝0 → 第一次就會更新）
          const fd = flow.dist[ty * w + tx];
          if (u.bestD[i] === 0 || fd < u.bestD[i] - 0.5) { u.bestD[i] = fd; u.waitT[i] = 0; }
          else if ((u.waitT[i] += dt) > 4) {
            u.waitT[i] = 0;
            const nx = tx + Math.sign(Math.round(fx * 1.4)), ny = ty + Math.sign(Math.round(fy * 1.4));
            if (!this.isSolid(nx, ny) && flow.dist[ny * w + nx] < fd) { u.x[i] = u.px[i] = nx + 0.5; u.y[i] = u.py[i] = ny + 0.5; }
          }
        } else {
          // 這格沒有流場方向：可能是被擠進石頭圍住的小空地（從對角的縫鑽進來）。
          // 先找附近走得到城堡的格子脫困；找不到才直直朝城堡走
          const esc = this.escapeDir(x, y);
          if (esc) {
            fx = esc[0]; fy = esc[1];
            // 卡住偵測：在走不到城堡的格子上待超過 1.5 秒（通常是被擠進對角的縫，出不來）→ 直接移到最近的可達格子
            // 敵人沒有技能，借用 skillT 當計時器
            if ((u.skillT[i] += dt) > 1.5) {
              const tile = this.escapeTile(x, y, 40); // 瞬移時找遠一點（被擠進比較大的封閉空地也出得來）
              if (tile >= 0) { u.x[i] = u.px[i] = (tile % w) + 0.5; u.y[i] = u.py[i] = Math.floor(tile / w) + 0.5; }
              u.skillT[i] = 0;
            }
          } else {
            const bx = baseCx - x, by = baseCy - y, bd = Math.hypot(bx, by) || 1;
            fx = bx / bd; fy = by / bd;
          }
        }
        // 前方有建築 → 停下來拆
        const px = x + fx * (u.rad[i] + 0.3), py = y + fy * (u.rad[i] + 0.3);
        const b = this.buildingAtTile(Math.floor(px), Math.floor(py));
        if (b) {
          const cx = Math.max(b.tx, Math.min(x, b.tx + b.w));
          const cy = Math.max(b.ty, Math.min(y, b.ty + b.h));
          if (Math.hypot(x - cx, y - cy) <= u.rad[i] + k.reach + 0.15) {
            attacking = true;
            u.face[i] = Math.atan2(fx, fy);
            if (u.cd[i] <= 0) {
              b.hp -= u.dmg[i] * (k.bldMul ?? 1); // 骨頭車：拆建築加倍
              b.hitT = 0.12;
              u.cd[i] = k.attackCd;
            }
          } else { dx = fx; dy = fy; }
        } else { dx = fx; dy = fy; }
      } else if (k.support && !k.villager && this.squadFight(i) >= 0) {
        // 輔助兵（號角手、救援犬）：小隊在打就跟過去，站在戰鬥點後面一點
        u.bestD[i] = Infinity; // 打完再重新判斷有沒有在前進
        const g = u.grp[i], ex = this.engX[g] - x, ey = this.engY[g] - y, d = Math.hypot(ex, ey);
        if (d > SQUAD.supportGap) { const s = Math.min(1, d - SQUAD.supportGap); dx = (ex / d) * s; dy = (ey / d) * s; }
      } else if (ord !== Ord.Idle) {
        // 執行指令：走向目的地
        const out = this.steerOut;
        if (this.steerToOrder(i, dt, out)) {
          if (ord === Ord.Patrol) {
            // 巡邏：到了一端就換去另一端
            const ox = u.ordX[i], oy = u.ordY[i], op = u.path[i];
            u.ordX[i] = u.patX[i]; u.ordY[i] = u.patY[i]; u.path[i] = u.path2[i];
            u.patX[i] = ox; u.patY[i] = oy; u.path2[i] = op;
            u.waitT[i] = 0; u.bestD[i] = Infinity;
          } else this.finishOrder(i, u.ordX[i], u.ordY[i]);
        } else { dx = out[0]; dy = out[1]; }
      } else if (!holding) {
        const hx = u.homeX[i] - x, hy = u.homeY[i] - y, d = Math.hypot(hx, hy);
        if (d > 0.3) {
          const s = Math.min(1, d);
          dx = (hx / d) * s; dy = (hy / d) * s;
        }
      }

      let speed = k.speed;
      if (this.raging(i)) speed *= 1 + (k.skill as { moveSpeed: number }).moveSpeed;
      // 陣型一起走時配合最慢的單位；快到了才各自加速就位
      if (u.spdCap[i] > 0 && ord !== Ord.Idle && t < 0 && Math.hypot(u.ordX[i] - x, u.ordY[i] - y) > 2.5) speed = Math.min(speed, u.spdCap[i]);
      // 敵人：地面的跟著群組行軍速度走（會飛、會跳的照自己的）
      if (u.team[i] === Team.Enemy && u.spdCap[i] > 0 && !k.flying && !k.jumping) speed = u.spdCap[i];
      if (slowed) speed *= 1 - SLOW.move;
      if (u.curled[i] && k.skill?.type === 'curl') speed *= 1 - k.skill.slow;
      u.vx[i] += (dx * speed - u.vx[i]) * blend;
      u.vy[i] += (dy * speed - u.vy[i]) * blend;
      u.x[i] += u.vx[i] * dt;
      u.y[i] += u.vy[i] * dt;
      // 快爪手：跑起來就開始蓄飛撲（站著不動不算）
      if (k.skill?.type === 'pounce' && !attacking) {
        if (u.vx[i] * u.vx[i] + u.vy[i] * u.vy[i] > k.speed * k.speed * 0.4) u.skillT[i] += dt;
      }
      if (!attacking && u.vx[i] * u.vx[i] + u.vy[i] * u.vy[i] > 0.04) {
        u.face[i] = lerpAngle(u.face[i], Math.atan2(u.vx[i], u.vy[i]), Math.min(1, dt * 10));
      }
    }
  }

  private updateBuildings(dt: number): void {
    for (const b of this.buildings) {
      if (b.job && (b.job.t += dt) >= b.job.dur) this.finishJob(b);
    }
    const u = this.units;
    for (const b of this.buildings) {
      if (b.hitT > 0) b.hitT -= dt;
      const cx = b.tx + b.size / 2, cy = b.ty + b.size / 2;
      if (b.kind === BK.Tower) {
        b.cd -= dt;
        if (b.cd > 0) continue;
        const range = this.towerRange(b), r2 = range * range;
        const n = this.hash.queryInto(cx, cy, range, this.tmp);
        let best = -1, bestD = Infinity;
        for (let q = 0; q < n; q++) {
          const j = this.tmp[q];
          if (!u.alive[j] || u.team[j] !== Team.Enemy) continue;
          const dx = u.x[j] - cx, dy = u.y[j] - cy;
          if (dx * dx + dy * dy > r2) continue;
          // 優先打「離城堡最近」的敵人
          const fd = this.flow.dist[Math.floor(u.y[j]) * this.map.w + Math.floor(u.x[j])];
          if (fd < bestD) { bestD = fd; best = j; }
        }
        if (best >= 0) {
          u.hp[best] -= this.towerDamage(b);
          u.hitT[best] = 0.12;
          // 箭塔：傷害立刻算（箭很快），畫面上飛一支箭
          const dur = Math.max(0.08, Math.hypot(u.x[best] - cx, u.y[best] - cy) / PROJ.arrow.speed);
          this.shots.push({ x1: cx, y1: cy, x2: u.x[best], y2: u.y[best], t: dur, dur, kind: 'arrow' });
          b.cd = BUILDING_KINDS[b.kind].cd ?? 1;
        } else b.cd = 0.1;
      } else if (BUILDING_KINDS[b.kind].spawnCap) {
        if (b.units >= this.barracksCap(b)) continue;
        b.spawnT -= dt;
        if (b.spawnT > 0) continue;
        b.spawnT = 5;
        // 從建築旁邊的道路出來（沒有道路就走旁邊的空地；完全堵住就不出兵）
        const ex = this.exitPoint(b, b.rallyX, b.rallyY);
        if (!ex) continue;
        const i = u.spawn(this.nextTrainee(b), ex[0], ex[1], b.id);
        if (i >= 0) {
          b.trained++;
          this.applySheepLevel(i, b.level, true);
          u.homeX[i] = b.rallyX + this.rng.range(-0.8, 0.8);
          u.homeY[i] = b.rallyY + this.rng.range(-0.8, 0.8);
          b.units++;
        }
      }
    }
  }

  /**
   * 流場方向的雙線性內插：以格子中心為取樣點，混合周圍 4 格（走不到城堡的格子不算）。
   * 結果放在 flowOut（單位向量）；fx/fy 是目前這格的方向，混出來是 0 時用它。
   */
  private readonly flowOut: [number, number] = [0, 0];
  /** 走路平滑的開關（測試用；smoothFlow＝流場方向內插、push＝每 tick 推開重疊的比例） */
  moveTuning = { smoothFlow: true, push: 0.4 };
  private smoothFlow(x: number, y: number, fx: number, fy: number): void {
    const flow = this.flow, w = this.map.w, h = this.map.h;
    const gx = x - 0.5, gy = y - 0.5, ix = Math.floor(gx), iy = Math.floor(gy), ax = gx - ix, ay = gy - iy;
    let sx = 0, sy = 0;
    for (let k = 0; k < 4; k++) {
      const cx = ix + (k & 1), cy = iy + (k >> 1);
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
      const j = cy * w + cx;
      if (!(flow.dist[j] < Infinity)) continue;
      const wt = ((k & 1) ? ax : 1 - ax) * ((k >> 1) ? ay : 1 - ay);
      sx += flow.dirX[j] * wt; sy += flow.dirY[j] * wt;
    }
    const len = Math.hypot(sx, sy);
    if (len < 1e-3) { this.flowOut[0] = fx; this.flowOut[1] = fy; return; }
    this.flowOut[0] = sx / len; this.flowOut[1] = sy / len;
  }

  // ---------------------------------------------------------------- 碰撞
  private resolveCollisions(): void {
    const u = this.units, hs = this.hash, cols = hs.cols, rows = hs.rows;
    // 熱迴圈：陣列先拿到區域變數（每一對都要讀很多次）
    const X = u.x, Y = u.y, R = u.rad, alive = u.alive, kind = u.kind, start = hs.cellStart, items = hs.items;
    const pushK = this.moveTuning.push;
    // 1) 單位之間互推：照建表時的格子逐格走，每一對只比一次＝同一格裡排在後面的，加上「前方」4 格（右、左下、下、右下）裡的全部
    //    （3x3 格每對會被兩邊各看一次；這樣少走一半。用建表時的格子，單位在這一輪被推動也不會重算或漏算）
    const FWD = [1, 0, -1, 1, 0, 1, 1, 1];
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const cell = cy * cols + cx, cs = start[cell], ce = start[cell + 1];
      for (let p = cs; p < ce; p++) {
        const i = items[p];
        if (!alive[i]) continue;
        const ri = R[i], mi = ri * ri, li = LAYER[kind[i]];
        for (let f = -2; f < 8; f += 2) {
          let qs: number, qe: number;
          if (f < 0) { qs = p + 1; qe = ce; } // 同一格：排在後面的
          else {
            const xx = cx + FWD[f], yy = cy + FWD[f + 1];
            if (xx < 0 || xx >= cols || yy >= rows) continue;
            const nc = yy * cols + xx; qs = start[nc]; qe = start[nc + 1];
          }
          for (let q = qs; q < qe; q++) {
            const j = items[q];
            if (!alive[j] || li !== LAYER[kind[j]]) continue; // 會飛、會跳的從地面單位上面越過，不互推
            let dx = X[j] - X[i], dy = Y[j] - Y[i];
            const rj = R[j], min = ri + rj;
            let d2 = dx * dx + dy * dy;
            if (d2 >= min * min) continue;
            if (d2 < 1e-8) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = dx * dx + dy * dy; }
            const d = Math.sqrt(d2);
            // 每 tick 只推開重疊的 40%（推太滿會在人群裡來回彈，看起來一直抖；0.8 時人群抖動約 4 倍）
            const push = (min - d) * pushK;
            const nx = dx / d, ny = dy / d;
            const mj = rj * rj, wi = mj / (mi + mj); // 大隻的比較推不動
            X[i] -= nx * push * wi; Y[i] -= ny * push * wi;
            X[j] += nx * push * (1 - wi); Y[j] += ny * push * (1 - wi);
          }
        }
      }
    }
    // 2) 單位 vs 地形/建築（圓與方格）
    const W = this.map.w, H = this.map.h, tiles = this.map.tiles, occ = this.occ;
    for (let i = 0; i < u.hi; i++) {
      if (!alive[i]) continue;
      const r = R[i];
      let x = X[i], y = Y[i];
      const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          // 擋路的格子＝地圖外、不是草地、或有建築（和 isSolid 一樣，直接查陣列比較快）
          if (tx >= 0 && ty >= 0 && tx < W && ty < H) { const ti = ty * W + tx; if (tiles[ti] === Tile.Grass && occ[ti] < 0) continue; }
          // 開著的城門：我方只被兩端各半格的塔擋住
          const gid = this.map.inBounds(tx, ty) ? this.occ[ty * W + tx] : -1;
          const gb = gid >= 0 ? this.byId.get(gid)! : null;
          if (gb && gb.kind === BK.Gate && gb.open && u.team[i] === Team.Player) {
            const tw = this.gateTowers(gb);
            for (let q = 0; q < 8; q += 4) {
              const qx = Math.max(tw[q], Math.min(x, tw[q + 2])), qy = Math.max(tw[q + 1], Math.min(y, tw[q + 3]));
              const ex = x - qx, ey = y - qy, e2 = ex * ex + ey * ey;
              if (e2 < r * r && e2 > 1e-8) { const e = Math.sqrt(e2), kk = (r - e) / e; x += ex * kk; y += ey * kk; }
            }
            continue;
          }
          const px = Math.max(tx, Math.min(x, tx + 1)), py = Math.max(ty, Math.min(y, ty + 1));
          const dx = x - px, dy = y - py, d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2), k = (r - d) / d;
            x += dx * k; y += dy * k;
          } else {
            // 中心在方格內：往最近的邊推出去
            const l = x - tx, rr = tx + 1 - x, t = y - ty, b = ty + 1 - y;
            const m = Math.min(l, rr, t, b);
            if (m === l) x = tx - r; else if (m === rr) x = tx + 1 + r; else if (m === t) y = ty - r; else y = ty + 1 + r;
          }
        }
      }
      u.x[i] = Math.max(r, Math.min(W - r, x));
      u.y[i] = Math.max(r, Math.min(H - r, y));
    }
  }

  private cleanup(dt: number): void {
    const u = this.units;
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i] || u.hp[i] > 0) continue;
      if (u.team[i] === Team.Enemy) {
        this.gold += UNIT_KINDS[u.kind[i]].reward;
        this.kills++;
      }
      if (u.owner[i] >= 0) {
        const b = this.byId.get(u.owner[i]);
        if (b) b.units--;
      }
      this.queues.delete(i);
      u.kill(i);
    }
    for (const b of this.buildings) {
      if (b.hp > 0) continue;
      if (b.kind === BK.Base) { b.hp = 0; this.gameOver = true; }
    }
    const dead = this.buildings.filter((b) => b.hp <= 0 && b.kind !== BK.Base);
    for (const b of dead) this.removeBuilding(b, false);
    for (const s of this.shots) s.t -= dt;
    if (this.shots.length) this.shots = this.shots.filter((s) => s.t > 0);
    for (const f of this.fx) f.t -= dt;
    if (this.fx.length) this.fx = this.fx.filter((f) => f.t > 0);
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
