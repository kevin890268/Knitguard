import type { CardCmd } from './hud';

/** 第二層分類（例如建造 → 防禦／經濟…）：點下去，上面再多一排它的功能 */
export interface FuncGroup {
  id: string;
  icon: string;
  label: string;
  items: () => CardCmd[];
}

/** 功能表的一個分類：點下去，上面再多一排這個分類的功能（或第二層分類） */
export interface FuncCategory {
  id: string;
  icon: string;
  label: string;
  items?: () => CardCmd[];
  /** 有第二層分類時：上面一排是分類，再上面一排是選到的分類的功能 */
  groups?: FuncGroup[];
}

const $ = (id: string) => document.getElementById(id)!;

/**
 * 資訊列上面的「功能表」：一小排分類按鈕（建造、部隊、市鎮中心、系統），
 * 點一個分類，上面再多一小排，顯示這個分類的功能；再點一次同一個分類就收起來。
 * 建造有第二層：防禦、經濟、生活…，點了再往上多一排建築。
 */
export class FuncBar {
  open: string | null = null;
  /** 每個分類目前打開的第二層（記住上次選的） */
  group: Record<string, string> = {};
  private items: { el: HTMLButtonElement; cmd: CardCmd }[] = [];
  private openKey = '';

  constructor(private readonly cats: FuncCategory[], private readonly getMoney: () => (cost: number) => boolean) {
    const bar = $('funcBar');
    for (const c of cats) {
      const b = document.createElement('button');
      b.dataset.id = c.id;
      b.innerHTML = `<span class="ico">${c.icon}</span>${c.label}`;
      b.onclick = () => this.toggle(c.id);
      bar.appendChild(b);
    }
    for (const id of ['funcBar', 'funcSub', 'funcSub2']) $(id).addEventListener('contextmenu', (e) => e.preventDefault());
  }

  toggle(id: string | null): void {
    this.open = this.open === id ? null : id;
    this.update();
  }

  /** 打開某個分類的某個第二層（例如按建造快捷鍵時跳到那棟建築所在的分類） */
  show(cat: string, group?: string): void {
    this.open = cat;
    if (group) this.group[cat] = group;
    this.update();
  }

  /** 每 0.2 秒：重建（內容換了才重建）＋更新亮起／變灰 */
  update(): void {
    for (const b of $('funcBar').children as HTMLCollectionOf<HTMLElement>) b.classList.toggle('on', b.dataset.id === this.open);
    const sub = $('funcSub'), sub2 = $('funcSub2');
    const cat = this.cats.find((c) => c.id === this.open);
    sub.classList.toggle('open', !!cat);
    const grp = cat?.groups ? cat.groups.find((g) => g.id === this.group[cat.id]) ?? cat.groups[0] : undefined;
    sub2.classList.toggle('open', !!grp);
    if (!cat) { this.openKey = ''; return; }
    const cmds = (grp ? grp.items() : cat.items?.()) ?? [];
    const key = cat.id + '/' + (grp?.id ?? '') + ':' + cmds.map((c) => c.label).join('|');
    if (key !== this.openKey) {
      this.openKey = key;
      // 有第二層：下面一排放分類，上面一排放功能；沒有：功能放下面一排
      const itemRow = grp ? sub2 : sub;
      sub.innerHTML = '';
      sub2.innerHTML = '';
      if (cat.groups) {
        for (const g of cat.groups) {
          const b = document.createElement('button');
          b.className = 'grp' + (g === grp ? ' on' : '');
          b.innerHTML = `<span class="ico">${g.icon}</span>${g.label}`;
          b.onclick = () => { this.group[cat.id] = g.id; this.update(); };
          sub.appendChild(b);
        }
      }
      this.items = cmds.map((cmd) => {
        const b = document.createElement('button');
        b.className = 'fn' + (cmd.debug ? ' debug' : '');
        b.title = cmd.tip ?? cmd.label;
        b.innerHTML = `<span class="ico">${cmd.icon}</span>${cmd.label}` +
          (cmd.cost !== undefined ? `<span class="cost">💰${cmd.cost}</span>` : '') + (cmd.key ? `<span class="key">${cmd.key}</span>` : '');
        b.onclick = () => { cmd.on(); this.update(); };
        itemRow.appendChild(b);
        return { el: b, cmd };
      });
    }
    const can = this.getMoney();
    for (const { el, cmd } of this.items) {
      el.classList.toggle('on', !!cmd.active?.());
      el.disabled = !!cmd.disabled?.();
      if (cmd.cost !== undefined) el.classList.toggle('poor', !can(cmd.cost));
    }
  }
}
