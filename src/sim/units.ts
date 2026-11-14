import { UNIT_KINDS } from './data';

/**
 * 所有單位用「陣列結構」(SoA, typed arrays) 存放：
 * 沒有每個單位一個物件，GC 幾乎為零，上萬單位也能快速迭代。
 * 單位以索引 i 表示；死亡的索引會放回 free list 重複使用。
 */
export class Units {
  hi = 0; // 曾使用的最大索引 + 1（迭代上限）
  count = 0; // 存活數量

  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly px: Float32Array; // 上一 tick 位置（繪圖插值用）
  readonly py: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly hp: Float32Array;
  readonly maxHp: Float32Array;
  readonly dmg: Float32Array;
  readonly rad: Float32Array;
  readonly cd: Float32Array;
  readonly face: Float32Array;
  readonly hitT: Float32Array;
  readonly homeX: Float32Array;
  readonly homeY: Float32Array;
  readonly kind: Uint8Array;
  readonly team: Uint8Array;
  readonly alive: Uint8Array;
  readonly target: Int32Array;
  readonly owner: Int32Array;
  /** 號角手給的攻擊加成（每 tick 重算） */
  readonly buff: Float32Array;
  /** 被減速剩下的秒數（吠叫、陷阱） */
  readonly slowT: Float32Array;
  /** 出血：剩下的秒數、每秒傷害 */
  readonly bleedT: Float32Array;
  readonly bleedDps: Float32Array;
  /** 刺球衛：是否縮成球、離開戰鬥後多久張開 */
  readonly curled: Uint8Array;
  readonly curlT: Float32Array;
  /** 技能冷卻（陷阱、治療） */
  readonly skillT: Float32Array;

  // ---- 玩家下的指令（見 orders.ts 的 Ord）
  /** 目前的指令 */
  readonly order: Uint8Array;
  /** 堅守位置：不移動，只打射程內的敵人 */
  readonly hold: Uint8Array;
  /** 指令目的地（陣型裡自己的位置） */
  readonly ordX: Float32Array;
  readonly ordY: Float32Array;
  /** 巡邏的另一端 */
  readonly patX: Float32Array;
  readonly patY: Float32Array;
  /** 指定攻擊的目標 */
  readonly ordT: Int32Array;
  /** 走去目的地用的路徑（World.paths 的編號，-1 = 直線走）；path2 是巡邏回程 */
  readonly path: Int16Array;
  readonly path2: Int16Array;
  /** 陣型一起走時的速度上限（0 = 不限） */
  readonly spdCap: Float32Array;
  /** 沒有更接近目的地的時間（被擠住或走不到，太久就算到了） */
  readonly waitT: Float32Array;
  /** 目前為止離目的地最近的距離（判斷有沒有在前進） */
  readonly bestD: Float32Array;
  /** 小隊：同一次指令一起下令的單位是同一隊，一隻開打全隊一起圍過去（-1 = 沒有） */
  readonly grp: Int32Array;
  /** 第幾代：索引被重複使用時 +1（選取、編隊用它分辨是不是同一隻） */
  readonly gen: Uint32Array;
  /** 走到目的地後要面向哪裡（弧度，和 face 一樣；NaN＝不轉）：移動指令的陣型朝向 */
  readonly endFace: Float32Array;

  private free: number[] = [];

  constructor(readonly cap: number) {
    const f = () => new Float32Array(cap);
    this.x = f(); this.y = f(); this.px = f(); this.py = f();
    this.vx = f(); this.vy = f(); this.hp = f(); this.maxHp = f();
    this.dmg = f(); this.rad = f(); this.cd = f(); this.face = f();
    this.hitT = f(); this.homeX = f(); this.homeY = f();
    this.buff = f(); this.slowT = f(); this.bleedT = f(); this.bleedDps = f(); this.curlT = f(); this.skillT = f();
    this.ordX = f(); this.ordY = f(); this.patX = f(); this.patY = f(); this.spdCap = f(); this.waitT = f(); this.bestD = f();
    this.endFace = f();
    this.order = new Uint8Array(cap);
    this.hold = new Uint8Array(cap);
    this.ordT = new Int32Array(cap);
    this.path = new Int16Array(cap);
    this.path2 = new Int16Array(cap);
    this.gen = new Uint32Array(cap);
    this.grp = new Int32Array(cap);
    this.curled = new Uint8Array(cap);
    this.kind = new Uint8Array(cap);
    this.team = new Uint8Array(cap);
    this.alive = new Uint8Array(cap);
    this.target = new Int32Array(cap);
    this.owner = new Int32Array(cap);
  }

  spawn(kind: number, x: number, y: number, owner = -1): number {
    let i: number;
    if (this.free.length) i = this.free.pop()!;
    else if (this.hi < this.cap) i = this.hi++;
    else return -1;
    const k = UNIT_KINDS[kind];
    this.x[i] = this.px[i] = this.homeX[i] = x;
    this.y[i] = this.py[i] = this.homeY[i] = y;
    this.vx[i] = this.vy[i] = 0;
    this.hp[i] = this.maxHp[i] = k.hp;
    this.dmg[i] = k.damage;
    this.rad[i] = k.radius;
    this.cd[i] = Math.random() * k.attackCd;
    this.face[i] = Math.random() * Math.PI * 2;
    this.hitT[i] = 0;
    this.buff[i] = this.slowT[i] = this.curlT[i] = this.skillT[i] = this.bleedT[i] = this.bleedDps[i] = 0;
    this.curled[i] = 0;
    this.order[i] = this.hold[i] = 0;
    this.ordT[i] = this.path[i] = this.path2[i] = this.grp[i] = -1;
    this.spdCap[i] = this.waitT[i] = this.bestD[i] = 0;
    this.endFace[i] = NaN;
    this.gen[i]++;
    this.kind[i] = kind;
    this.team[i] = k.team;
    this.alive[i] = 1;
    this.target[i] = -1;
    this.owner[i] = owner;
    this.count++;
    return i;
  }

  kill(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.free.push(i);
    this.count--;
  }
}
