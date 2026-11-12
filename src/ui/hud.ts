import { Armor, BK, BUILDING_KINDS, Team, UNIT_KINDS, type UnitKind } from '../sim/data';
import { FORMATIONS, Ord } from '../sim/orders';
import type { Building, World } from '../sim/world';
import type { ArmyControl } from './army';

/** 指令卡上的一個按鈕 */
export interface CardCmd {
  icon: string;
  label: string;
  key?: string;
  tip?: string;
  /** 價錢（買不起時變灰） */
  cost?: number;
  debug?: boolean;
  on: () => void;
  active?: () => boolean;
  disabled?: () => boolean;
}

export interface HudDeps {
  getWorld: () => World;
  army: ArmyControl;
  getBuilding: () => Building | null;
  setBuilding: (b: Building | null) => void;
  /** 沒選東西時的指令卡（建造工具） */
  buildCmds: () => CardCmd[];
  /** 選到建築時的指令卡 */
  buildingCmds: (b: Building) => CardCmd[];
  portrait: (kind: number) => HTMLCanvasElement | null;
}

const $ = (id: string) => document.getElementById(id)!;
const ORDER_TEXT: Record<number, string> = {
  [Ord.Idle]: '待命', [Ord.Move]: '移動中', [Ord.AttackMove]: '攻擊移動中', [Ord.Attack]: '攻擊目標', [Ord.Patrol]: '巡邏中',
};

/** 技能說明（從數值產生，改 data.ts 會自動更新） */
function skillText(k: UnitKind): string {
  const s = k.skill;
  if (!s) return '';
  switch (s.type) {
    case 'horn': return `📯 號角：周圍 ${s.radius} 格的我方攻擊 +${s.atk}`;
    case 'curl': return `🦔 縮球：敵人靠近自動縮成刺球，防禦 +${s.def}、近戰反傷 ${s.reflect}、移動 −${Math.round(s.slow * 100)}%`;
    case 'pierce': return '🎯 貫穿：射出的刺穿過一整排敵人';
    case 'trap': return `🪤 陷阱：每 ${s.cd} 秒放一個地刺（最多 ${s.max} 個），踩到受 ${s.dmg} 傷害並變慢`;
    case 'bark': return `🐕 吠叫：周圍 ${s.radius} 格的敵人移動、攻擊變慢`;
    case 'heal': return `💚 治療：每 ${s.cd} 秒治療附近最需要的隊友 ${s.amount} 血`;
  }
}

/**
 * 最下方的資訊列（參考世紀帝國 4）：
 *   左：選到的東西的頭像與數值　中：編隊＋選取格子　右：指令卡　最右：小地圖（minimap.ts）
 * 每 0.2 秒更新一次；DOM 結構只在「選取內容換了」時重建。
 */
export class Hud {
  private portraitUrl = new Map<HTMLCanvasElement, string>();
  private cardKey = '';
  private cards: { el: HTMLButtonElement; cmd: CardCmd }[] = [];
  private gridKey = '';
  /** 資訊欄：內容一樣就不重寫（頭像是很長的圖片網址，每次重寫都要重新解碼圖片，會卡） */
  private info = {
    last: '',
    set innerHTML(v: string) { if (v !== this.last) { this.last = v; $('infoPanel').innerHTML = v; } },
  };

  constructor(private readonly d: HudDeps) {
    $('bottomBar').addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private get world(): World { return this.d.getWorld(); }

  /** 頭像圖片網址（2D 版用面向鏡頭的圖；沒有就用 emoji） */
  private portraitHtml(kind: number, cls: string): string {
    const c = this.d.portrait(kind);
    if (!c) return `<div class="${cls} emoji">${UNIT_KINDS[kind].team === Team.Enemy ? '👾' : '🐑'}</div>`;
    let url = this.portraitUrl.get(c);
    if (!url) { url = c.toDataURL(); this.portraitUrl.set(c, url); }
    return `<img class="${cls}" src="${url}" alt="" />`;
  }

  update(): void {
    const army = this.d.army, b = this.d.getBuilding();
    const enemy = army.inspected();
    this.updateGroups();
    if (army.sel.length) {
      this.unitInfo(army.sel, false);
      this.selectionGrid();
      this.card('units', () => this.unitCmds());
    } else if (enemy >= 0) {
      this.unitInfo([enemy], true);
      this.clearGrid('敵人：只能查看');
      this.card('enemy', () => []);
    } else if (b && !b.dead) {
      this.buildingInfo(b);
      this.clearGrid('');
      this.card(`b${b.id}:${b.level}`, () => this.d.buildingCmds(b));
    } else {
      this.info.innerHTML = '<div class="empty">左鍵點選或框選部隊<br>點建築查看資訊</div>';
      this.clearGrid('');
      this.card('build', () => this.d.buildCmds());
    }
    this.refreshCard();
  }

  // ---------------------------------------------------------------- 左：資訊
  /** 單一單位：完整數值；多隻：以數量最多的兵種為主，顯示總數和總血量 */
  private unitInfo(ids: number[], enemy: boolean): void {
    const u = this.world.units;
    const counts = new Map<number, number>();
    for (const i of ids) counts.set(u.kind[i], (counts.get(u.kind[i]) ?? 0) + 1);
    const kind = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const k = UNIT_KINDS[kind];
    let hp = 0, maxHp = 0;
    for (const i of ids) { hp += u.hp[i]; maxHp += u.maxHp[i]; }
    const one = ids.length === 1 ? ids[0] : -1;
    const dmg = one >= 0 ? u.dmg[one] + u.buff[one] : k.damage;
    const buff = one >= 0 && u.buff[one] > 0 ? `<span class="up">(+${u.buff[one]})</span>` : '';
    const ranged = (k.range ?? 0) > 0;
    const bonus = [k.bonusLight ? `對輕甲 +${k.bonusLight}` : '', k.bonusHeavy ? `對重甲 +${k.bonusHeavy}` : '', k.bonusLarge ? `對大型 +${k.bonusLarge}` : ''].filter(Boolean).join('、');
    const stats = [
      k.support ? '<span>⚔️ 不攻擊（輔助）</span>' : `<span title="傷害／攻擊間隔">⚔️ ${dmg.toFixed(0)}${buff} <small>/${k.attackCd}s</small></span>`,
      `<span>${ranged ? `🏹 射程 ${k.range}` : '🗡️ 近戰'}</span>`,
      `<span title="近戰防禦／遠程防禦">🛡️ ${k.meleeDef ?? 0} / ${k.rangedDef ?? 0}</span>`,
      `<span>${(k.armor ?? Armor.Light) === Armor.Heavy ? '⛓️ 重甲' : '🧶 輕甲'}</span>`,
      `<span>👟 ${k.speed}</span>`,
    ].join('');
    let status = '';
    if (one >= 0 && !enemy) {
      const q = this.world.queuedOrders(one).length;
      status = u.order[one] === Ord.Idle && u.hold[one] ? '堅守位置' : ORDER_TEXT[u.order[one]];
      if (u.curled[one]) status += '・縮成刺球';
      if (u.slowT[one] > 0) status += '・被減速';
      if (q) status += `（後面還有 ${q} 個指令）`;
    } else if (enemy) status = '敵人';
    else status = `已選 ${ids.length} 隻${counts.size > 1 ? `（${counts.size} 種）` : ''}`;
    const r = hp / maxHp;
    if (counts.size > 1) {
      // 混合兵種：只顯示總數和總血量，各兵種看中間的格子
      this.info.innerHTML =
        `<div class="pf">${this.portraitHtml(kind, 'face')}</div>` +
        `<div class="body"><div class="name">部隊 <small>×${ids.length}</small></div>` +
        `<div class="hpbar"><i style="width:${(r * 100).toFixed(1)}%;background:${hpColor(r)}"></i><span>${Math.ceil(hp)} / ${Math.ceil(maxHp)}</span></div>` +
        `<div class="stats"><span>${counts.size} 種兵</span><span>陣型：${FORMATIONS.find((f) => f.id === this.d.army.form)!.label}</span></div>` +
        `<div class="skill">點中間的格子＝只選那一種<br>Shift＋點＝把那一種取消</div></div>`;
      return;
    }
    this.info.innerHTML =
      `<div class="pf">${this.portraitHtml(kind, 'face')}</div>` +
      `<div class="body"><div class="name">${k.name}${ids.length > 1 ? ` <small>×${counts.get(kind)}</small>` : ''}</div>` +
      `<div class="hpbar"><i style="width:${(r * 100).toFixed(1)}%;background:${hpColor(r)}"></i><span>${Math.ceil(hp)} / ${Math.ceil(maxHp)}</span></div>` +
      `<div class="stats">${stats}</div>` +
      (bonus ? `<div class="bonus">💥 ${bonus}</div>` : '') +
      (k.skill ? `<div class="skill">${skillText(k)}</div>` : '') +
      `<div class="status">${status}</div></div>`;
  }

  private buildingInfo(b: Building): void {
    const k = BUILDING_KINDS[b.kind], w = this.world, r = b.hp / b.maxHp;
    const lines: string[] = [];
    if (b.kind === BK.Tower) lines.push(`<span>⚔️ ${w.towerDamage(b).toFixed(0)} <small>/${k.cd}s</small></span>`, `<span>🏹 射程 ${w.towerRange(b).toFixed(1)}</span>`);
    if (b.kind === BK.Barracks) lines.push(`<span>🐑 綿羊 ${b.units} / ${w.barracksCap(b)}</span>`, '<span>右鍵點地面：集結點</span>');
    if (b.kind === BK.Base) lines.push('<span>被拆掉就輸了！</span>');
    if (b.kind === BK.Wall) lines.push('<span>擋住怪物的路</span>');
    this.info.innerHTML =
      `<div class="pf"><div class="face emoji">${k.icon}</div></div>` +
      `<div class="body"><div class="name">${k.name} <small>${k.levelNames ? `階段 ${'ⅠⅡⅢⅣⅤ'[b.level - 1]}・${k.levelNames[b.level - 1]}` : `Lv.${b.level}`}</small></div>` +
      `<div class="hpbar"><i style="width:${(r * 100).toFixed(1)}%;background:${hpColor(r)}"></i><span>${Math.ceil(b.hp)} / ${b.maxHp}</span></div>` +
      `<div class="stats">${lines.join('')}</div></div>`;
  }

  // ---------------------------------------------------------------- 中：編隊與選取格子
  private updateGroups(): void {
    const sizes = this.d.army.groupSizes();
    const el = $('groups');
    if (!el.childElementCount) {
      // 1…9、0 的順序，和鍵盤一樣
      for (const g of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
        const b = document.createElement('button');
        b.dataset.g = String(g);
        b.title = `第 ${g} 隊：點一下選取、點兩下鏡頭跳過去（Ctrl+${g} 設定）`;
        b.onclick = () => { this.d.army.groupKey(g, false, false); this.d.setBuilding(null); this.update(); };
        el.appendChild(b);
      }
    }
    for (const b of el.children as HTMLCollectionOf<HTMLButtonElement>) {
      const n = sizes[Number(b.dataset.g)];
      b.innerHTML = `${b.dataset.g}${n ? `<small>${n}</small>` : ''}`;
      b.classList.toggle('has', n > 0);
    }
  }

  /** 選取格子：每個兵種一格（頭像、數量、平均血量）。點＝只留這種、Shift＋點＝去掉這種 */
  private selectionGrid(): void {
    const u = this.world.units, army = this.d.army;
    const by = new Map<number, number[]>();
    for (const i of army.sel) { const a = by.get(u.kind[i]); if (a) a.push(i); else by.set(u.kind[i], [i]); }
    const kinds = [...by.keys()].sort((a, b) => a - b);
    const key = kinds.join(',');
    const grid = $('selGrid');
    if (key !== this.gridKey) {
      this.gridKey = key;
      grid.innerHTML = '';
      for (const kind of kinds) {
        const t = document.createElement('div');
        t.className = 'tile';
        t.dataset.kind = String(kind);
        t.title = `${UNIT_KINDS[kind].name}：點＝只選這種，Shift＋點＝取消這種`;
        t.innerHTML = `${this.portraitHtml(kind, 'mini')}<b></b><i></i>`;
        t.onclick = (e) => { army.filterKind(kind, !e.shiftKey); this.update(); };
        grid.appendChild(t);
      }
    }
    for (const t of grid.children as HTMLCollectionOf<HTMLElement>) {
      const ids = by.get(Number(t.dataset.kind)) ?? [];
      let hp = 0, max = 0;
      for (const i of ids) { hp += u.hp[i]; max += u.maxHp[i]; }
      const r = max ? hp / max : 0;
      t.querySelector('b')!.textContent = ids.length > 1 ? String(ids.length) : '';
      const bar = t.querySelector('i')!;
      bar.style.width = `${(r * 100).toFixed(0)}%`;
      bar.style.background = hpColor(r);
    }
  }

  private clearGrid(text: string): void {
    if (this.gridKey === `text:${text}`) return;
    this.gridKey = `text:${text}`;
    $('selGrid').innerHTML = text ? `<div class="hint">${text}</div>` : '';
  }

  // ---------------------------------------------------------------- 右：指令卡
  private unitCmds(): CardCmd[] {
    const army = this.d.army, u = this.world.units;
    return [
      { icon: '⚔️', label: '攻擊移動', key: 'A', tip: '再左鍵點地面：邊走邊打；點敵人＝攻擊', on: () => { army.mode = 'attackMove'; }, active: () => army.mode === 'attackMove' },
      { icon: '🔁', label: '巡邏', key: 'R', tip: '再左鍵點地面：在兩點之間來回攻擊移動', on: () => { army.mode = 'patrol'; }, active: () => army.mode === 'patrol' },
      { icon: '✋', label: '停止', key: 'S', tip: '停下來，清掉排好的指令', on: () => army.command('stop') },
      { icon: '🛡️', label: '堅守', key: 'H', tip: '不移動，只打射程內的敵人', on: () => army.command('hold'),
        active: () => army.sel.every((i) => u.hold[i] && u.order[i] === Ord.Idle) },
      ...FORMATIONS.map((f): CardCmd => ({
        icon: f.icon, label: f.label, tip: `陣型：${f.label}（下次移動時套用）`,
        on: () => { army.form = f.id; }, active: () => army.form === f.id,
      })),
      { icon: '❌', label: '取消選取', key: 'Esc', on: () => army.setSelection([], false) },
    ];
  }

  /** 換了指令卡內容才重建按鈕 */
  private card(key: string, make: () => CardCmd[]): void {
    if (key === this.cardKey) return;
    this.cardKey = key;
    const el = $('cmdCard');
    el.innerHTML = '';
    this.cards = make().map((cmd) => {
      const b = document.createElement('button');
      b.className = 'cmd' + (cmd.debug ? ' debug' : '');
      b.title = cmd.tip ?? cmd.label;
      b.innerHTML = `<span class="ico">${cmd.icon}</span><span class="lbl">${cmd.label}</span>` +
        (cmd.cost !== undefined ? `<span class="cost">💰${cmd.cost}</span>` : '') + (cmd.key ? `<span class="key">${cmd.key}</span>` : '');
      b.onclick = () => { cmd.on(); this.update(); };
      el.appendChild(b);
      return { el: b, cmd };
    });
  }

  /** 每次更新：亮起／變灰 */
  private refreshCard(): void {
    for (const { el, cmd } of this.cards) {
      el.classList.toggle('on', !!cmd.active?.());
      el.disabled = !!cmd.disabled?.();
      if (cmd.cost !== undefined) el.classList.toggle('poor', !this.world.canAfford(cmd.cost));
    }
  }

  /** 換地圖或建築升級後：強制重建 */
  invalidate(): void { this.cardKey = ''; this.gridKey = ''; }
}

function hpColor(r: number): string {
  return r > 0.5 ? '#5ad35a' : r > 0.25 ? '#f0c040' : '#e05050';
}
