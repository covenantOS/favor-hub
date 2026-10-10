// Deposit highlights for RDDs. Replaces the deposit email's highlights: for one deposit day (Monday, Wednesday or Friday), the gifts the
// RDDs read about, which are gifts of $1,000 and up and RDD portfolio gifts, with the same follow-up text as the Daily Revenue Report.
// Check and letter images stay in Blackbaud. No email goes out from here.
import { compare } from '../tieout';
import type { FilterDef, ReportDef, Row } from '../types';
import { addDays, buildPost, loadGrid, longDate, num, round2, shorten, weekday, type GridGift } from './b1-shared';

const filters: FilterDef[] = [
  { id: 'day', label: 'Deposit day', type: 'date', def: '' },
  { id: 'pay', label: 'Gifts', type: 'seg', def: 'deposit', options: [['deposit', 'Checks and cash'], ['all', 'All payments']] },
];

/** The latest Monday, Wednesday or Friday on or before today. */
export function lastDepositDay(today: string): string {
  let d = today;
  for (let i = 0; i < 7; i++, d = addDays(d, -1)) if ([1, 3, 5].includes(weekday(d))) return d;
  return today;
}

const inDeposit = (g: GridGift, pay: string) => pay === 'all' || g.method === 'PersonalCheck' || g.method === 'Cash';

interface Extra {
  day: string;
  pay: string;
  total: number;
  count: number;
}

const def: ReportDef = {
  id: 'deposit',
  filters,
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'gift', label: 'Gift', type: 'id' },
    { key: 'batch', label: 'Batch', type: 'id' },
    { key: 'partner', label: 'Partner' },
    { key: 'amount', label: 'Amount', type: 'money', total: true },
    { key: 'fund', label: 'Fund' },
    { key: 'method', label: 'Payment' },
    { key: 'follow', label: 'Follow-up' },
    { key: 'why', label: 'Highlighted as' },
  ],
  pageSize: 200,
  async load(ctx, f) {
    const day = f.day || lastDepositDay(ctx.today);
    const grid = (await loadGrid(ctx, day, day)).filter((g) => inDeposit(g, f.pay));
    const post = buildPost(grid, 12);
    const byId = new Map(post.gifts.map((p) => [p.giftID, p]));
    const picked = grid.filter((g) => {
      const p = byId.get(g.lookup);
      return g.rows[0].fullAmount >= 1000 || (p && p.block === 'RDD Portfolio Giving');
    });
    const batches = picked.length
      ? await ctx.sql<{ id: string; b: string | null }>(`SELECT id AS id, json_extract(raw_json, '$.batch_number') AS b FROM gifts WHERE id IN (SELECT value FROM json_each(?1))`, [JSON.stringify(picked.map((g) => g.id))])
      : [];
    const batchOf = new Map(batches.map((b) => [String(b.id), b.b || '']));
    const rows: Row[] = picked.map((g) => {
      const p = byId.get(g.lookup)!;
      const hard = g.rows[0];
      const soft = [...new Set(g.rows.filter((r) => r.softCredit).map((r) => r.softCredit))];
      const funds = [...new Set(g.rows.filter((r) => r.partner === hard.partner).map((r) => r.fund).filter(Boolean))];
      return {
        date: g.date,
        gift: g.lookup,
        batch: batchOf.get(g.id) || '',
        partner: shorten(hard.partner + (soft.length ? ` | ${soft.join(' & ')}` : '')),
        amount: hard.fullAmount,
        fund: shorten(funds.join(' & ')),
        method: g.method === 'PersonalCheck' ? 'Check' : g.method === 'CreditCard' ? 'Card' : g.method === 'DirectDebit' ? 'Bank draft' : g.method,
        follow: p.director,
        why: [hard.fullAmount >= 1000 ? '$1,000 and up' : '', p.block === 'RDD Portfolio Giving' ? 'RDD portfolio' : '', p.newPartner ? 'New partner' : ''].filter(Boolean).join(', '),
      };
    });
    return { rows, extra: { day, pay: f.pay, total: post.total, count: post.count } satisfies Extra, asOf: ctx.today };
  },
  totals: (rows) => ({ amount: round2(rows.reduce((t, r) => t + num(r.amount), 0)) }),
  tiles(rows, _f, extra) {
    const e = extra as Extra;
    return [
      { label: 'Deposit day', value: longDate(e.day), kind: 'text' },
      { label: 'Gifts that day', value: e.count, kind: 'int', sub: e.pay === 'all' ? 'All payments' : 'Checks and cash' },
      { label: 'Received', value: e.total, kind: 'money' },
      { label: 'Highlighted gifts', value: rows.length, kind: 'int' },
      { label: 'Highlighted dollars', value: round2(rows.reduce((t, r) => t + num(r.amount), 0)), kind: 'money' },
    ];
  },
  async tie(ctx, rows, f, extra) {
    const e = extra as Extra | undefined;
    const day = e?.day || f.day || lastDepositDay(ctx.today);
    const pay = f.pay === 'all' ? '' : `AND gift_payment_method IN ('PersonalCheck', 'Cash')`;
    const r = await ctx.sql<{ s: number }>(
      `SELECT COALESCE(SUM(gift_amount), 0) AS s FROM gifts WHERE substr(gift_date, 1, 10) = ?1 AND gift_amount >= 1000 AND gift_type <> 'RecurringGift' ${pay}`,
      [day]
    );
    const mine = round2(rows.filter((x) => num(x.amount) >= 1000).reduce((t, x) => t + num(x.amount), 0));
    return compare('Gifts of $1,000 and up that day, counted from the gift list', mine, round2(num(r[0]?.s)));
  },
  note: 'RDD portfolio gifts of any size are included.',
  fileTag: (f) => f.day || 'last-deposit-day',
};
export default def;
