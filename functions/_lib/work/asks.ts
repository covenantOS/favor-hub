// Ask pipeline (Work Center tab Asks). Every action tagged Amount of Ask is one ask. It sits in one of four columns: Asked with no
// close date, Closing (a close date today or later), Past the close date, or Gave. The close date is the one thing the hub stores
// (act_ask_close in the hub database); everything else is read from the D1 copy of Blackbaud. No Blackbaud calls.
//
// Match rule (decided 2026-10-10): a gift settles an ask when it is credited to the ask's partner (as the giver or as a soft credit),
// is dated on or after the day the ask was first tagged, and the credited amount is at least the asked amount. One gift settles one ask,
// the oldest it covers. Opportunities are not used: regional directors do not keep them.
//
// Counting (corrected 2026-10-10 after the first total, $76.3M, looked far too high): one ask is one partner and one amount, so a follow-up
// action that repeats the amount within 90 days joins the ask. An action Blackbaud no longer has (act_ask_gone) is left out. An ask of
// $1,000,000 or more is held back from the default board and every total. The board opens on the last 12 months.
//
// Mirror rules that shape the SQL: the endpoint refuses any statement whose text contains insert, update, replace, upsert, delete,
// drop, alter or create anywhere (readOnly checks it), and a list of ids goes in as one JSON parameter read with json_each(?).
import { HttpError, nowIso, type Env } from '../http';
import { mirrorQ, type Q } from './partner';
import { readOnly } from './repo';
import { GIVEN } from './gifts';
import { logEvent } from './db';
import { todayEt, type Ctx } from './service';
import { addDays } from '../actions/completion';
import type { Scope } from './role';

/** The default window: asks tagged in the last 12 months. The "All time" filter widens it to every ask on record. */
export const ASK_DAYS = 365;
/** An ask this size or larger is left out of the default board and totals. The largest gift Favor has received is $1,999,775 and the whole year's giving is about $13M. */
export const REVIEW_AMOUNT = 1_000_000;
/** Tags on the same partner for the same amount, each within this many days of the one before, are one ask. */
export const SAME_ASK_DAYS = 90;
export const CLOSE_AHEAD_DAYS = 90;
const ID = /^\d{1,12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface RawAsk { id: string; cid: string; d: string; amt: number; summary: string; description: string; frs: string | null; name: string; city: string; st: string; deceased: number }
export interface RawAskGift { id: string; giver: string; amount: number; gdate: string; soft: string | null }
export interface AskClose { action_id: string; expected_close: string; set_by: string }

export type AskState = 'open' | 'closing' | 'past' | 'gave';

export interface AskRow {
  id: string;
  cid: string;
  name: string;
  place: string;
  amount: number;
  date: string;
  ageDays: number;
  line: string;
  owners: string[];
  close: { date: string; by: string } | null;
  state: AskState;
  gave: { amount: number; date: string; giftId: string } | null;
  /** Actions tagged with this same ask (a follow-up that repeats the amount is not a new ask). */
  tags: number;
  /** Day of the first tag. The gift match starts here; `date` is the latest tag. */
  first: string;
  /** At or over REVIEW_AMOUNT: kept out of the default board. */
  review: boolean;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const day = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 10) : '');
function parse<T = any>(v: unknown, fallback: T): T {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

/** The first line a person wrote about the ask: the action's description, or its summary when there is no description. */
export function lineOf(description: string, summary: string): string {
  const first = String(description || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) || String(summary || '').trim();
  return first.length > 160 ? first.slice(0, 157).replace(/\s+\S*$/, '') + '...' : first;
}

/** Put every ask in its column. An ask with a zero amount is not an ask. Asks are settled oldest first, and a gift settles one ask. */
export function shapeAsks(raw: { asks: RawAsk[]; gifts: RawAskGift[]; closes: AskClose[]; gone?: Set<string> }, today: string): AskRow[] {
  const closeOf = new Map(raw.closes.map((c) => [String(c.action_id), c]));
  // The credits each gift gives, per partner.
  const credits = new Map<string, { id: string; date: string; amount: number }[]>();
  const add = (cid: string, id: string, date: string, amount: number) => {
    if (!cid || amount <= 0) return;
    const l = credits.get(cid) || credits.set(cid, []).get(cid)!;
    if (!l.some((x) => x.id === id)) l.push({ id, date, amount });
  };
  for (const g of raw.gifts) {
    add(String(g.giver), String(g.id), day(g.gdate), num(g.amount));
    for (const s of parse<any[]>(g.soft, [])) if (s && s.constituent_id && String(s.constituent_id) !== String(g.giver)) add(String(s.constituent_id), String(g.id), day(g.gdate), num(s.amount && s.amount.value));
  }
  for (const l of credits.values()) l.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const used = new Set<string>();
  const sorted = raw.asks.filter((a) => num(a.amt) > 0 && day(a.d) && !(raw.gone && raw.gone.has(String(a.id)))).slice().sort((a, b) => (day(a.d) < day(b.d) ? -1 : day(a.d) > day(b.d) ? 1 : String(a.id) < String(b.id) ? -1 : 1));
  // One ask is one partner and one amount. The same amount tagged again within SAME_ASK_DAYS of the last tag joins that ask.
  type Chain = { a: RawAsk; first: string; last: string; n: number; owners: Set<string> };
  const chains: Chain[] = [];
  const open = new Map<string, Chain>();
  for (const a of sorted) {
    const k = `${a.cid}|${num(a.amt)}`;
    const c = open.get(k);
    const owners = parse<string[]>(a.frs, []).map(String);
    if (c && daysBetween(c.last, day(a.d)) <= SAME_ASK_DAYS) {
      c.last = day(a.d); c.n++; c.a = a; owners.forEach((o) => c.owners.add(o));
    } else {
      const n: Chain = { a, first: day(a.d), last: day(a.d), n: 1, owners: new Set(owners) };
      chains.push(n); open.set(k, n);
    }
  }
  const out: AskRow[] = [];
  for (const ch of chains) {
    const a = { ...ch.a, id: sorted.find((x) => String(x.cid) === String(ch.a.cid) && num(x.amt) === num(ch.a.amt) && day(x.d) === ch.first)!.id };
    const date = ch.last;
    const amount = num(a.amt);
    const hit = (credits.get(String(a.cid)) || []).find((g) => g.date >= ch.first && g.amount >= amount && !used.has(`${a.cid}|${g.id}`));
    if (hit) used.add(`${a.cid}|${hit.id}`);
    const c = closeOf.get(String(a.id));
    const close = c ? { date: day(c.expected_close), by: c.set_by } : null;
    const state: AskState = hit ? 'gave' : !close ? 'open' : close.date < today ? 'past' : 'closing';
    out.push({
      id: String(a.id),
      cid: String(a.cid),
      name: String(a.name || `Record ${a.cid}`),
      place: [a.city, a.st].filter(Boolean).join(', '),
      amount,
      date,
      ageDays: Math.max(0, daysBetween(date, today)),
      line: lineOf(a.description, a.summary),
      owners: [...ch.owners],
      close,
      state,
      gave: hit ? { amount: hit.amount, date: hit.date, giftId: hit.id } : null,
      tags: ch.n,
      first: ch.first,
      review: amount >= REVIEW_AMOUNT,
    });
  }
  return out;
}

export interface Tally { n: number; total: number }
export interface AskStats { open: Tally; soon: Tally; past: Tally; gave: Tally }
export interface AskColumns { open: Tally; closing: Tally; past: Tally; gave: Tally }

const sum = (rows: AskRow[], f: (r: AskRow) => number = (r) => r.amount): Tally => ({ n: rows.length, total: rows.reduce((t, r) => t + f(r), 0) });

/** Tiles and column totals leave out the asks held for review (REVIEW_AMOUNT and over). */
export function statsOf(all: AskRow[], today: string): { stats: AskStats; columns: AskColumns } {
  const rows = all.filter((r) => !r.review);
  const live = rows.filter((r) => r.state !== 'gave');
  const horizon = addDays(today, CLOSE_AHEAD_DAYS);
  const gave = (r: AskRow) => (r.gave ? r.gave.amount : 0);
  return {
    stats: {
      open: sum(live),
      soon: sum(live.filter((r) => r.state === 'closing' && r.close!.date <= horizon)),
      past: sum(live.filter((r) => r.state === 'past')),
      gave: sum(rows.filter((r) => r.state === 'gave'), gave),
    },
    columns: {
      open: sum(rows.filter((r) => r.state === 'open')),
      closing: sum(rows.filter((r) => r.state === 'closing')),
      past: sum(rows.filter((r) => r.state === 'past')),
      gave: sum(rows.filter((r) => r.state === 'gave'), gave),
    },
  };
}

/* ------------------------------------------------------------------ queries */

const ASKS_SQL = readOnly(`SELECT a.id AS id, a.constituent_record_id AS cid, substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) AS d,
       t.action_ask_amount AS amt, a.action_summary AS summary, substr(COALESCE(a.action_description, ''), 1, 400) AS description,
       json_extract(a.raw_json, '$.fundraisers') AS frs,
       COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name,
       json_extract(c.raw_json, '$.address.city') AS city, json_extract(c.raw_json, '$.address.state') AS st, c.deceased AS deceased
  FROM action_tags t JOIN actions a ON a.id = t.id JOIN constituents c ON c.id = a.constituent_record_id
 WHERE CAST(COALESCE(t.action_ask_amount, 0) AS REAL) > 0 AND substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) >= ?1
 ORDER BY COALESCE(a.action_completed_date, a.action_date_due) DESC LIMIT 4000`);

const GIVER_GIFTS_SQL = readOnly(`SELECT g.id AS id, g.constituent_record_id AS giver, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS gdate, g.soft_credits AS soft
  FROM gifts g WHERE g.constituent_record_id IN (SELECT value FROM json_each(?1)) AND substr(g.gift_date, 1, 10) >= ?2 AND g.gift_amount > 0
   AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'`);

const SOFT_GIFTS_SQL = readOnly(`SELECT g.id AS id, g.constituent_record_id AS giver, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS gdate, g.soft_credits AS soft
  FROM gifts g WHERE substr(g.gift_date, 1, 10) >= ?1 AND g.gift_amount > 0 AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'
   AND g.soft_credits LIKE '%constituent_id%' LIMIT 5000`);

const FUNDRAISER_NAMES_SQL = readOnly('SELECT id AS id, fundraiser_first_name AS first, fundraiser_last_name AS last FROM fundraisers');

const chunkOf = <T>(list: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

/** Actions Blackbaud no longer has (read live and answered 404). The mirror keeps deleted rows, so these are left out. */
export async function loadGone(env: Env): Promise<Set<string>> {
  if (!env.DB) return new Set();
  const r = await env.DB.prepare('SELECT action_id FROM act_ask_gone').all<{ action_id: string }>().catch(() => ({ results: [] as { action_id: string }[] }));
  return new Set(r.results.map((x) => String(x.action_id)));
}

export async function loadCloses(env: Env): Promise<AskClose[]> {
  if (!env.DB) return [];
  const r = await env.DB.prepare('SELECT action_id, expected_close, set_by FROM act_ask_close').all<AskClose>().catch(() => ({ results: [] as AskClose[] }));
  return r.results;
}

/** Every ask in the window, with its column. A few mirror reads and one hub read. */
export async function loadAsks(env: Env, q: Q, today: string, allTime = false): Promise<AskRow[]> {
  const since = allTime ? '2000-01-01' : addDays(today, -ASK_DAYS);
  // Read a little further back so an ask first tagged just before the window still joins its later tags.
  const asks = await q<RawAsk>(ASKS_SQL, [allTime ? since : addDays(since, -SAME_ASK_DAYS)]);
  const cids = [...new Set(asks.map((a) => String(a.cid)))];
  const minDate = asks.reduce((m, a) => (day(a.d) < m ? day(a.d) : m), today);
  const parts = await Promise.all(chunkOf(cids, 400).map((c) => q<RawAskGift>(GIVER_GIFTS_SQL, [JSON.stringify(c), minDate])));
  const soft = cids.length ? await q<RawAskGift>(SOFT_GIFTS_SQL, [minDate]) : [];
  const seen = new Set<string>();
  const gifts: RawAskGift[] = [];
  for (const g of parts.flat().concat(soft)) if (!seen.has(String(g.id))) { seen.add(String(g.id)); gifts.push(g); }
  const [closes, gone] = await Promise.all([loadCloses(env), loadGone(env)]);
  return shapeAsks({ asks, gifts, closes, gone }, today).filter((r) => r.date >= since);
}

export interface AsksOut {
  ok: true;
  today: string;
  synced: string;
  days: number;
  /** '12m' or 'all': how far back the asks reach. */
  range: '12m' | 'all';
  owner: string;
  /** Every ask in the person's portfolio, before the director picker narrows it. */
  everyone: number;
  owners: { id: string; name: string; n: number }[];
  rows: (AskRow & { ownerNames: string[] })[];
  stats: AskStats;
  columns: AskColumns;
  /** Sum of every ask on the board, for the tie-out against a direct count of the Amount of Ask tags. */
  total: number;
  /** Asks at or over REVIEW_AMOUNT, left out of every total above. */
  review: Tally;
}

const visible = (s: Scope | undefined): Set<string> | null => (!s || s.all ? null : s.fids);
export const mayAsks = (s: Scope | undefined): boolean => !s || s.role === 'admin' || s.role === 'support' || s.role === 'director';

export async function asksResponse(ctx: Ctx, ownerIn: string, rangeIn = '12m'): Promise<AsksOut> {
  if (!mayAsks(ctx.scope)) throw new HttpError(403, 'not_yours', 'Asks is for directors and the Support Team.');
  const today = todayEt();
  const q = mirrorQ(ctx.env);
  const [all, names] = await Promise.all([loadAsks(ctx.env, q, today, rangeIn === 'all'), q<{ id: string; first: string; last: string }>(FUNDRAISER_NAMES_SQL).catch(() => [])]);
  const nameOf: Record<string, string> = {};
  for (const f of names) nameOf[String(f.id)] = `${f.first || ''} ${f.last || ''}`.trim();
  const vis = visible(ctx.scope);
  const mine = all.map((r) => ({ ...r, owners: vis ? r.owners.filter((o) => vis.has(o)) : r.owners })).filter((r) => r.owners.length);
  const count = new Map<string, number>();
  for (const r of mine) for (const o of r.owners) count.set(o, (count.get(o) || 0) + 1);
  const owner = ownerIn && count.has(ownerIn) ? ownerIn : ctx.scope && ctx.scope.role === 'director' && ctx.scope.fid ? ctx.scope.fid : '';
  const rows = mine.filter((r) => !owner || r.owners.includes(owner));
  const { stats, columns } = statsOf(rows, today);
  return {
    ok: true,
    today,
    synced: await ctx.repo.synced().catch(() => ''),
    days: ASK_DAYS,
    range: rangeIn === 'all' ? 'all' : '12m',
    owner,
    everyone: mine.length,
    owners: [...count.entries()].map(([id, n]) => ({ id, name: nameOf[id] || `Fundraiser ${id}`, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
    rows: rows.map((r) => ({ ...r, ownerNames: r.owners.map((o) => nameOf[o] || `Fundraiser ${o}`) })),
    stats,
    columns,
    total: rows.filter((r) => !r.review).reduce((t, r) => t + r.amount, 0),
    review: { n: rows.filter((r) => r.review).length, total: rows.filter((r) => r.review).reduce((t, r) => t + r.amount, 0) },
  };
}

/* ------------------------------------------------------------------ the close date */

const ONE_ASK_SQL = readOnly(`SELECT a.id AS id, a.constituent_record_id AS cid, t.action_ask_amount AS amt, json_extract(a.raw_json, '$.fundraisers') AS frs
  FROM action_tags t JOIN actions a ON a.id = t.id WHERE a.id = ?1 AND CAST(COALESCE(t.action_ask_amount, 0) AS REAL) > 0 LIMIT 1`);

/** Set the close date on an ask, or clear it with null. Returns the date it had before, which is what Undo sends back. */
export async function setClose(ctx: Ctx, id: string, dateIn: unknown): Promise<{ id: string; close: string | null; previous: string | null }> {
  if (!mayAsks(ctx.scope)) throw new HttpError(403, 'not_yours', 'Asks is for directors and the Support Team.');
  if (!ID.test(id)) throw new HttpError(400, 'bad_id', 'That is not an ask.');
  const date = dateIn == null || dateIn === '' ? null : String(dateIn);
  const today = todayEt();
  if (date !== null) {
    if (!DAY.test(date) || Number.isNaN(Date.parse(date + 'T12:00:00Z'))) throw new HttpError(400, 'bad_date', 'Pick a date.');
    if (date < today) throw new HttpError(400, 'past_date', 'Pick today or a later day.');
    if (date > addDays(today, 365 * 5)) throw new HttpError(400, 'far_date', 'Pick a date within five years.');
  }
  const ask = (await mirrorQ(ctx.env)<{ id: string; cid: string; frs: string | null }>(ONE_ASK_SQL, [id]))[0];
  if (!ask) throw new HttpError(404, 'no_ask', 'That ask is not in the Blackbaud copy.');
  const owners = parse<string[]>(ask.frs, []).map(String);
  const vis = visible(ctx.scope);
  if (vis && !owners.some((o) => vis.has(o))) throw new HttpError(403, 'not_yours', 'That ask belongs to someone outside your portfolio.');
  if (ctx.testCid && String(ask.cid) !== ctx.testCid) throw new HttpError(403, 'test_only', 'A role test may change only the test record.');
  const prev = await ctx.env.DB.prepare('SELECT expected_close FROM act_ask_close WHERE action_id = ? LIMIT 1').bind(id).first<{ expected_close: string }>();
  if (date === null) await ctx.env.DB.prepare('DELETE FROM act_ask_close WHERE action_id = ?').bind(id).run();
  else
    await ctx.env.DB.prepare(
      `INSERT INTO act_ask_close (action_id, expected_close, set_by, set_by_email, set_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(action_id) DO UPDATE SET expected_close = excluded.expected_close, set_by = excluded.set_by, set_by_email = excluded.set_by_email, set_at = excluded.set_at`
    ).bind(id, date, ctx.actor, ctx.email, nowIso()).run();
  await logEvent(ctx.env, { actor: ctx.actor, actor_email: ctx.email, action_id: id, kind: 'ask_close', ok: true, detail: `${prev ? prev.expected_close : 'none'} to ${date || 'none'}` }).catch(() => undefined);
  return { id, close: date, previous: prev ? prev.expected_close : null };
}
