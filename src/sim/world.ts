import { Rng } from '../core/rng';
import { GameMap, Tile } from './map';
import { Units } from './units';
import { SpatialHash } from './spatialHash';
import { FlowField } from './flowfield';
import { Armor, BK, BUILDING_KINDS, ECON, MAX_LEVEL, PROJ, SLOW, Team, UK, UNIT_KINDS, type ProjKind } from './data';

export interface Building {
  id: number;
  kind: number;
  tx: number;
  ty: number;
  size: number;
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

/** 一閃而過的範圍效果（吠叫、治療、號角），只給繪圖用 */
export interface Fx { x: number; y: number; r: number; t: number; kind: 'bark' | 'heal' | 'horn' | 'trap'; }

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
  readonly byId = new Map<number, Building>();
  buildings: Building[] = [];
  base: Building;

  gold = ECON.startGold;
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
  fx: Fx[] = [];
  private flights: Flight[] = [];
  /** 自訂每一波的敵人數量（DEMO 用）；沒設定就用公式 */
  waveSizes: number[] | null = null;
  /** 自訂波次的組成比例：[毛球怪, 飛毛蟲, 大毛怪] */
  waveMix: [number, number, number] = [0.6, 0.3, 0.1];
  spawnPoints: number[] = [];

  private costs: Float32Array;
  private flowDirty = true;
  private spawnQueue: number[] = []; // kind, x, y 三個一組
  private nextBid = 1;
  private tmp = new Int32Array(4096);
  private rng: Rng;

  constructor(readonly seed: number, size = 96) {
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.map = new GameMap(size, size, seed);
    this.hash = new SpatialHash(size, size, 1.25, MAX_UNITS);
    this.flow = new FlowField(size, size);
    this.occ = new Int32Array(size * size).fill(-1);
    this.costs = new Float32Array(size * size);
    this.base = this.addBuilding(BK.Base, this.map.baseX, this.map.baseY);
    this.recomputeFlow();
    const { w, h } = this.map;
    const edge: number[] = [];
    for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);
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
    const custom = this.waveSizes?.[w - 1];
    this.spawnHorde(custom ?? Math.round(12 + w * 8 + w * w * 1.5), custom !== undefined);
  }

  spawnHorde(count: number, useMix = false): void {
    if (!this.spawnPoints.length) return;
    const clusters: number[] = [];
    const nc = 1 + Math.min(3, Math.floor(this.wave / 3));
    for (let c = 0; c < nc; c++) clusters.push(this.spawnPoints[this.rng.int(0, this.spawnPoints.length - 1)]);
    const w = this.map.w;
    for (let n = 0; n < count; n++) {
      const sp = clusters[n % clusters.length];
      let x = (sp % w) + 0.5 + this.rng.range(-2, 2);
      let y = Math.floor(sp / w) + 0.5 + this.rng.range(-2, 2);
      // 隨機偏移後要確認還走得到城堡：偏移可能把敵人丟進被石頭圍住的封閉小區域，那裡流場沒有方向，敵人會卡住
      const ti = Math.floor(y) * w + Math.floor(x);
      if (this.isSolid(Math.floor(x), Math.floor(y)) || !(this.flow.dist[ti] < Infinity)) { x = (sp % w) + 0.5; y = Math.floor(sp / w) + 0.5; }
      const r = this.rng.next();
      let kind: number = UK.Fuzz;
      if (useMix) {
        const [, runner, brute] = this.waveMix;
        if (r < brute) kind = UK.Brute;
        else if (r < brute + runner) kind = UK.Runner;
      } else if (this.wave >= 4 && r < 0.05 + this.wave * 0.005) kind = UK.Brute;
      else if (this.wave >= 2 && r < 0.3) kind = UK.Runner;
      this.spawnQueue.push(kind, x, y);
    }
  }

  spawnUnitAt(kind: number, x: number, y: number): number {
    return this.units.spawn(kind, x, y);
  }

  private processSpawns(): void {
    const q = this.spawnQueue;
    const n = Math.min(q.length / 3, 60);
    for (let k = 0; k < n; k++) this.units.spawn(q[k * 3], q[k * 3 + 1], q[k * 3 + 2]);
    q.splice(0, n * 3);
  }

  get pendingSpawns(): number {
    return this.spawnQueue.length / 3;
  }

  // ---------------------------------------------------------------- 建築
  canPlace(kind: number, tx: number, ty: number): boolean {
    const s = BUILDING_KINDS[kind].size;
    for (let y = ty; y < ty + s; y++)
      for (let x = tx; x < tx + s; x++) {
        if (!this.map.inBounds(x, y) || this.map.solidTerrain(x, y) || this.occ[y * this.map.w + x] >= 0) return false;
      }
    return true;
  }

  canAfford(cost: number): boolean {
    return this.freeBuild || this.gold >= cost;
  }

  tryPlace(kind: number, tx: number, ty: number): Building | null {
    const cost = BUILDING_KINDS[kind].cost;
    if (!this.canPlace(kind, tx, ty) || !this.canAfford(cost)) return null;
    if (!this.freeBuild) this.gold -= cost;
    return this.addBuilding(kind, tx, ty);
  }

  private addBuilding(kind: number, tx: number, ty: number): Building {
    const k = BUILDING_KINDS[kind];
    const b: Building = {
      id: this.nextBid++, kind, tx, ty, size: k.size, hp: k.hp, maxHp: k.hp, level: 1,
      cd: 0, spawnT: 1, units: 0, rallyX: 0, rallyY: 0, invested: k.cost, hitT: 0, dead: false,
    };
    for (let y = ty; y < ty + k.size; y++)
      for (let x = tx; x < tx + k.size; x++) this.occ[y * this.map.w + x] = b.id;
    if (kind === BK.Barracks) {
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
    for (let y = b.ty; y < b.ty + b.size; y++)
      for (let x = b.tx; x < b.tx + b.size; x++) this.occ[y * this.map.w + x] = -1;
    b.dead = true;
    if (refund) this.gold += Math.floor(b.invested * ECON.refundRatio);
    this.byId.delete(b.id);
    this.buildings = this.buildings.filter((o) => o !== b);
    this.buildingsVersion++;
    this.flowDirty = true;
  }

  upgradeCost(b: Building): number | null {
    if (b.level >= MAX_LEVEL) return null;
    return BUILDING_KINDS[b.kind].upgradeCost[b.level - 1] ?? null;
  }

  upgrade(b: Building): boolean {
    const cost = this.upgradeCost(b);
    if (cost === null || !this.canAfford(cost)) return false;
    if (!this.freeBuild) this.gold -= cost;
    b.invested += cost;
    b.level++;
    b.maxHp = Math.round(b.maxHp * 1.4);
    b.hp = b.maxHp;
    if (b.kind === BK.Barracks) {
      const u = this.units;
      for (let i = 0; i < u.hi; i++) {
        if (u.alive[i] && u.owner[i] === b.id) this.applySheepLevel(i, b.level, true);
      }
    }
    this.buildingsVersion++;
    return true;
  }

  setRally(b: Building, x: number, y: number): void {
    b.rallyX = x;
    b.rallyY = y;
    const u = this.units;
    for (let i = 0; i < u.hi; i++) {
      if (u.alive[i] && u.owner[i] === b.id) {
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
    this.flowDirty = false;
  }

  // ---------------------------------------------------------------- 單位 AI
  private findTarget(i: number): number {
    const u = this.units;
    const k = UNIT_KINDS[u.kind[i]];
    // 我方士兵以「集結點」為中心索敵 → 守住位置，不會被引走
    const cx = u.team[i] === Team.Player ? u.homeX[i] : u.x[i];
    const cy = u.team[i] === Team.Player ? u.homeY[i] : u.y[i];
    const r = k.aggro;
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
    return best;
  }

  // ---------------------------------------------------------------- 傷害
  /**
   * i 打 t 一下。傷害 = 攻擊 + 對護甲加成 + 對大型加成 + 號角加成 − 對應的防禦（至少 1）。
   * 近戰打到縮著的刺球衛會被反傷。
   */
  private hit(i: number, t: number, ranged: boolean): void {
    const u = this.units, ka = UNIT_KINDS[u.kind[i]], kt = UNIT_KINDS[u.kind[t]];
    let dmg = u.dmg[i] + u.buff[i];
    if ((kt.armor ?? Armor.Light) === Armor.Heavy) dmg += ka.bonusHeavy ?? 0;
    else dmg += ka.bonusLight ?? 0;
    if (u.rad[t] >= 0.45) dmg += ka.bonusLarge ?? 0;
    let def = ranged ? kt.rangedDef ?? 0 : kt.meleeDef ?? 0;
    const curl = kt.skill?.type === 'curl' && u.curled[t] ? kt.skill : null;
    if (curl) def += curl.def;
    u.hp[t] -= Math.max(1, dmg - def);
    u.hitT[t] = 0.12;
    if (curl && !ranged) { u.hp[i] -= curl.reflect; u.hitT[i] = 0.12; }
  }

  /** 尖刺弩砲：從 i 往 t 的方向射一根刺，打中整條線上的敵人 */
  private pierce(i: number, t: number, range: number, width: number): void {
    const u = this.units, x = u.x[i], y = u.y[i];
    let dx = u.x[t] - x, dy = u.y[t] - y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
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
      if (u.alive[f.i] && u.alive[f.t] && u.team[f.i] !== u.team[f.t]) this.hit(f.i, f.t, true);
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
    }
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i]) continue;
      const s = UNIT_KINDS[u.kind[i]].skill;
      if (!s) continue;
      const x = u.x[i], y = u.y[i], team = u.team[i];
      if (s.type === 'horn') {
        const n = this.hash.queryInto(x, y, s.radius, this.tmp);
        for (let q = 0; q < n; q++) {
          const j = this.tmp[q];
          if (u.alive[j] && u.team[j] === team && j !== i) u.buff[j] = Math.max(u.buff[j], s.atk);
        }
        if (((this.tick + i) % 45) === 0) this.fx.push({ x, y, r: s.radius, t: 0.4, kind: 'horn' });
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
  private escapeTile(x: number, y: number): number {
    const w = this.map.w, tx0 = Math.floor(x), ty0 = Math.floor(y);
    if (this.buildingAtTile(tx0, ty0) === this.base) return -1;
    let best = -1, bestD = Infinity;
    for (let r = 1; r <= 6 && best < 0; r++) {
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

      let t = u.target[i];
      if (k.support) t = -1;
      else {
        if (t >= 0 && (!u.alive[t] || u.team[t] === u.team[i])) t = -1;
        // 錯開每個單位的索敵時機，分散 CPU 負擔
        if (t < 0 ? ((this.tick + i) & 7) === 0 : ((this.tick + i) & 15) === 0) t = this.findTarget(i);
      }
      u.target[i] = t;

      const x = u.x[i], y = u.y[i];
      let dx = 0, dy = 0, attacking = false;

      if (t >= 0) {
        const ex = u.x[t] - x, ey = u.y[t] - y;
        const d = Math.hypot(ex, ey) || 0.001;
        const ranged = (k.range ?? 0) > 0;
        const reach = ranged ? k.range! : k.reach;
        if (d <= u.rad[i] + u.rad[t] + reach) {
          attacking = true;
          u.face[i] = Math.atan2(ex, ey);
          if (u.cd[i] <= 0) {
            u.cd[i] = k.attackCd;
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
            else this.hit(i, t, ranged);
          }
        } else { dx = ex / d; dy = ey / d; }
      } else if (u.team[i] === Team.Enemy) {
        const tx = Math.min(w - 1, Math.max(0, Math.floor(x)));
        const ty = Math.min(h - 1, Math.max(0, Math.floor(y)));
        let fx = flow.dirX[ty * w + tx], fy = flow.dirY[ty * w + tx];
        if (fx !== 0 || fy !== 0) u.skillT[i] = 0;
        else {
          // 這格沒有流場方向：可能是被擠進石頭圍住的小空地（從對角的縫鑽進來）。
          // 先找附近走得到城堡的格子脫困；找不到才直直朝城堡走
          const esc = this.escapeDir(x, y);
          if (esc) {
            fx = esc[0]; fy = esc[1];
            // 卡住偵測：在走不到城堡的格子上待超過 1.5 秒（通常是被擠進對角的縫，出不來）→ 直接移到最近的可達格子
            // 敵人沒有技能，借用 skillT 當計時器
            if ((u.skillT[i] += dt) > 1.5) {
              const tile = this.escapeTile(x, y);
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
          const cx = Math.max(b.tx, Math.min(x, b.tx + b.size));
          const cy = Math.max(b.ty, Math.min(y, b.ty + b.size));
          if (Math.hypot(x - cx, y - cy) <= u.rad[i] + k.reach + 0.15) {
            attacking = true;
            u.face[i] = Math.atan2(fx, fy);
            if (u.cd[i] <= 0) {
              b.hp -= u.dmg[i];
              b.hitT = 0.12;
              u.cd[i] = k.attackCd;
            }
          } else { dx = fx; dy = fy; }
        } else { dx = fx; dy = fy; }
      } else {
        const hx = u.homeX[i] - x, hy = u.homeY[i] - y, d = Math.hypot(hx, hy);
        if (d > 0.3) {
          const s = Math.min(1, d);
          dx = (hx / d) * s; dy = (hy / d) * s;
        }
      }

      let speed = k.speed;
      if (slowed) speed *= 1 - SLOW.move;
      if (u.curled[i] && k.skill?.type === 'curl') speed *= 1 - k.skill.slow;
      u.vx[i] += (dx * speed - u.vx[i]) * blend;
      u.vy[i] += (dy * speed - u.vy[i]) * blend;
      u.x[i] += u.vx[i] * dt;
      u.y[i] += u.vy[i] * dt;
      if (!attacking && u.vx[i] * u.vx[i] + u.vy[i] * u.vy[i] > 0.04) {
        u.face[i] = lerpAngle(u.face[i], Math.atan2(u.vx[i], u.vy[i]), Math.min(1, dt * 10));
      }
    }
  }

  private updateBuildings(dt: number): void {
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
      } else if (b.kind === BK.Barracks) {
        if (b.units >= this.barracksCap(b)) continue;
        b.spawnT -= dt;
        if (b.spawnT > 0) continue;
        b.spawnT = 5;
        // 從建築邊緣靠近集結點的位置出兵
        const m = 0.45;
        const sx = Math.max(b.tx - m, Math.min(b.rallyX, b.tx + b.size + m));
        const sy = Math.max(b.ty - m, Math.min(b.rallyY, b.ty + b.size + m));
        const i = u.spawn(UK.Sheep, sx, sy, b.id);
        if (i >= 0) {
          this.applySheepLevel(i, b.level, true);
          u.homeX[i] = b.rallyX + this.rng.range(-0.8, 0.8);
          u.homeY[i] = b.rallyY + this.rng.range(-0.8, 0.8);
          b.units++;
        }
      }
    }
  }

  // ---------------------------------------------------------------- 碰撞
  private resolveCollisions(): void {
    const u = this.units, hs = this.hash, cols = hs.cols, rows = hs.rows;
    // 1) 單位之間互推（只比較附近 3x3 格）
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i]) continue;
      const c = hs.cellIndex(u.x[i], u.y[i]);
      const cx = c % cols, cy = (c / cols) | 0;
      const ri = u.rad[i], mi = ri * ri;
      for (let yy = Math.max(0, cy - 1); yy <= Math.min(rows - 1, cy + 1); yy++) {
        for (let xx = Math.max(0, cx - 1); xx <= Math.min(cols - 1, cx + 1); xx++) {
          const cell = yy * cols + xx;
          for (let p = hs.cellStart[cell], e = hs.cellStart[cell + 1]; p < e; p++) {
            const j = hs.items[p];
            if (j <= i || !u.alive[j]) continue;
            let dx = u.x[j] - u.x[i], dy = u.y[j] - u.y[i];
            const rj = u.rad[j], min = ri + rj;
            let d2 = dx * dx + dy * dy;
            if (d2 >= min * min) continue;
            if (d2 < 1e-8) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = dx * dx + dy * dy; }
            const d = Math.sqrt(d2);
            const push = (min - d) * 0.8;
            const nx = dx / d, ny = dy / d;
            const mj = rj * rj, wi = mj / (mi + mj); // 大隻的比較推不動
            u.x[i] -= nx * push * wi; u.y[i] -= ny * push * wi;
            u.x[j] += nx * push * (1 - wi); u.y[j] += ny * push * (1 - wi);
          }
        }
      }
    }
    // 2) 單位 vs 地形/建築（圓與方格）
    const W = this.map.w, H = this.map.h;
    for (let i = 0; i < u.hi; i++) {
      if (!u.alive[i]) continue;
      const r = u.rad[i];
      let x = u.x[i], y = u.y[i];
      const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (!this.isSolid(tx, ty)) continue;
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
