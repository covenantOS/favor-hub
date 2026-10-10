// Month to month. Replaces the Month to Month sheet Morgan Mason updates on Mondays: one row per month of the year with the U.S. income,
// gifts and recurring giving, the change from the month before and the same month a year earlier. Built from the same gift rule as
// 2026 YTD Income (every gift except Recurring Gift setups), so the months add up to the YTD figure.
import { compare, noTie } from '../tieout';
import type { FilterDef, ReportDef, Row } from '../types';
import { monthName, num, round2 } from './b1-shared';

const filters: FilterDef[] = [{ id: 'year', label: 'Year', type: 'select', def: '2026', options: [['2026', '2026'], ['2025', '2025']] }];

interface Agg {
  m: string;
  s: number;
  n: number;
  rs: number;
  rn: number;
}

const ratio = (a: number, b: number): number | null => (b ? (a - b) / b : null);

const def: ReportDef = {
  id: 'month-to-month',
  filters,
  columns: [
    { key: 'month', label: 'Month' },
    { key: 'income', label: 'U.S. income', type: 'money', total: true },
    { key: 'gifts', label: 'Gifts', type: 'int', total: true },
    { key: 'recurring', label: 'Recurring', type: 'money', total: true },
    { key: 'recurringGifts', label: 'Recurring payments', type: 'int', total: true },
    { key: 'other', label: 'All other', type: 'money', total: true },
    { key: 'avg', label: 'Average gift', type: 'money' },
    { key: 'change', label: 'Change from last month', type: 'money' },
    { key: 'changePct', label: 'Change', type: 'pct' },
    { key: 'lastYear', label: 'Same month last year', type: 'money' },
    { key: 'yoyPct', label: 'Year on year', type: 'pct' },
  ],
  pageSize: 24,
  async load(ctx, f) {
    const year = Number(f.year || ctx.today.slice(0, 4));
    const agg = await ctx.sql<Agg>(
      `SELECT substr(gift_date, 1, 7) AS m, SUM(gift_amount) AS s, COUNT(*) AS n,
              SUM(CASE WHEN gift_type = 'RecurringGiftPayment' THEN gift_amount ELSE 0 END) AS rs,
              SUM(CASE WHEN gift_type = 'RecurringGiftPayment' THEN 1 ELSE 0 END) AS rn
         FROM gifts WHERE substr(gift_date, 1, 7) >= ?1 AND substr(gift_date, 1, 7) <= ?2 AND gift_amount > 0 AND gift_type <> 'RecurringGift' GROUP BY 1`,
      [`${year - 1}-01`, `${year}-12`]
    );
    const by = new Map(agg.map((r) => [String(r.m), r]));
    const nowYm = ctx.today.slice(0, 7);
    const rows: Row[] = [];
    let prev: number | null = null;
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      if (ym > nowYm) break;
      const r = by.get(ym);
      const ly = by.get(`${year - 1}-${String(m).padStart(2, '0')}`);
      const income = round2(num(r?.s));
      const gifts = num(r?.n);
      const recurring = round2(num(r?.rs));
      rows.push({
        month: monthName(m),
        ym,
        income,
        gifts,
        recurring,
        recurringGifts: num(r?.rn),
        other: round2(income - recurring),
        avg: gifts ? round2(income / gifts) : null,
        change: prev === null ? null : round2(income - prev),
        changePct: prev === null ? null : ratio(income, prev),
        lastYear: ly ? round2(num(ly.s)) : null,
        yoyPct: ly ? ratio(income, num(ly.s)) : null,
      });
      prev = income;
    }
    return { rows, extra: { year }, asOf: ctx.today };
  },
  totals(rows) {
    const t = (k: string) => round2(rows.reduce((s, r) => s + num(r[k]), 0));
    return { income: t('income'), gifts: rows.reduce((s, r) => s + num(r.gifts), 0), recurring: t('recurring'), recurringGifts: rows.reduce((s, r) => s + num(r.recurringGifts), 0), other: t('other') };
  },
  tiles(rows) {
    const total = round2(rows.reduce((s, r) => s + num(r.income), 0));
    const best = [...rows].sort((a, b) => num(b.income) - num(a.income))[0];
    const complete = rows.length > 1 ? rows.slice(0, -1) : rows;
    return [
      { label: 'U.S. income, year to date', value: total, kind: 'money' },
      { label: 'Average full month', value: complete.length ? round2(complete.reduce((s, r) => s + num(r.income), 0) / complete.length) : 0, kind: 'money', sub: rows.length > 1 ? 'Months before the current one' : '' },
      { label: 'Largest month', value: best ? num(best.income) : 0, kind: 'money', sub: best ? String(best.month) : '' },
      { label: 'Gifts', value: rows.reduce((s, r) => s + num(r.gifts), 0), kind: 'int' },
    ];
  },
  async tie(ctx, rows, f) {
    const k = await ctx.kpi();
    const year = f.year || ctx.today.slice(0, 4);
    const kyear = k?.asOf ? k.asOf.slice(0, 4) : ctx.today.slice(0, 4);
    if (year !== kyear) return noTie();
    const total = round2(rows.reduce((s, r) => s + num(r.income), 0));
    const months = k?.monthlyGiving || [];
    const bad = rows.filter((r, i) => months[i] !== null && months[i] !== undefined && Math.abs(num(r.income) - Number(months[i])) >= 0.005).map((r) => r.month);
    const t = compare('KPI dashboard, Executive, YTD revenue (the months added up)', total, k?.ytdRevenue ?? null);
    return bad.length ? { ...t, status: 'differs', diff: t.diff || 0.01, note: `Months that differ from the KPI dashboard: ${bad.join(', ')}.` } : t;
  },
  note: 'Every gift except Recurring Gift setups.',
  fileTag: (f) => f.year || 'year',
};
export default def;
