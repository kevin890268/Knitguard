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
  /** 刺球衛：是否縮成球、離開戰鬥後多久張開 */
  readonly curled: Uint8Array;
  readonly curlT: Float32Array;
  /** 技能冷卻（陷阱、治療） */
  readonly skillT: Float32Array;

  private free: number[] = [];

  constructor(readonly cap: number) {
    const f = () => new Float32Array(cap);
    this.x = f(); this.y = f(); this.px = f(); this.py = f();
    this.vx = f(); this.vy = f(); this.hp = f(); this.maxHp = f();
    this.dmg = f(); this.rad = f(); this.cd = f(); this.face = f();
    this.hitT = f(); this.homeX = f(); this.homeY = f();
    this.buff = f(); this.slowT = f(); this.curlT = f(); this.skillT = f();
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
    this.buff[i] = this.slowT[i] = this.curlT[i] = this.skillT[i] = 0;
    this.curled[i] = 0;
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
