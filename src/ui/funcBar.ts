import type { CardCmd } from './hud';

/** 功能表的一個分類：點下去，上面再多一排這個分類的功能 */
export interface FuncCategory {
  id: string;
  icon: string;
  label: string;
  items: () => CardCmd[];
}

const $ = (id: string) => document.getElementById(id)!;

/**
 * 資訊列上面的「功能表」：一小排分類按鈕（建造、部隊、市鎮中心、系統），
 * 點一個分類，上面再多一小排，顯示這個分類的功能；再點一次同一個分類就收起來。
 */
export class FuncBar {
  open: string | null = null;
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
    bar.addEventListener('contextmenu', (e) => e.preventDefault());
    $('funcSub').addEventListener('contextmenu', (e) => e.preventDefault());
  }

  toggle(id: string | null): void {
    this.open = this.open === id ? null : id;
    this.update();
  }

  /** 每 0.2 秒：重建（分類換了才重建）＋更新亮起／變灰 */
  update(): void {
    for (const b of $('funcBar').children as HTMLCollectionOf<HTMLElement>) b.classList.toggle('on', b.dataset.id === this.open);
    const sub = $('funcSub');
    const cat = this.cats.find((c) => c.id === this.open);
    sub.classList.toggle('open', !!cat);
    if (!cat) { this.openKey = ''; return; }
    const cmds = cat.items();
    const key = cat.id + ':' + cmds.map((c) => c.label).join('|');
    if (key !== this.openKey) {
      this.openKey = key;
      sub.innerHTML = '';
      this.items = cmds.map((cmd) => {
        const b = document.createElement('button');
        b.className = 'fn' + (cmd.debug ? ' debug' : '');
        b.title = cmd.tip ?? cmd.label;
        b.innerHTML = `<span class="ico">${cmd.icon}</span>${cmd.label}` +
          (cmd.cost !== undefined ? `<span class="cost">💰${cmd.cost}</span>` : '') + (cmd.key ? `<span class="key">${cmd.key}</span>` : '');
        b.onclick = () => { cmd.on(); this.update(); };
        sub.appendChild(b);
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
