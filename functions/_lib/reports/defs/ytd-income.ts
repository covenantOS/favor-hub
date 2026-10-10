// 2026 YTD Income. Replaces query 1218 (YTD Daily Totals) and the Executive Drive sheet: one row per day, the U.S. total of every
// gift except Recurring Gift setups, and the Africa income Morgan Mason types in once a month from the QuickBooks books.
import { compare, noTie } from '../tieout';
import type { FilterDef, ReportDef, Row } from '../types';
import { addDays, num, round2 } from './b1-shared';

const filters: FilterDef[] = [{ id: 'year', label: 'Year', type: 'select', def: '2026', options: [['2026', '2026'], ['2025', '2025']] }];

interface Extra {
  year: string;
  through: string;
}

const def: ReportDef = {
  id: 'ytd-income',
  filters,
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'us', label: 'U.S.', type: 'money', total: true },
    { key: 'gifts', label: 'Gifts', type: 'int', total: true },
    { key: 'africa', label: 'Africa', type: 'cell', total: true },
  ],
  pageSize: 400,
  editable: { keyOf: (r: Row) => String(r.date), columns: ['africa'] },
  async load(ctx, f) {
    const year = f.year || ctx.today.slice(0, 4);
    const last = `${year}-12-31`;
    const through = last < ctx.today ? last : ctx.today;
    const days = await ctx.sql<{ d: string; s: number; n: number }>(
      `SELECT substr(gift_date, 1, 10) AS d, SUM(gift_amount) AS s, COUNT(*) AS n FROM gifts
        WHERE substr(gift_date, 1, 10) >= ?1 AND substr(gift_date, 1, 10) <= ?2 AND gift_amount > 0 AND gift_type <> 'RecurringGift' GROUP BY 1`,
      [`${year}-01-01`, through]
    );
    const by = new Map(days.map((r) => [String(r.d), r]));
    const rows: Row[] = [];
    for (let d = `${year}-01-01`; d <= through; d = addDays(d, 1)) {
      const r = by.get(d);
      const a = ctx.edits[`${d}|africa`];
      rows.push({ date: d, us: round2(num(r?.s)), gifts: num(r?.n), africa: a === undefined || a === '' ? null : Number(a) });
    }
    return { rows, extra: { year, through } satisfies Extra, asOf: ctx.today };
  },
  totals: (rows) => ({
    us: round2(rows.reduce((t, r) => t + num(r.us), 0)),
    gifts: rows.reduce((t, r) => t + num(r.gifts), 0),
    africa: round2(rows.reduce((t, r) => t + num(r.africa), 0)),
  }),
  tiles(rows) {
    const us = round2(rows.reduce((t, r) => t + num(r.us), 0));
    const af = round2(rows.reduce((t, r) => t + num(r.africa), 0));
    return [
      { label: 'U.S. income', value: us, kind: 'money' },
      { label: 'Africa income', value: af, kind: 'money', sub: 'Typed in from the Uganda books' },
      { label: 'Favor income', value: round2(us + af), kind: 'money' },
      { label: 'Gifts', value: rows.reduce((t, r) => t + num(r.gifts), 0), kind: 'int' },
    ];
  },
  async tie(ctx, rows, f) {
    const k = await ctx.kpi();
    const year = f.year || ctx.today.slice(0, 4);
    const kyear = k?.asOf ? k.asOf.slice(0, 4) : ctx.today.slice(0, 4);
    if (year !== kyear) return noTie();
    return compare('KPI dashboard, Executive, YTD revenue (U.S. income)', round2(rows.reduce((t, r) => t + num(r.us), 0)), k?.ytdRevenue ?? null);
  },
  note: 'Africa income is typed in once a month, on the last day of the month.',
  fileTag: (f) => f.year || 'ytd',
};
export default def;
