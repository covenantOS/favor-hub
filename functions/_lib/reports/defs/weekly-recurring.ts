// Weekly recurring report. Replaces the Monday Gift List (recurring gift payments of $0.01 and up, this month) and the month-to-date
// recurring calculator. One row per recurring payment, the month-to-date total and count Morgan Mason posts on the Admin WhatsApp group,
// and a month-to-date line for each Monday of the month. Posting stays by hand.
import { compare, noTie } from '../tieout';
import type { FilterDef, ReportDef, Row, TieOut } from '../types';
import { addDays, lastDayOfMonth, longDate, money, monthName, num, round2, shorten, weekday } from './b1-shared';

const filters: FilterDef[] = [
  { id: 'month', label: 'Month', type: 'month', def: '' },
  { id: 'through', label: 'Through', type: 'date', def: '' },
];

interface Span {
  month: string;
  from: string;
  to: string;
}
export function spanOf(f: Record<string, string>, today: string): Span {
  const month = f.month || today.slice(0, 7);
  const first = `${month}-01`;
  const end = lastDayOfMonth(month);
  let to = end < today ? end : today;
  if (month > today.slice(0, 7)) to = end;
  if (f.through && f.through >= first && f.through <= end) to = f.through;
  return { month, from: first, to };
}

interface Extra extends Span {
  weeks: Array<{ date: string; total: number; count: number }>;
}

const line = (total: number, count: number) => `Recurring Gift Total: ${money(total)} from ${count.toLocaleString('en-US')} gifts`;

async function tie(ctx: Parameters<NonNullable<ReportDef['tie']>>[0], s: Span, total: number): Promise<TieOut> {
  const k = await ctx.kpi();
  const year = k?.asOf ? Number(k.asOf.slice(0, 4)) : Number(ctx.today.slice(0, 4));
  if (Number(s.month.slice(0, 4)) !== year) return noTie();
  const i = Number(s.month.slice(5)) - 1;
  const kpi = k?.monthlyRecurring[i] ?? null;
  const label = `KPI dashboard, recurring giving for ${monthName(i + 1)}`;
  if (s.to >= lastDayOfMonth(s.month) || s.to >= ctx.today) return compare(label, total, kpi);
  const r = await ctx.sql<{ s: number }>(
    `SELECT COALESCE(SUM(gift_amount), 0) AS s FROM gifts WHERE substr(gift_date, 1, 7) = ?1 AND gift_type = 'RecurringGiftPayment' AND gift_amount > 0`,
    [s.month]
  );
  return compare(`${label} (the whole month)`, round2(num(r[0]?.s)), kpi);
}

const def: ReportDef = {
  id: 'weekly-recurring',
  filters,
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'gift', label: 'Gift', type: 'id' },
    { key: 'partner', label: 'Partner' },
    { key: 'amount', label: 'Amount', type: 'money', total: true },
    { key: 'fund', label: 'Fund' },
    { key: 'setup', label: 'Recurring gift', type: 'id' },
  ],
  pageSize: 400,
  async load(ctx, f) {
    const s = spanOf(f, ctx.today);
    const rows = await ctx.sql<Row>(
      `SELECT substr(g.gift_date, 1, 10) AS date, g.id AS gift,
              COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS partner,
              g.gift_amount AS amount, g.linked_gift_id AS setup,
              (SELECT fu.fund_description FROM funds fu WHERE fu.id = json_extract(g.gift_splits, '$[0].fund_id')) AS fund
         FROM gifts g LEFT JOIN constituents c ON c.id = g.constituent_record_id
        WHERE g.gift_type = 'RecurringGiftPayment' AND g.gift_amount > 0 AND substr(g.gift_date, 1, 10) >= ?1 AND substr(g.gift_date, 1, 10) <= ?2
        ORDER BY g.gift_date, g.id LIMIT 6000`,
      [s.from, s.to]
    );
    const out = rows.map((r) => ({ ...r, partner: shorten(String(r.partner ?? '')), fund: shorten(String(r.fund ?? '')), amount: num(r.amount) }));
    // Month to date at each Monday, the way the monthly sheet lists them.
    const weeks: Extra['weeks'] = [];
    for (let d = s.from; d <= s.to; d = addDays(d, 1)) {
      if (weekday(d) !== 1) continue;
      const upto = out.filter((r) => String(r.date) <= d);
      weeks.push({ date: d, total: round2(upto.reduce((t, r) => t + num(r.amount), 0)), count: upto.length });
    }
    return { rows: out, extra: { ...s, weeks } satisfies Extra, asOf: ctx.today };
  },
  totals: (rows) => ({ amount: round2(rows.reduce((t, r) => t + num(r.amount), 0)) }),
  tiles(rows, _f, extra) {
    const e = extra as Extra;
    const total = round2(rows.reduce((t, r) => t + num(r.amount), 0));
    const last = e.weeks[e.weeks.length - 1];
    return [
      { label: `Recurring, ${monthName(Number(e.month.slice(5)))} through ${longDate(e.to)}`, value: total, kind: 'money' },
      { label: 'Payments', value: rows.length, kind: 'int' },
      { label: 'Average payment', value: rows.length ? round2(total / rows.length) : 0, kind: 'money' },
      { label: last ? `Month to date on ${longDate(last.date)}` : 'No Monday yet', value: last ? last.total : 0, kind: 'money', sub: last ? `${last.count} payments` : '' },
    ];
  },
  tie: (ctx, rows, f, extra) => tie(ctx, (extra as Extra) ?? spanOf(f, ctx.today), round2(rows.reduce((t, r) => t + num(r.amount), 0))),
  post(rows, _f, extra) {
    void extra;
    return line(round2(rows.reduce((t, r) => t + num(r.amount), 0)), rows.length);
  },
  fileTag: (f) => f.month || 'this-month',
};
export default def;
