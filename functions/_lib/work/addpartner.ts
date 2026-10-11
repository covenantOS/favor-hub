// Add a partner from Entry. Support finds a sheet row that matches no record, checks Blackbaud for the same person (the mirror at once,
// Blackbaud's own duplicate search on a pause and again on save), ticks "None of these is the same person", and adds the record.
//
// The create step has a stand-in sender. The stand-in builds the same calls and checks them against the keys Blackbaud takes, answers
// with made-up ids, and sends nothing. The agent key and every role test are limited to it, so a test never makes a real record.
import { HttpError, newId, nowIso, type Env } from '../http';
import { mirror, type OpsCall, type OpsManyResult } from '../foundations/blackbaud';
import { digits } from '../actions/intake';
import { idemKey } from '../actions/outbox';
import { liveQuery, mergeLive, probeOf, probeReady, rankCandidates, type Cand, type LiveHit, type Match, type Probe } from '../actions/partner-match';
import { addMeter, listStaff, logEvent, type StaffRow } from './db';
import { readOnly } from './repo';
import { MORNING_RUN_CODES, TABLES_FALLBACK, getTables, type Tables } from './records';
import { entryPatch } from './entry';
import { todayEt, type Ctx } from './service';

export const CODES = ['Prospect', 'Partner', 'Church'] as const;
export type Code = (typeof CODES)[number];

/** Who can hold a new partner: every director with an Entry chip, and Partner Care. */
export async function holdersForAdd(env: Env): Promise<StaffRow[]> {
  return (await listStaff(env).catch(() => [])).filter((x) => x.active === 1 && x.bb_fundraiser_id && (x.entry_owner === 1 || x.team === 'partner_care'));
}

/** State to the regional director, from the Regions tab of the Daily Procedures sheet (the rows the worker keeps in dp_reference). */
export function regionMap(rows: unknown[][]): Map<string, string> {
  const out = new Map<string, string>();
  const names = Array.isArray(rows[3]) ? rows[3] : [];
  for (let i = 4; i < rows.length; i++) {
    const r = Array.isArray(rows[i]) ? rows[i] : [];
    for (let c = 0; c < r.length; c++) {
      const v = String(r[c] ?? '').trim();
      const who = String(names[c] ?? '').trim();
      if (/^[A-Z]{2}$/.test(v) && who && !out.has(v)) out.set(v, who);
    }
  }
  return out;
}

export interface HolderGuess {
  fid: string;
  name: string;
  source: 'territory' | 'partner_care' | '';
}

/** The holder a new partner gets from the state on the address. No state, or a state no region lists (Alaska and Hawaii), shows Partner Care. */
export async function holderForState(env: Env, state: string): Promise<HolderGuess> {
  const st = state.trim().toUpperCase();
  const staff = await holdersForAdd(env);
  const pc = staff.find((x) => x.team === 'partner_care');
  const fallback: HolderGuess = pc ? { fid: String(pc.bb_fundraiser_id), name: pc.name, source: 'partner_care' } : { fid: '', name: '', source: '' };
  if (!/^[A-Z]{2}$/.test(st)) return fallback;
  try {
    const rows = await mirror<{ json: string }>(env, readOnly("SELECT json FROM dp_reference WHERE name = 'regions' LIMIT 1"));
    const table = rows[0] ? (JSON.parse(rows[0].json) as unknown[][]) : [];
    const who = regionMap(Array.isArray(table) ? table : []).get(st);
    const hit = who ? staff.find((x) => x.entry_owner === 1 && x.name.toLowerCase() === who.toLowerCase()) : undefined;
    if (hit) return { fid: String(hit.bb_fundraiser_id), name: hit.name, source: 'territory' };
  } catch {
    // The table could not be read: Partner Care holds it until a person picks.
  }
  return fallback;
}

/** Support and admins add partners. A director asks Support. */
export function mayAddPartner(ctx: Ctx): boolean {
  const s = ctx.scope;
  return !s || s.all || s.role === 'admin' || s.role === 'support';
}

const MAX_LIVE_PER_MINUTE = 12;

const jsonIds = (ids: string[]) => JSON.stringify(ids);

async function candidatesFor(env: Env, p: Probe): Promise<Cand[]> {
  const q = <T = Record<string, any>>(sql: string, params: unknown[] = []) => mirror<T>(env, readOnly(sql), params);
  const ids = new Set<string>();
  const ph = digits(p.phone);
  if (ph) {
    const rows = await q<{ cid: string; n: string }>('SELECT constituent_record_id AS cid, phone_number AS n FROM phones WHERE phone_number LIKE ?1 LIMIT 60', [`%${ph.slice(0, 3)}%${ph.slice(3, 6)}%${ph.slice(6)}%`]).catch(() => []);
    for (const r of rows) if (digits(r.n) === ph) ids.add(String(r.cid));
  }
  const em = p.email.trim().toLowerCase();
  if (em.includes('@')) {
    for (const r of await q<{ cid: string }>('SELECT constituent_record_id AS cid FROM emails WHERE lower(email_address) = ?1 LIMIT 30', [em]).catch(() => [])) ids.add(String(r.cid));
    const dom = em.split('@')[1];
    if (p.kind === 'organization' && dom && dom.includes('.')) {
      for (const r of await q<{ cid: string }>('SELECT constituent_record_id AS cid FROM emails WHERE lower(email_address) LIKE ?1 LIMIT 40', [`%@${dom}`]).catch(() => [])) ids.add(String(r.cid));
    }
  }
  const city = p.city.trim().toLowerCase();
  const lasts = [p.last, p.kind === 'household' ? p.spouseLast || p.last : ''].map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 2);
  for (const last of new Set(lasts)) {
    const rows = await q<{ id: string }>(
      `SELECT k.id AS id FROM constituents k WHERE k.inactive = 0 AND lower(k.last_name) = ?1
        ORDER BY CASE WHEN lower(json_extract(k.raw_json, '$.address.city')) = ?2 THEN 0 ELSE 1 END LIMIT 80`,
      [last, city]
    ).catch(() => []);
    for (const r of rows) ids.add(String(r.id));
  }
  if (p.kind === 'organization' && p.org.trim().length >= 3) {
    const name = p.org.trim().toLowerCase();
    for (const r of await q<{ id: string }>('SELECT k.id AS id FROM constituents k WHERE k.inactive = 0 AND lower(k.organization_name) LIKE ?1 LIMIT 40', [`%${name}%`]).catch(() => [])) ids.add(String(r.id));
  }
  const all = [...ids].slice(0, 120);
  if (!all.length) return [];
  const [rows, phones, emails, gifts, holders] = await Promise.all([
    q<any>(
      `SELECT k.id AS id, k.constituent_lookup_id AS lookup, k.constituent_type AS ctype, k.first_name AS first, k.last_name AS last, k.organization_name AS org,
              json_extract(k.raw_json, '$.address.city') AS city, json_extract(k.raw_json, '$.address.state') AS st, json_extract(k.raw_json, '$.address.postal_code') AS zip,
              k.deceased AS deceased, k.inactive AS inactive, substr(json_extract(k.raw_json, '$.date_added'), 1, 10) AS since
         FROM constituents k WHERE k.id IN (SELECT value FROM json_each(?1))`,
      [jsonIds(all)]
    ),
    q<{ cid: string; n: string }>('SELECT constituent_record_id AS cid, phone_number AS n FROM phones WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND is_inactive = 0', [jsonIds(all)]).catch(() => []),
    q<{ cid: string; e: string }>('SELECT constituent_record_id AS cid, lower(email_address) AS e FROM emails WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND is_inactive = 0', [jsonIds(all)]).catch(() => []),
    q<{ cid: string; n: number; last: string; amt: number }>(
      `SELECT g.constituent_record_id AS cid, COUNT(*) AS n, MAX(substr(g.gift_date, 1, 10)) AS last,
              (SELECT g2.gift_amount FROM gifts g2 WHERE g2.constituent_record_id = g.constituent_record_id AND g2.gift_amount > 0 ORDER BY g2.gift_date DESC LIMIT 1) AS amt
         FROM gifts g WHERE g.constituent_record_id IN (SELECT value FROM json_each(?1)) AND g.gift_amount > 0 GROUP BY g.constituent_record_id`,
      [jsonIds(all)]
    ).catch(() => []),
    q<{ cid: string; fid: string }>(
      "SELECT constituent_record_id AS cid, assignment_fundraiser_id AS fid FROM assignments WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND (assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) >= date('now'))",
      [jsonIds(all)]
    ).catch(() => []),
  ]);
  const by = <T extends { cid: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) m.set(String(x.cid), (m.get(String(x.cid)) || []).concat(x));
    return m;
  };
  const phBy = by(phones);
  const emBy = by(emails);
  const gf = new Map(gifts.map((g) => [String(g.cid), g]));
  const hd = by(holders);
  return rows.map((r: any) => ({
    cid: String(r.id), lookup: String(r.lookup || ''), type: String(r.ctype || 'Individual'), first: String(r.first || ''), last: String(r.last || ''), org: String(r.org || ''),
    city: String(r.city || ''), state: String(r.st || ''), zip: String(r.zip || ''),
    phones: (phBy.get(String(r.id)) || []).map((x) => digits(x.n)).filter(Boolean), emails: (emBy.get(String(r.id)) || []).map((x) => x.e).filter(Boolean),
    deceased: r.deceased === 1 || r.deceased === '1' || r.deceased === true, inactive: r.inactive === 1 || r.inactive === '1', since: String(r.since || ''),
    gifts: Number(gf.get(String(r.id))?.n) || 0, lastGift: String(gf.get(String(r.id))?.last || ''), lastAmount: Number(gf.get(String(r.id))?.amt) || 0,
    holders: (hd.get(String(r.id)) || []).map((x) => String(x.fid)),
  }));
}

export interface MatchesOut {
  ok: true;
  matches: Match[];
  live: 'ran' | 'skipped' | 'failed';
  calls: number;
  ready: boolean;
}

/** The duplicate check. The mirror is read every time (no Blackbaud call); Blackbaud's duplicate search runs when asked (live) and counts one call. */
export async function findMatches(ctx: Ctx, body: Record<string, unknown>, opts: { live: boolean }): Promise<MatchesOut> {
  if (!mayAddPartner(ctx)) throw new HttpError(403, 'not_yours', 'Support adds partners. Ask Support to add this one.');
  const p = probeOf(body);
  if (!probeReady(p)) return { ok: true, matches: [], live: 'skipped', calls: 0, ready: false };
  let matches = rankCandidates(p, await candidatesFor(ctx.env, p).catch(() => []));
  let live: MatchesOut['live'] = 'skipped';
  let calls = 0;
  if (opts.live) {
    const query = liveQuery(p);
    if (query) {
      await limitLive(ctx);
      const res = await ctx.repo.send([{ method: 'GET', path: `/constituent/v1/constituents/duplicatesearch?${query}` }]);
      calls = res.results.length;
      if (calls) await addMeter(ctx.env, calls, res.callsToday).catch(() => undefined);
      const r = res.results[0];
      if (r && r.ok && r.body && Array.isArray(r.body.value)) {
        live = 'ran';
        matches = mergeLive(p, matches, r.body.value as LiveHit[]);
      } else live = 'failed';
    }
  }
  const names = await holderNames(ctx.env, matches.flatMap((m) => m.holders));
  matches = matches.map((m) => ({ ...m, holders: m.holders.map((h) => names.get(h) || h) }));
  return { ok: true, matches, live, calls, ready: true };
}

async function holderNames(env: Env, fids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!fids.length) return m;
  for (const s of await listStaff(env).catch(() => [])) if (s.bb_fundraiser_id) m.set(String(s.bb_fundraiser_id), s.name);
  const missing = [...new Set(fids)].filter((f) => !m.has(f));
  if (missing.length) {
    const rows = await mirror<{ id: string; first: string; last: string }>(env, readOnly('SELECT id AS id, fundraiser_first_name AS first, fundraiser_last_name AS last FROM fundraisers WHERE id IN (SELECT value FROM json_each(?1))'), [jsonIds(missing)]).catch(() => []);
    for (const r of rows) m.set(String(r.id), `${r.first ?? ''} ${r.last ?? ''}`.trim());
  }
  return m;
}

/** A person's live checks are limited so a held key cannot spend the day's allowance. */
async function limitLive(ctx: Ctx): Promise<void> {
  const key = `dupq:${ctx.email}:${new Date().toISOString().slice(0, 16)}`;
  const row = await ctx.env.DB.prepare('SELECT value FROM act_cache WHERE key = ?').bind(key).first<{ value: string }>().catch(() => null);
  const n = Number(row?.value) || 0;
  if (n >= MAX_LIVE_PER_MINUTE) throw new HttpError(429, 'slow_down', 'Too many checks in a minute. Wait a moment and try again.');
  await ctx.env.DB.prepare('INSERT INTO act_cache (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at').bind(key, String(n + 1), nowIso()).run().catch(() => undefined);
}

/* ------------------------------------------------------------------ adding */

/** Relationships between two people, and the reciprocal Blackbaud files on the other side (read back on test records 2026-10-10). */
export const PERSON_RELATIONS: Record<string, string> = { Parent: 'Child', Child: 'Parent', Sibling: 'Sibling', Friend: 'Friend', Grandparent: 'Grandchild', Grandchild: 'Grandparent', Mentor: 'Mentee', Mentee: 'Mentor' };
/** What an organization's contact is to the organization, and what the organization is to the contact. */
export const CONTACT_ROLES: Record<string, string> = { Employee: 'Employer', 'Staff Member': 'Employer', Pastor: 'Church', 'Board Member': 'Organization', Member: 'Organization' };

export interface AddInput {
  probe: Probe;
  code: Code;
  holder: string;
  street: string;
  none_same: boolean;
  row: string;
  title: string;
  middle: string;
  suffix: string;
  phoneType: string;
  spouse: { title: string; middle: string; suffix: string; phone: string; phoneType: string; email: string };
  /** The organization's type code (Church, DAF Provider, Foundation and the like). Prospect or Partner is `code`. */
  typeCode: string;
  contact: { first: string; last: string; title: string; phone: string; email: string; position: string; role: string } | null;
  /** Links from the new partner to partners already in Blackbaud. The other partner is the new partner's `type`. */
  relations: { id: string; type: string }[];
}

export function parseAdd(b: Record<string, unknown>): AddInput {
  const probe = probeOf(b);
  const code = String(b.code || '') as Code;
  const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const out: AddInput = {
    probe, code, holder: clean(b.holder, 20), street: clean(b.street, 100), none_same: b.none_same === true, row: clean(b.row, 40),
    title: clean(b.title, 30), middle: clean(b.middle, 50), suffix: clean(b.suffix, 30), phoneType: clean(b.phone_type, 30),
    spouse: { title: clean(b.spouse_title, 30), middle: clean(b.spouse_middle, 50), suffix: clean(b.spouse_suffix, 30), phone: clean(b.spouse_phone, 30), phoneType: clean(b.spouse_phone_type, 30), email: clean(b.spouse_email, 120).toLowerCase() },
    typeCode: clean(b.type_code, 60), contact: null, relations: [],
  };
  const ct = b.contact && typeof b.contact === 'object' ? (b.contact as Record<string, unknown>) : null;
  if (ct && (clean(ct.first, 50) || clean(ct.last, 100))) {
    out.contact = { first: clean(ct.first, 50), last: clean(ct.last, 100), title: clean(ct.title, 30), phone: clean(ct.phone, 30), email: clean(ct.email, 120).toLowerCase(), position: clean(ct.position, 50), role: clean(ct.role, 40) || 'Employee' };
  }
  if (Array.isArray(b.relations)) {
    for (const r of b.relations.slice(0, 6)) {
      const o = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
      const id = clean(o.id, 12);
      if (/^\d{1,12}$/.test(id)) out.relations.push({ id, type: clean(o.type, 40) });
    }
  }
  if (!CODES.includes(code)) throw new HttpError(400, 'bad_code', 'Pick the code: Prospect, Partner or Church.');
  for (const r of out.relations) if (!PERSON_RELATIONS[r.type]) throw new HttpError(400, 'bad_relationship', 'Pick the relationship from the list.');
  if (out.contact) {
    if (probe.kind !== 'organization') out.contact = null;
    else {
      if (!out.contact.first || !out.contact.last) throw new HttpError(400, 'missing_field', 'Type the contact\'s first and last name, or clear the contact.');
      if (!CONTACT_ROLES[out.contact.role]) throw new HttpError(400, 'bad_relationship', 'Pick what the contact is to the organization.');
      if (out.contact.phone && digits(out.contact.phone).length !== 10) throw new HttpError(400, 'bad_phone', 'The contact\'s phone number needs 10 digits.');
      if (out.contact.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.contact.email)) throw new HttpError(400, 'bad_email', 'The contact\'s email address does not look right.');
    }
  }
  if (out.typeCode && MORNING_RUN_CODES.includes(out.typeCode)) throw new HttpError(400, 'bad_code', 'Prospect and Partner are picked as the status, not the type.');
  if (out.spouse.phone && digits(out.spouse.phone).length !== 10) throw new HttpError(400, 'bad_phone', 'The spouse\'s phone number needs 10 digits.');
  if (out.spouse.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.spouse.email)) throw new HttpError(400, 'bad_email', 'The spouse\'s email address does not look right.');
  if (probe.kind === 'organization') {
    if (probe.org.length < 3) throw new HttpError(400, 'missing_field', 'Type the organization name.');
  } else {
    if (!probe.first || !probe.last) throw new HttpError(400, 'missing_field', 'Type the first and last name.');
    if (probe.kind === 'household' && !probe.spouseFirst) throw new HttpError(400, 'missing_field', 'Type the spouse\'s first name, or pick Individual.');
  }
  if (probe.phone && digits(probe.phone).length !== 10) throw new HttpError(400, 'bad_phone', 'The phone number needs 10 digits.');
  if (probe.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(probe.email)) throw new HttpError(400, 'bad_email', 'That email address does not look right.');
  if (probe.state && probe.state.length > 30) throw new HttpError(400, 'bad_state', 'Use the two-letter state.');
  return out;
}

/** The Blackbaud assignment type a holder gets: church engagement directors keep their own type; a Prospect gets a Prospect Steward; a Partner gets an RDD. */
export function assignmentType(code: Code, holderTeam: string): string {
  if (holderTeam === 'church') return 'Church Engagement Director';
  if (holderTeam === 'partner_care') return 'Partner Care';
  return code === 'Prospect' ? 'Prospect Steward' : 'Regional Development Director (RDD)';
}

const PHONE_TYPE = (org: boolean) => (org ? 'Business Phone' : 'Cell Phone');

/** The body of one POST /constituent/v1/constituents. Only keys the upkeep route lets through. */
export function personBody(a: AddInput, who: 'first' | 'spouse'): Record<string, unknown> {
  const p = a.probe;
  const me = who === 'first';
  const body: Record<string, unknown> = { type: 'Individual', first: me ? p.first : p.spouseFirst, last: me ? p.last : p.spouseLast || p.last };
  const t = me ? a.title : a.spouse.title;
  const m = me ? a.middle : a.spouse.middle;
  const x = me ? a.suffix : a.spouse.suffix;
  if (t) body.title = t;
  if (m) body.middle = m;
  if (x) body.suffix = x;
  addContact(body, a, who);
  return body;
}

function addContact(body: Record<string, unknown>, a: AddInput, who: 'first' | 'spouse' | 'org'): void {
  const p = a.probe;
  const org = who === 'org';
  if (a.street || p.city || p.state || p.zip) {
    body.address = { type: org ? 'Business' : 'Home', address_lines: a.street, city: p.city, state: p.state, postal_code: p.zip, preferred: true };
  }
  const email = who === 'spouse' ? a.spouse.email : p.email;
  const phone = who === 'spouse' ? a.spouse.phone : p.phone;
  const phoneType = (who === 'spouse' ? a.spouse.phoneType : a.phoneType) || PHONE_TYPE(org);
  if (email) body.email = { address: email, type: 'Email', primary: true };
  if (digits(phone)) body.phone = { number: phone, type: phoneType, primary: true };
}

export function orgBody(a: AddInput): Record<string, unknown> {
  const body: Record<string, unknown> = { type: 'Organization', name: a.probe.org };
  addContact(body, a, 'org');
  return body;
}

/** The organization's main contact: a person with their own phone and email, joined to the organization afterwards. */
export function contactBody(a: AddInput): Record<string, unknown> {
  const c = a.contact!;
  const body: Record<string, unknown> = { type: 'Individual', first: c.first, last: c.last };
  if (c.title) body.title = c.title;
  if (c.email) body.email = { address: c.email, type: 'Email', primary: true };
  if (digits(c.phone)) body.phone = { number: c.phone, type: 'Cell Phone', primary: true };
  return body;
}

/** Titles, suffixes, phone types and the organization's type code must be entries in Blackbaud's tables. Read once a week; fixes the case. */
export async function checkTables(ctx: Ctx, a: AddInput): Promise<void> {
  const need = [a.title, a.suffix, a.phoneType, a.spouse.title, a.spouse.suffix, a.spouse.phoneType, a.typeCode, a.contact?.title].some(Boolean);
  if (!need) return;
  const t = await getTables(ctx).catch(() => ({ ...TABLES_FALLBACK, at: '', source: 'fallback' }) as Tables);
  const pick = (v: string, list: string[], what: string): string => {
    if (!v) return v;
    const hit = list.find((x) => x.toLowerCase() === v.toLowerCase());
    if (!hit) throw new HttpError(400, 'bad_field', `Pick the ${what} from the list.`);
    return hit;
  };
  a.title = pick(a.title, t.titles, 'title');
  a.suffix = pick(a.suffix, t.suffixes, 'suffix');
  a.phoneType = pick(a.phoneType, t.phoneTypes, 'phone type');
  a.spouse.title = pick(a.spouse.title, t.titles, 'spouse\'s title');
  a.spouse.suffix = pick(a.spouse.suffix, t.suffixes, 'spouse\'s suffix');
  a.spouse.phoneType = pick(a.spouse.phoneType, t.phoneTypes, 'spouse\'s phone type');
  a.typeCode = pick(a.typeCode, t.constituentCodes, 'type');
  if (a.contact) a.contact.title = pick(a.contact.title, t.titles, 'contact\'s title');
}

export type Sender = (calls: OpsCall[]) => Promise<OpsManyResult>;

const CREATE_KEYS = ['type', 'first', 'last', 'name', 'address', 'email', 'phone', 'middle', 'title', 'suffix'];
const REL_KEYS = ['constituent_id', 'relation_id', 'type', 'reciprocal_type', 'is_spouse', 'is_organization_contact', 'position', 'organization_contact_type'];

/** The stand-in. It checks each call the way the upkeep route does and answers with made-up ids. It sends nothing to Blackbaud. */
export function standInSender(log: OpsCall[]): Sender {
  let next = 900000;
  return async (calls) => {
    const results: OpsManyResult['results'] = [];
    for (const c of calls) {
      log.push(c);
      const body = (c.body || {}) as Record<string, unknown>;
      let ok = true;
      let reply: any = {};
      if (c.method === 'POST' && c.path === '/constituent/v1/constituents') {
        const extra = Object.keys(body).filter((k) => !CREATE_KEYS.includes(k));
        if (extra.length) ok = false;
        reply = ok ? { id: String(++next) } : { refused: `body keys not allowed here: ${extra.join(', ')}` };
      } else if (c.method === 'POST' && c.path === '/constituent/v1/relationships') {
        const extra = Object.keys(body).filter((k) => !REL_KEYS.includes(k));
        if (extra.length) ok = false;
        reply = ok ? { id: String(++next) } : { refused: `body keys not allowed here: ${extra.join(', ')}` };
      } else if (c.method === 'POST' && (c.path === '/constituent/v1/constituentcodes' || c.path === '/fundraising/v1/fundraisers/assignments')) reply = { id: String(++next) };
      else if (c.method === 'GET' && /^\/constituent\/v1\/constituents\/\d+$/.test(c.path)) reply = { id: c.path.split('/').pop(), lookup_id: '99' + c.path.split('/').pop()!.slice(-3) };
      else ok = false;
      results.push({ ok, status: ok ? 200 : 0, body: reply });
    }
    return { results, callsToday: undefined };
  };
}

export interface AddResult {
  ok: true;
  standin: boolean;
  cid: string;
  cid2: string | null;
  cid3: string | null;
  lookup: string;
  name: string;
  warnings: string[];
  calls: OpsCall[] | null;
  row: unknown;
}

const nameOf = (p: Probe) => (p.kind === 'organization' ? p.org : p.kind === 'household' ? (p.spouseLast && p.spouseLast !== p.last ? `${p.first} ${p.last} and ${p.spouseFirst} ${p.spouseLast}` : `${p.first} and ${p.spouseFirst} ${p.last}`) : `${p.first} ${p.last}`);

export async function addPartner(ctx: Ctx, body: Record<string, unknown>, mode: { standin: boolean; send?: Sender }): Promise<AddResult> {
  if (!mayAddPartner(ctx)) throw new HttpError(403, 'not_yours', 'Support adds partners. Ask Support to add this one.');
  if (ctx.testCid && !mode.standin) throw new HttpError(403, 'test_only', 'This is a test run, and a test never makes a real record. It uses the stand-in route.');
  const a = parseAdd(body);
  await checkTables(ctx, a);
  if (!a.none_same) throw new HttpError(400, 'not_confirmed', 'Tick "None of these is the same person" first.');
  const env = ctx.env;
  let holderTeam = '';
  if (a.holder) {
    const owner = (await holdersForAdd(env)).find((o) => String(o.bb_fundraiser_id) === a.holder);
    if (!owner) throw new HttpError(400, 'bad_holder', 'Pick who holds this partner from the list.');
    if (owner.team !== 'partner_care' && ctx.scope && !ctx.scope.all && !ctx.scope.fids.has(a.holder)) throw new HttpError(403, 'not_yours', 'That person is not one of the directors you support.');
    holderTeam = owner.team;
  }
  // The check runs again on save, whatever the form showed. Its answer goes in the log with the tick.
  const check = await findMatches(ctx, body, { live: true }).catch(() => null);
  const keyHash = (await idemKey([a.probe.kind, a.probe.first, a.probe.last, a.probe.spouseFirst, a.probe.org, digits(a.probe.phone), a.probe.email, a.probe.city, a.contact ? a.contact.first + a.contact.last : '', a.typeCode])).slice(0, 24);
  const claim = `addp:${keyHash}`;
  const log: OpsCall[] = [];
  const send: Sender = mode.standin ? standInSender(log) : mode.send || ((c) => ctx.repo.send(c));
  if (!mode.standin) {
    const have = await env.DB.prepare('SELECT value, at FROM act_cache WHERE key = ?').bind(claim).first<{ value: string; at: string }>().catch(() => null);
    if (have && Date.now() - Date.parse(have.at) < 24 * 3600000) {
      if (have.value === 'pending') throw new HttpError(409, 'in_progress', 'This partner is being added. Wait a moment, then check the list.');
      throw new HttpError(409, 'already_added', 'This partner was just added. Search for the name to find the record.');
    }
    await env.DB.prepare('INSERT INTO act_cache (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at').bind(claim, 'pending', nowIso()).run();
  }
  const release = () => (mode.standin ? Promise.resolve() : env.DB.prepare('DELETE FROM act_cache WHERE key = ?').bind(claim).run().catch(() => undefined));
  const warnings: string[] = [];
  let spent = 0;
  const run = async (calls: OpsCall[]) => {
    const res = await send(calls);
    spent += res.results.length;
    if (!mode.standin && res.results.length) await addMeter(env, res.results.length, res.callsToday).catch(() => undefined);
    return res;
  };
  const p = a.probe;
  const first = await run([{ method: 'POST', path: '/constituent/v1/constituents', body: p.kind === 'organization' ? orgBody(a) : personBody(a, 'first') }]);
  const r1 = first.results[0];
  const cid = r1 && r1.ok && r1.body && r1.body.id ? String(r1.body.id) : '';
  if (!cid) {
    // A lost answer may still have made the record: leave the claim so a second press does not make a second one.
    if (!first.lost) await release();
    await logEvent(env, { actor: ctx.actor, actor_email: ctx.email, kind: 'partner_add_failed', ok: false, status: r1?.status, detail: `${nameOf(p)}: ${first.wait || JSON.stringify(r1?.body || '').slice(0, 200)}` }).catch(() => undefined);
    throw new HttpError(502, 'bb_refused', first.lost ? 'Blackbaud did not answer, and the record may have been made. Search for the name before you try again.' : 'Blackbaud did not take the new record. Nothing was added. ' + (r1?.body?.refused || first.wait || '').toString().slice(0, 160));
  }
  let cid2: string | null = null;
  if (p.kind === 'household') {
    const second = await run([{ method: 'POST', path: '/constituent/v1/constituents', body: personBody(a, 'spouse') }]);
    const r2 = second.results[0];
    if (r2 && r2.ok && r2.body && r2.body.id) cid2 = String(r2.body.id);
    else warnings.push(`The spouse's record was not made (${(r2?.body?.refused || second.wait || 'Blackbaud said no').toString().slice(0, 100)}). Add the spouse in Blackbaud.`);
  }
  let cid3: string | null = null;
  if (a.contact) {
    const third = await run([{ method: 'POST', path: '/constituent/v1/constituents', body: contactBody(a) }]);
    const r3 = third.results[0];
    if (r3 && r3.ok && r3.body && r3.body.id) cid3 = String(r3.body.id);
    else warnings.push(`The contact's record was not made (${(r3?.body?.refused || third.wait || 'Blackbaud said no').toString().slice(0, 100)}). Add the contact in Blackbaud.`);
  }
  // Each step after the records carries the words the person reads if it fails.
  const steps: { call: OpsCall; what: string }[] = [{ call: { method: 'POST', path: '/constituent/v1/constituentcodes', body: { constituent_id: cid, description: a.code } }, what: 'The code' }];
  if (a.typeCode) steps.push({ call: { method: 'POST', path: '/constituent/v1/constituentcodes', body: { constituent_id: cid, description: a.typeCode } }, what: `The ${a.typeCode} code` });
  if (cid2) steps.push({ call: { method: 'POST', path: '/constituent/v1/constituentcodes', body: { constituent_id: cid2, description: a.code } }, what: 'The spouse\'s code' });
  if (cid2) steps.push({ call: { method: 'POST', path: '/constituent/v1/relationships', body: { constituent_id: cid, relation_id: cid2, type: 'Spouse', reciprocal_type: 'Spouse', is_spouse: true } }, what: 'The spouse link' });
  if (cid3 && a.contact) {
    steps.push({ call: { method: 'POST', path: '/constituent/v1/relationships', body: { constituent_id: cid, relation_id: cid3, type: a.contact.role, reciprocal_type: CONTACT_ROLES[a.contact.role], is_organization_contact: true, ...(a.contact.position ? { position: a.contact.position } : {}) } }, what: 'The contact link' });
  }
  for (const r of a.relations) steps.push({ call: { method: 'POST', path: '/constituent/v1/relationships', body: { constituent_id: cid, relation_id: r.id, type: r.type, reciprocal_type: PERSON_RELATIONS[r.type] } }, what: `The ${r.type.toLowerCase()} link` });
  if (a.holder) steps.push({ call: { method: 'POST', path: '/fundraising/v1/fundraisers/assignments', body: { constituent_id: cid, fundraiser_id: a.holder, type: assignmentType(a.code, holderTeam), start: `${todayEt()}T00:00:00` } }, what: 'The holder' });
  const rest: OpsCall[] = steps.map((x) => x.call);
  rest.push({ method: 'GET', path: `/constituent/v1/constituents/${cid}` });
  const tail = await run(rest);
  tail.results.slice(0, rest.length - 1).forEach((r, i) => {
    if (!r.ok) warnings.push(`${steps[i]?.what || 'One step'} was not saved (${(r.body?.refused || sayShort(r.body)).toString().slice(0, 100)}). Finish it in Blackbaud.`);
  });
  if (tail.results.length < rest.length - 1) warnings.push('Some steps after the record were not sent. Check the record in Blackbaud.');
  const lookupRes = tail.results[rest.length - 1];
  const lookup = lookupRes && lookupRes.ok && lookupRes.body ? String(lookupRes.body.lookup_id || '') : '';
  const name = nameOf(p);
  const place = [p.city, p.state].filter(Boolean).join(', ');
  let row: unknown = null;
  if (!mode.standin) {
    await env.DB.prepare('INSERT OR REPLACE INTO act_new_partners (cid, lookup, name, place, holder, created_by, created_at) VALUES (?,?,?,?,?,?,?)').bind(cid, lookup || null, name, place || null, a.holder || null, ctx.actor, nowIso()).run();
    await env.DB.prepare('UPDATE act_cache SET value = ?, at = ? WHERE key = ?').bind(cid, nowIso(), claim).run().catch(() => undefined);
    if (a.row) {
      row = await entryPatch(ctx, a.row, { constituent_id: cid }).catch((e) => {
        warnings.push('The row was not linked to the new partner: ' + (e instanceof Error ? e.message : 'try Find the partner'));
        return null;
      });
    }
  }
  await logEvent(env, {
    actor: ctx.actor, actor_email: ctx.email, kind: mode.standin ? 'partner_add_standin' : 'partner_added',
    detail: `${name} (${cid}${cid2 ? ', ' + cid2 : ''}${cid3 ? ', ' + cid3 : ''}) code ${a.code}${a.typeCode ? ' + ' + a.typeCode : ''}${a.holder ? ' holder ' + a.holder : ''}; ${spent} calls; matches shown ${check ? check.matches.length : '?'} (${check ? check.live : 'unchecked'}); tick confirmed`,
  }).catch(() => undefined);
  return { ok: true, standin: mode.standin, cid, cid2, cid3, lookup, name, warnings, calls: mode.standin ? log : null, row };
}

const sayShort = (b: any): string => (!b ? 'Blackbaud said no' : typeof b === 'string' ? b : Array.isArray(b) && b[0] ? String(b[0].message || b[0].error_name || 'Blackbaud said no') : String(b.message || 'Blackbaud said no'));

void newId;
