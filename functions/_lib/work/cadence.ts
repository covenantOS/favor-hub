// Partner Care cadence queue (Work Center tab "Cadence"). It applies the contact rules in the Partner Care manual to the D1 mirror and
// lists who is due. It sets no rule of its own: the rules, the order of contact and the $1,000 line are the manual's and Who Does
// What's. Read only from the mirror; the hub's own act_cadence_done and act_thanks rows lay over it so a step clears at once.
//
// Manual (Department Manuals, Partner Care): first-time partners get a call at once when they gave a number; monthly partners
// (under $1,000) a call and a handwritten card every three months; quarterly partners are thanked each time they give; twice-a-year
// partners a card and a call twice a year; annual partners a call, card, email and text. Order of contact: call, text, email, card.
//
// The mirror holds no schedule field for a recurring gift, so the pattern is read from the gift dates of the last 24 months (see classify).
import type { Env } from '../http';
import { readOnly } from './repo';
import type { Q } from './partner';
import { addDays } from '../actions/completion';

export type Rule = 'first' | 'monthly' | 'quarterly' | 'semi' | 'annual';
export type StepKey = 'call' | 'text' | 'email' | 'card';
export const STEP_ORDER: StepKey[] = ['call', 'text', 'email', 'card'];
export const STEP_LABEL: Record<StepKey, string> = { call: 'Call', text: 'Text', email: 'Email', card: 'Card' };

/** Steps each repeating rule asks for, and how many days a completed step lasts. */
export const RULE_STEPS: Record<'monthly' | 'semi' | 'annual', StepKey[]> = { monthly: ['call', 'card'], semi: ['call', 'card'], annual: ['call', 'text', 'email', 'card'] };
export const PERIOD: Record<'monthly' | 'semi' | 'annual', number> = { monthly: 90, semi: 182, annual: 365 };
/** Partner Care thanks first gifts and gifts under this amount (Who Does What). Matches PC_LIMIT in gifts.ts. */
export const LIMIT = 1000;
/** A first-time partner stays on the list this long after the first gift. */
export const FIRST_DAYS = 30;
/** A quarterly gift stays owed this long. */
export const QUARTERLY_DAYS = 60;
/** Rows due inside this many days show as coming up. */
export const AHEAD_DAYS = 14;
export const RULE_LABEL: Record<Rule, string> = { first: 'First-time partner', monthly: 'Monthly partner', quarterly: 'Quarterly partner', semi: 'Twice a year', annual: 'Annual partner' };

const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = MON.map((m) => m.slice(0, 3));
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
const money = (n: number): string => '$' + (Math.round(n) === n ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const shortDay = (iso: string): string => `${MON3[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface RawGiftRef { d: string; amt: number; rec: boolean }
export interface Pattern { rule: 'monthly' | 'quarterly' | 'semi' | 'annual'; last: string; amount: number; first: string; months: number[]; recurring: boolean }

/**
 * The gift pattern from the dates of the last 24 months. Two gifts in one calendar month count once. The median gap between gifts picks
 * the rule: up to 45 days monthly, to 135 quarterly, to 270 twice a year, to 460 annual. Monthly, quarterly and twice a year need three
 * gifts, annual needs two. A partner whose last gift is older than the rule's own span (75, 135, 270 or 460 days) has lapsed and has no rule.
 */
export function classify(gifts: RawGiftRef[], today: string): Pattern | null {
  const sorted = gifts.filter((g) => g.d && g.amt > 0).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const seen = new Set<string>();
  const dates: RawGiftRef[] = [];
  for (const g of sorted) {
    const m = g.d.slice(0, 7);
    if (seen.has(m)) continue;
    seen.add(m);
    dates.push(g);
  }
  if (dates.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1].d, dates[i].d));
  const s = gaps.slice().sort((a, b) => a - b);
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  let rule: Pattern['rule'] | null = null;
  let span = 0;
  if (med <= 45) { rule = 'monthly'; span = 75; }
  else if (med <= 135) { rule = 'quarterly'; span = 135; }
  else if (med <= 270) { rule = 'semi'; span = 270; }
  else if (med <= 460) { rule = 'annual'; span = 460; }
  if (!rule) return null;
  if (rule !== 'annual' && dates.length < 3) return null;
  const last = dates[dates.length - 1];
  if (daysBetween(last.d, today) > span) return null;
  const recent = dates.slice(rule === 'semi' ? -2 : rule === 'annual' ? -1 : 0).map((g) => Number(g.d.slice(5, 7)));
  return { rule, last: last.d, amount: last.amt, first: dates[0].d, months: [...new Set(recent)].sort((a, b) => a - b), recurring: dates.filter((g) => g.rec).length >= dates.length - 1 };
}

export interface Contacts { call?: string; text?: string; email?: string; card?: string }
export interface ContactInfo { phone: string | null; callOk: boolean; hasPhone: boolean; email: string | null; emailOk: boolean; mailOk: boolean; hasAddress: boolean }
export interface PartnerFacts { cid: string; name: string; kind: string; place: string }

export interface Candidate {
  cid: string;
  rule: Rule;
  /** Whether the first gift is the only gift (first-time partners), or the pattern for the others. */
  pattern: Pattern | null;
  firstGift: { date: string; amount: number } | null;
  /** The date the rule first called for contact. */
  due: string;
  /** Repeating rules: the steps whose last completed date is far enough back that they are due within AHEAD_DAYS, with each one's due date. */
  stepDue: Partial<Record<StepKey, string>>;
  /** Quarterly: the gift date and amount. */
  gift: { date: string; amount: number } | null;
}

export interface Step { k: StepKey; label: string; state: 'next' | 'todo'; off: string | null }
export interface CadenceRow {
  cid: string;
  name: string;
  kind: string;
  place: string;
  rule: Rule;
  ruleLabel: string;
  pattern: string;
  line: string;
  last: { date: string; what: string } | null;
  due: string;
  /** Days past due, 0 when due today, negative for a row coming up. */
  over: number;
  holders: string[];
  holderNames: string[];
  phone: string | null;
  steps: Step[];
  /** 'any': one of the steps finishes the row (a quarterly thank-you). 'all': every step does. */
  need: 'any' | 'all';
}

const CONTACT_WORDS: Record<StepKey, string> = { call: 'Call', text: 'Text', email: 'Email', card: 'Card' };
function lastWhat(c: Contacts): { date: string; what: string } | null {
  let top = '';
  for (const k of STEP_ORDER) if (c[k] && c[k]! > top) top = c[k]!;
  if (!top) return null;
  const ks = STEP_ORDER.filter((k) => c[k] === top).map((k) => CONTACT_WORDS[k].toLowerCase());
  const what = ks.length > 1 ? ks.slice(0, -1).join(', ') + ' and ' + ks[ks.length - 1] : ks[0];
  return { date: top, what: what[0].toUpperCase() + what.slice(1) };
}

const RULE_LINE: Record<Rule, string> = {
  first: 'Gave a number. Call at once.',
  monthly: 'A call and a handwritten card every three months.',
  quarterly: 'Thank them each time they give.',
  semi: 'A card and a call twice a year.',
  annual: 'A call, card, email and text.',
};

function describe(c: Candidate): string {
  const p = c.pattern;
  if (c.rule === 'first' && c.firstGift) return `${money(c.firstGift.amount)} on ${shortDay(c.firstGift.date)}, first gift`;
  if (!p) return '';
  const a = money(p.amount);
  if (c.rule === 'monthly') return `${a} a month since ${p.first.slice(0, 4)}`;
  if (c.rule === 'quarterly') return `${a} on ${shortDay(p.last)}, every quarter`;
  if (c.rule === 'semi') return `${a} each ${p.months.map((m) => MON[m - 1]).join(' and ')}`;
  return `${a} each ${MON[(p.months[0] || 1) - 1]}`;
}

/** First pass on the mirror's rows: who has a rule and when it first called for contact. No phones or emails needed yet. */
export function candidate(cid: string, gifts: RawGiftRef[], firstEver: { date: string; amount: number; n: number } | null, contacts: Contacts, today: string): Candidate | null {
  // First-time partner: the first gift ever is recent and the call (or card) it calls for has not been made.
  if (firstEver && daysBetween(firstEver.date, today) <= FIRST_DAYS && daysBetween(firstEver.date, today) >= 0) {
    return { cid, rule: 'first', pattern: null, firstGift: { date: firstEver.date, amount: firstEver.amount }, due: firstEver.date, stepDue: {}, gift: null };
  }
  const p = classify(gifts, today);
  if (!p) return null;
  if (p.amount >= LIMIT) return null;
  if (p.rule === 'quarterly') {
    const age = daysBetween(p.last, today);
    if (age > QUARTERLY_DAYS) return null;
    const thanked = (['call', 'email', 'card'] as StepKey[]).some((k) => contacts[k] && contacts[k]! >= p.last);
    if (thanked) return null;
    return { cid, rule: 'quarterly', pattern: p, firstGift: null, due: p.last, stepDue: {}, gift: { date: p.last, amount: p.amount } };
  }
  const rule = p.rule;
  const period = PERIOD[rule];
  const stepDue: Partial<Record<StepKey, string>> = {};
  // A step with no contact on record counts from the start of the pattern, at most two periods back, so the oldest backlog reads as one period over.
  const origin = p.first > addDays(today, -2 * period) ? p.first : addDays(today, -2 * period);
  for (const k of RULE_STEPS[rule]) stepDue[k] = addDays(contacts[k] || origin, period);
  const soonest = Object.values(stepDue).sort()[0] as string;
  if (daysBetween(today, soonest) > AHEAD_DAYS) return null;
  return { cid, rule, pattern: p, firstGift: null, due: soonest, stepDue, gift: null };
}

/**
 * Second pass: put the person's phone, email and address on the candidate and settle the steps. A step with no number, email or address,
 * or with a do-not flag, stays on the row, switched off with the reason. The next step is the first one left in the manual's order.
 */
export function finish(c: Candidate, facts: PartnerFacts, info: ContactInfo, contacts: Contacts, holders: string[], names: Record<string, string>, today: string): CadenceRow | null {
  let keys: StepKey[];
  let need: 'any' | 'all' = 'all';
  if (c.rule === 'first') keys = [info.callOk ? 'call' : 'card'];
  else if (c.rule === 'quarterly') { keys = ['call', 'email', 'card']; need = 'any'; }
  else keys = RULE_STEPS[c.rule];
  const pending = keys.filter((k) => {
    if (c.rule === 'first') return !contacts[k] || contacts[k]! < (c.firstGift as { date: string }).date;
    if (c.rule === 'quarterly') return true;
    return daysBetween(today, c.stepDue[k] as string) <= 0;
  });
  // A repeating row that is only coming up shows every step that falls due inside the window.
  const show = c.rule === 'first' || c.rule === 'quarterly' ? pending : keys.filter((k) => daysBetween(today, c.stepDue[k] as string) <= AHEAD_DAYS);
  if (!show.length) return null;
  const off = (k: StepKey): string | null => {
    if (k === 'call' || k === 'text') return !info.hasPhone ? 'No phone number' : !info.callOk ? 'Do not call' : null;
    if (k === 'email') return !info.email ? 'No email address' : !info.emailOk ? 'Do not email' : null;
    return !info.hasAddress ? 'No mailing address' : !info.mailOk ? 'Do not mail' : null;
  };
  const ordered = STEP_ORDER.filter((k) => show.includes(k));
  const nextKey = ordered.find((k) => !off(k) && pending.includes(k)) || ordered.find((k) => pending.includes(k)) || ordered[0];
  const steps: Step[] = ordered.map((k) => ({ k, label: STEP_LABEL[k], state: k === nextKey ? 'next' : 'todo', off: off(k) }));
  let line = RULE_LINE[c.rule];
  if (c.rule === 'first' && !info.callOk) line = 'No number given. Send a card.';
  const over = daysBetween(c.due, today);
  return {
    cid: c.cid, name: facts.name, kind: facts.kind, place: facts.place, rule: c.rule, ruleLabel: RULE_LABEL[c.rule], pattern: describe(c), line,
    last: lastWhat(contacts), due: c.due, over, holders, holderNames: holders.map((h) => names[h] || `Fundraiser ${h}`), phone: info.hasPhone && info.callOk ? info.phone : null,
    steps, need,
  };
}

/* ------------------------------------------------------------------ the mirror */

const CURRENT = `(assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) >= ?1)`;
const GIVEN = "('Donation', 'RecurringGiftPayment', 'GiftInKind', 'Stock/Property', 'Other')";
const DIRECTOR_TYPES = "('Regional Development Director (RDD)', 'Prospect Steward', 'Church Engagement Director')";
/** Partners Partner Care holds that no director holds and that are living and active. A partner a director holds stays the director's. */
const PC_SET = `SELECT constituent_record_id FROM assignments WHERE assignment_type = 'Partner Care' AND ${CURRENT}
   AND constituent_record_id NOT IN (SELECT constituent_record_id FROM assignments WHERE assignment_type IN ${DIRECTOR_TYPES} AND ${CURRENT})
   AND constituent_record_id NOT IN (SELECT id FROM constituents WHERE COALESCE(deceased, 0) = 1 OR COALESCE(inactive, 0) = 1)`;

export const GIFTS_SQL = readOnly(`SELECT g.constituent_record_id AS cid, group_concat(substr(g.gift_date, 1, 10) || '~' || g.gift_amount || '~' || CASE g.gift_type WHEN 'RecurringGiftPayment' THEN 'r' ELSE 'd' END, ',') AS gifts
  FROM gifts g WHERE g.gift_date >= ?2 AND g.gift_amount > 0 AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'
   AND g.constituent_record_id IN (${PC_SET}) GROUP BY 1`);

/** The first gift ever, for partners whose first gift is recent. */
export const FIRST_SQL = readOnly(`SELECT g.constituent_record_id AS cid, MIN(substr(g.gift_date, 1, 10)) AS d, COUNT(*) AS n FROM gifts g
 WHERE g.gift_amount > 0 AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active' AND g.constituent_record_id IN (${PC_SET})
   AND g.constituent_record_id IN (SELECT constituent_record_id FROM gifts WHERE gift_date >= ?2 AND gift_amount > 0 AND gift_type IN ${GIVEN})
 GROUP BY 1 HAVING MIN(substr(g.gift_date, 1, 10)) >= ?2`);

export const FIRST_AMOUNT_SQL = readOnly(`SELECT constituent_record_id AS cid, gift_amount AS amount FROM gifts WHERE constituent_record_id IN (SELECT value FROM json_each(?1))
   AND substr(gift_date, 1, 10) = (SELECT MIN(substr(g2.gift_date, 1, 10)) FROM gifts g2 WHERE g2.constituent_record_id = gifts.constituent_record_id AND g2.gift_amount > 0 AND g2.gift_type IN ${GIVEN})
   AND gift_amount > 0 AND gift_type IN ${GIVEN}`);

export const HOLDS_SQL = readOnly(`SELECT constituent_record_id AS cid, assignment_fundraiser_id AS fid FROM assignments
 WHERE assignment_type = 'Partner Care' AND ${CURRENT} AND constituent_record_id IN (SELECT value FROM json_each(?2))`);

/** The latest completed contact per partner and kind. A call logged as unsuccessful (a left message) does not count. */
export const CONTACTS_SQL = readOnly(`SELECT a.constituent_record_id AS cid, a.action_category AS cat, COALESCE(t.texted, 0) AS tx, MAX(substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10)) AS d
  FROM actions a LEFT JOIN action_tags t ON t.id = a.id
 WHERE a.constituent_record_id IN (SELECT value FROM json_each(?1)) AND json_extract(a.raw_json, '$.completed') = 1
   AND a.action_category IN ('Phone call', 'Mailing', 'Email') AND COALESCE(json_extract(a.raw_json, '$.outcome'), '') <> 'Unsuccessful'
   AND substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) >= ?2
 GROUP BY 1, 2, 3`);

export const FACTS_SQL = readOnly(`SELECT c.id AS id, COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name,
       c.constituent_type AS kind, json_extract(c.raw_json, '$.address.city') AS city, json_extract(c.raw_json, '$.address.state') AS st
  FROM constituents c WHERE c.id IN (SELECT value FROM json_each(?1))`);
export const PHONES_SQL = readOnly(`SELECT constituent_record_id AS cid, phone_number AS number, do_not_call AS dnc, is_primary AS prim FROM phones
 WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0`);
export const EMAILS_SQL = readOnly(`SELECT constituent_record_id AS cid, email_address AS address, do_not_email AS dne, is_primary AS prim FROM emails
 WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0`);
export const ADDRESSES_SQL = readOnly(`SELECT constituent_record_id AS cid, address_lines AS lines, do_not_mail AS dnm, is_primary AS prim FROM addresses
 WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0`);

const chunkOf = <T>(list: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

export function parseGifts(s: unknown): RawGiftRef[] {
  return String(s || '').split(',').map((x) => {
    const [d, a, k] = x.split('~');
    return { d: d || '', amt: num(a), rec: k === 'r' };
  }).filter((g) => g.d);
}

export interface Loaded { rows: CadenceRow[]; synced: string }

/** Contacts the hub has saved that the mirror has not read back yet: this hub's own steps and thank-yous, by partner and kind. */
export async function hubContacts(env: Env, cids: string[], since: string): Promise<Record<string, Contacts>> {
  const out: Record<string, Contacts> = {};
  if (!cids.length || !env.DB) return out;
  const put = (cid: string, k: StepKey, d: string) => {
    const c = out[cid] || (out[cid] = {});
    if (!c[k] || c[k]! < d) c[k] = d;
  };
  const stepOf = (how: string): StepKey | null => (how === 'call' ? 'call' : how === 'text' ? 'text' : how === 'email' ? 'email' : how === 'card' || how === 'letter' ? 'card' : null);
  for (const part of chunkOf(cids, 80)) {
    const marks = part.map(() => '?').join(',');
    const a = await env.DB.prepare(
      `SELECT d.cid, d.step, d.done_at FROM act_cadence_done d LEFT JOIN act_batches b ON b.id = d.batch_id
        WHERE d.cid IN (${marks}) AND d.outcome = 'done' AND d.done_at >= ? AND (b.state IS NULL OR b.state IN ('queued', 'running', 'done'))`
    ).bind(...part, since).all<{ cid: string; step: string; done_at: string }>().catch(() => ({ results: [] as { cid: string; step: string; done_at: string }[] }));
    for (const r of a.results) put(String(r.cid), r.step as StepKey, String(r.done_at).slice(0, 10));
    const t = await env.DB.prepare(
      `SELECT t.cid, t.how, t.created_at FROM act_thanks t LEFT JOIN act_batches b ON b.id = t.batch_id
        WHERE t.cid IN (${marks}) AND t.outcome IN ('talked', 'sent') AND t.created_at >= ? AND (b.state IS NULL OR b.state IN ('queued', 'running', 'done'))`
    ).bind(...part, since).all<{ cid: string; how: string; created_at: string }>().catch(() => ({ results: [] as { cid: string; how: string; created_at: string }[] }));
    for (const r of t.results) {
      const k = stepOf(String(r.how));
      if (k) put(String(r.cid), k, String(r.created_at).slice(0, 10));
    }
  }
  return out;
}

/** Everything the tab needs from the mirror: the rule for every Partner Care partner who has one and is due within two weeks. */
export async function loadCadence(env: Env, q: Q, o: { today: string; names: Record<string, string> }): Promise<CadenceRow[]> {
  const today = o.today;
  const since24 = addDays(today, -730);
  const firstSince = addDays(today, -FIRST_DAYS);
  const gifts = await q<{ cid: string; gifts: string }>(GIFTS_SQL, [today, since24]);
  const firsts = await q<{ cid: string; d: string; n: number }>(FIRST_SQL, [today, firstSince]);
  const all = [...new Set([...gifts.map((g) => String(g.cid)), ...firsts.map((f) => String(f.cid))])];
  const each = async <T>(sql: string, list: string[], extra: unknown[] = []): Promise<T[]> => {
    const out: T[] = [];
    for (const part of chunkOf(list, 400)) out.push(...(await q<T>(sql, [JSON.stringify(part), ...extra])));
    return out;
  };
  const firstAmt = firsts.length ? await each<{ cid: string; amount: number }>(FIRST_AMOUNT_SQL, firsts.map((f) => String(f.cid))) : [];
  const contactRows = await each<{ cid: string; cat: string; tx: number; d: string }>(CONTACTS_SQL, all, [addDays(today, -420)]);
  const contacts: Record<string, Contacts> = {};
  for (const r of contactRows) {
    const k: StepKey | null = r.cat === 'Phone call' ? (num(r.tx) === 1 ? 'text' : 'call') : r.cat === 'Mailing' ? 'card' : r.cat === 'Email' ? 'email' : null;
    if (!k) continue;
    const c = contacts[String(r.cid)] || (contacts[String(r.cid)] = {});
    if (!c[k] || c[k]! < r.d) c[k] = r.d;
  }
  const hub = await hubContacts(env, all, addDays(today, -420));
  for (const [cid, h] of Object.entries(hub)) {
    const c = contacts[cid] || (contacts[cid] = {});
    for (const k of STEP_ORDER) if (h[k] && (!c[k] || c[k]! < h[k]!)) c[k] = h[k];
  }
  const firstBy = new Map(firsts.map((f) => [String(f.cid), { date: String(f.d), n: num(f.n), amount: num(firstAmt.find((a) => String(a.cid) === String(f.cid))?.amount) }]));
  const cands: Candidate[] = [];
  for (const g of gifts) {
    const c = candidate(String(g.cid), parseGifts(g.gifts), firstBy.get(String(g.cid)) || null, contacts[String(g.cid)] || {}, today);
    if (c) cands.push(c);
  }
  for (const f of firsts) {
    if (cands.some((c) => c.cid === String(f.cid))) continue;
    const c = candidate(String(f.cid), [], firstBy.get(String(f.cid))!, contacts[String(f.cid)] || {}, today);
    if (c) cands.push(c);
  }
  // A first-time partner is done once the call (or card) it calls for is on record; drop those before the second pass.
  const ids = cands.map((c) => c.cid);
  if (!ids.length) return [];
  const [facts, phones, emails, addrs, holds] = await Promise.all([
    each<{ id: string; name: string; kind: string; city: string; st: string }>(FACTS_SQL, ids),
    each<{ cid: string; number: string; dnc: number; prim: number }>(PHONES_SQL, ids),
    each<{ cid: string; address: string; dne: number; prim: number }>(EMAILS_SQL, ids),
    each<{ cid: string; lines: string; dnm: number; prim: number }>(ADDRESSES_SQL, ids),
    (async () => {
      const out: { cid: string; fid: string }[] = [];
      for (const part of chunkOf(ids, 400)) out.push(...(await q<{ cid: string; fid: string }>(HOLDS_SQL, [today, JSON.stringify(part)])));
      return out;
    })(),
  ]);
  const by = <T extends { cid: string }>(list: T[]): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const x of list) (m.get(String(x.cid)) || m.set(String(x.cid), []).get(String(x.cid))!).push(x);
    return m;
  };
  const phoneBy = by(phones);
  const emailBy = by(emails);
  const addrBy = by(addrs);
  const holdBy = by(holds);
  const factBy = new Map(facts.map((f) => [String(f.id), f]));
  const rows: CadenceRow[] = [];
  for (const c of cands) {
    const f = factBy.get(c.cid);
    if (!f || !f.name) continue;
    const ph = (phoneBy.get(c.cid) || []).slice().sort((a, b) => num(b.prim) - num(a.prim));
    const callable = ph.find((p) => num(p.dnc) !== 1);
    const em = (emailBy.get(c.cid) || []).slice().sort((a, b) => num(b.prim) - num(a.prim));
    const mailable = em.find((e) => num(e.dne) !== 1);
    const ad = addrBy.get(c.cid) || [];
    const info: ContactInfo = {
      phone: callable ? String(callable.number) : ph[0] ? String(ph[0].number) : null, hasPhone: ph.length > 0, callOk: !!callable,
      email: mailable ? String(mailable.address) : em[0] ? String(em[0].address) : null, emailOk: !!mailable,
      hasAddress: ad.length > 0, mailOk: ad.some((a) => num(a.dnm) !== 1),
    };
    const row = finish(c, { cid: c.cid, name: String(f.name), kind: String(f.kind || ''), place: [f.city, f.st].filter(Boolean).join(', ') }, info, contacts[c.cid] || {}, [...new Set((holdBy.get(c.cid) || []).map((h) => String(h.fid)))], o.names, today);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => (a.over < b.over ? 1 : a.over > b.over ? -1 : a.name < b.name ? -1 : 1));
  return rows;
}

/** The three print lists: Friday, Saturday, Sunday. The partners who have waited longest go first. Even thirds. */
export function splitLists<T extends { over: number }>(rows: T[]): { friday: T[]; saturday: T[]; sunday: T[] } {
  const sorted = rows.filter((r) => r.over >= 0).sort((a, b) => b.over - a.over);
  const n = Math.ceil(sorted.length / 3);
  return { friday: sorted.slice(0, n), saturday: sorted.slice(n, 2 * n), sunday: sorted.slice(2 * n) };
}
