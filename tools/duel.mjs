// 兩軍對打測試（不開畫面）。用 Vite 直接載入 src/sim 的 TypeScript。
//
//   node tools/duel.mjs tribes                 八個種族兩兩對打（每種兵 6 隻），印出勝率表
//   node tools/duel.mjs tribe 羊 牛               兩族對打的詳細結果
//   node tools/duel.mjs units 長槍兵 狗狗騎兵      兩種兵各 10 隻對打（看剋制關係）
//   node tools/duel.mjs counters               幾組經典剋制（長槍 vs 騎兵、騎兵 vs 弓箭手…）
//   node tools/duel.mjs research               同一族：研究 0 級 vs 4 級
//   node tools/duel.mjs enemy                  骨頭族 ×1／×2／×3 隻數 vs 每個我方種族
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { duel, duelBoth } = await server.ssrLoadModule('/src/sim/duel.ts');
  const { TRIBES, ENEMY_TRIBES, UNIT_KINDS } = await server.ssrLoadModule('/src/sim/data.ts');
  const byName = (n) => { const i = UNIT_KINDS.findIndex((k) => k.name === n); if (i < 0) throw new Error('沒有這個兵種：' + n); return i; };
  const mode = process.argv[2] ?? 'tribes';
  const fmt = (r) => `${r.winner === 'draw' ? '平手' : r.winner + ' 贏'}（${r.time}s，A 剩 ${r.aAlive} 隻 ${Math.round(r.aHp * 100)}%，B 剩 ${r.bAlive} 隻 ${Math.round(r.bHp * 100)}%）`;

  if (mode === 'tribes') {
    const n = TRIBES.length, wins = Array(n).fill(0);
    const pad = (s, w) => s + ' '.repeat(Math.max(0, w - [...s].length * 2));
    console.log('勝率（列＝A 族，欄＝B 族；1＝兩邊位置都贏，0.5＝一勝一敗）');
    console.log(pad('', 12) + TRIBES.map((t) => pad(t.name.replace(/^\S+\s/u, ''), 8)).join(''));
    for (let i = 0; i < n; i++) {
      let row = pad(TRIBES[i].name.replace(/^\S+\s/u, ''), 12);
      for (let j = 0; j < n; j++) {
        if (i === j) { row += pad('—', 8); continue; }
        const { score } = duelBoth({ kinds: TRIBES[i].kinds }, { kinds: TRIBES[j].kinds }, 7 + i * 13 + j);
        wins[i] += score;
        row += pad(score.toFixed(1), 8);
      }
      console.log(row);
    }
    console.log('\n總勝場（滿分 ' + (n - 1) + '）：');
    TRIBES.map((t, i) => [t.name, wins[i]]).sort((a, b) => b[1] - a[1]).forEach(([name, w]) => console.log(`  ${name}  ${w.toFixed(1)}`));
  } else if (mode === 'tribe') {
    // 兩族詳細：誰活下來
    const find = (n) => { const t = TRIBES.find((t) => t.id === n || t.name.includes(n)); if (!t) throw new Error('沒有這個種族：' + n); return t; };
    const ta = find(process.argv[3]), tb = find(process.argv[4]);
    const { detail } = duelBoth({ kinds: ta.kinds }, { kinds: tb.kinds });
    console.log(`${ta.name}（A） vs ${tb.name}（B）`);
    console.log('  第 1 場：' + fmt(detail[0]));
    console.log('  第 2 場（交換位置）：' + fmt(detail[1]));
  } else if (mode === 'units') {
    const a = byName(process.argv[3]), b = byName(process.argv[4]), cnt = Number(process.argv[5] ?? 10);
    console.log(`${UNIT_KINDS[a].name} ×${cnt}（A） vs ${UNIT_KINDS[b].name} ×${cnt}（B）`);
    const { detail } = duelBoth({ kinds: [a], count: cnt }, { kinds: [b], count: cnt });
    console.log('  第 1 場：' + fmt(detail[0]));
    console.log('  第 2 場（交換位置，A/B 對調）：' + fmt(detail[1]));
  } else if (mode === 'counters') {
    const pairs = [
      ['長槍兵', '狗狗騎兵'], ['狗狗騎兵', '弓箭手'], ['弓箭手', '長槍兵'],
      ['弩兵', '巨槌兵', 10, 6], ['槌頭兵', '巨槌兵', 10, 6], ['魚矛兵', '狗狗騎兵'],
      ['刺球衛', '輕型斧頭兵'], ['輕型斧頭兵', '輕型彎刀手'], ['輕型快爪手', '輕型長弓兵'],
      ['尖刺弩砲', '投石車'], ['重型衝撞車', '投石車'],
    ];
    // 第 3、4 個數字：雙方數量（沒寫就 10 對 10）。重型兵比較貴，用 10 對 6 比較公平
    for (const [x, y, na = 10, nb = 10] of pairs) {
      const a = byName(x.startsWith('魚矛') ? '輕型魚矛兵' : x), b = byName(y);
      const { score, detail } = duelBoth({ kinds: [a], count: na }, { kinds: [b], count: nb });
      const hp = ((detail[0].aHp + detail[1].bHp) / 2 * 100).toFixed(0), hq = ((detail[0].bHp + detail[1].aHp) / 2 * 100).toFixed(0);
      console.log(`${(score === 1 ? '✅' : score === 0 ? '❌' : '➖')} ${UNIT_KINDS[a].name}×${na} vs ${UNIT_KINDS[b].name}×${nb}：勝率 ${score}，剩血 ${hp}% : ${hq}%`);
    }
  } else if (mode === 'enemy') {
    // 敵人種族（骨頭族）× 數量倍數 vs 每個我方種族：看幾倍的骨頭才打得贏
    for (const e of ENEMY_TRIBES) for (const t of TRIBES) {
      const out = [];
      for (const mul of [1, 2, 3]) {
        const r = duel({ kinds: t.kinds }, { kinds: e.kinds, count: 0, mul }, 3);
        out.push(`×${mul}：${r.winner === 'A' ? '我方贏' : r.winner === 'B' ? '敵人贏' : '平手'}`);
      }
      console.log(`${t.name} vs ${e.name}　${out.join('　')}`);
    }
  } else if (mode === 'research') {
    for (const t of TRIBES) {
      const full = { meleeAtk: 4, rangedAtk: 4, meleeDef: 4, rangedDef: 4 };
      const { score, detail } = duelBoth({ kinds: t.kinds, research: full }, { kinds: t.kinds });
      console.log(`${t.name}：研究 4 級 vs 0 級 → 勝率 ${score}，剩血 ${Math.round((detail[0].aHp + detail[1].bHp) / 2 * 100)}%`);
    }
  } else {
    console.log('用法：node tools/duel.mjs tribes | units <A> <B> [數量] | counters | research');
  }
} finally {
  await server.close();
}
