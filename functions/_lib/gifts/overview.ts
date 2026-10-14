// Gifts > Overview: the gift day on one screen. Every part reads on its own (Promise.allSettled), so a part that fails comes back
// null and the rest still answer. Nothing here calls Fundraise Up or Blackbaud live: it reads the hub's D1 tables and the mirror
// (the copy of Blackbaud, up to 12 hours old).
//
// What each part means:
//   mail       FavorOS deposits made today (not removed, testers left out unless the viewer is a tester) and the deposits still open
//              (open, sending, needs a person). A deposit made in Blackbaud by the admin desk is not a FavorOS deposit and is not counted here.
//   online     Online gifts waiting for Partner Care's approval: the same list /online-gifts/ shows (the giving form, its same-minute
//              copies and Blackbaud donation form batches) over its widest window of 14 days, minus gifts that already have an
//              og_review row. Fundraise Up gifts need a live call, so they are not counted until the admin desk enters them in Blackbaud.
//   review     FavorOS gifts in open deposits that are held, waiting on a person's look, or failed to send.
//   blackbaud  This month's mail deposits, the month page's totals (monthDeposits).
//   receipts   Gifts left on the Receipts menu entry, and the newest print file.
//   letters    Gifts of $5,000 and up this month from the HQTY desk, with where each letter stands.
//   chart      The last 7 weekdays through yesterday by gift date, split by how the gift was paid. The sums are raw; capCents is where
//              the page should stop drawing a bar, because one stock or DAF gift dwarfs a day of checks.
import type { Env } from '../http';
import { notTesterSql } from '../testuser';
import { etParts } from '../actions/intake';
import type { Q } from '../work/partner';
import { currentYm, FRESH_SQL, monthDeposits } from './month';
import { onlineGifts, setting, TEST_RECORD } from '../online-gifts/service';
import { parseReference } from '../online-gifts/read';
import { openPrintFile, receiptsFigure } from '../hub/today';
import { loadHqty } from '../work/hqty';
import type { HqtyRow } from '../work/hqty';

export const CAP_CENTS = 2_500_000;
export const ONLINE_DAYS = 14;
export const CHART_DAYS = 7;
/** FavorOS deposit statuses that still need work from a person in FavorOS. A created or committed deposit waits on Blackbaud, not here. */
export const OPEN_STATUSES = ['open', 'sending', 'needs_person'];
export const REVIEW_STATUSES = ['review', 'held', 'failed'];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface OnlineRow {
  name: string;
  cents: number;
  date: string;
  kind: string;
  cid: string | null;
}
export interface ChartDay {
  date: string;
  weekday: string;
  checksCents: number;
  cardCents: number;
  otherCents: number;
}
export interface LetterRow {
  name: string;
  cents: number;
  fund: string;
  date: string;
  state: string;
  stateLabel: string;
}
export interface Overview {
  ok: true;
  today: string;
  weekday: string;
  pickupDay: boolean;
  mail: { startedToday: number; openDeposits: number } | null;
  online: { toApprove: number; cents: number; rows: OnlineRow[] } | null;
  review: { waiting: number } | null;
  blackbaud: { deposits: number; items: number; cents: number } | null;
  receipts: { left: number; lastFile: { at: string; gifts: number; marked: number } | null } | null;
  letters: { month: number; rows: LetterRow[] } | null;
  chart: { days: ChartDay[]; capCents: number } | null;
  asOf: string | null;
}

/** Mail comes to the desk Monday, Wednesday and Friday. dow is 0 for Sunday. */
export const isPickupDay = (dow: number): boolean => dow === 1 || dow === 3 || dow === 5;

const addDays = (ymd: string, n: number): string => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dowOf = (ymd: string): number => new Date(`${ymd}T12:00:00Z`).getUTCDay();

/** The last `count` weekdays (Monday to Friday) before `today`, oldest first. A Monday looks back to the Friday before. */
export function lastWeekdays(today: string, count = CHART_DAYS): string[] {
  const out: string[] = [];
  let d = today;
  while (out.length < count) {
    d = addDays(d, -1);
    const w = dowOf(d);
    if (w !== 0 && w !== 6) out.push(d);
  }
  return out.reverse();
}

export type Bucket = 'checks' | 'card' | 'other';
/** Checks and cash arrive in the mail. Card, bank draft and PayPal arrive online. Everything else (stock, DAF, wire, other) is other. */
export function bucketOf(method: string | null | undefined): Bucket {
  const m = String(method || '');
  if (m === 'PersonalCheck' || m === 'Cash') return 'checks';
  if (m === 'CreditCard' || m === 'DirectDebit' || m === 'PayPal') return 'card';
  return 'other';
}

export interface ChartSumRow {
  d: string;
  pm: string | null;
  cents: number | string | null;
}

/** One entry per day asked for, in order, with zeros for a day with no gifts. Rows outside the days are ignored. */
export function foldChart(days: string[], rows: ChartSumRow[]): ChartDay[] {
  const by = new Map<string, ChartDay>(days.map((d) => [d, { date: d, weekday: WEEKDAYS[dowOf(d)], checksCents: 0, cardCents: 0, otherCents: 0 }]));
  for (const r of rows) {
    const day = by.get(String(r.d));
    if (!day) continue;
    const c = Math.round(Number(r.cents) || 0);
    const b = bucketOf(r.pm);
    if (b === 'checks') day.checksCents += c;
    else if (b === 'card') day.cardCents += c;
    else day.otherCents += c;
  }
  return days.map((d) => by.get(d)!);
}

export const CHART_SQL = `SELECT substr(g.gift_date, 1, 10) AS d, g.gift_payment_method AS pm, CAST(ROUND(SUM(g.gift_amount) * 100) AS INTEGER) AS cents
  FROM gifts g
 WHERE g.gift_type = 'Donation' AND g.gift_amount > 0 AND substr(g.gift_date, 1, 10) IN (SELECT value FROM json_each(?1))
 GROUP BY d, pm`;

/** A plain word for how an online gift came in. */
export function onlineKind(g: { type?: string | null; ref?: string | null; src?: string | null }): string {
  const parsed = parseReference(g.ref);
  if (g.type === 'RecurringGiftPayment' || parsed.monthly) return 'Monthly';
  if (g.src === 'realtime-web' || parsed.source === 'website') return 'Website';
  return 'One time';
}

/** The gifts still waiting for approval: no og_review row, and not the test record unless the viewer is a tester. */
export function waitingOnline(gifts: Record<string, any>[], reviewed: Set<string>, tester: boolean): Record<string, any>[] {
  return gifts.filter((g) => !reviewed.has(`re:${g.id}`) && (tester || String(g.cid) !== TEST_RECORD));
}

export function onlinePart(waiting: Record<string, any>[], limit = 5): NonNullable<Overview['online']> {
  const newest = [...waiting].sort((a, b) => String(b.added || b.d || '').localeCompare(String(a.added || a.d || ''))).slice(0, limit);
  return {
    toApprove: waiting.length,
    cents: waiting.reduce((s, g) => s + Math.round((Number(g.amt) || 0) * 100), 0),
    rows: newest.map((g) => ({ name: String(g.name || 'Partner'), cents: Math.round((Number(g.amt) || 0) * 100), date: String(g.d || ''), kind: onlineKind(g), cid: g.cid ? String(g.cid) : null })),
  };
}

const STATE_LABEL: Record<string, string> = { write: 'To write', printed: 'Printed', signed: 'Signed', mailed: 'Mailed', cannot: 'Cannot send' };

/** The HQTY rows dated in `ym`, newest first (the desk's own order), the five newest shown. */
export function lettersPart(rows: HqtyRow[], ym: string, limit = 5): NonNullable<Overview['letters']> {
  const month = rows.filter((r) => r.date.slice(0, 7) === ym);
  return {
    month: month.length,
    rows: month.slice(0, limit).map((r) => ({ name: r.partner.name, cents: Math.round(r.amount * 100), fund: r.fund, date: r.date, state: r.state, stateLabel: STATE_LABEL[r.state] || r.state })),
  };
}

export const asOfOf = (runAt: string | null | undefined): string | null => {
  const run = runAt ? String(runAt).replace(' ', 'T') : '';
  return run ? `${run.replace(/Z$/, '')}Z` : null;
};

export interface OverviewOpts {
  /** The viewer is a FavorOS test user: sees test deposits and the test record. */
  tester?: boolean;
  now?: Date;
  /** Tests replace the HQTY desk's loader. */
  hqty?: (env: Env, q: Q, o: { today: string; since?: string }) => Promise<{ shaped: { rows: HqtyRow[] } }>;
}

async function mailPart(env: Env, today: string, tester: boolean): Promise<NonNullable<Overview['mail']>> {
  const since = new Date(Date.parse(`${addDays(today, -1)}T00:00:00Z`)).toISOString();
  const rows = (
    await env.DB.prepare(
      `SELECT id, status, created_at FROM ge_deposit WHERE status <> 'removed' ${tester ? '' : `AND ${notTesterSql('created_by_email')}`}
          AND (created_at >= ?1 OR status IN (SELECT value FROM json_each(?2)))`
    ).bind(since, JSON.stringify(OPEN_STATUSES)).all<{ id: string; status: string; created_at: string }>()
  ).results;
  return {
    startedToday: rows.filter((r) => etParts(new Date(r.created_at)).date === today).length,
    openDeposits: rows.filter((r) => OPEN_STATUSES.includes(r.status)).length,
  };
}

async function reviewPart(env: Env, tester: boolean): Promise<NonNullable<Overview['review']>> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ge_gift g JOIN ge_deposit d ON d.id = g.deposit_id
      WHERE g.status IN (SELECT value FROM json_each(?1)) AND d.status IN (SELECT value FROM json_each(?2)) ${tester ? '' : `AND ${notTesterSql('d.created_by_email')}`}`
  ).bind(JSON.stringify(REVIEW_STATUSES), JSON.stringify(OPEN_STATUSES)).first<{ n: number }>();
  return { waiting: Number(r?.n) || 0 };
}

async function onlineLoad(env: Env, q: Q, today: string, tester: boolean): Promise<NonNullable<Overview['online']>> {
  // The donation form batch numbers come from the page's own cached list. Reading them live would be a Blackbaud call.
  let formBatches: string[] = [];
  try {
    formBatches = (JSON.parse(await setting(env.DB as any, 'og:bb', '{}')) as { formBatches?: string[] }).formBatches || [];
  } catch {
    formBatches = [];
  }
  const gifts = await onlineGifts(q as any, addDays(today, -(ONLINE_DAYS - 1)), formBatches);
  const keys = gifts.map((g) => `re:${g.id}`);
  const done = keys.length
    ? (await env.DB.prepare('SELECT gift_key FROM og_review WHERE gift_key IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(keys)).all<{ gift_key: string }>()).results
    : [];
  return onlinePart(waitingOnline(gifts, new Set(done.map((r) => String(r.gift_key))), tester));
}

async function receiptsPart(env: Env): Promise<NonNullable<Overview['receipts']>> {
  const file = await openPrintFile(env);
  const last = await env.DB.prepare(
    `SELECT created_at, gifts, count, marked FROM rcp_batches WHERE kind = 'new' AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 1`
  ).first<{ created_at: string; gifts: number; count: number; marked: number }>();
  return {
    left: file ? receiptsFigure(file) : 0,
    lastFile: last ? { at: last.created_at, gifts: Number(last.gifts) || Number(last.count) || 0, marked: Number(last.marked) || 0 } : null,
  };
}

export async function giftsOverview(env: Env, q: Q, opts: OverviewOpts = {}): Promise<Overview> {
  const tester = !!opts.tester;
  const now = opts.now || new Date();
  const et = etParts(now);
  const today = et.date;
  const ym = currentYm(now);
  const days = lastWeekdays(today);
  const load = opts.hqty || loadHqty;

  const [mail, online, review, blackbaud, receipts, letters, chart, fresh] = await Promise.allSettled([
    mailPart(env, today, tester),
    onlineLoad(env, q, today, tester),
    reviewPart(env, tester),
    monthDeposits(q, ym, ym, { env, withTesters: tester }).then((m) => ({ deposits: m.totals.deposits, items: m.totals.items, cents: m.totals.totalCents })),
    receiptsPart(env),
    load(env, q, { today, since: `${ym}-01` }).then((r) => lettersPart(r.shaped.rows, ym)),
    q<ChartSumRow>(CHART_SQL, [JSON.stringify(days)]).then((rows) => ({ days: foldChart(days, rows), capCents: CAP_CENTS })),
    q<{ run_at: string | null }>(FRESH_SQL).then((r) => asOfOf(r[0]?.run_at)),
  ]);
  const got = <T>(r: PromiseSettledResult<T>, name: string): T | null => {
    if (r.status === 'fulfilled') return r.value;
    console.error(`[gifts/overview] ${name}`, r.reason);
    return null;
  };
  return {
    ok: true,
    today,
    weekday: WEEKDAYS[et.dow],
    pickupDay: isPickupDay(et.dow),
    mail: got(mail, 'mail'),
    online: got(online, 'online'),
    review: got(review, 'review'),
    blackbaud: got(blackbaud, 'blackbaud'),
    receipts: got(receipts, 'receipts'),
    letters: got(letters, 'letters'),
    chart: got(chart, 'chart'),
    asOf: got(fresh, 'asOf'),
  };
}
