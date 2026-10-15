// Recurring gifts: every schedule in the D1 copy of Blackbaud (table recurring_schedules, filled by the sync worker) with how it is
// paid, its last twelve months of payments, any declined payment since July and who holds the partner. Read only: no Blackbaud calls.
//
// Mirror rules that shape the SQL: the endpoint refuses any statement whose text contains insert, update, replace, upsert, delete,
// drop, alter or create anywhere (readOnly checks it), and a list of ids goes in as one JSON parameter read with json_each(?).
import { readOnly } from '../work/repo';
import type { Q } from '../work/partner';
import { addDays } from '../actions/completion';
import { FACTS_SQL } from '../work/cadence';
import { HOLDERS_SQL, cleanReason, methodWord } from '../work/declines';

export const FREQUENCY_LABEL: Record<string, string> = { WEEKLY: 'weekly', MONTHLY: 'monthly', QUARTERLY: 'quarterly', ANNUALLY: 'yearly' };
export const EDITABLE_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'ANNUALLY', 'WEEKLY'] as const;

export const SCHEDULES_SQL = readOnly(`SELECT r.gift_id AS id, r.constituent_record_id AS cid, r.gift_status AS status, r.amount AS amount, r.frequency AS freq,
       substr(r.start_date, 1, 10) AS start, substr(r.end_date, 1, 10) AS ends, substr(r.next_transaction_date, 1, 10) AS nxt,
       substr(r.status_date, 1, 10) AS sdate, r.synced_at AS synced, g.gift_payment_method AS pm, g.gift_splits AS splits
  FROM recurring_schedules r LEFT JOIN gifts g ON g.id = r.gift_id`);

/** Paid payments by schedule and month for the last twelve months, with the last paid day in that month. */
export const MONTHLY_SQL = readOnly(`SELECT linked_gift_id AS sched, substr(gift_date, 1, 7) AS m, COUNT(*) AS n, SUM(gift_amount) AS total, MAX(substr(gift_date, 1, 10)) AS last_ok
  FROM gifts WHERE gift_type = 'RecurringGiftPayment' AND gift_amount > 0 AND gift_date >= ?1 GROUP BY 1, 2`);

/** Every schedule's first and last paid day and how many payments it has had. */
export const LIFETIME_SQL = readOnly(`SELECT linked_gift_id AS sched, COUNT(*) AS n, MIN(substr(gift_date, 1, 10)) AS first_ok, MAX(substr(gift_date, 1, 10)) AS last_ok
  FROM gifts WHERE gift_type = 'RecurringGiftPayment' AND gift_amount > 0 GROUP BY 1`);

/** Declined charges on a schedule: a $0 payment whose reference holds the processor's reason. */
export const REJECTS_SQL = readOnly(`SELECT linked_gift_id AS sched, id AS id, substr(gift_date, 1, 10) AS d,
       COALESCE(json_extract(raw_json, '$.reference'), gift_comments, '') AS ref
  FROM gifts WHERE gift_type = 'RecurringGiftPayment' AND gift_amount = 0 AND gift_date >= ?1
   AND upper(COALESCE(json_extract(raw_json, '$.reference'), gift_comments, '')) LIKE '%REJECT%'`);

export const FUNDS_BY_ID_SQL = readOnly('SELECT id AS id, fund_description AS name FROM funds WHERE id IN (SELECT value FROM json_each(?1))');

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown): string => (v == null ? '' : String(v));
const chunkOf = <T>(list: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

/** "Since July": the first of July of this year, or of last year before July. */
export function declineSince(today: string): string {
  const y = Number(today.slice(0, 4));
  return `${today.slice(5, 7) >= '07' ? y : y - 1}-07-01`;
}

export const WINDOWS = { stoppedDays: 90, paidRecentDays: 180, paidDays: 30, noPaymentDays: 45 } as const;

export interface RawSchedule { id: string; cid: string; status: string; amount: number; freq: string; start: string; ends: string; nxt: string; sdate: string; synced: string; pm: string; splits: unknown }
export interface MonthlyPaid { sched: string; m: string; n: number; total: number; last_ok: string }
export interface Lifetime { sched: string; n: number; first_ok: string; last_ok: string }
export interface Reject { sched: string; id: string; d: string; ref: string }

export interface ScheduleRow {
  id: string;
  cid: string;
  name: string;
  place: string;
  status: string;
  amount: number;
  frequency: string;
  frequencyLabel: string;
  method: string;
  fund: string;
  start: string;
  end: string;
  next: string;
  statusDate: string;
  annual: number;
  /** Twelve flags, oldest month first: did a payment go through that month. */
  months: boolean[];
  paid12: number;
  paid: number;
  lastPaid: string;
  holder: string;
  synced: string;
  /** The newest declined charge since July, and whether a payment went through after it. */
  declinedOn: string;
  declineReason: string;
  declineRecovered: boolean;
  declines: number;
  flags: { declined: boolean; pastDue: boolean; pastEnd: boolean; stopped90: boolean; twoYears: boolean; noPayment: boolean };
  daysLate: number;
}

export interface RecurringStats {
  active: number;
  card: number;
  bank: number;
  scheduledEach: number;
  payments12: number;
  paid30Schedules: number;
  paid30Amount: number;
  declined: number;
  stopped90: number;
  pastDue: number;
  pastEnd: number;
  held: number;
  stopped: number;
  twoYears: number;
}

const gone = (s: string) => /terminat|cancel|complet/i.test(s);

/** Rows and the numbers over them. Pure: the tests feed it made-up mirror rows. */
export function shape(o: {
  today: string;
  schedules: RawSchedule[];
  monthly: MonthlyPaid[];
  life: Lifetime[];
  rejects: Reject[];
  facts: Map<string, { name: string; place: string }>;
  holders: Map<string, string>;
  funds: Map<string, string>;
}): { rows: ScheduleRow[]; stats: RecurringStats } {
  const months: string[] = [];
  const cur = o.today.slice(0, 7);
  for (let i = 11; i >= 0; i--) {
    const y = Number(cur.slice(0, 4));
    const m = Number(cur.slice(5, 7)) - i;
    const d = new Date(Date.UTC(y, m - 1, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const monthBy = new Map<string, Map<string, MonthlyPaid>>();
  for (const p of o.monthly) {
    const k = String(p.sched);
    (monthBy.get(k) || monthBy.set(k, new Map()).get(k)!).set(String(p.m), p);
  }
  const lifeBy = new Map(o.life.map((l) => [String(l.sched), l]));
  const rejBy = new Map<string, Reject[]>();
  for (const r of o.rejects) (rejBy.get(String(r.sched)) || rejBy.set(String(r.sched), []).get(String(r.sched))!).push(r);
  const stoppedFrom = addDays(o.today, -WINDOWS.stoppedDays);
  const recentPaid = addDays(o.today, -WINDOWS.paidRecentDays);
  const twoYears = addDays(o.today, -730);
  const noPay = addDays(o.today, -WINDOWS.noPaymentDays);

  const rows: ScheduleRow[] = o.schedules.map((s) => {
    const id = String(s.id);
    const f = o.facts.get(String(s.cid));
    const mo = monthBy.get(id);
    const life = lifeBy.get(id);
    const rej = (rejBy.get(id) || []).slice().sort((a, b) => (a.d < b.d ? 1 : -1));
    const newest = rej[0];
    const status = text(s.status) || 'Active';
    const active = status === 'Active';
    const fundId = (() => {
      try {
        const sp = typeof s.splits === 'string' ? JSON.parse(s.splits) : s.splits;
        return Array.isArray(sp) && sp[0] && sp[0].fund_id != null ? String(sp[0].fund_id) : '';
      } catch {
        return '';
      }
    })();
    const next = text(s.nxt);
    const end = text(s.ends);
    const lastPaid = life ? text(life.last_ok) : '';
    const recovered = !!(newest && lastPaid && lastPaid > newest.d);
    const pastDue = active && !!next && next < o.today;
    return {
      id, cid: String(s.cid), name: f ? f.name : `Record ${s.cid}`, place: f ? f.place : '', status, amount: num(s.amount),
      frequency: text(s.freq), frequencyLabel: FREQUENCY_LABEL[text(s.freq).toUpperCase()] || text(s.freq).toLowerCase(), method: methodWord(text(s.pm)),
      fund: fundId ? o.funds.get(fundId) || '' : '', start: text(s.start), end, next, statusDate: text(s.sdate), annual: 0,
      months: months.map((m) => !!mo && mo.has(m)), paid12: [...(mo ? mo.values() : [])].reduce((n, p) => n + num(p.n), 0), paid: life ? num(life.n) : 0, lastPaid,
      holder: o.holders.get(String(s.cid)) || '', synced: text(s.synced),
      declinedOn: newest ? newest.d : '', declineReason: newest ? cleanReason(newest.ref) : '', declineRecovered: recovered, declines: rej.length,
      daysLate: pastDue ? Math.max(1, daysBetween(next, o.today)) : 0,
      flags: {
        declined: !!newest,
        pastDue,
        pastEnd: active && !!end && end < o.today,
        stopped90: /terminat/i.test(status) && !!text(s.sdate) && text(s.sdate) >= stoppedFrom && !!lastPaid && lastPaid >= recentPaid,
        twoYears: active && !!life && text(life.first_ok) <= twoYears,
        noPayment: active && !!text(s.start) && text(s.start) < noPay && (!lastPaid || lastPaid < noPay),
      },
    };
  });
  for (const r of rows) r.annual = Math.round(r.amount * ({ WEEKLY: 52, MONTHLY: 12, QUARTERLY: 4, ANNUALLY: 1 } as Record<string, number>)[r.frequency.toUpperCase()] * 100 || 0) / 100;

  // Declines first, then the largest.
  const rank = (r: ScheduleRow) => (r.flags.declined && !r.declineRecovered ? 0 : 1);
  rows.sort((a, b) => rank(a) - rank(b) || b.amount - a.amount || (a.name < b.name ? -1 : 1));

  const active = rows.filter((r) => r.status === 'Active');
  const stats: RecurringStats = {
    active: active.length,
    card: active.filter((r) => r.method === 'Card').length,
    bank: active.filter((r) => r.method === 'Bank').length,
    scheduledEach: Math.round(active.reduce((n, r) => n + r.amount, 0) * 100) / 100,
    payments12: o.monthly.reduce((n, p) => n + num(p.n), 0),
    paid30Schedules: 0,
    paid30Amount: 0,
    declined: active.filter((r) => r.flags.declined).length,
    stopped90: rows.filter((r) => r.flags.stopped90).length,
    pastDue: active.filter((r) => r.flags.pastDue).length,
    pastEnd: active.filter((r) => r.flags.pastEnd).length,
    held: rows.filter((r) => /held/i.test(r.status)).length,
    stopped: rows.filter((r) => gone(r.status)).length,
    twoYears: active.filter((r) => r.flags.twoYears).length,
  };
  return { rows, stats };
}

/** Payments in the last 30 days: schedules and dollars. A separate read, because the monthly rollup cannot split a month. */
export const PAID30_SQL = readOnly(`SELECT COUNT(DISTINCT linked_gift_id) AS schedules, COALESCE(SUM(gift_amount), 0) AS total, COUNT(*) AS n
  FROM gifts WHERE gift_type = 'RecurringGiftPayment' AND gift_amount > 0 AND gift_date >= ?1
   AND linked_gift_id IN (SELECT gift_id FROM recurring_schedules WHERE gift_status = 'Active')`);

export interface Loaded { rows: ScheduleRow[]; stats: RecurringStats }

export async function loadRecurring(q: Q, o: { today: string; transform?: (s: RawSchedule[]) => RawSchedule[] }): Promise<Loaded> {
  const since12 = addDays(o.today, -365);
  const [rawSchedules, monthly, life, rejects, paid30] = await Promise.all([
    q<RawSchedule>(SCHEDULES_SQL),
    q<MonthlyPaid>(MONTHLY_SQL, [since12.slice(0, 7) + '-01']),
    q<Lifetime>(LIFETIME_SQL),
    q<Reject>(REJECTS_SQL, [declineSince(o.today)]),
    q<{ schedules: number; total: number }>(PAID30_SQL, [addDays(o.today, -WINDOWS.paidDays)]),
  ]);
  const schedules = o.transform ? o.transform(rawSchedules) : rawSchedules;
  const cids = [...new Set(schedules.map((s) => String(s.cid)))];
  const fundIds = new Set<string>();
  for (const s of schedules) {
    try {
      const sp = typeof s.splits === 'string' ? JSON.parse(s.splits) : s.splits;
      if (Array.isArray(sp)) for (const x of sp) if (x && x.fund_id != null) fundIds.add(String(x.fund_id));
    } catch {
      /* no fund */
    }
  }
  const each = async <T>(sql: string, list: string[], extra: unknown[] = []): Promise<T[]> => {
    const out: T[] = [];
    for (const part of chunkOf(list, 400)) out.push(...(await q<T>(sql, [JSON.stringify(part), ...extra])));
    return out;
  };
  const [facts, holders, funds] = await Promise.all([
    each<{ id: string; name: string; city: string; st: string }>(FACTS_SQL, cids),
    each<{ cid: string; fid: string; type: string; name: string }>(HOLDERS_SQL, cids, [o.today]),
    each<{ id: string; name: string }>(FUNDS_BY_ID_SQL, [...fundIds]),
  ]);
  const holdBy = new Map<string, string>();
  for (const h of holders) if (!holdBy.has(String(h.cid))) holdBy.set(String(h.cid), text(h.name) || `Fundraiser ${h.fid}`);
  const out = shape({
    today: o.today, schedules, monthly, life, rejects,
    facts: new Map(facts.map((f) => [String(f.id), { name: text(f.name), place: [f.city, f.st].filter(Boolean).join(', ') }])),
    holders: holdBy,
    funds: new Map(funds.map((f) => [String(f.id), text(f.name)])),
  });
  out.stats.paid30Schedules = num(paid30[0]?.schedules);
  out.stats.paid30Amount = Math.round(num(paid30[0]?.total) * 100) / 100;
  return out;
}
