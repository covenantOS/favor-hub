// Record maintenance in the hub's partner drawer: contact details (addresses, phones, emails), the three record flags, constituent codes
// and solicit codes, and the deceased and inactive marks. Everything is read live from Blackbaud (the mirror lacks address dates, seasonal
// windows and ended codes), written through the same batch outbox as the Work Center's edits (saved first, sent through the upkeep
// route's write guard and its ledger, counted in the day's meter, undone for 24 hours), and read back after the send so the screen shows
// what Blackbaud kept, not what was sent.
//
// Probed on record 27202 on 2026-10-10 and 2026-10-11 (live test through the hub):
//  - An address marked Preferred cannot be unmarked and cannot be deleted. Another address is marked preferred instead (Blackbaud
//    clears the old mark itself), so a new preferred address is made unmarked and then marked, and Undo marks the old one again before
//    it removes the new one. Phones and emails can be unmarked and deleted.
//  - Blackbaud puts "preferred" and "primary" on the newest row and clears the old one itself. The plan still unmarks the old row first
//    and the read-back counts exactly one preferred active address.
//  - Ending an address (an end date in the past) makes it inactive. An end of null puts it back.
//  - A Seasonal address needs both seasonal dates, and its type cannot change away from Seasonal.
//  - Marking deceased takes deceased:true plus a date. {deceased:false} alone answers 200 and keeps the mark; undoing needs
//    {deceased:false, deceased_date:null}.
//  - Solicit codes are the Constituent API's communication preferences: GET /constituents/{id}/communicationpreferences, POST
//    /communicationpreferences, PATCH {end}. The Communication Preference API route lists the code table only and its POST answers 404.
import { HttpError, nowIso, type Env } from '../http';
import { mirror } from '../foundations/blackbaud';
import { readOnly } from './repo';
import { addMeter, getSetting, logEvent, setSetting } from './db';
import type { Step } from '../actions/completion';
import type { Ctx, PlannedItem } from './service';

const ID = /^\d{1,12}$/;
const parse = (s: unknown): any => {
  try {
    return typeof s === 'string' ? JSON.parse(s) : s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
};
const todayEt = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/* ------------------------------------------------------------------ code tables */

/** The tables Favor's Blackbaud holds (read 2026-10-10). A weekly read refreshes them; these fill any gap. */
export const TABLES_FALLBACK = {
  addressTypes: ['Home', 'Business', 'Seasonal', 'Estate', 'Previous address'],
  phoneTypes: ['Home Phone', 'Cell Phone', 'Business Phone', 'International Phone'],
  titles: ['Admiral', 'Ambassador', 'Archbishop', 'Bishop', 'Brother', 'Capt.', 'Cmdr.', 'Col.', 'Dr.', 'Drs.', 'Father', 'General', 'Governor', 'Judge', 'Lt.', 'Madam', 'Major', 'Master', 'Miss', 'Mr.', 'Mrs.', 'Ms.', 'Pastor', 'Prof.', 'Rabbi', 'Reverend', 'Senator', 'Sir', 'Sir/Madam', 'Sister', 'The Estate of', 'The Honorable'],
  suffixes: ['II', 'III', 'IV', ', D.D.S.', ', Esq.', ', Jr.', ', M.D.', ', Ph.D.', ', Sr.', 'USA Ret.', 'USAF, Ret'],
  relationshipTypes: ['Spouse', 'Parent', 'Child', 'Sibling', 'Friend', 'Employee', 'Board Member', 'Pastor', 'Member', 'Owner', 'Church', 'Business', 'Foundation', 'Donor Advised Fund', 'Staff Member', 'Executive Director', 'President', 'Treasurer'],
  contactTypes: [] as string[],
  constituentCodes: ['Partner', 'Prospect', 'Church', 'Church Staff', 'DAF Provider', 'Foundation', 'Board Member', 'Volunteer', 'Vendor', 'Staff', 'Other'],
  solicitCodes: ['All Email', 'All Mail', 'Call From Approved Person', 'Do Not Call', 'Do Not Call to Solicit', 'Do Not Call to Thank', 'Do Not Contact', 'Do Not Email', 'Do Not Email Newsletter', 'Do Not Email Quarterly Report', 'Do Not Email Solicitation', 'Do Not Mail', 'Do Not Mail Quarterly Report', 'Do Not Mail Solicitation', 'Do Not Mail Thank You', 'Do Not Solicit', 'Do Not Text', 'Email Annual Tax Receipts', 'Email Newsletter', 'Email Quarterly Report', 'Email Solicitation', 'Event Invitations Only', 'Has no valid email', 'Mail Quarterly Report', 'Mail Solicitation', 'No Event Invitations'],
};
export type Tables = typeof TABLES_FALLBACK & { at: string; source: string };

/** Codes the morning run owns. They are not added, ended or changed here. */
export const MORNING_RUN_CODES = ['Partner', 'Prospect'];

const TABLES_KEY = 'rectables:v1';

/** Add spaces back where Blackbaud's list run together ("CellPhone" never reaches here; the live read returns the real labels). */
export async function getTables(ctx: Ctx, opts: { force?: boolean } = {}): Promise<Tables> {
  const cached = parse(await getSetting(ctx.env, TABLES_KEY, '').catch(() => ''));
  if (cached && cached.at && !opts.force && Date.now() - Date.parse(cached.at) < 7 * 86400000) return cached as Tables;
  const paths = [
    '/constituent/v1/addresstypes', '/constituent/v1/phonetypes', '/constituent/v1/titles', '/constituent/v1/suffixes', '/constituent/v1/relationshiptypes',
    '/constituent/v1/organizationcontacttypes', '/constituent/v1/constituentcodetypes', '/constituent/v1/communicationpreferences',
  ];
  const r = await ctx.repo.send(paths.map((path) => ({ method: 'GET', path })));
  await addMeter(ctx.env, r.results.length, r.callsToday).catch(() => undefined);
  const list = (i: number): string[] | null => {
    const x = r.results[i];
    const v = x && x.ok && x.body && Array.isArray(x.body.value) ? x.body.value.map((v: any) => (typeof v === 'string' ? v : String(v.name ?? v.description ?? v))).filter(Boolean) : null;
    return v && v.length ? v : null;
  };
  const out: Tables = {
    addressTypes: list(0) || TABLES_FALLBACK.addressTypes,
    phoneTypes: list(1) || TABLES_FALLBACK.phoneTypes,
    titles: list(2) || TABLES_FALLBACK.titles,
    suffixes: list(3) || TABLES_FALLBACK.suffixes,
    relationshipTypes: list(4) || TABLES_FALLBACK.relationshipTypes,
    contactTypes: list(5) || TABLES_FALLBACK.contactTypes,
    constituentCodes: list(6) || TABLES_FALLBACK.constituentCodes,
    solicitCodes: list(7) || TABLES_FALLBACK.solicitCodes,
    at: nowIso(),
    source: r.results.some((x) => x && x.ok) ? 'blackbaud' : 'fallback',
  };
  if (out.source === 'blackbaud') await setSetting(ctx.env, TABLES_KEY, JSON.stringify(out)).catch(() => undefined);
  return out;
}

/* ------------------------------------------------------------------ dates */

export interface Fuzzy {
  d?: number;
  m?: number;
  y?: number;
}

/** A Blackbaud fuzzy date or date-time as YYYY-MM-DD, or '' when there is none. */
export function isoOf(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '';
  if (typeof v === 'object') {
    const f = v as Fuzzy;
    if (f.y && f.m && f.d) return `${f.y}-${String(f.m).padStart(2, '0')}-${String(f.d).padStart(2, '0')}`;
  }
  return '';
}
/** YYYY-MM-DD to a Blackbaud fuzzy date. */
export function fuzzyOf(iso: string): Fuzzy {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { d, m, y };
}
const stampOf = (iso: string): string => `${iso.slice(0, 10)}T00:00:00`;
/** A month and day, as the seasonal window keeps them. */
export interface MonthDay {
  m: number;
  d: number;
}
const monthDay = (v: unknown): MonthDay | null => {
  if (!v || typeof v !== 'object') return null;
  const f = v as Fuzzy;
  return f.m && f.d ? { m: Number(f.m), d: Number(f.d) } : null;
};
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function checkMonthDay(v: unknown, what: string): MonthDay {
  const x = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const m = Number(x.m);
  const d = Number(x.d);
  if (!Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > DAYS_IN[m - 1]) throw new HttpError(400, 'bad_field', `Pick a month and day for ${what}.`);
  return { m, d };
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "Every year May 1 to October 15", shown before a seasonal address saves. */
export function windowWords(a: MonthDay, b: MonthDay): string {
  return `Every year ${MONTHS[a.m - 1]} ${a.d} to ${MONTHS[b.m - 1]} ${b.d}`;
}

/* ------------------------------------------------------------------ live reads and their display shapes */

export type Kind = 'address' | 'phone' | 'email' | 'code' | 'solicit';
const LIST: Record<Kind, string> = { address: 'addresses', phone: 'phones', email: 'emailaddresses', code: 'constituentcodes', solicit: 'communicationpreferences' };
const WRITE: Record<Kind, string> = { address: '/constituent/v1/addresses', phone: '/constituent/v1/phones', email: '/constituent/v1/emailaddresses', code: '/constituent/v1/constituentcodes', solicit: '/constituent/v1/communicationpreferences' };

export interface AddressView {
  id: string;
  type: string;
  lines: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  county: string;
  preferred: boolean;
  doNotMail: boolean;
  inactive: boolean;
  start: string;
  end: string;
  seasonalStart: MonthDay | null;
  seasonalEnd: MonthDay | null;
  added: string;
}
export interface PhoneView {
  id: string;
  number: string;
  type: string;
  primary: boolean;
  doNotCall: boolean;
  inactive: boolean;
}
export interface EmailView {
  id: string;
  address: string;
  primary: boolean;
  doNotEmail: boolean;
  inactive: boolean;
}
export interface CodeView {
  id: string;
  code: string;
  start: string;
  end: string;
  inactive: boolean;
  morningRun: boolean;
}
export interface SolicitView {
  id: string;
  code: string;
  start: string;
  end: string;
  inactive: boolean;
}

const s = (v: unknown): string => (v == null ? '' : String(v));
export const addressView = (a: any): AddressView => ({
  id: s(a.id), type: s(a.type), lines: s(a.address_lines), city: s(a.city), state: s(a.state), zip: s(a.postal_code), country: s(a.country), county: s(a.county),
  preferred: a.preferred === true, doNotMail: a.do_not_mail === true, inactive: a.inactive === true, start: isoOf(a.start), end: isoOf(a.end),
  seasonalStart: monthDay(a.seasonal_start), seasonalEnd: monthDay(a.seasonal_end), added: isoOf(a.date_added),
});
export const phoneView = (p: any): PhoneView => ({ id: s(p.id), number: s(p.number), type: s(p.type), primary: p.primary === true, doNotCall: p.do_not_call === true, inactive: p.inactive === true });
export const emailView = (e: any): EmailView => ({ id: s(e.id), address: s(e.address), primary: e.primary === true, doNotEmail: e.do_not_email === true, inactive: e.inactive === true });
export const codeView = (c: any): CodeView => {
  const end = isoOf(c.end);
  return { id: s(c.id), code: s(c.description), start: isoOf(c.start), end, inactive: c.inactive === true || (!!end && end <= todayEt()), morningRun: MORNING_RUN_CODES.includes(s(c.description)) };
};
export const solicitView = (c: any): SolicitView => {
  const end = isoOf(c.end);
  return { id: s(c.id), code: s(c.solicit_code), start: isoOf(c.start), end, inactive: !!end && end <= todayEt() };
};
const VIEW: Record<Kind, (x: any) => any> = { address: addressView, phone: phoneView, email: emailView, code: codeView, solicit: solicitView };

/** The live rows of one kind for a partner: one Blackbaud call, counted in the day's meter. */
export async function readLive(ctx: Ctx, cid: string, kind: Kind): Promise<any[]> {
  if (!ID.test(cid)) throw new HttpError(400, 'bad_partner', 'That is not a partner record.');
  const r = await ctx.repo.send([{ method: 'GET', path: `/constituent/v1/constituents/${cid}/${LIST[kind]}?include_inactive=true&limit=500` }]);
  await addMeter(ctx.env, r.results.length, r.callsToday).catch(() => undefined);
  const x = r.results[0];
  if (!x) throw new HttpError(503, 'blackbaud_wait', `${r.wait || 'Blackbaud did not answer.'} Nothing was changed. Try again in a minute.`);
  if ((x as any).refused) throw new HttpError(503, 'not_allowed', 'The Blackbaud connection does not allow this yet.');
  if (x.status === 404) throw new HttpError(404, 'no_partner', 'Blackbaud has no record with that number.');
  if (!x.ok || !x.body) throw new HttpError(503, 'blackbaud_wait', 'Blackbaud did not answer, so nothing was changed. Try again in a minute.');
  return Array.isArray(x.body.value) ? x.body.value : [];
}

/** The constituent itself: flags, deceased mark and date. One call. */
export async function readConstituent(ctx: Ctx, cid: string): Promise<Record<string, any>> {
  if (!ID.test(cid)) throw new HttpError(400, 'bad_partner', 'That is not a partner record.');
  const r = await ctx.repo.send([{ method: 'GET', path: `/constituent/v1/constituents/${cid}` }]);
  await addMeter(ctx.env, r.results.length, r.callsToday).catch(() => undefined);
  const x = r.results[0];
  if (!x) throw new HttpError(503, 'blackbaud_wait', `${r.wait || 'Blackbaud did not answer.'} Nothing was changed. Try again in a minute.`);
  if (x.status === 404) throw new HttpError(404, 'no_partner', 'Blackbaud has no record with that number.');
  if (!x.ok || !x.body) throw new HttpError(503, 'blackbaud_wait', 'Blackbaud did not answer, so nothing was changed. Try again in a minute.');
  return x.body;
}

export interface RecordFlags {
  givesAnonymously: boolean;
  requestsNoEmail: boolean;
  noValidAddress: boolean;
  inactive: boolean;
  deceased: boolean;
  deceasedDate: string;
  type: string;
}
export const flagsView = (c: any): RecordFlags => ({
  givesAnonymously: c.gives_anonymously === true, requestsNoEmail: c.requests_no_email === true, noValidAddress: c.no_valid_address === true,
  inactive: c.inactive === true, deceased: c.deceased === true, deceasedDate: isoOf(c.deceased_date), type: s(c.type),
});

/** What the Contact tab shows: all three lists, live. */
export async function contactView(ctx: Ctx, cid: string) {
  const [a, p, e] = await Promise.all([readLive(ctx, cid, 'address'), readLive(ctx, cid, 'phone'), readLive(ctx, cid, 'email')]);
  const t = await getTables(ctx).catch(() => TABLES_FALLBACK);
  return { addresses: a.map(addressView), phones: p.map(phoneView), emails: e.map(emailView), tables: { addressTypes: t.addressTypes, phoneTypes: t.phoneTypes }, at: nowIso() };
}

/** What the Codes tab shows: constituent codes (ended ones too) and solicit codes, live, with the tables for the pickers. */
export async function codesView(ctx: Ctx, cid: string) {
  const [c, sc, tables] = await Promise.all([readLive(ctx, cid, 'code'), readLive(ctx, cid, 'solicit'), getTables(ctx)]);
  return {
    codes: c.map(codeView),
    solicit: sc.map(solicitView),
    tables: { constituentCodes: tables.constituentCodes, solicitCodes: tables.solicitCodes },
    morningRun: MORNING_RUN_CODES,
    at: nowIso(),
  };
}

/** What the Record tab shows: the flags and status live, the open actions and current assignments from the copy. */
export async function recordView(ctx: Ctx, cid: string) {
  const c = await readConstituent(ctx, cid);
  const open = await mirror<any>(ctx.env, readOnly(`SELECT id AS id, action_summary AS summary, action_category AS category, substr(action_date_due, 1, 10) AS due FROM actions WHERE constituent_record_id = ?1 AND json_extract(raw_json, '$.completed') = 0 ORDER BY action_date_due LIMIT 40`), [cid]).catch(() => []);
  const assigns = await mirror<any>(ctx.env, readOnly(`SELECT id AS id, assignment_fundraiser_id AS fid, assignment_type AS type, substr(assignment_to_date, 1, 10) AS endd FROM assignments WHERE constituent_record_id = ?1 AND (assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) >= date('now')) LIMIT 20`), [cid]).catch(() => []);
  const noted = parse(await ctx.env.DB.prepare('SELECT value FROM act_cache WHERE key = ? LIMIT 1').bind(`pstatus:${cid}`).first<{ value: string }>().then((r) => r?.value || '').catch(() => ''));
  return {
    flags: flagsView(c),
    name: s(c.name),
    openActions: open.map((a: any) => ({ id: s(a.id), summary: s(a.summary), category: s(a.category), due: s(a.due) })),
    assignments: assigns.map((a: any) => ({ id: s(a.id), fid: s(a.fid), type: s(a.type) })),
    lastStatusChange: noted && noted.at ? { at: noted.at, status: noted.status, date: noted.date } : null,
    at: nowIso(),
  };
}

/** Drop the short-lived copies of a partner's live reads (a write made them stale). */
export async function forgetRecord(env: Env, cid: string): Promise<void> {
  await env.DB.prepare("DELETE FROM act_cache WHERE key LIKE ?").bind(`rec:%:${cid}`).run().catch(() => undefined);
}

/* ------------------------------------------------------------------ input checks */

const clean = (v: unknown, n: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1;

export interface AddressInput {
  type?: string;
  lines?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  county?: string;
  preferred?: boolean;
  doNotMail?: boolean;
  start?: string;
  end?: string | null;
  seasonalStart?: MonthDay | null;
  seasonalEnd?: MonthDay | null;
}

/** An address as Blackbaud's body. On create the type is required and one of street, city or ZIP must be there. */
export function checkAddress(set: Record<string, any>, tables: { addressTypes: string[] }, opts: { create?: boolean } = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(set, k);
  if (has('type')) {
    const t = tables.addressTypes.find((x) => x.toLowerCase() === clean(set.type, 40).toLowerCase());
    if (!t) throw new HttpError(400, 'bad_field', 'Pick an address type from the list.');
    body.type = t;
  } else if (opts.create) throw new HttpError(400, 'bad_field', 'Pick an address type.');
  if (has('lines')) body.address_lines = clean(set.lines, 150);
  if (has('city')) body.city = clean(set.city, 50);
  if (has('state')) body.state = clean(set.state, 30);
  if (has('zip')) body.postal_code = clean(set.zip, 12);
  if (has('country')) body.country = clean(set.country, 60) || 'United States';
  else if (opts.create) body.country = 'United States';
  if (has('county')) body.county = clean(set.county, 60);
  if (has('preferred')) body.preferred = bool(set.preferred);
  if (has('doNotMail')) body.do_not_mail = bool(set.doNotMail);
  const iso = (v: unknown, what: string): string | null => {
    if (v === null || v === '' || v === undefined) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(String(v) + 'T12:00:00Z'))) throw new HttpError(400, 'bad_field', `Pick a valid date for ${what}.`);
    return String(v);
  };
  if (has('start')) {
    const v = iso(set.start, 'the start date');
    if (v || !opts.create) body.start = v ? stampOf(v) : null;
  }
  if (has('end')) {
    const v = iso(set.end, 'the end date');
    if (v || !opts.create) body.end = v ? stampOf(v) : null;
  }
  if (body.start && body.end && String(body.end) < String(body.start)) throw new HttpError(400, 'bad_field', 'The end date is before the start date.');
  if (has('seasonalStart') || has('seasonalEnd')) {
    body.seasonal_start = checkMonthDay(set.seasonalStart, 'the first day of the season');
    body.seasonal_end = checkMonthDay(set.seasonalEnd, 'the last day of the season');
  }
  if (body.type === 'Seasonal' && (!body.seasonal_start || !body.seasonal_end) && opts.create) throw new HttpError(400, 'bad_field', 'A seasonal address needs the first and last day of the season.');
  if (opts.create && !body.address_lines && !body.city && !body.postal_code) throw new HttpError(400, 'bad_field', 'Type a street, a city or a ZIP code.');
  return body;
}

export function checkPhone(set: Record<string, any>, tables: { phoneTypes: string[] }, opts: { create?: boolean } = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(set, k);
  if (has('number')) {
    const n = clean(set.number, 40);
    if (n.replace(/\D/g, '').length < 7) throw new HttpError(400, 'bad_phone', 'That phone number looks too short.');
    body.number = n;
  } else if (opts.create) throw new HttpError(400, 'bad_field', 'Type the number.');
  if (has('type')) {
    const t = tables.phoneTypes.find((x) => x.toLowerCase() === clean(set.type, 40).toLowerCase());
    if (!t) throw new HttpError(400, 'bad_field', 'Pick a phone type from the list.');
    body.type = t;
  } else if (opts.create) body.type = tables.phoneTypes.includes('Cell Phone') ? 'Cell Phone' : tables.phoneTypes[0];
  if (has('primary')) body.primary = bool(set.primary);
  if (has('doNotCall')) body.do_not_call = bool(set.doNotCall);
  if (has('inactive')) body.inactive = bool(set.inactive);
  return body;
}

export function checkEmail(set: Record<string, any>, opts: { create?: boolean } = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(set, k);
  if (has('address')) {
    const a = clean(set.address, 150);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) throw new HttpError(400, 'bad_email', 'That email address does not look right.');
    body.address = a;
  } else if (opts.create) throw new HttpError(400, 'bad_field', 'Type the email address.');
  if (opts.create) body.type = 'Email';
  if (has('primary')) body.primary = bool(set.primary);
  if (has('doNotEmail')) body.do_not_email = bool(set.doNotEmail);
  if (has('inactive')) body.inactive = bool(set.inactive);
  return body;
}

const sameVal = (a: unknown, b: unknown): boolean => {
  const na = a == null || a === '' ? null : a;
  const nb = b == null || b === '' ? null : b;
  if (typeof na === 'object' && na && typeof nb === 'object' && nb) {
    const key = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    return key(na as Record<string, unknown>) === key(nb as Record<string, unknown>);
  }
  if (typeof na === 'string' && typeof nb === 'string') return na.trim() === nb.trim() || (/^\d{4}-\d{2}-\d{2}T/.test(na) && na.slice(0, 10) === nb.slice(0, 10));
  return (na === false ? null : na) === (nb === false ? null : nb);
};

/** Fields in `set` whose live value is not what the person was looking at and is not already what they asked for. */
export function conflictsOf(live: Record<string, any>, base: Record<string, any> | undefined, body: Record<string, unknown>): { key: string; theirs: unknown }[] {
  if (!base) return [];
  const out: { key: string; theirs: unknown }[] = [];
  for (const k of Object.keys(body)) {
    if (!Object.prototype.hasOwnProperty.call(base, k)) continue;
    if (!sameVal(live[k], base[k]) && !sameVal(live[k], body[k])) out.push({ key: k, theirs: live[k] ?? null });
  }
  return out;
}

/** The body keys that differ from the live row, so an edit sends (and Undo restores) only what changes. */
function changedKeys(live: Record<string, any>, body: Record<string, unknown>): string[] {
  return Object.keys(body).filter((k) => !sameVal(live[k], body[k]));
}

function oldValues(live: Record<string, any>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = live[k];
    out[k] = v === undefined ? (k === 'preferred' || k === 'primary' || k.startsWith('do_not') || k === 'inactive' ? false : k === 'start' || k === 'end' || k.startsWith('seasonal') ? null : '') : v;
  }
  return out;
}

/* ------------------------------------------------------------------ planning */

export interface RecordInput {
  op: string;
  cid?: string;
  kind?: Kind;
  mode?: 'add' | 'edit' | 'end' | 'reopen';
  id?: string;
  set?: Record<string, any>;
  base?: Record<string, any>;
  code?: string;
  date?: string;
  status?: 'active' | 'inactive' | 'deceased';
  effects?: Record<string, boolean>;
  closeIds?: string[];
  alsoNote?: string;
  flags?: Record<string, boolean>;
}
export interface RecordPlan {
  items: PlannedItem[];
  params: Record<string, unknown>;
  reads: number;
  conflict?: { key: string; theirs: unknown }[];
}

const labelFor = (partner: string, what: string) => `${partner || 'Partner'} | ${what}`;

async function partnerName(env: Env, cid: string): Promise<string> {
  const r = await mirror<any>(env, readOnly('SELECT constituent_type AS t, first_name AS f, last_name AS l, preferred_name AS p, organization_name AS o FROM constituents WHERE id = ?1 LIMIT 1'), [cid]).catch(() => []);
  const w = r[0];
  if (!w) return '';
  return w.t === 'Organization' ? w.o || '' : `${w.p || w.f || ''} ${w.l || ''}`.trim();
}

const call = (method: string, path: string): Record<string, unknown> => ({ __call: { method, path } });

/** A step that sends one call, carries the call that puts it back, and says what to read back afterwards. */
function step(method: string, path: string, body: Record<string, unknown>, before: { method: string; path: string; body?: Record<string, unknown> } | undefined, check: Record<string, unknown> | null, label: string, dep?: number): Step {
  const out: Step = {
    op: 'call' as any,
    body: { ...call(method, path), ...(check ? { __check: check } : {}), ...body },
    label,
  };
  if (before) out.before = { ...call(before.method, before.path), ...(before.body || {}) };
  if (dep !== undefined) out.dep = dep;
  return out;
}

/**
 * Contact rows: add, edit or end an address, add or edit a phone or email. The live rows are read first (one call), a field somebody
 * else changed since the form was opened comes back as a conflict, and the one preferred (or primary) row is unmarked before a new
 * one is marked. Undo of an add removes the row (the upkeep route allows that only for a row it made) and puts the mark back.
 */
export async function planContact(ctx: Ctx, input: RecordInput): Promise<RecordPlan> {
  const cid = String(input.cid || '');
  const kind = input.kind;
  if (!ID.test(cid)) throw new HttpError(400, 'no_partner', 'Pick the partner first.');
  if (kind !== 'address' && kind !== 'phone' && kind !== 'email') throw new HttpError(400, 'bad_field', 'Pick what to change.');
  const mode = input.mode === 'edit' || input.mode === 'end' ? input.mode : 'add';
  const tables = await getTables(ctx).catch(() => ({ ...TABLES_FALLBACK, at: '', source: 'fallback' }) as Tables);
  const set = input.set || {};
  const rows = await readLive(ctx, cid, kind);
  const partner = await partnerName(ctx.env, cid);
  const word = kind === 'address' ? 'Address' : kind === 'phone' ? 'Phone' : 'Email';
  const markKey = kind === 'address' ? 'preferred' : 'primary';
  const steps: Step[] = [];
  const base = WRITE[kind];
  const others = (except?: string) => rows.filter((r) => r.inactive !== true && r[markKey] === true && String(r.id) !== except);
  // Phones and emails: the old primary is unmarked first. (An address cannot be unmarked; see the note at the top.)
  const unmark = (except?: string) => {
    if (kind === 'address') return;
    for (const r of others(except)) steps.push(step('PATCH', `${base}/${r.id}`, { [markKey]: false }, { method: 'PATCH', path: `${base}/${r.id}`, body: { [markKey]: true } }, { k: kind, cid, id: String(r.id), expect: { [markKey]: false } }, `unmark ${markKey}`));
  };
  let conflict: { key: string; theirs: unknown }[] | undefined;

  if (mode === 'add') {
    const body = kind === 'address' ? checkAddress(set, tables, { create: true }) : kind === 'phone' ? checkPhone(set, tables, { create: true }) : checkEmail(set, { create: true });
    const wantMark = body[markKey] === true;
    const oldMark = others()[0];
    if (wantMark) unmark();
    if (kind === 'phone' && body.number && rows.some((r) => String(r.number).replace(/\D/g, '') === String(body.number).replace(/\D/g, '') && r.inactive !== true)) throw new HttpError(409, 'duplicate', 'This partner already has that number.');
    if (kind === 'email' && rows.some((r) => String(r.address).toLowerCase() === String(body.address).toLowerCase() && r.inactive !== true)) throw new HttpError(409, 'duplicate', 'This partner already has that email address.');
    if (kind === 'address' && wantMark && oldMark) {
      // Made unmarked, then marked: the mark moves off the old address by Blackbaud's own rule, and Undo can move it back first.
      const plain = { ...body, preferred: false };
      steps.push(step('POST', base, { constituent_id: cid, ...plain }, { method: 'DELETE', path: `${base}/{id}?constituent=${cid}` }, { k: kind, cid, made: true, expect: plain }, 'address add'));
      const mark = step('PATCH', `${base}/{dep}`, { preferred: true }, { method: 'PATCH', path: `${base}/${oldMark.id}`, body: { preferred: true, __undoFirst: true } }, { k: kind, cid, viaDep: true, expect: { preferred: true } }, 'address preferred', 0);
      steps.push(mark);
      return finish();
    }
    const expect: Record<string, unknown> = { ...body };
    steps.push(step('POST', base, { constituent_id: cid, ...body }, { method: 'DELETE', path: `${base}/{id}?constituent=${cid}` }, { k: kind, cid, made: true, expect }, `${word.toLowerCase()} add`));
    // Blackbaud puts the mark on the newest row when none is marked; the read-back asks for exactly one.
    return finish();
  }

  const id = String(input.id || '');
  const live = rows.find((r) => String(r.id) === id);
  if (!live) throw new HttpError(404, 'not_found', 'That row is not on this partner in Blackbaud. Someone may have removed it. Reload and try again.');
  let body: Record<string, unknown>;
  if (mode === 'end') {
    if (kind === 'address') {
      const date = String(set.end || todayEt());
      body = checkAddress({ end: date }, tables);
    } else body = kind === 'phone' ? checkPhone({ inactive: true }, tables) : checkEmail({ inactive: true });
    if (kind !== 'address') body = { ...body, [markKey]: false };
  } else {
    body = kind === 'address' ? checkAddress(set, tables) : kind === 'phone' ? checkPhone(set, tables) : checkEmail(set);
  }
  if (kind === 'address' && live.type === 'Seasonal' && body.type && body.type !== 'Seasonal') throw new HttpError(400, 'bad_field', 'A seasonal address cannot change its type. End it and add the new address.');
  const found = conflictsOf(live, input.base, body);
  if (found.length) return { items: [], params: {}, reads: 1, conflict: found };
  const keys = changedKeys(live, body);
  if (!keys.length) throw new HttpError(400, 'nothing_to_do', 'Nothing changed.');
  const send: Record<string, unknown> = {};
  for (const k of keys) send[k] = body[k];
  if (kind === 'address' && live.preferred === true && send.preferred === false) {
    throw new HttpError(400, 'bad_field', 'An address marked Preferred stays preferred until another address is marked. Mark the other address preferred instead.');
  }
  if (send[markKey] === true) unmark(id);
  if (kind === 'address' && send.preferred === true) {
    // The mark moves by Blackbaud's own rule. It is its own step so Undo moves it back to the old address.
    const rest: Record<string, unknown> = { ...send };
    delete rest.preferred;
    if (Object.keys(rest).length) steps.push(step('PATCH', `${base}/${id}`, rest, { method: 'PATCH', path: `${base}/${id}`, body: oldValues(live, Object.keys(rest)) }, { k: kind, cid, id, expect: rest }, 'address change'));
    const oldMark = others(id)[0];
    steps.push(step('PATCH', `${base}/${id}`, { preferred: true }, oldMark ? { method: 'PATCH', path: `${base}/${oldMark.id}`, body: { preferred: true, __undoFirst: true } } : undefined, { k: kind, cid, id, expect: { preferred: true } }, 'address preferred'));
    return finish();
  }
  steps.push(step('PATCH', `${base}/${id}`, send, { method: 'PATCH', path: `${base}/${id}`, body: oldValues(live, keys) }, { k: kind, cid, id, expect: send }, `${word.toLowerCase()} ${mode === 'end' ? 'end' : 'change'}`));
  return finish();

  function finish(): RecordPlan {
    const items: PlannedItem[] = [{ cid, label: labelFor(partner, mode === 'end' ? `${word} ended` : mode === 'add' ? `New ${word.toLowerCase()}` : `${word} changed`), steps }];
    return { items, params: { op: 'pcontact', kind, mode }, reads: 2, conflict };
  }
}

/** The three record flags. */
export async function planFlags(ctx: Ctx, input: RecordInput): Promise<RecordPlan> {
  const cid = String(input.cid || '');
  if (!ID.test(cid)) throw new HttpError(400, 'no_partner', 'Pick the partner first.');
  const map: Record<string, string> = { givesAnonymously: 'gives_anonymously', requestsNoEmail: 'requests_no_email', noValidAddress: 'no_valid_address' };
  const want: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input.flags || {})) if (map[k]) want[map[k]] = bool(v);
  if (!Object.keys(want).length) throw new HttpError(400, 'nothing_to_do', 'Nothing changed.');
  const c = await readConstituent(ctx, cid);
  const send: Record<string, unknown> = {};
  const back: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(want)) if ((c[k] === true) !== v) { send[k] = v; back[k] = c[k] === true; }
  if (!Object.keys(send).length) throw new HttpError(400, 'nothing_to_do', 'Nothing changed.');
  const partner = await partnerName(ctx.env, cid);
  const path = `/constituent/v1/constituents/${cid}`;
  return { items: [{ cid, label: labelFor(partner, 'Record flags'), steps: [step('PATCH', path, send, { method: 'PATCH', path, body: back }, { k: 'flags', cid, expect: send }, 'record flags')] }], params: { op: 'pflags' }, reads: 2 };
}

/** The pass-through check before a Partner code goes on a record: gifts on it that are all soft-credited to someone else. */
export async function passThrough(env: Env, cid: string): Promise<{ gifts: number; passed: number; to: string[]; blocked: boolean }> {
  const rows = await mirror<any>(env, readOnly("SELECT id AS id, soft_credits AS soft FROM gifts WHERE constituent_record_id = ?1 AND gift_amount > 0 LIMIT 400"), [cid]).catch(() => []);
  let passed = 0;
  const to = new Map<string, number>();
  for (const g of rows) {
    const soft = Array.isArray(parse(g.soft)) ? (parse(g.soft) as any[]) : [];
    const others = soft.filter((x) => String(x.constituent_id) !== cid);
    if (others.length) {
      passed++;
      for (const o of others) to.set(String(o.constituent_id), (to.get(String(o.constituent_id)) || 0) + 1);
    }
  }
  let names: string[] = [];
  if (to.size) {
    const named = await mirror<any>(env, readOnly('SELECT id AS id, constituent_type AS t, first_name AS f, last_name AS l, organization_name AS o FROM constituents WHERE id IN (SELECT value FROM json_each(?1))'), [JSON.stringify([...to.keys()])]).catch(() => []);
    names = named.map((n: any) => (n.t === 'Organization' ? n.o : `${n.f || ''} ${n.l || ''}`.trim())).filter(Boolean);
  }
  return { gifts: rows.length, passed, to: names, blocked: rows.length > 0 && passed === rows.length };
}

/** Constituent codes: add or end. Partner and Prospect belong to the morning run, so they are neither added nor ended here. */
export async function planCode(ctx: Ctx, input: RecordInput): Promise<RecordPlan> {
  const cid = String(input.cid || '');
  if (!ID.test(cid)) throw new HttpError(400, 'no_partner', 'Pick the partner first.');
  const tables = await getTables(ctx).catch(() => ({ ...TABLES_FALLBACK, at: '', source: 'fallback' }) as Tables);
  const rows = await readLive(ctx, cid, 'code');
  const partner = await partnerName(ctx.env, cid);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ? String(input.date) : todayEt();
  const steps: Step[] = [];
  if (input.mode === 'end' || input.mode === 'reopen') {
    const live = rows.find((r) => String(r.id) === String(input.id || ''));
    if (!live) throw new HttpError(404, 'not_found', 'That code is not on this partner in Blackbaud. Reload and try again.');
    if (MORNING_RUN_CODES.includes(s(live.description))) throw new HttpError(403, 'morning_run', `${live.description} comes from the morning run and its gift rules. It is not changed here.`);
    const path = `/constituent/v1/constituentcodes/${live.id}`;
    const reopen = input.mode === 'reopen';
    const send = { end: reopen ? null : fuzzyOf(date) };
    steps.push(step('PATCH', path, send, { method: 'PATCH', path, body: { end: live.end ?? null } }, { k: 'code', cid, id: String(live.id), expect: { end: send.end } }, reopen ? 'code reopen' : 'code end'));
    return { items: [{ cid, label: labelFor(partner, `${live.description} code ${reopen ? 'reopened' : 'ended'}`), steps }], params: { op: 'pcode', mode: input.mode }, reads: 2 };
  }
  const code = tables.constituentCodes.find((c) => c.toLowerCase() === clean(input.code, 60).toLowerCase());
  if (!code) throw new HttpError(400, 'bad_field', 'Pick a code from the list.');
  if (MORNING_RUN_CODES.includes(code)) {
    // The pass-through check stands on its own when someone tries: an organization that only passes money along stays a Prospect.
    const pt = await passThrough(ctx.env, cid);
    if (pt.blocked) throw new HttpError(409, 'pass_through', `All ${pt.gifts} gifts on this record are soft-credited to ${pt.to.slice(0, 2).join(' and ') || 'another partner'}. A record that only passes money along stays a Prospect.`);
    throw new HttpError(403, 'morning_run', `${code} comes from the morning run and its gift rules. It is not added here.`);
  }
  if (rows.some((r) => s(r.description) === code && !isoOf(r.end))) throw new HttpError(409, 'duplicate', `This partner already has the ${code} code.`);
  const body = { constituent_id: cid, description: code, start: fuzzyOf(date) };
  steps.push(step('POST', '/constituent/v1/constituentcodes', body, { method: 'DELETE', path: '/constituent/v1/constituentcodes/{id}' }, { k: 'code', cid, made: true, expect: { description: code } }, 'code add'));
  return { items: [{ cid, label: labelFor(partner, `${code} code added`), steps }], params: { op: 'pcode', mode: 'add' }, reads: 2 };
}

/** Solicit codes: add or end (an end date today). Read and written through the Constituent API's communication preferences. */
export async function planSolicit(ctx: Ctx, input: RecordInput): Promise<RecordPlan> {
  const cid = String(input.cid || '');
  if (!ID.test(cid)) throw new HttpError(400, 'no_partner', 'Pick the partner first.');
  const tables = await getTables(ctx).catch(() => ({ ...TABLES_FALLBACK, at: '', source: 'fallback' }) as Tables);
  const rows = await readLive(ctx, cid, 'solicit');
  const partner = await partnerName(ctx.env, cid);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ? String(input.date) : todayEt();
  const steps: Step[] = [];
  if (input.mode === 'end' || input.mode === 'reopen') {
    const live = rows.find((r) => String(r.id) === String(input.id || ''));
    if (!live) throw new HttpError(404, 'not_found', 'That code is not on this partner in Blackbaud. Reload and try again.');
    const path = `/constituent/v1/communicationpreferences/${live.id}`;
    const reopen = input.mode === 'reopen';
    const send = { end: reopen ? null : stampOf(date) };
    steps.push(step('PATCH', path, send, { method: 'PATCH', path, body: { end: live.end ?? null } }, { k: 'solicit', cid, id: String(live.id), expect: send }, reopen ? 'solicit reopen' : 'solicit end'));
    return { items: [{ cid, label: labelFor(partner, `${live.solicit_code} ${reopen ? 'reopened' : 'ended'}`), steps }], params: { op: 'psolicit', mode: input.mode }, reads: 2 };
  }
  const code = tables.solicitCodes.find((c) => c.toLowerCase() === clean(input.code, 80).toLowerCase());
  if (!code) throw new HttpError(400, 'bad_field', 'Pick a solicit code from the list.');
  if (rows.some((r) => s(r.solicit_code) === code && !isoOf(r.end))) throw new HttpError(409, 'duplicate', `This partner already has ${code}.`);
  const body = { constituent_id: cid, solicit_code: code, start: stampOf(date) };
  steps.push(step('POST', '/constituent/v1/communicationpreferences', body, { method: 'DELETE', path: `/constituent/v1/communicationpreferences/{id}?constituent=${cid}` }, { k: 'solicit', cid, made: true, expect: { solicit_code: code } }, 'solicit add'));
  return { items: [{ cid, label: labelFor(partner, `${code} added`), steps }], params: { op: 'psolicit', mode: 'add' }, reads: 2 };
}

export const STATUS_EFFECTS = ['endPartner', 'endAssignments', 'doNotSolicit', 'closeActions', 'noteOther'] as const;

/**
 * Deceased, inactive, or active again. The flag is always set. The effects the person left ticked run after it: end the Partner code
 * and the assignments on that date, add Do Not Solicit, cancel open actions the person picked, and put a note on the other person
 * in a household. A deceased or inactive record keeps its ended Partner code and assignments, and the morning run skips it.
 */
export async function planStatus(ctx: Ctx, input: RecordInput): Promise<RecordPlan> {
  const cid = String(input.cid || '');
  if (!ID.test(cid)) throw new HttpError(400, 'no_partner', 'Pick the partner first.');
  const status = input.status;
  if (status !== 'active' && status !== 'inactive' && status !== 'deceased') throw new HttpError(400, 'bad_field', 'Pick Active, Inactive or Deceased.');
  const c = await readConstituent(ctx, cid);
  const now = flagsView(c);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ? String(input.date) : todayEt();
  if (status === 'deceased' && c.type === 'Organization') throw new HttpError(400, 'bad_field', 'An organization is marked inactive, not deceased.');
  if (status === 'deceased' && date > todayEt()) throw new HttpError(400, 'bad_field', 'The date of death is in the future.');
  const partner = await partnerName(ctx.env, cid);
  const path = `/constituent/v1/constituents/${cid}`;
  const fx = input.effects || {};
  const steps: Step[] = [];
  const noted: Record<string, unknown> = { at: nowIso(), status, date, codeIds: [], solicit: '' };
  const send: Record<string, unknown> = {};
  const back: Record<string, unknown> = {};
  if (status === 'deceased') {
    if (!now.deceased) { send.deceased = true; back.deceased = false; back.deceased_date = null; }
    if (!now.deceased || now.deceasedDate !== date) { send.deceased_date = fuzzyOf(date); if (now.deceasedDate) back.deceased_date = fuzzyOf(now.deceasedDate); }
  } else if (status === 'inactive') {
    if (!now.inactive) { send.inactive = true; back.inactive = false; }
  } else {
    if (now.deceased) { send.deceased = false; send.deceased_date = null; back.deceased = true; back.deceased_date = now.deceasedDate ? fuzzyOf(now.deceasedDate) : null; }
    if (now.inactive) { send.inactive = false; back.inactive = true; }
  }
  if (!Object.keys(send).length && status !== 'active') throw new HttpError(400, 'nothing_to_do', `This record is already ${status === 'deceased' ? 'marked deceased' : 'inactive'}.`);
  if (!Object.keys(send).length && status === 'active') throw new HttpError(400, 'nothing_to_do', 'This record is already active.');
  steps.push(step('PATCH', path, send, { method: 'PATCH', path, body: back }, { k: 'flags', cid, expect: send }, 'record status'));

  if (status === 'active') {
    // Reopen what ended with the status, from the hub's own note of that change.
    const prior = parse(await ctx.env.DB.prepare('SELECT value FROM act_cache WHERE key = ? LIMIT 1').bind(`pstatus:${cid}`).first<{ value: string }>().then((r) => r?.value || '').catch(() => ''));
    const codes = await readLive(ctx, cid, 'code');
    for (const id of Array.isArray(prior.codeIds) ? prior.codeIds : []) {
      const live = codes.find((r) => String(r.id) === String(id));
      if (!live || !isoOf(live.end)) continue;
      const p = `/constituent/v1/constituentcodes/${live.id}`;
      steps.push(step('PATCH', p, { end: null }, { method: 'PATCH', path: p, body: { end: live.end } }, { k: 'code', cid, id: String(live.id), expect: { end: null } }, 'code reopen'));
    }
    if (prior.solicit) {
      // The code this status added: the same name, started on the date of the status, still open.
      const sc = await readLive(ctx, cid, 'solicit');
      const live = sc.find((r) => s(r.solicit_code) === String(prior.solicit) && isoOf(r.start) === String(prior.date) && !isoOf(r.end));
      if (live) {
        const p = `/constituent/v1/communicationpreferences/${live.id}`;
        steps.push(step('PATCH', p, { end: stampOf(date) }, { method: 'PATCH', path: p, body: { end: null } }, { k: 'solicit', cid, id: String(live.id), expect: { end: stampOf(date) } }, 'solicit end'));
      }
    }
    return { items: [{ cid, label: labelFor(partner, 'Marked active'), steps }], params: { op: 'pstatus', status }, reads: 4 };
  }

  let reads = 2;
  if (fx.endPartner !== false) {
    const codes = await readLive(ctx, cid, 'code');
    reads++;
    for (const r of codes) {
      if (s(r.description) !== 'Partner' || isoOf(r.end)) continue;
      const p = `/constituent/v1/constituentcodes/${r.id}`;
      (noted.codeIds as string[]).push(String(r.id));
      steps.push(step('PATCH', p, { end: fuzzyOf(date) }, { method: 'PATCH', path: p, body: { end: null } }, { k: 'code', cid, id: String(r.id), expect: { end: fuzzyOf(date) } }, 'end Partner code'));
    }
  }
  if (fx.endAssignments !== false) {
    const rows = await mirror<any>(ctx.env, readOnly(`SELECT id AS id FROM assignments WHERE constituent_record_id = ?1 AND (assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) > ?2) LIMIT 20`), [cid, date]).catch(() => []);
    for (const a of rows) {
      const p = `/fundraising/v1/fundraisers/assignments/${a.id}`;
      steps.push(step('PATCH', p, { end: stampOf(date) }, { method: 'PATCH', path: p, body: { end: null } }, null, 'end assignment'));
    }
  }
  if (fx.doNotSolicit !== false && status === 'deceased' || fx.doNotSolicit === true) {
    const sc = await readLive(ctx, cid, 'solicit');
    reads++;
    if (!sc.some((r) => s(r.solicit_code) === 'Do Not Solicit' && !isoOf(r.end))) {
      noted.solicit = 'Do Not Solicit';
      steps.push(step('POST', '/constituent/v1/communicationpreferences', { constituent_id: cid, solicit_code: 'Do Not Solicit', start: stampOf(date) }, { method: 'DELETE', path: `/constituent/v1/communicationpreferences/{id}?constituent=${cid}` }, { k: 'solicit', cid, made: true, expect: { solicit_code: 'Do Not Solicit' } }, 'solicit add'));
    }
  }
  const closeIds = [...new Set((input.closeIds || []).map(String).filter((x) => ID.test(x)))];
  for (const id of closeIds.slice(0, 40)) {
    const p = `/constituent/v1/actions/${id}`;
    steps.push({ op: 'call' as any, actionId: id, body: { ...call('PATCH', p), status: 'Canceled' }, before: { ...call('PATCH', p), status: 'Open' }, label: 'cancel action' });
  }
  const items: PlannedItem[] = [{ cid, label: labelFor(partner, status === 'deceased' ? 'Marked deceased' : 'Marked inactive'), steps }];
  const other = String(input.alsoNote || '');
  if (fx.noteOther === true && ID.test(other) && other !== cid) {
    const nm = await partnerName(ctx.env, other);
    const d = fuzzyOf(todayEt());
    items.push({ cid: other, label: labelFor(nm, 'Note about the household'), steps: [step('POST', '/constituent/v1/notes', { constituent_id: other, type: 'Note (general)', summary: `${partner} ${status === 'deceased' ? 'passed away' : 'is now inactive'}`.slice(0, 255), text: status === 'deceased' ? `${partner} passed away on ${date}.` : `${partner} was marked inactive on ${date}.`, date: d }, { method: 'DELETE', path: '/constituent/v1/notes/{id}' }, null, 'household note')] });
  }
  // The hub keeps a note of what ended with the status so Marking active can open exactly that.
  await ctx.env.DB.prepare('INSERT INTO act_cache (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at').bind(`pstatus:${cid}`, JSON.stringify(noted), nowIso()).run().catch(() => undefined);
  return { items, params: { op: 'pstatus', status }, reads };
}

/** One dispatcher for the five record ops. */
export async function planRecord(ctx: Ctx, input: RecordInput): Promise<RecordPlan> {
  switch (input.op) {
    case 'pcontact':
      return planContact(ctx, input);
    case 'pflags':
      return planFlags(ctx, input);
    case 'pcode':
      return planCode(ctx, input);
    case 'psolicit':
      return planSolicit(ctx, input);
    case 'pstatus':
      return planStatus(ctx, input);
    default:
      throw new HttpError(400, 'bad_op', 'That is not something the Work Center does.');
  }
}

export const RECORD_OPS = ['pcontact', 'pflags', 'pcode', 'psolicit', 'pstatus'] as const;

/* ------------------------------------------------------------------ the read-back */

interface Check {
  k: Kind | 'flags';
  cid: string;
  id?: string;
  made?: boolean;
  /** The row to read back is the one an earlier step of the same batch made. */
  viaDep?: boolean;
  expect: Record<string, unknown>;
}

/** The value Blackbaud keeps, in the form the check compares. */
function liveField(k: string, row: Record<string, any>): unknown {
  if (k === 'deceased_date' || k === 'start' || k === 'end') {
    const v = row[k];
    return v == null ? null : typeof v === 'object' ? v : String(v).slice(0, 10);
  }
  return row[k];
}
function expectField(k: string, v: unknown): unknown {
  if ((k === 'start' || k === 'end') && typeof v === 'string') return v.slice(0, 10);
  return v;
}
/** Whether the live row carries every value the change asked for. Returns the first key that does not. */
export function mismatch(row: Record<string, any>, expect: Record<string, unknown>): string | null {
  for (const [k, want] of Object.entries(expect)) {
    const got = liveField(k, row);
    const w = expectField(k, want);
    if (typeof w === 'object' && w !== null) {
      const a = got && typeof got === 'object' ? (got as Fuzzy) : null;
      const b = w as Fuzzy;
      if (!a || a.d !== b.d || a.m !== b.m || (b.y !== undefined && a.y !== b.y)) return k;
      continue;
    }
    if (w === null) {
      if (got !== null && got !== undefined && got !== '' && got !== false) return k;
      continue;
    }
    if (typeof w === 'boolean') {
      if ((got === true) !== w) return k;
      continue;
    }
    // A phone number may come back reformatted, and Blackbaud may change the case of a state or an email address.
    if (k === 'number') {
      if (String(got ?? '').replace(/\D/g, '') !== String(w).replace(/\D/g, '')) return k;
      continue;
    }
    if (String(got ?? '').trim().toLowerCase() !== String(w).trim().toLowerCase()) return k;
  }
  return null;
}

/**
 * After a request sends record changes, read each partner's rows back once per kind and compare. A change Blackbaud answered with 200
 * and did not keep is marked failed in plain words, and a second preferred or primary row is cleared. Called by the drain with the
 * rows that went. Costs one call per partner and kind.
 */
export async function verifyRecords(ctx: Ctx, rows: { id: string; op: string; bb_id: string | null; payload: string | null }[]): Promise<void> {
  const groups = new Map<string, { check: Check; rows: { id: string; bb_id: string | null; check: Check }[] }>();
  for (const r of rows) {
    if (r.op !== 'call') continue;
    const p = parse(r.payload);
    const ck = p.__check as Check | undefined;
    if (!ck || !ck.cid) continue;
    const key = `${ck.cid}:${ck.k}`;
    const g = groups.get(key) || { check: ck, rows: [] };
    let bb = r.bb_id;
    if (ck.viaDep && p.__dep) {
      const dep = await ctx.env.DB.prepare('SELECT bb_id FROM act_outbox WHERE id = ?').bind(p.__dep).first<{ bb_id: string | null }>().catch(() => null);
      bb = dep ? dep.bb_id : null;
    }
    g.rows.push({ id: r.id, bb_id: bb, check: ck.viaDep ? { ...ck, made: true } : ck });
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const { cid, k } = g.check;
    let live: any[] = [];
    try {
      if (k === 'flags') live = [await readConstituent(ctx, cid)];
      else live = await readLive(ctx, cid, k as Kind);
    } catch {
      continue; // The read-back could not run; the rows stay "sent" and the screen reads the record fresh.
    }
    for (const row of g.rows) {
      const id = row.check.made ? String(row.bb_id || '') : String(row.check.id || '');
      const mine = k === 'flags' ? live[0] : live.find((x) => String(x.id) === id);
      let why = '';
      if (!mine) why = 'Blackbaud does not list it';
      else {
        const bad = mismatch(mine, row.check.expect);
        if (bad) why = `Blackbaud kept a different ${bad.replace(/_/g, ' ')}`;
      }
      if (!why && (k === 'address' || k === 'phone' || k === 'email') && row.check.expect && (row.check.expect.preferred === true || row.check.expect.primary === true)) {
        const flag = k === 'address' ? 'preferred' : 'primary';
        const marked = live.filter((x) => x[flag] === true && x.inactive !== true && String(x.id) !== id);
        if (k === 'address' && marked.length) why = 'Blackbaud shows two preferred addresses';
        for (const o of k === 'address' ? [] : marked) {
          const path = `${WRITE[k]}/${o.id}`;
          const fix = await ctx.repo.send([{ method: 'PATCH', path, body: { [flag]: false } }]);
          await addMeter(ctx.env, fix.results.length, fix.callsToday).catch(() => undefined);
          if (!fix.results[0] || !fix.results[0].ok) why = `Blackbaud shows two ${flag} rows and would not clear the other`;
        }
      }
      if (why) {
        await ctx.env.DB.prepare("UPDATE act_outbox SET state = 'failed', last_error = ? WHERE id = ? AND state IN ('sent', 'verified')").bind(`${why}. The change was not kept.`, row.id).run().catch(() => undefined);
        await logEvent(ctx.env, { actor: ctx.actor, actor_email: ctx.email, kind: 'record_check_failed', ok: false, detail: `${cid} ${k}: ${why}` }).catch(() => undefined);
      } else {
        await ctx.env.DB.prepare("UPDATE act_outbox SET state = 'verified' WHERE id = ? AND state = 'sent'").bind(row.id).run().catch(() => undefined);
      }
    }
    await forgetRecord(ctx.env, cid);
  }
}
