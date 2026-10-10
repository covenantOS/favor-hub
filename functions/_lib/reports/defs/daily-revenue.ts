// Daily Revenue Report. Replaces query 1148 (Daily Revenue Reporter 4.1) and the 4.2 browser script. One row per gift for the
// dates chosen, and the post Morgan Mason copies into WhatsApp, built line for line from the script. Posting stays by hand.
import { compare, noTie } from '../tieout';
import type { FilterDef, ReportDef, Row, TieOut } from '../types';
import { buildPost, easternHour, lastBusinessRange, lastDayOfMonth, loadGrid, longDate, num, round2, shorten, type GridGift, type PostResult } from './b1-shared';

const filters: FilterDef[] = [
  { id: 'mode', label: 'Dates', type: 'seg', def: 'last', options: [['last', 'Last business day'], ['day', 'One day'], ['range', 'A range']] },
  { id: 'day', label: 'Day', type: 'date', def: '', showWhen: { id: 'mode', is: 'day' } },
  { id: 'from', label: 'From', type: 'date', def: '', showWhen: { id: 'mode', is: 'range' } },
  { id: 'to', label: 'To', type: 'date', def: '', showWhen: { id: 'mode', is: 'range' } },
];

export function rangeOf(f: Record<string, string>, today: string): { from: string; to: string } {
  const last = lastBusinessRange(today);
  if (f.mode === 'day' && f.day) return { from: f.day, to: f.day };
  if (f.mode === 'range' && f.from) {
    const to = f.to && f.to >= f.from ? f.to : f.from;
    return { from: f.from, to };
  }
  return last;
}

interface Extra {
  post: PostResult;
  from: string;
  to: string;
  hour: number;
  grid: GridGift[];
}

const flagsOf = (amount: number, p: { newPartner: boolean; block: string; consistent: boolean; recurring: boolean }) =>
  [amount >= 1000 ? '$1,000 and up' : '', p.newPartner ? 'New partner' : '', p.block === 'RDD Portfolio Giving' ? 'RDD portfolio' : '', p.block === 'Influenced Giving' ? 'PC or Grant' : '', p.consistent ? 'Consistent' : '', p.recurring ? 'Recurring' : '']
    .filter(Boolean)
    .join(', ');

/** The KPI dashboard's figure for the months this range touches, against the mirror, so any dates can be checked. */
async function tie(ctx: Parameters<NonNullable<ReportDef['tie']>>[0], total: number, from: string, to: string): Promise<TieOut> {
  const k = await ctx.kpi();
  const year = k?.asOf ? Number(k.asOf.slice(0, 4)) : Number(ctx.today.slice(0, 4));
  if (Number(from.slice(0, 4)) !== year || Number(to.slice(0, 4)) !== year) return noTie();
  const m1 = Number(from.slice(5, 7));
  const m2 = Number(to.slice(5, 7));
  const kpiSum = (k?.monthlyGiving || []).slice(m1 - 1, m2).reduce<number | null>((s, v) => (s === null || v === null ? null : s + v), 0);
  const covers = from.slice(8) === '01' && (to === lastDayOfMonth(to.slice(0, 7)) || to >= ctx.today);
  const names = m1 === m2 ? `month ${from.slice(0, 7)}` : `months ${from.slice(0, 7)} to ${to.slice(0, 7)}`;
  if (covers) return compare(`KPI dashboard, Executive, revenue for ${names}`, total, kpiSum);
  const r = await ctx.sql<{ s: number }>(
    `SELECT COALESCE(SUM(gift_amount), 0) AS s FROM gifts WHERE substr(gift_date, 1, 7) >= ?1 AND substr(gift_date, 1, 7) <= ?2 AND gift_amount > 0 AND gift_type <> 'RecurringGift'`,
    [from.slice(0, 7), to.slice(0, 7)]
  );
  return compare(`KPI dashboard, Executive, revenue for ${names} (the month these dates fall in)`, round2(num(r[0]?.s)), kpiSum);
}

const def: ReportDef = {
  id: 'daily-revenue',
  filters,
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'gift', label: 'Gift', type: 'id' },
    { key: 'partner', label: 'Partner' },
    { key: 'amount', label: 'Amount', type: 'money', total: true },
    { key: 'fund', label: 'Fund' },
    { key: 'appeal', label: 'Appeal' },
    { key: 'block', label: 'Post block' },
    { key: 'kind', label: 'Type' },
    { key: 'follow', label: 'Follow-up' },
    { key: 'flags', label: 'Highlighted as' },
  ],
  pageSize: 300,
  async load(ctx, f) {
    const { from, to } = rangeOf(f, ctx.today);
    const grid = await loadGrid(ctx, from, to);
    const hour = easternHour();
    const post = buildPost(grid, hour);
    const byId = new Map(post.gifts.map((p) => [p.giftID, p]));
    const rows: Row[] = grid.map((g) => {
      const p = byId.get(g.lookup);
      const hard = g.rows[0];
      const soft = [...new Set(g.rows.filter((r) => r.softCredit).map((r) => r.softCredit))];
      const funds = [...new Set(g.rows.filter((r) => !r.softCredit).map((r) => r.fund).filter(Boolean))];
      const appeals = [...new Set(g.rows.filter((r) => !r.softCredit).map((r) => r.appealID).filter(Boolean))];
      const amount = hard.fullAmount;
      return {
        date: g.date,
        gift: g.lookup,
        partner: shorten(hard.partner + (soft.length ? ` | ${soft.join(' & ')}` : '')),
        amount,
        fund: shorten(funds.join(' & ')),
        appeal: appeals.join(' & '),
        block: p ? p.block : '',
        kind: g.type === 'RecurringGiftPayment' ? 'Recurring' : 'One-time',
        follow: p ? p.director : '',
        flags: p ? flagsOf(amount, p) : '',
      };
    });
    return { rows, extra: { post, from, to, hour, grid } satisfies Extra, asOf: ctx.today };
  },
  totals: (rows) => ({ amount: round2(rows.reduce((s, r) => s + num(r.amount), 0)) }),
  tiles(rows, _f, extra) {
    const e = extra as Extra;
    return [
      { label: 'Total received', value: e.post.total, kind: 'money', sub: e.from ? (e.from === e.to ? longDate(e.from) : `${longDate(e.from)} - ${longDate(e.to)}`) : 'No gifts in these dates' },
      { label: 'Gifts', value: e.post.count, kind: 'int' },
      { label: 'Recurring (in total)', value: e.post.recurring, kind: 'money' },
      { label: 'Consistent (in total)', value: e.post.consistent, kind: 'money' },
      { label: 'Gifts of $1,000 and up', value: e.post.highlights.length, kind: 'int' },
    ];
  },
  async tie(ctx, rows, f, extra) {
    const e = extra as Extra | undefined;
    const { from, to } = e ? { from: e.from, to: e.to } : rangeOf(f, ctx.today);
    const total = round2(rows.reduce((s, r) => s + num(r.amount), 0));
    return tie(ctx, total, from, to);
  },
  post(_rows, _f, extra) {
    return (extra as Extra).post.text;
  },
  note: 'Consistent Giving counts the gifts on the Consistent tag list the sync worker keeps.',
  fileTag: (f) => (f.mode === 'day' && f.day ? f.day : f.mode === 'range' && f.from ? `${f.from}-${f.to || f.from}` : 'last-business-day'),
};
export default def;
