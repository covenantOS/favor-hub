// The HQTY letters desk (Work Center, round 3 Group C). Every gift of $5,000 and up, newest first, with where its letter stands.
// Read from the D1 mirror (gifts, constituents, addresses, actions) and laid over the hub's own act_hqty rows, so a step shows at
// once. A gift counts as already written when an "RESERVED (HQTY Letter)" action sits on a partner the gift counts for, dated on or
// after the gift (the mirror's 2026 test: 212 gifts, 138 with one, 74 without). Mark mailed writes one such action through the
// outbox (1 SKY call per letter), so Recent, Undo and the write guard apply. No Blackbaud calls are made to read the list.
//
// Mirror rules that shape the SQL: the endpoint refuses any statement whose text contains insert, update, replace, upsert, delete,
// drop, alter or create anywhere (readOnly checks it), and a list of ids goes in as one JSON parameter read with json_each(?).
import { HttpError, newId, nowIso, type Env } from '../http';
import { readOnly, FUNDS_SQL } from './repo';
import { mirrorQ, type Q } from './partner';
import { setSetting } from './db';
import { authorizeBatch, saveBatch, todayEt, type Ctx, type PlannedItem } from './service';
import { planEdit } from './edit';
import { GIVEN } from './gifts';
import { HQTY_DEFAULT, HQTY_CLOSING, cleanLetterText, hqtyLetter, monthName, money, shortDay, usableAddress, type Address, type LetterDoc, type Party } from './letters';
import { CATCH_ALL } from '../foundations/blackbaud';
import { HQTY_TYPE } from '../actions/contact-types';
import type { Scope } from './role';

export const HQTY_MIN = 5000;
export const STATES = ['write', 'printed', 'signed', 'mailed', 'cannot'] as const;
export type HqtyState = (typeof STATES)[number];
export const WHYS = ['Pass-through for another ministry', 'No partner credited', 'Returned mail', 'Sent outside the hub'] as const;
/** The first day the desk looks at. Older gifts belong to earlier years. */
export const DESK_SINCE = '2026-01-01';

export const mayHqty = (s: Scope | undefined): boolean => !s || s.role === 'admin' || s.role === 'support';

const text = (v: unknown): string => (v == null ? '' : String(v));
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

export interface RawHqtyGift { id: string; giver: string; amount: number; gdate: string; gtype: string; pm: string; splits: string | null; soft: string | null }
export interface RawParty { id: string; kind: string; first: string; last: string; preferred: string; org: string; title: string; sfirst: string; slast: string; name: string; city: string; st: string; inactive: number; deceased: number }
export interface RawAddr { cid: string; lines: string; city: string; state: string; zip: string; country: string; dnm: number; prim: number }
export interface RawAction { cid: string; id: string; d: string }
export interface RawHub { gift_id: string; cid: string; state: string; why: string | null; printed_at: string | null; signed_at: string | null; mailed_at: string | null; batch_id: string | null; bstate: string | null; bb_id: string | null; byname: string | null }
export interface RawHqty {
  gifts: RawHqtyGift[];
  parties: RawParty[];
  addrs: RawAddr[];
  actions: RawAction[];
  funds: { id: string; name: string }[];
  hub: RawHub[];
  /** month (YYYY-MM) to the letter text saved for that month */
  texts: Record<string, string>;
}

export interface HqtyRow {
  key: string;
  giftId: string;
  cid: string;
  amount: number;
  date: string;
  month: string;
  type: string;
  pay: string;
  fund: string;
  partner: { name: string; place: string };
  /** The giver, when the letter goes to a partner the gift is soft credited to. */
  through: string | null;
  address: string;
  flags: string[];
  state: HqtyState;
  /** Where the state came from: this hub, or an HQTY action already in Blackbaud. */
  source: 'hub' | 'blackbaud' | '';
  stateDate: string;
  actionId: string;
  why: string;
}

const PAY: Record<string, string> = { PersonalCheck: 'Check', CreditCard: 'Card', Cash: 'Cash', DirectDebit: 'Bank draft', PayPal: 'PayPal', Other: 'Other' };

export interface Credited { cid: string; giver: string; soft: boolean }
/** The partner a letter goes to: the first soft-credited partner, else the giver. Both count for the "letter already logged" test. */
export function creditedOf(g: Pick<RawHqtyGift, 'giver' | 'soft'>): { to: string; counts: string[]; soft: boolean } {
  const soft = parse<any[]>(g.soft, [])
    .map((s) => ({ c: String(s?.constituent_id || ''), a: num(s?.amount?.value) }))
    .filter((s) => s.c && s.c !== String(g.giver) && s.a > 0);
  const to = soft.length ? soft[0].c : String(g.giver);
  return { to, counts: [...new Set([String(g.giver), ...soft.map((s) => s.c)])], soft: soft.length > 0 };
}

export const partyOf = (r: RawParty | undefined): Party => ({
  kind: r ? text(r.kind) : '', first: r?.first, last: r?.last, preferred: r?.preferred, org: r?.org, title: r?.title, spouseFirst: r?.sfirst, spouseLast: r?.slast, name: r?.name,
});

export function pickAddress(list: RawAddr[]): { addr: Address | null; doNotMail: boolean } {
  const sorted = list.slice().sort((a, b) => num(b.prim) - num(a.prim));
  const as = (x: RawAddr): Address => ({ lines: text(x.lines), city: text(x.city), state: text(x.state), zip: text(x.zip), country: text(x.country) });
  const ok = sorted.find((x) => usableAddress(as(x)));
  if (!ok) return { addr: null, doNotMail: false };
  return { addr: as(ok), doNotMail: num(ok.dnm) === 1 };
}

/** The text saved for a month, else the latest earlier month's, else the default. */
export function textForMonth(texts: Record<string, string>, ym: string): string {
  const keys = Object.keys(texts).filter((k) => k <= ym).sort();
  return keys.length ? texts[keys[keys.length - 1]] : HQTY_DEFAULT;
}

export interface Shaped {
  rows: HqtyRow[];
  stats: { write: number; printed: number; signed: number; mailedMonth: number; earlier: number; total: number };
}

/** Months the desk counts as current: this one and the one before it. */
export function recentFrom(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}-01`;
}

export function shapeHqty(raw: RawHqty, o: { today: string }): Shaped {
  const parties = new Map(raw.parties.map((p) => [String(p.id), p]));
  const nameOf = (id: string): string => {
    const p = parties.get(id);
    if (!p) return `Record ${id}`;
    return text(p.name) || [p.first, p.last].filter(Boolean).join(' ') || text(p.org) || `Record ${id}`;
  };
  const addrs = new Map<string, RawAddr[]>();
  for (const a of raw.addrs) (addrs.get(String(a.cid)) || addrs.set(String(a.cid), []).get(String(a.cid))!).push(a);
  const funds = new Map(raw.funds.map((f) => [String(f.id), f.name]));
  const acts = new Map<string, RawAction[]>();
  for (const a of raw.actions) (acts.get(String(a.cid)) || acts.set(String(a.cid), []).get(String(a.cid))!).push(a);
  const hub = new Map(raw.hub.map((h) => [String(h.gift_id), h]));
  const monthStart = o.today.slice(0, 7) + '-01';
  const recent = recentFrom(o.today);
  const rows: HqtyRow[] = [];
  const stats = { write: 0, printed: 0, signed: 0, mailedMonth: 0, earlier: 0, total: 0 };

  for (const g of raw.gifts) {
    const cr = creditedOf(g);
    const date = day(g.gdate);
    const party = parties.get(cr.to);
    const { addr, doNotMail } = pickAddress(addrs.get(cr.to) || []);
    const flags: string[] = [];
    if (!party || cr.to === CATCH_ALL.system) flags.push('No partner credited');
    if (!addr) flags.push('No mailing address');
    else if (doNotMail) flags.push('Do not mail');
    if (party && num(party.deceased) === 1) flags.push('Deceased');
    // Already logged in Blackbaud: an HQTY action on a partner the gift counts for, dated on or after the gift.
    const logged = cr.counts.flatMap((c) => acts.get(c) || []).filter((a) => day(a.d) >= date).sort((a, b) => (a.d < b.d ? -1 : 1))[0];
    const h = hub.get(String(g.id));
    // A mailed row whose batch was undone is back to signed.
    const hubState: HqtyState | '' = h ? (h.state === 'mailed' && h.bstate === 'undone' ? 'signed' : (h.state as HqtyState)) : '';
    let state: HqtyState = 'write';
    let source: HqtyRow['source'] = '';
    let stateDate = '';
    let actionId = '';
    if (hubState === 'mailed') {
      state = 'mailed';
      source = 'hub';
      stateDate = day(h!.mailed_at);
      actionId = text(h!.bb_id);
    } else if (logged) {
      state = 'mailed';
      source = 'blackbaud';
      stateDate = day(logged.d);
      actionId = text(logged.id);
    } else if (hubState === 'cannot') {
      state = 'cannot';
      source = 'hub';
      stateDate = day(h!.printed_at || h!.mailed_at || '');
    } else if (hubState === 'signed' || hubState === 'printed') {
      state = hubState;
      source = 'hub';
      stateDate = day(hubState === 'signed' ? h!.signed_at : h!.printed_at);
    }
    const ym = date.slice(0, 7);
    const row: HqtyRow = {
      key: String(g.id),
      giftId: String(g.id),
      cid: cr.to,
      amount: num(g.amount),
      date,
      month: ym,
      type: text(g.gtype),
      pay: PAY[g.pm] || text(g.pm),
      fund: [...new Set(parse<any[]>(g.splits, []).map((s) => funds.get(String(s?.fund_id)) || '').filter(Boolean))].join(', '),
      partner: { name: nameOf(cr.to), place: party ? [text(party.city), text(party.st)].filter(Boolean).join(', ') : '' },
      through: cr.soft ? nameOf(String(g.giver)) : null,
      address: addr ? [addr.lines.replace(/\r?\n/g, ', '), [addr.city, [addr.state, addr.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') : '',
      flags,
      state,
      source,
      stateDate,
      actionId,
      why: state === 'cannot' ? text(h!.why) : '',
    };
    rows.push(row);
    stats.total++;
    if (state === 'write') {
      if (date >= recent) stats.write++;
      else stats.earlier++;
    } else if (state === 'printed') stats.printed++;
    else if (state === 'signed') stats.signed++;
    else if (state === 'mailed' && stateDate >= monthStart) stats.mailedMonth++;
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.giftId < b.giftId ? 1 : -1));
  return { rows, stats };
}

/* ------------------------------------------------------------------ queries */

const GIFTS_SQL = readOnly(`SELECT g.id AS id, g.constituent_record_id AS giver, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS gdate, g.gift_type AS gtype,
       g.gift_payment_method AS pm, g.gift_splits AS splits, g.soft_credits AS soft
  FROM gifts g WHERE substr(g.gift_date, 1, 10) >= ?1 AND g.gift_amount >= ${HQTY_MIN} AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'
 ORDER BY g.gift_date DESC, g.id DESC LIMIT 1500`);

const GIFTS_BY_ID_SQL = readOnly(`SELECT g.id AS id, g.constituent_record_id AS giver, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS gdate, g.gift_type AS gtype,
       g.gift_payment_method AS pm, g.gift_splits AS splits, g.soft_credits AS soft
  FROM gifts g WHERE g.id IN (SELECT value FROM json_each(?1))`);

const PARTIES_SQL = readOnly(`SELECT c.id AS id, c.constituent_type AS kind, c.first_name AS first, c.last_name AS last, c.preferred_name AS preferred, c.organization_name AS org, c.title AS title,
       c.spouse_first_name AS sfirst, c.spouse_last_name AS slast,
       COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name,
       json_extract(c.raw_json, '$.address.city') AS city, json_extract(c.raw_json, '$.address.state') AS st, c.inactive AS inactive, c.deceased AS deceased
  FROM constituents c WHERE c.id IN (SELECT value FROM json_each(?1))`);

const ADDR_SQL = readOnly(`SELECT constituent_record_id AS cid, address_lines AS lines, address_city AS city, address_state AS state, address_postal_code AS zip, address_country AS country,
       do_not_mail AS dnm, is_primary AS prim
  FROM addresses WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0`);

const ACTIONS_SQL = readOnly(`SELECT constituent_record_id AS cid, id AS id, substr(action_date_due, 1, 10) AS d FROM actions
 WHERE action_type = '${HQTY_TYPE}' AND json_extract(raw_json, '$.completed') = 1 AND constituent_record_id IN (SELECT value FROM json_each(?1))`);

const chunkOf = <T>(list: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

export async function hubRows(env: Env, giftIds: string[]): Promise<RawHub[]> {
  const out: RawHub[] = [];
  if (!env.DB) return out;
  for (const part of chunkOf(giftIds, 80)) {
    const r = await env.DB.prepare(
      `SELECT h.gift_id, h.cid, h.state, h.why, h.printed_at, h.signed_at, h.mailed_at, h.batch_id, b.state AS bstate,
              (SELECT o.bb_id FROM act_outbox o WHERE o.batch_id = h.batch_id AND o.op = 'create' AND o.bb_id IS NOT NULL LIMIT 1) AS bb_id, h.by_name AS byname
         FROM act_hqty h LEFT JOIN act_batches b ON b.id = h.batch_id WHERE h.gift_id IN (${part.map(() => '?').join(',')})`
    ).bind(...part).all<RawHub>().catch(() => ({ results: [] as RawHub[] }));
    out.push(...r.results);
  }
  return out;
}

export async function monthTexts(env: Env): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!env.DB) return out;
  const r = await env.DB.prepare("SELECT key, value FROM act_settings WHERE key LIKE 'hqty:text:%'").all<{ key: string; value: string }>().catch(() => ({ results: [] as { key: string; value: string }[] }));
  for (const x of r.results) out[x.key.slice('hqty:text:'.length)] = x.value;
  return out;
}

/** Everything the desk needs, from the mirror in a handful of queries, laid over the hub's rows. ids reads those gifts only (any size). */
export async function loadHqty(env: Env, q: Q, o: { today: string; since?: string; ids?: string[] }): Promise<{ raw: RawHqty; shaped: Shaped }> {
  const gifts = o.ids ? await q<RawHqtyGift>(GIFTS_BY_ID_SQL, [JSON.stringify(o.ids)]) : await q<RawHqtyGift>(GIFTS_SQL, [o.since || DESK_SINCE]);
  const cids = new Set<string>();
  const fundIds = new Set<string>();
  for (const g of gifts) {
    const cr = creditedOf(g);
    cr.counts.forEach((c) => cids.add(c));
    cids.add(cr.to);
    for (const s of parse<any[]>(g.splits, [])) if (s?.fund_id != null) fundIds.add(String(s.fund_id));
  }
  const all = [...cids];
  const each = async <T>(sql: string): Promise<T[]> => {
    const out: T[] = [];
    for (const part of chunkOf(all, 400)) out.push(...(await q<T>(sql, [JSON.stringify(part)])));
    return out;
  };
  const [parties, addrs, actions, funds, hub, texts] = await Promise.all([
    each<RawParty>(PARTIES_SQL),
    each<RawAddr>(ADDR_SQL),
    each<RawAction>(ACTIONS_SQL),
    fundIds.size ? q<{ id: string; name: string }>(FUNDS_SQL, [JSON.stringify([...fundIds])]) : Promise.resolve([] as { id: string; name: string }[]),
    hubRows(env, gifts.map((g) => String(g.id))),
    monthTexts(env),
  ]);
  const raw: RawHqty = { gifts, parties, addrs, actions, funds, hub, texts };
  return { raw, shaped: shapeHqty(raw, { today: o.today }) };
}

export interface HqtyOut {
  ok: true;
  today: string;
  synced: string;
  since: string;
  rows: HqtyRow[];
  stats: Shaped['stats'];
  whys: readonly string[];
  /** The letter text for the current month and the month it came from. */
  text: { month: string; body: string; saved: boolean; defaultBody: string };
  months: Record<string, string>;
}

export async function hqtyResponse(ctx: Ctx, q: Q = mirrorQ(ctx.env)): Promise<HqtyOut> {
  if (!mayHqty(ctx.scope)) throw new HttpError(403, 'not_yours', 'HQTY letters is for the Support Team.');
  const today = todayEt();
  const { raw, shaped } = await loadHqty(ctx.env, q, { today });
  const ym = today.slice(0, 7);
  return {
    ok: true,
    today,
    synced: await ctx.repo.synced().catch(() => ''),
    since: DESK_SINCE,
    rows: shaped.rows,
    stats: shaped.stats,
    whys: WHYS,
    text: { month: ym, body: textForMonth(raw.texts, ym), saved: raw.texts[ym] !== undefined, defaultBody: HQTY_DEFAULT },
    months: raw.texts,
  };
}

/** Save the letter text for one month. */
export async function saveMonthText(ctx: Ctx, month: string, body: unknown): Promise<{ month: string; body: string }> {
  if (!mayHqty(ctx.scope)) throw new HttpError(403, 'not_yours', 'HQTY letters is for the Support Team.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'bad_month', 'Pick a month.');
  const t = cleanLetterText(body);
  if (t.length < 20) throw new HttpError(400, 'too_short', 'The letter needs at least a sentence.');
  await setSetting(ctx.env, `hqty:text:${month}`, t);
  return { month, body: t };
}

export async function monthTextFor(env: Env, ym: string): Promise<string> {
  return textForMonth(await monthTexts(env), ym);
}

/** A letter for each gift. Rows come from the same read the desk uses, so a letter always matches the row. */
export function lettersFor(raw: RawHqty, rows: HqtyRow[], today: string, override?: string): LetterDoc[] {
  const parties = new Map(raw.parties.map((p) => [String(p.id), p]));
  const addrs = new Map<string, RawAddr[]>();
  for (const a of raw.addrs) (addrs.get(String(a.cid)) || addrs.set(String(a.cid), []).get(String(a.cid))!).push(a);
  return rows.map((r) => {
    const { addr } = pickAddress(addrs.get(r.cid) || []);
    return hqtyLetter(partyOf(parties.get(r.cid)), addr, { amount: r.amount, date: r.date, fund: r.fund }, override ?? textForMonth(raw.texts, r.month), today);
  });
}

/* ------------------------------------------------------------------ steps */

const REQ = /^[\w:.-]{1,60}$/;

export interface StepInput {
  ids?: unknown;
  to?: unknown;
  why?: unknown;
  req?: unknown;
}

/** The rows a request names, checked against the desk: only gifts of $5,000 and up (a role test may name its one test record's gifts). */
async function pick(ctx: Ctx, ids: unknown, q: Q = mirrorQ(ctx.env)): Promise<{ raw: RawHqty; rows: HqtyRow[] }> {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((x) => /^\d{1,12}$/.test(x)))];
  if (!list.length) throw new HttpError(400, 'nothing_to_do', 'Pick a gift first.');
  if (list.length > 100) throw new HttpError(400, 'too_many', 'Pick 100 gifts or fewer at a time.');
  const { raw, shaped } = await loadHqty(ctx.env, q, { today: todayEt(), ids: list });
  const rows = shaped.rows.filter((r) => (ctx.testCid ? r.cid === ctx.testCid : r.amount >= HQTY_MIN));
  if (!rows.length) throw new HttpError(404, 'no_gift', 'That gift is not a gift of $5,000 or more in the Blackbaud copy.');
  return { raw, rows };
}

export async function pickRows(ctx: Ctx, ids: unknown, q?: Q) {
  if (!mayHqty(ctx.scope)) throw new HttpError(403, 'not_yours', 'HQTY letters is for the Support Team.');
  return pick(ctx, ids, q);
}

/** The fundraiser the letter action goes on: the person's own Blackbaud id, else the first Support Team member who has one. */
async function actorFid(ctx: Ctx): Promise<string> {
  if (ctx.scope?.fid) return ctx.scope.fid;
  const r = await ctx.env.DB.prepare("SELECT bb_fundraiser_id AS id FROM act_staff WHERE team = 'support' AND active = 1 AND bb_fundraiser_id IS NOT NULL ORDER BY name LIMIT 1").first<{ id: string }>().catch(() => null);
  if (!r || !r.id) throw new HttpError(400, 'no_fundraiser', 'No Support Team member with a Blackbaud fundraiser id is on the staff list, so the letter has nobody to be logged under.');
  return String(r.id);
}

/**
 * Move gifts forward. printed and signed are marks in this hub. cannot needs a reason. reset puts a gift back to To write. mailed saves
 * one HQTY Letter action per gift as an ordinary batch (the page then sends it with .../batches/:id/run).
 */
export async function hqtyStep(ctx: Ctx, input: StepInput, q?: Q) {
  if (!mayHqty(ctx.scope)) throw new HttpError(403, 'not_yours', 'HQTY letters is for the Support Team.');
  const to = String(input.to || '');
  if (!['printed', 'signed', 'mailed', 'cannot', 'reset'].includes(to)) throw new HttpError(400, 'bad_step', 'Pick a step.');
  const { rows } = await pick(ctx, input.ids, q);
  const why = String(input.why || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (to === 'cannot' && !why) throw new HttpError(400, 'needs_why', 'Pick why the letter cannot be sent.');
  const now = nowIso();
  const done: string[] = [];
  const skipped: { giftId: string; why: string }[] = [];
  const mark = async (r: HqtyRow, state: HqtyState, set: Record<string, string | null>): Promise<void> => {
    await ctx.env.DB.prepare(
      `INSERT INTO act_hqty (gift_id, cid, state, why, printed_at, signed_at, mailed_at, batch_id, by_name, by_email, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
       ON CONFLICT(gift_id) DO UPDATE SET state = excluded.state, why = excluded.why, printed_at = COALESCE(excluded.printed_at, act_hqty.printed_at),
         signed_at = COALESCE(excluded.signed_at, act_hqty.signed_at), mailed_at = COALESCE(excluded.mailed_at, act_hqty.mailed_at),
         batch_id = COALESCE(excluded.batch_id, act_hqty.batch_id), by_name = excluded.by_name, by_email = excluded.by_email, updated_at = excluded.updated_at`
    ).bind(r.giftId, r.cid, state, set.why ?? null, set.printed_at ?? null, set.signed_at ?? null, set.mailed_at ?? null, set.batch_id ?? null, ctx.actor, ctx.email, now).run();
  };

  if (to === 'reset') {
    for (const r of rows) {
      if (r.source !== 'hub' || r.state === 'mailed' || r.state === 'write') {
        skipped.push({ giftId: r.giftId, why: r.state === 'mailed' ? 'A mailed letter is taken back with Undo in Recent.' : 'Nothing to put back.' });
        continue;
      }
      await ctx.env.DB.prepare('DELETE FROM act_hqty WHERE gift_id = ?').bind(r.giftId).run();
      done.push(r.giftId);
    }
    return { ok: true, done, skipped };
  }

  if (to === 'printed' || to === 'signed') {
    for (const r of rows) {
      if (r.state === 'mailed' || r.state === 'cannot') {
        skipped.push({ giftId: r.giftId, why: r.state === 'mailed' ? 'That letter is already mailed.' : 'That gift is marked Cannot send. Put it back first.' });
        continue;
      }
      if (to === 'printed') {
        if (r.state === 'write') await mark(r, 'printed', { printed_at: now });
        else await mark(r, r.state, { printed_at: now });
      } else await mark(r, 'signed', { printed_at: r.state === 'write' ? now : null, signed_at: now });
      done.push(r.giftId);
    }
    return { ok: true, done, skipped };
  }

  if (to === 'cannot') {
    for (const r of rows) {
      if (r.state === 'mailed') {
        skipped.push({ giftId: r.giftId, why: 'That letter is already mailed.' });
        continue;
      }
      await mark(r, 'cannot', { why });
      done.push(r.giftId);
    }
    return { ok: true, done, skipped };
  }

  // mailed: one HQTY Letter action per gift, through the outbox.
  const req = REQ.test(String(input.req || '')) ? String(input.req) : newId('wcr');
  const today = todayEt();
  const fid = await actorFid(ctx);
  const ready: HqtyRow[] = [];
  for (const r of rows) {
    if (r.state === 'mailed') skipped.push({ giftId: r.giftId, why: r.source === 'blackbaud' ? 'Blackbaud already holds an HQTY Letter for this gift.' : 'That letter is already mailed.' });
    else if (r.state === 'cannot') skipped.push({ giftId: r.giftId, why: 'That gift is marked Cannot send. Put it back first.' });
    else if (r.state === 'write') skipped.push({ giftId: r.giftId, why: 'Print the letter first.' });
    else ready.push(r);
  }
  if (!ready.length) return { ok: true, done, skipped, batch: null };
  await authorizeBatch(ctx, { op: 'new', cids: [...new Set(ready.map((r) => r.cid))], set: { fundraisers: [fid] } });
  const synced = await ctx.repo.synced().catch(() => '');
  const planned: PlannedItem[] = [];
  let reads = 0;
  for (const r of ready) {
    const set: Record<string, unknown> = {
      category: 'Mailing',
      type: HQTY_TYPE,
      date: today,
      summary: `HQTY ${monthName(r.month)} letter`,
      description: `Letter for the ${money(r.amount)} gift of ${shortDay(r.date)}${r.fund ? ', ' + r.fund : ''} (gift ${r.giftId}).${r.through ? ' Given through ' + r.through + '.' : ''}`,
      fundraisers: [fid],
      completed: true,
      status: 'Completed',
      direction: 'Outbound',
    };
    const plan = await planEdit(ctx, { op: 'new', cids: [r.cid], set } as any, { today, synced });
    planned.push(...plan.items);
    reads += plan.reads;
  }
  const batch = await saveBatch(ctx, 'new', planned, { op: 'new', n: planned.length, summary: 'HQTY letter', hqty: ready.length }, { reqId: req + ':h', reads, keySalt: req });
  if (batch.id) {
    for (const r of ready) await mark(r, 'mailed', { mailed_at: now, batch_id: batch.id });
    done.push(...ready.map((r) => r.giftId));
  }
  return { ok: true, done, skipped, batch: batch.id ? { id: batch.id, n: batch.n, run_when: batch.run_when } : null };
}

export { HQTY_CLOSING };
