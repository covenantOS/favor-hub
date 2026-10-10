// My week: a regional director's weekly goals, what counted toward each, and the giving line, read from the D1 copy of Blackbaud.
// No Blackbaud calls. The report draft is written in the browser (public/js/work-week-report.js) from this payload.
//
// Rules (decided 2026-10-10 from the RDD manual's weekly expectations: connect with 20 partners or prospects, attend 3 meetings,
// schedule 1 Favor event, hold 3 one-on-one appointments):
//   Connections   distinct partners with a completed Phone call, Email or Meeting action of the director's in the week, or a completed
//                 Mailing carrying the Thanked tag (a thank-you letter). RESERVED action types are staff data work and never count.
//   Meetings      completed actions tagged Attended or Hosted.
//   Event         an action of the director's dated in the week, open or done, in the Meeting or Task/Other categories, that is tagged
//                 Hosted or whose summary says an event was planned, scheduled, hosted or booked. "event/f2f" (a meeting held at an
//                 event) does not count.
//   One-on-ones   completed Meeting actions with no Attended or Hosted tag.
// An action is dated by its completed date, else its due date. Weeks run Monday to Sunday, Eastern. Giving to goal is the year's
// portfolio credit the KPI RDD tab shows (fundraiser_totals) against annual_goal, prorated for part-year directors the way that tab does.
import { openActionSql } from '../hub/actions';
import { heldIds, type PortfolioRow } from './portfolio';
import type { Q } from './partner';

export const GOALS = { conn: 20, mtg: 3, ev: 1, oo: 3 } as const;
/** Teams whose directors have weekly goals. */
export const WEEK_TEAMS = new Set(['rdd']);

const CONNECT = new Set(['Phone call', 'Email', 'Meeting']);
const HOW: Record<string, string> = { 'Phone call': 'Call', Email: 'Email', Meeting: 'Visit', Mailing: 'Letter', 'Task/Other': 'Task' };
const GIVEN = "('Donation', 'RecurringGiftPayment', 'GiftInKind', 'Stock/Property', 'Other')";
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fd = (ymd: string) => `${MON[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;

export interface WeekSpan {
  offset: number;
  start: string;
  end: string;
  range: string;
}

/** The Monday to Sunday week that holds `today`, moved back by `back` weeks. */
export function weekSpan(today: string, back = 0): WeekSpan {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const start = addDays(today, -((dow + 6) % 7) - 7 * back);
  const end = addDays(start, 6);
  const range = start.slice(0, 7) === end.slice(0, 7) ? `${fd(start)} to ${Number(end.slice(8, 10))}` : `${fd(start)} to ${fd(end)}`;
  return { offset: back ? -back : 0, start, end, range };
}

export interface WeekRow {
  id: string;
  cid: string;
  date: string;
  how: string;
  name: string;
  said: string;
  tags: string[];
  ask: number;
  refs: number;
  conn: boolean;
}

export interface WeekData {
  fid: string;
  name: string;
  today: string;
  week: WeekSpan;
  goals: typeof GOALS;
  counts: { conn: number; mtg: number; ev: number; oo: number };
  rows: WeekRow[];
  moreRows: number;
  giving: Giving;
  gifts: { n: number; total: number };
  calendar: { date: string; how: string; text: string }[];
  next: { date: string; how: string; text: string }[];
  quiet: { cid: string; name: string; last: string | null }[];
  asks: { cid: string; name: string; amount: number; date: string }[];
}

export interface Giving {
  ytd: number;
  goal: number;
  pace: number;
  behind: number;
  weeks: number;
  perWeek: number;
  /** 0 to 100, how far to the goal; and where the pace marker sits. */
  pct: number;
  ppct: number;
}

/** The share of the year a person works it, the way the KPI RDD tab prorates a goal (start and end dates inside the year). */
export function yearWindow(today: string, start: string | null, end: string | null): { from: string; to: string; share: number } {
  const y = Number(today.slice(0, 4));
  const ys = `${y}-01-01`;
  const ye = `${y + 1}-01-01`;
  const s = start ? String(start).slice(0, 10) : '';
  const e = end ? addDays(String(end).slice(0, 10), 1) : '';
  const from = s && s > ys ? s : ys;
  const to = e && e < ye ? e : ye;
  const share = to > from ? daysBetween(from, to) / daysBetween(ys, ye) : 0;
  return { from, to, share };
}

export function givingOf(today: string, ytd: number, annual: number, start: string | null, end: string | null): Giving {
  const w = yearWindow(today, start, end);
  const goal = Math.round(annual * w.share);
  const span = Math.max(1, daysBetween(w.from, w.to));
  const done = Math.min(span, Math.max(0, daysBetween(w.from, today) + 1));
  const pace = Math.round((goal * done) / span);
  const weeks = Math.max(1, Math.ceil(daysBetween(today, w.to) / 7));
  const left = Math.max(0, goal - ytd);
  return {
    ytd: Math.round(ytd),
    goal,
    pace,
    behind: Math.max(0, pace - Math.round(ytd)),
    weeks,
    perWeek: Math.round(left / weeks),
    pct: goal > 0 ? Math.min(100, (ytd / goal) * 100) : 0,
    ppct: goal > 0 ? Math.min(100, (pace / goal) * 100) : 0,
  };
}

const clip = (s: unknown, n = 240) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '...' : t;
};

/** Every non-canceled action of one fundraiser dated in a span, with partner name and tags. Mirror rows for deleted partners drop out of the join. */
const ACTION_SQL = `SELECT a.id AS id, a.constituent_record_id AS cid, a.action_category AS cat, COALESCE(a.action_type, '') AS typ,
       substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) AS d,
       (a.action_completed_date IS NOT NULL OR COALESCE(json_extract(a.raw_json, '$.completed'), 0) IN (1, 'true')) AS done,
       a.action_summary AS summary, substr(COALESCE(a.action_description, ''), 1, 600) AS descr, json_extract(a.raw_json, '$.location') AS loc,
       COALESCE(t.action_ask_amount, 0) AS ask, COALESCE(t.action_referrals, 0) AS refs, COALESCE(t.attended_Hosted, '') AS ah,
       COALESCE(t.presented, 0) AS pres, COALESCE(t.scheduling, 0) AS sched, COALESCE(t.stewardship, 0) AS stew, COALESCE(t.texted, 0) AS txt, COALESCE(t.thanked, 0) AS thx,
       COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name
  FROM actions a JOIN constituents c ON c.id = a.constituent_record_id LEFT JOIN action_tags t ON t.id = a.id
 WHERE a.action_fundraiser_id LIKE ?1 AND substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) BETWEEN ?2 AND ?3
   AND COALESCE(json_extract(a.raw_json, '$.status'), '') <> 'Canceled' AND COALESCE(json_extract(a.raw_json, '$.computed_status'), '') <> 'Canceled'
 ORDER BY 5 DESC, a.id DESC LIMIT 1500`;

const OPEN_SQL = `SELECT a.id AS id, a.action_category AS cat, substr(a.action_date_due, 1, 10) AS d, a.action_summary AS summary,
       COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name
  FROM actions a JOIN constituents c ON c.id = a.constituent_record_id
 WHERE a.action_fundraiser_id LIKE ?1 AND substr(a.action_date_due, 1, 10) BETWEEN ?2 AND ?3 AND ${openActionSql('a')} AND COALESCE(a.action_type, '') NOT LIKE 'RESERVED%'
 ORDER BY a.action_date_due, a.id LIMIT 40`;

const TOTALS_SQL = `SELECT SUM(CAST(json_extract(td.value, '$.portfolio_amount') AS REAL)) AS amount
  FROM fundraiser_totals ft JOIN json_each(ft.totals_data) td WHERE ft.id = ?1 AND substr(json_extract(td.value, '$.year_month'), 1, 4) = ?2`;

const FR_SQL = `SELECT annual_goal AS goal, substr(fundraiser_start_date, 1, 10) AS fstart, substr(fundraiser_end_date, 1, 10) AS fend,
       trim(COALESCE(fundraiser_first_name, '') || ' ' || COALESCE(fundraiser_last_name, '')) AS name FROM fundraisers WHERE id = ?1`;

function tagsOf(r: any): string[] {
  const out: string[] = [];
  if (r.thx) out.push('Thanked');
  if (r.txt) out.push('Texted');
  if (r.stew) out.push('Stewardship');
  if (r.sched) out.push('Scheduling');
  if (r.pres) out.push('Favor Presentation');
  if (r.ah === 'Attended') out.push('Attended Event');
  if (r.ah === 'Hosted') out.push('Hosted Event');
  return out;
}

/** A summary that says an event was planned or scheduled. "event/f2f" (a meeting held at an event) does not match. */
const EVENT_PLAN = /\b(schedul\w*|plan\w*|host\w*|book\w*)\b[^.]*\bevent\b|\bevent\b[^.]*\b(schedul\w*|plan\w*|date)\b/i;
const reserved = (typ: string) => /^RESERVED/i.test(typ);

/** What one week's actions come to, by the rules at the top of this file. Pure, so the tests can feed it rows. */
export function countWeek(rows: any[]): { counts: WeekData['counts']; rows: WeekRow[] } {
  const partners = new Set<string>();
  let mtg = 0;
  let ev = 0;
  let oo = 0;
  const out: WeekRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(String(r.id))) continue;
    seen.add(String(r.id));
    const done = Number(r.done) === 1;
    const res = reserved(String(r.typ));
    const isConn = done && !res && (CONNECT.has(r.cat) || (r.cat === 'Mailing' && Number(r.thx) === 1));
    const isMtg = done && !res && (r.ah === 'Attended' || r.ah === 'Hosted');
    const isOo = done && !res && r.cat === 'Meeting' && !r.ah;
    const isEv = !res && (r.cat === 'Meeting' || r.cat === 'Task/Other') && (r.ah === 'Hosted' || EVENT_PLAN.test(String(r.summary || '')));
    if (isConn) partners.add(String(r.cid));
    if (isMtg) mtg += 1;
    if (isOo) oo += 1;
    if (isEv) ev += 1;
    if (isConn || isMtg || isOo) {
      out.push({
        id: String(r.id),
        cid: String(r.cid),
        date: String(r.d),
        how: HOW[r.cat] || String(r.cat),
        name: String(r.name || '').replace(/\s+/g, ' ').trim() || `Record ${r.cid}`,
        said: clip(r.cat === 'Mailing' ? r.summary : r.descr || r.summary),
        tags: tagsOf(r),
        ask: num(r.ask),
        refs: num(r.refs),
        conn: isConn,
      });
    }
  }
  return { counts: { conn: partners.size, mtg, ev, oo }, rows: out };
}

const LIST_MAX = 40;

export async function loadWeek(
  q: Q,
  fid: string,
  today: string,
  back = 0,
  opts: { portfolio?: () => Promise<PortfolioRow[]> } = {}
): Promise<WeekData> {
  const week = weekSpan(today, back);
  const like = `%"${fid.replace(/\D/g, '')}"%`;
  const yr = today.slice(0, 4);
  const [acts, opens, tot, fr, held] = await Promise.all([
    q<any>(ACTION_SQL, [like, week.start, week.end]),
    q<any>(OPEN_SQL, [like, week.start, addDays(week.end, 7)]),
    q<any>(TOTALS_SQL, [fid, yr]),
    q<any>(FR_SQL, [fid]),
    heldIds(q, fid, today),
  ]);
  const { counts, rows } = countWeek(acts);
  const f = fr[0] || {};
  const giving = givingOf(today, num(tot[0] && tot[0].amount), num(f.goal), f.fstart || null, f.fend || null);

  const heldJ = JSON.stringify(held);
  const gifts = held.length
    ? await q<any>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(gift_amount), 0) AS total FROM gifts WHERE constituent_record_id IN (SELECT value FROM json_each(?1))
          AND substr(gift_date, 1, 10) BETWEEN ?2 AND ?3 AND gift_amount > 0 AND gift_type IN ${GIVEN}`,
        [heldJ, week.start, week.end]
      )
    : [{ n: 0, total: 0 }];

  // Asks still open: an ask in the last 60 days with no later gift from that partner.
  const asks = await q<any>(
    `SELECT a.constituent_record_id AS cid, t.action_ask_amount AS amt, substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) AS d,
            COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name
       FROM actions a JOIN action_tags t ON t.id = a.id JOIN constituents c ON c.id = a.constituent_record_id
      WHERE a.action_fundraiser_id LIKE ?1 AND t.action_ask_amount > 0 AND substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) BETWEEN ?2 AND ?3
        AND COALESCE(json_extract(a.raw_json, '$.status'), '') <> 'Canceled'
        AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.constituent_record_id = a.constituent_record_id AND g.gift_amount > 0 AND g.gift_type IN ${GIVEN}
                          AND substr(g.gift_date, 1, 10) >= substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10))
      ORDER BY t.action_ask_amount DESC LIMIT 6`,
    [like, addDays(today, -60), today]
  );

  let quiet: WeekData['quiet'] = [];
  if (opts.portfolio) {
    const pf = await opts.portfolio();
    quiet = pf
      .filter((r) => r.quiet === null || r.quiet >= 90)
      .sort((a, b) => b.l12 - a.l12)
      .slice(0, 3)
      .map((r) => ({ cid: r.cid, name: r.name, last: r.last ? r.last.date : null }));
  }

  const cal = (r: any) => ({ date: String(r.d), how: HOW[r.cat] || String(r.cat), text: `${clip(r.summary, 90)}${r.name ? ' with ' + String(r.name).replace(/\s+/g, ' ').trim() : ''}`.trim() });
  const inWeek = opens.filter((r: any) => String(r.d) >= week.start && String(r.d) <= week.end);
  const after = opens.filter((r: any) => String(r.d) > week.end);
  return {
    fid,
    name: String(f.name || '').trim(),
    today,
    week,
    goals: GOALS,
    counts,
    rows: rows.slice(0, LIST_MAX),
    moreRows: Math.max(0, rows.length - LIST_MAX),
    giving,
    gifts: { n: num(gifts[0] && gifts[0].n), total: Math.round(num(gifts[0] && gifts[0].total)) },
    calendar: inWeek.map(cal),
    next: after.map(cal),
    quiet,
    asks: asks.map((r: any) => ({ cid: String(r.cid), name: String(r.name || '').replace(/\s+/g, ' ').trim(), amount: num(r.amt), date: String(r.d) })),
  };
}
