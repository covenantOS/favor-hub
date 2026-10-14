// The month of mail deposits for Gift entry. One row per Blackbaud batch, whoever typed it: the admin desk keys most batches straight into
// Blackbaud, FavorOS sends the rest. Blackbaud's side comes from the mirror (the copy of Blackbaud, up to 12 hours old) and FavorOS's side
// from its own ge_deposit table. A deposit sent from FavorOS shows once, matched by its Blackbaud batch number.
//
// What the copy shows and what it cannot:
//   - A mail deposit is a batch of Donation gifts paid by PersonalCheck or Cash, batch number GFT-YYYY-NNNN. The card gifts the desk keys into
//     the same batch (a few a month) are not on the deposit and are not counted.
//   - A batch belongs to the month it was entered (the gifts' date_added, Eastern as Blackbaud wrote it), not the month of its gift date.
//     GFT-2026-1080 holds September 30 gifts entered October 1 and counts in October.
//   - The copy does not say who entered a batch, so enteredBy is empty for Blackbaud rows. A FavorOS row carries the person who made it.
//   - Gifts reach the copy only after their batch is committed, so every Blackbaud row is approved. post_status on the gift is the general
//     ledger posting state, not the approval, and is not used.
//   - The batch description lives in Blackbaud's batch record, not in the copy. The kind comes from the gifts' appeals instead.
import type { Env } from '../http';
import { notTesterSql } from '../testuser';
import { etParts } from '../actions/intake';
import type { Q } from '../work/partner';

export type MonthKind = 'Regular' | 'Acquisition' | 'Grant';

export interface MonthDeposit {
  batch: string;
  /** The gift date most gifts in the batch carry, YYYY-MM-DD. */
  giftDate: string;
  /** The day the batch was entered, YYYY-MM-DD. */
  addedDate: string;
  items: number;
  cash: number;
  checks: number;
  totalCents: number;
  /** Who entered the batch. Empty for a batch typed in Blackbaud, because the copy does not hold it. */
  enteredBy: string;
  approved: boolean;
  kind: MonthKind;
  source: 'favoros' | 'blackbaud';
  /** The FavorOS deposit id, for a deposit FavorOS made. */
  favorosId: string | null;
  /** The FavorOS status (open, sending, created, committed, needs_person), or '' for a Blackbaud batch. */
  status: string;
}

export interface MonthResult {
  ym: string;
  deposits: MonthDeposit[];
  totals: { deposits: number; items: number; totalCents: number };
  /** When the Blackbaud copy last finished a sync, ISO UTC, or null when the copy does not say. */
  asOf: string | null;
}

export const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
export const BATCH = /^GFT-\d{4}-\d+$/;

/** This month, Eastern. */
export const currentYm = (now: Date = new Date()): string => etParts(now).date.slice(0, 7);

/** The first day of the month after `ym`. */
export function nextMonthStart(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

const KIND_LABEL: Record<string, MonthKind> = { regular: 'Regular', acquisition: 'Acquisition', grant: 'Grant' };

/** The mirror refuses statement text containing insert, update, replace, upsert, delete, drop, alter or create, so none appears below. */
const MAIL = `g.gift_type = 'Donation' AND g.gift_payment_method IN ('PersonalCheck', 'Cash') AND json_extract(g.raw_json, '$.batch_number') LIKE 'GFT-%'`;

export const BATCH_SQL = `SELECT json_extract(g.raw_json, '$.batch_number') AS batch, substr(g.gift_date, 1, 10) AS gift_day, g.gift_payment_method AS method,
       COUNT(*) AS n, CAST(ROUND(SUM(g.gift_amount) * 100) AS INTEGER) AS cents, MIN(substr(g.date_added, 1, 10)) AS added
  FROM gifts g
 WHERE ${MAIL}
   AND ((g.date_added >= ?1 AND g.date_added < ?2) OR json_extract(g.raw_json, '$.batch_number') IN (SELECT value FROM json_each(?3)))
 GROUP BY batch, gift_day, method`;

export const KIND_SQL = `SELECT json_extract(g.raw_json, '$.batch_number') AS batch,
       CASE WHEN a.appeal_category = 'Acquisition' THEN 'Acquisition'
            WHEN a.appeal_category IN ('Foundation Gift', 'Grants Team') OR lower(COALESCE(a.appeal_description, '')) LIKE '% grant%' THEN 'Grant'
            ELSE 'Regular' END AS kind, COUNT(*) AS n
  FROM gifts g, json_each(g.gift_splits) s
  LEFT JOIN appeals a ON a.id = json_extract(s.value, '$.appeal_id')
 WHERE ${MAIL} AND json_extract(g.raw_json, '$.batch_number') IN (SELECT value FROM json_each(?1))
 GROUP BY batch, kind`;

export const FRESH_SQL = `SELECT MAX(run_at) AS run_at FROM sync_log WHERE table_name = '__complete__' AND sync_status = 'success'`;

export interface BatchRow {
  batch: string;
  gift_day: string | null;
  method: string;
  n: number;
  cents: number;
  added: string | null;
}

export interface KindRow {
  batch: string;
  kind: string;
  n: number;
}

/** One Blackbaud deposit per batch from the grouped rows. The gift date is the day most gifts carry (ties go to the earlier day). */
export function foldBatches(rows: BatchRow[], kinds: KindRow[] = []): MonthDeposit[] {
  const by = new Map<string, BatchRow[]>();
  for (const r of rows) {
    const b = String(r.batch || '');
    if (!BATCH.test(b)) continue;
    by.set(b, [...(by.get(b) || []), r]);
  }
  const kindBy = new Map<string, Map<string, number>>();
  for (const k of kinds) {
    const m = kindBy.get(String(k.batch)) || new Map<string, number>();
    m.set(k.kind, (m.get(k.kind) || 0) + Number(k.n || 0));
    kindBy.set(String(k.batch), m);
  }
  const out: MonthDeposit[] = [];
  for (const [batch, list] of by) {
    const days = new Map<string, number>();
    for (const r of list) days.set(String(r.gift_day || ''), (days.get(String(r.gift_day || '')) || 0) + Number(r.n || 0));
    const giftDate = [...days].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
    const sum = (m?: string) => list.filter((r) => !m || r.method === m).reduce((s, r) => s + Number(r.n || 0), 0);
    const added = list.map((r) => String(r.added || '')).filter(Boolean).sort()[0] || '';
    const kc = kindBy.get(batch);
    let kind: MonthKind = 'Regular';
    if (kc) {
      const top = Math.max(...kc.values());
      // A tie goes to Regular, then Acquisition.
      kind = (['Regular', 'Acquisition', 'Grant'] as MonthKind[]).find((k) => (kc.get(k) || 0) === top) || 'Regular';
    }
    out.push({
      batch, giftDate, addedDate: added, items: sum(), cash: sum('Cash'), checks: sum('PersonalCheck'),
      totalCents: list.reduce((s, r) => s + Number(r.cents || 0), 0), enteredBy: '', approved: true, kind, source: 'blackbaud', favorosId: null, status: '',
    });
  }
  return out;
}

export interface FavorosDeposit {
  id: string;
  kind: string;
  deposit_date: string;
  status: string;
  created_by: string;
  created_at: string;
  sent_at: string | null;
  bb_batch_number: string | null;
  gifts: number;
  cash: number;
  cents: number;
}

const etDay = (iso: string | null): string => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? etParts(d).date : '';
};

/**
 * Put FavorOS's deposits into the Blackbaud rows. A FavorOS deposit whose batch is in the copy replaces that row's source, enterer and approval
 * (the copy's counts stay, since Blackbaud holds what was keyed). One not yet in the copy shows from FavorOS's own gift rows. The month a FavorOS
 * deposit counts in is the month it was made, Eastern, so a batch near a month end is never in two months.
 */
export function mergeFavoros(blackbaud: MonthDeposit[], favoros: FavorosDeposit[], ymFrom: string, ymTo: string): MonthDeposit[] {
  const inRange = (ym: string) => ym >= ymFrom && ym <= ymTo;
  const byBatch = new Map(favoros.filter((f) => f.bb_batch_number).map((f) => [String(f.bb_batch_number), f]));
  const rows: MonthDeposit[] = [];
  const used = new Set<string>();
  for (const b of blackbaud) {
    const f = byBatch.get(b.batch);
    if (!f) {
      rows.push(b);
      continue;
    }
    if (!inRange(etDay(f.created_at).slice(0, 7))) continue;
    used.add(f.id);
    rows.push({ ...b, enteredBy: f.created_by, approved: f.status === 'committed', kind: KIND_LABEL[f.kind] || b.kind, source: 'favoros', favorosId: f.id, status: f.status });
  }
  for (const f of favoros) {
    if (used.has(f.id) || !inRange(etDay(f.created_at).slice(0, 7))) continue;
    // Not in the copy yet: still open, sending, or committed after the copy's last sync. The batch was asked for by number, so a batch in the copy would have matched above.
    rows.push({
      batch: f.bb_batch_number || '', giftDate: f.deposit_date, addedDate: etDay(f.sent_at || f.created_at), items: f.gifts, cash: f.cash, checks: f.gifts - f.cash,
      totalCents: f.cents, enteredBy: f.created_by, approved: f.status === 'committed', kind: KIND_LABEL[f.kind] || 'Regular', source: 'favoros', favorosId: f.id, status: f.status,
    });
  }
  return rows;
}

/** Newest first: by the day entered, then gift date, then batch number. */
export const newestFirst = (a: MonthDeposit, b: MonthDeposit): number =>
  b.addedDate.localeCompare(a.addedDate) || b.giftDate.localeCompare(a.giftDate) || b.batch.localeCompare(a.batch);

export function monthTotals(deposits: MonthDeposit[]): MonthResult['totals'] {
  return { deposits: deposits.length, items: deposits.reduce((s, d) => s + d.items, 0), totalCents: deposits.reduce((s, d) => s + d.totalCents, 0) };
}

async function favorosDeposits(env: Env, from: string, to: string, withTesters: boolean): Promise<FavorosDeposit[]> {
  // The padding is a day each side so an Eastern month edge is never cut off; monthOf() settles the exact month.
  const lo = new Date(Date.parse(`${from}T00:00:00Z`) - 86400000).toISOString();
  const hi = new Date(Date.parse(`${to}T00:00:00Z`) + 86400000).toISOString();
  const deps = (
    await env.DB.prepare(
      `SELECT id, kind, deposit_date, status, created_by, created_at, sent_at, bb_batch_number FROM ge_deposit
        WHERE status <> 'removed' ${withTesters ? '' : `AND ${notTesterSql('created_by_email')}`} AND created_at >= ? AND created_at < ? ORDER BY created_at`
    ).bind(lo, hi).all<any>()
  ).results;
  if (!deps.length) return [];
  const counts = (
    await env.DB.prepare(
      `SELECT deposit_id AS id, COUNT(*) AS gifts, COALESCE(SUM(CASE WHEN kind = 'cash' THEN 1 ELSE 0 END), 0) AS cash, COALESCE(SUM(amount_cents), 0) AS cents
         FROM ge_gift WHERE status <> 'removed' AND deposit_id IN (SELECT value FROM json_each(?)) GROUP BY deposit_id`
    ).bind(JSON.stringify(deps.map((d) => d.id))).all<any>()
  ).results;
  const by = new Map(counts.map((c) => [String(c.id), c]));
  return deps.map((d) => ({ ...d, gifts: Number(by.get(d.id)?.gifts || 0), cash: Number(by.get(d.id)?.cash || 0), cents: Number(by.get(d.id)?.cents || 0) }));
}

/**
 * Every mail deposit entered from ymFrom through ymTo (YYYY-MM, inclusive), newest first, with the month totals.
 * `opts.env` adds FavorOS's own deposits; without it only Blackbaud's batches are listed. `opts.withTesters` is for the test users themselves.
 */
export async function monthDeposits(mirror: Q, ymFrom: string, ymTo: string, opts: { env?: Env; withTesters?: boolean } = {}): Promise<MonthResult> {
  if (!YM.test(ymFrom) || !YM.test(ymTo) || ymFrom > ymTo) throw new Error('bad month range');
  const from = `${ymFrom}-01`;
  const to = nextMonthStart(ymTo);
  const favoros = opts.env ? await favorosDeposits(opts.env, from, to, !!opts.withTesters) : [];
  const inRange = (f: FavorosDeposit) => {
    const m = etDay(f.created_at).slice(0, 7);
    return m >= ymFrom && m <= ymTo;
  };
  // A FavorOS batch placed by when FavorOS made it is asked for by number, so a batch entered a day after the month turned still lines up.
  const wanted = favoros.filter((f) => f.bb_batch_number && inRange(f)).map((f) => String(f.bb_batch_number));
  const rows = await mirror<BatchRow>(BATCH_SQL, [from, to, JSON.stringify(wanted)]);
  const batches = [...new Set(rows.map((r) => String(r.batch || '')).filter((b) => BATCH.test(b)))];
  // The kind is a refinement. If that query fails the rows still show, as Regular.
  const kinds = batches.length ? await mirror<KindRow>(KIND_SQL, [JSON.stringify(batches)]).catch(() => []) : [];
  const fresh = await mirror<{ run_at: string | null }>(FRESH_SQL).catch(() => []);
  const run = fresh[0]?.run_at ? String(fresh[0].run_at).replace(' ', 'T') : '';
  const asOf = run ? `${run.replace(/Z$/, '')}Z` : null;
  const deposits = mergeFavoros(foldBatches(rows, kinds), favoros, ymFrom, ymTo).sort(newestFirst);
  return { ym: ymFrom === ymTo ? ymFrom : `${ymFrom}..${ymTo}`, deposits, totals: monthTotals(deposits), asOf };
}
