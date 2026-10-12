// Declined payments and zeroed gifts (Work Center tab "Declines"). Blackbaud records a failed recurring charge as a $0 payment whose
// Reference holds the processor's reason ("HARDREJECT: ...", "SOFTREJECT: ..."). A returned check ends as a gift set to $0. Admin Desk and
// Partner Care followed these up from the gift list; this reads them from the D1 copy of Blackbaud and lays the hub's own follow-up
// rows over them, so an outcome shows at once. Read only: no Blackbaud calls, and no card, amount or schedule is touched here.
//
// Mirror rules that shape the SQL: the endpoint refuses any statement whose text contains insert, update, replace, upsert, delete,
// drop, alter or create anywhere (readOnly checks it), and a list of ids goes in as one JSON parameter read with json_each(?).
import { readOnly } from './repo';
import type { Q } from './partner';
import { addDays } from '../actions/completion';
import { ADDRESSES_SQL, EMAILS_SQL, FACTS_SQL, PHONES_SQL } from './cadence';

/** How far back the desk looks. A decline older than this has been handled or lost. */
export const DECLINE_DAYS = 90;

export type Kind = 'hard' | 'soft' | 'full' | 'zeroed';
export const KIND_LABEL: Record<Kind, string> = { hard: 'Hard reject', soft: 'Soft reject', full: 'Recorded at full amount', zeroed: 'Zeroed gift' };
export const KIND_ORDER: Kind[] = ['hard', 'soft', 'full', 'zeroed'];

/** How the follow-up ends. Open keeps the row on the list. */
export const STATUSES = ['open', 'fixed', 'ended', 'unreachable', 'no_action'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { open: 'Still open', fixed: 'Card or bank fixed', ended: 'Partner ended the gift', unreachable: 'Cannot reach', no_action: 'Nothing to do' };

export type How = 'call' | 'text' | 'email' | 'card' | 'note';
export const HOWS: How[] = ['call', 'text', 'email', 'card', 'note'];

export const DECLINED_SQL = readOnly(`SELECT g.id AS id, g.constituent_record_id AS cid, substr(g.gift_date, 1, 10) AS d, g.gift_amount AS amount, g.gift_type AS type,
       g.gift_payment_method AS pm, g.gift_status AS status, COALESCE(json_extract(g.raw_json, '$.reference'), g.gift_comments, '') AS ref,
       json_extract(g.raw_json, '$.linked_gifts[0]') AS sched
  FROM gifts g
 WHERE g.gift_date >= ?1 AND COALESCE(g.gift_status, 'Active') = 'Active' AND (
       upper(COALESCE(json_extract(g.raw_json, '$.reference'), g.gift_comments, '')) LIKE '%REJECT%'
    OR (g.gift_type = 'Donation' AND g.gift_amount = 0))
 ORDER BY g.gift_date DESC`);

/** The recurring gift behind each decline: its amount, how it is paid and whether it is still running. */
export const SCHEDULE_SQL = readOnly(`SELECT id AS id, gift_amount AS amount, gift_status AS status, gift_payment_method AS pm
  FROM gifts WHERE id IN (SELECT value FROM json_each(?1))`);

/** The latest payment that went through on each of those recurring gifts since a date. */
export const PAID_SQL = readOnly(`SELECT json_extract(raw_json, '$.linked_gifts[0]') AS sched, MAX(substr(gift_date, 1, 10)) AS last_ok
  FROM gifts WHERE gift_type = 'RecurringGiftPayment' AND gift_amount > 0 AND gift_date >= ?2
   AND json_extract(raw_json, '$.linked_gifts[0]') IN (SELECT value FROM json_each(?1)) GROUP BY 1`);

export const HOLDERS_SQL = readOnly(`SELECT a.constituent_record_id AS cid, a.assignment_fundraiser_id AS fid, a.assignment_type AS type,
       trim(COALESCE(f.fundraiser_first_name, '') || ' ' || COALESCE(f.fundraiser_last_name, '')) AS name
  FROM assignments a LEFT JOIN fundraisers f ON f.id = a.assignment_fundraiser_id
 WHERE a.constituent_record_id IN (SELECT value FROM json_each(?1)) AND (a.assignment_to_date IS NULL OR substr(a.assignment_to_date, 1, 10) >= ?2)`);

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown): string => (v == null ? '' : String(v));

/** The processor's words without the HARD or SOFT prefix and with the spaces closed up. */
export function cleanReason(ref: string): string {
  return text(ref).replace(/^\s*(HARD|SOFT)REJECT:?\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

/** hard: the card or account will not work again. soft: the bank said try again. A zero gift with no reject text is a zeroed gift. */
export function kindOf(g: { amount: number; type: string; ref: string }): Kind | null {
  const ref = text(g.ref).toUpperCase();
  if (/HARDREJECT/.test(ref)) return g.amount > 0 ? 'full' : 'hard';
  if (/SOFTREJECT/.test(ref)) return g.amount > 0 ? 'full' : 'soft';
  if (/REJECT/.test(ref)) return g.amount > 0 ? 'full' : 'hard';
  if (g.type === 'Donation' && g.amount === 0) return 'zeroed';
  return null;
}

export const methodWord = (pm: string): string => (/direct|bank|ach|eft/i.test(pm) ? 'Bank' : /credit|card/i.test(pm) ? 'Card' : text(pm) || 'Payment');

export interface FollowUp { gift_id: string; how: string; outcome: string; status: string; line: string; actor: string; at: string }

export interface DeclineRow {
  key: string;
  giftId: string;
  cid: string;
  name: string;
  place: string;
  kind: Kind;
  kindLabel: string;
  reason: string;
  date: string;
  /** Days since the decline. */
  age: number;
  method: string;
  /** The recurring gift amount that failed, when the decline sits on a schedule. */
  amount: number | null;
  scheduleId: string | null;
  scheduleStatus: string | null;
  /** Declines on the same schedule inside the window. */
  attempts: number;
  /** A later payment on the schedule went through on this date. */
  paidSince: string | null;
  /** open: needs a follow-up. paid: a later payment went through. ended: the schedule is not running. done: a person closed it. */
  state: 'open' | 'paid' | 'ended' | 'done';
  status: Status;
  holders: string[];
  phone: string | null;
  email: string | null;
  hasAddress: boolean;
  steps: number;
  last: { how: string; at: string; by: string; outcome: string } | null;
}

export interface RawDecline { id: string; cid: string; d: string; amount: number; type: string; pm: string; status: string; ref: string; sched: string | null }

const chunkOf = <T>(list: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

/** The row's state, from the schedule, a later payment and the latest follow-up the hub holds. */
export function stateOf(o: { kind: Kind; scheduleStatus: string | null; paidSince: string | null; date: string; status: Status }): DeclineRow['state'] {
  if (o.status !== 'open') return 'done';
  if (o.paidSince && o.paidSince > o.date) return 'paid';
  if (o.scheduleStatus && /terminat|cancel|complet|held/i.test(o.scheduleStatus) && o.kind !== 'zeroed') return 'ended';
  return 'open';
}

/**
 * Every decline and zeroed gift in the window. Pure over what the mirror returned so the tests can feed it made-up rows.
 * follow holds the hub's own rows, newest first per gift.
 */
export function shape(raw: RawDecline[], o: {
  today: string;
  schedules: Map<string, { amount: number; status: string; pm: string }>;
  paid: Map<string, string>;
  facts: Map<string, { name: string; place: string }>;
  holders: Map<string, string[]>;
  phones: Map<string, string | null>;
  emails: Map<string, string | null>;
  addresses: Set<string>;
  follow: FollowUp[];
}): DeclineRow[] {
  const attempts = new Map<string, number>();
  for (const g of raw) if (g.sched) attempts.set(g.sched, (attempts.get(g.sched) || 0) + 1);
  const followBy = new Map<string, FollowUp[]>();
  for (const f of o.follow) (followBy.get(f.gift_id) || followBy.set(f.gift_id, []).get(f.gift_id)!).push(f);
  // One row per schedule: the newest decline stands for the schedule, and older ones count as attempts.
  const newest = new Map<string, RawDecline>();
  for (const g of raw) {
    if (!g.sched) continue;
    const cur = newest.get(String(g.sched));
    if (!cur || g.d > cur.d || (g.d === cur.d && Number(g.id) > Number(cur.id))) newest.set(String(g.sched), g);
  }
  const rows: DeclineRow[] = [];
  for (const g of raw) {
    if (g.sched && newest.get(String(g.sched)) !== g) continue;
    const kind = kindOf({ amount: num(g.amount), type: g.type, ref: g.ref });
    if (!kind) continue;
    const sched = g.sched ? o.schedules.get(String(g.sched)) || null : null;
    const fl = (followBy.get(String(g.id)) || []).slice().sort((a, b) => (a.at < b.at ? 1 : -1));
    // The latest follow-up decides: a step logged as still open after a close reopens the row.
    const latest = fl[0];
    const eff: Status = latest && (STATUSES as readonly string[]).includes(latest.status) ? (latest.status as Status) : 'open';
    const paidSince = g.sched ? o.paid.get(String(g.sched)) || null : null;
    const f = o.facts.get(String(g.cid));
    const row: DeclineRow = {
      key: String(g.id), giftId: String(g.id), cid: String(g.cid), name: f ? f.name : `Record ${g.cid}`, place: f ? f.place : '', kind, kindLabel: KIND_LABEL[kind],
      reason: kind === 'zeroed' ? cleanReason(g.ref) || 'Gift set to $0' : cleanReason(g.ref), date: g.d, age: Math.max(0, daysBetween(g.d, o.today)),
      method: methodWord(g.pm || (sched ? sched.pm : '')), amount: kind === 'zeroed' ? null : sched ? num(sched.amount) : kind === 'full' ? num(g.amount) : null,
      scheduleId: g.sched ? String(g.sched) : null, scheduleStatus: sched ? sched.status : null, attempts: g.sched ? attempts.get(String(g.sched)) || 1 : 1, paidSince,
      state: 'open', status: eff, holders: o.holders.get(String(g.cid)) || [], phone: o.phones.get(String(g.cid)) || null, email: o.emails.get(String(g.cid)) || null,
      hasAddress: o.addresses.has(String(g.cid)), steps: fl.length,
      last: latest ? { how: latest.how, at: latest.at, by: latest.actor, outcome: latest.outcome } : null,
    };
    row.state = stateOf({ kind, scheduleStatus: row.scheduleStatus, paidSince, date: g.d, status: eff });
    rows.push(row);
  }
  const rank = (r: DeclineRow) => KIND_ORDER.indexOf(r.kind);
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : rank(a) - rank(b) || (a.name < b.name ? -1 : 1)));
  return rows;
}

/** Read the window from the mirror. The hub's follow-up rows are passed in so the mirror stays read only. */
export async function loadDeclines(q: Q, o: { today: string; follow: FollowUp[] }): Promise<DeclineRow[]> {
  const since = addDays(o.today, -DECLINE_DAYS);
  const raw = await q<RawDecline>(DECLINED_SQL, [since]);
  if (!raw.length) return [];
  const cids = [...new Set(raw.map((g) => String(g.cid)))];
  const sids = [...new Set(raw.map((g) => (g.sched ? String(g.sched) : '')).filter(Boolean))];
  const each = async <T>(sql: string, list: string[], extra: unknown[] = []): Promise<T[]> => {
    const out: T[] = [];
    for (const part of chunkOf(list, 400)) out.push(...(await q<T>(sql, [JSON.stringify(part), ...extra])));
    return out;
  };
  const [scheds, paidRows, facts, holders, phones, emails, addrs] = await Promise.all([
    sids.length ? each<{ id: string; amount: number; status: string; pm: string }>(SCHEDULE_SQL, sids) : Promise.resolve([]),
    sids.length ? each<{ sched: string; last_ok: string }>(PAID_SQL, sids, [since]) : Promise.resolve([]),
    each<{ id: string; name: string; city: string; st: string }>(FACTS_SQL, cids),
    each<{ cid: string; fid: string; type: string; name: string }>(HOLDERS_SQL, cids, [o.today]),
    each<{ cid: string; number: string; dnc: number; prim: number }>(PHONES_SQL, cids),
    each<{ cid: string; address: string; dne: number; prim: number }>(EMAILS_SQL, cids),
    each<{ cid: string; lines: string; dnm: number; prim: number }>(ADDRESSES_SQL, cids),
  ]);
  const phoneOf = new Map<string, string | null>();
  for (const p of phones.slice().sort((a, b) => num(b.prim) - num(a.prim))) if (num(p.dnc) !== 1 && !phoneOf.get(String(p.cid))) phoneOf.set(String(p.cid), String(p.number));
  const emailOf = new Map<string, string | null>();
  for (const e of emails.slice().sort((a, b) => num(b.prim) - num(a.prim))) if (num(e.dne) !== 1 && !emailOf.get(String(e.cid))) emailOf.set(String(e.cid), String(e.address));
  const holdBy = new Map<string, string[]>();
  for (const h of holders) {
    const names = holdBy.get(String(h.cid)) || holdBy.set(String(h.cid), []).get(String(h.cid))!;
    const n = text(h.name) || `Fundraiser ${h.fid}`;
    if (!names.includes(n)) names.push(n);
  }
  return shape(raw, {
    today: o.today,
    schedules: new Map(scheds.map((s) => [String(s.id), { amount: num(s.amount), status: text(s.status), pm: text(s.pm) }])),
    paid: new Map(paidRows.map((p) => [String(p.sched), text(p.last_ok)])),
    facts: new Map(facts.map((f) => [String(f.id), { name: text(f.name), place: [f.city, f.st].filter(Boolean).join(', ') }])),
    holders: holdBy,
    phones: phoneOf,
    emails: emailOf,
    addresses: new Set(addrs.filter((a) => num(a.dnm) !== 1).map((a) => String(a.cid))),
    follow: o.follow,
  });
}
