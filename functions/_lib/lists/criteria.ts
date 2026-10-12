// The list builder's criteria and the SQL they compile to. Everything a person picks is a menu value, checked here against
// a whitelist or a shape (date, number, id); nothing a person types is ever placed in the SQL text, only bound as a parameter.
//
// Two lists share one spec. A partner list is households (the Brain's household rule, see layer.ts); a gift list is the gifts
// credited to the households that pass the same partner criteria. Statuses use the KPI dashboard's windows:
//   active  last gift within the 12 months up to today
//   LYBUNT  last gift 12 to 24 months back
//   lapsed  last gift more than 24 months back
// computed here with SQLite's date(today, '-12 months'), the same expression the Brain uses.

export const KINDS = ['partners', 'gifts'] as const;
export type Kind = (typeof KINDS)[number];
export const STATUSES = ['active', 'lybunt', 'lapsed'] as const;
export type Status = (typeof STATUSES)[number];
export const MAJOR_MIN = 1000;
export const MAX_ROWS = 25000;
export const PAGE = 100;

export interface Range {
  min: number | null;
  max: number | null;
}
export interface Span {
  from: string;
  to: string;
}
export interface Giving extends Span, Range {}

export interface PartnerCrit {
  status: Status[];
  deceased: 'exclude' | 'include' | 'only';
  major: 'any' | 'yes' | 'no';
  type: 'any' | 'individual' | 'organization';
  cameIn: 'any' | 'acquisition' | 'other';
  firstCats: string[];
  holders: string[];
  holderTypes: string[];
  teams: string[];
  holder: 'any' | 'none' | 'some';
  states: string[];
  cities: string[];
  zips: string[];
  lifetime: Range;
  largest: Range;
  gifts: Range;
  giving: Giving[];
  firstGift: Span;
  lastGift: Span;
  contactBefore: string;
  neverContacted: boolean;
  /** Leave out Do Not Mail partners and partners marked no valid address. */
  mailReady: boolean;
  solicitHas: string[];
  solicitNot: string[];
  codesHas: string[];
  codesNot: string[];
  attrsHas: string[];
  attrsNot: string[];
  relsHas: string[];
  eventsHas: string[];
}

export interface GiftCrit extends Span, Range {
  funds: string[];
  fundCats: string[];
  appeals: string[];
  appealCats: string[];
  kinds: ('one_time' | 'recurring')[];
  methods: string[];
  creditedTo: string[];
  soft: 'any' | 'yes' | 'no';
}

export interface ListSpec {
  kind: Kind;
  partner: PartnerCrit;
  gift: GiftCrit;
  columns: string[];
  sort: { key: string; dir: 'asc' | 'desc' };
}

const emptyRange = (): Range => ({ min: null, max: null });
const emptySpan = (): Span => ({ from: '', to: '' });

export function emptySpec(kind: Kind = 'partners'): ListSpec {
  return {
    kind,
    partner: {
      status: [], deceased: 'exclude', major: 'any', type: 'any', cameIn: 'any', firstCats: [], holders: [], holderTypes: [], teams: [], holder: 'any', states: [], cities: [], zips: [],
      lifetime: emptyRange(), largest: emptyRange(), gifts: emptyRange(), giving: [], firstGift: emptySpan(), lastGift: emptySpan(), contactBefore: '', neverContacted: false, mailReady: false,
      solicitHas: [], solicitNot: [], codesHas: [], codesNot: [], attrsHas: [], attrsNot: [], relsHas: [], eventsHas: [],
    },
    gift: { from: '', to: '', min: null, max: null, funds: [], fundCats: [], appeals: [], appealCats: [], kinds: [], methods: [], creditedTo: [], soft: 'any' },
    columns: [],
    sort: { key: '', dir: 'desc' },
  };
}

// ---- columns ----
export interface ColumnDef {
  key: string;
  label: string;
  type: 'text' | 'id' | 'int' | 'money' | 'date' | 'chip';
  /** SQL over h (lr_hh) and, for gift lists, g (lr_gift). `today` placeholders are filled in by the compiler. */
  sql: string;
  /** Partner list or gift list only. */
  only?: Kind;
  /** Shown before the person picks columns. */
  def?: boolean;
  /** A real value the column sorts on, when the shown text differs. */
  sort?: string;
  /** Read from the Blackbaud mirror when rows are shown or exported, never kept in the snapshot. contact needs contact access. */
  live?: 'mail' | 'contact';
}

const STATUS_SQL = (t12: string, t24: string) => `CASE WHEN h.last_gift > '${t12}' THEN 'Active' WHEN h.last_gift > '${t24}' THEN 'LYBUNT' ELSE 'Lapsed' END`;
const LY_SQL = (t12: string, t24: string, t36: string) =>
  `CASE WHEN h.last_gift_ly IS NULL THEN '' WHEN h.last_gift_ly > '${t24}' THEN 'Active' WHEN h.last_gift_ly > '${t36}' THEN 'LYBUNT' ELSE 'Lapsed' END`;
const HOLDERS_SQL = `(SELECT group_concat(DISTINCT f.name) FROM lr_holder x JOIN lr_fr f ON f.id = x.fundraiser_id WHERE x.household_id = h.household_id)`;
const holderOf = (type: string) => `(SELECT group_concat(DISTINCT f.name) FROM lr_holder x JOIN lr_fr f ON f.id = x.fundraiser_id WHERE x.household_id = h.household_id AND x.atype = '${type}')`;
const TAGS_SQL = (kind: string) => `(SELECT group_concat(t.value, '; ') FROM lr_tag t WHERE t.household_id = h.household_id AND t.kind = '${kind}')`;

/** Columns, in the order the picker lists them. The status expressions need the date placeholders, so this is a function of them. */
export function columns(p: { t12: string; t24: string; t36: string }): ColumnDef[] {
  return [
    { key: 'partner', label: 'Partner', type: 'text', sql: 'h.name', def: true },
    { key: 'lookup', label: 'Partner ID', type: 'id', sql: 'h.lookup_id', def: true },
    { key: 'ptype', label: 'Type', type: 'text', sql: 'h.ctype' },
    { key: 'status', label: 'Status', type: 'chip', sql: STATUS_SQL(p.t12, p.t24), sort: 'h.last_gift', def: true },
    { key: 'status_ly', label: 'Status a year ago', type: 'chip', sql: LY_SQL(p.t12, p.t24, p.t36) },
    { key: 'major', label: 'Major', type: 'text', sql: `CASE WHEN h.major = 1 THEN 'Yes' ELSE '' END`, sort: 'h.largest' },
    { key: 'came_in', label: 'Came in through', type: 'text', sql: `CASE WHEN h.first_cat = 'Acquisition' THEN 'Acquisition' ELSE 'Other' END` },
    { key: 'first_appeal', label: 'First appeal', type: 'text', sql: 'h.first_code', only: 'partners' },
    { key: 'first_cat', label: 'First appeal category', type: 'text', sql: 'h.first_cat', only: 'partners' },
    { key: 'last_appeal', label: 'Last appeal', type: 'text', sql: 'h.last_code', only: 'partners' },
    { key: 'last_cat', label: 'Last appeal category', type: 'text', sql: 'h.last_cat', only: 'partners' },
    { key: 'first_gift', label: 'First gift', type: 'date', sql: 'h.first_gift', only: 'partners' },
    { key: 'last_gift', label: 'Last gift', type: 'date', sql: 'h.last_gift', only: 'partners', def: true },
    { key: 'last_amt', label: 'Last gift amount', type: 'money', sql: 'h.last_amt', only: 'partners' },
    { key: 'largest', label: 'Largest gift', type: 'money', sql: 'h.largest', only: 'partners' },
    { key: 'lifetime', label: 'Lifetime giving', type: 'money', sql: 'h.lifetime', only: 'partners', def: true },
    { key: 'gifts', label: 'Gifts', type: 'int', sql: 'h.gifts', only: 'partners' },
    { key: 'city', label: 'City', type: 'text', sql: 'h.city' },
    { key: 'state', label: 'State', type: 'text', sql: 'h.state', def: true },
    { key: 'zip', label: 'ZIP', type: 'text', sql: 'h.zip' },
    { key: 'country', label: 'Country', type: 'text', sql: 'h.country' },
    { key: 'holders', label: 'Held by', type: 'text', sql: HOLDERS_SQL },
    { key: 'rdd', label: 'RDD', type: 'text', sql: holderOf('Regional Development Director (RDD)') },
    { key: 'care', label: 'Partner Care', type: 'text', sql: holderOf('Partner Care') },
    { key: 'last_contact', label: 'Last contact', type: 'date', sql: 'h.last_contact', only: 'partners' },
    { key: 'solicit', label: 'Solicit codes', type: 'text', sql: TAGS_SQL('solicit') },
    { key: 'codes', label: 'Constituent codes', type: 'text', sql: TAGS_SQL('code') },
    { key: 'addressee', label: 'Addressee', type: 'text', sql: '', live: 'mail', only: 'partners' },
    { key: 'salutation', label: 'Salutation', type: 'text', sql: '', live: 'mail', only: 'partners' },
    { key: 'address', label: 'Address lines', type: 'text', sql: '', live: 'mail', only: 'partners' },
    { key: 'email', label: 'Email', type: 'text', sql: '', live: 'contact', only: 'partners' },
    { key: 'phone', label: 'Phone', type: 'text', sql: '', live: 'contact', only: 'partners' },
    { key: 'period_total', label: 'Giving in the period', type: 'money', sql: '', only: 'partners' },
    // Gift columns.
    { key: 'gift_id', label: 'Gift ID', type: 'id', sql: 'g.gift_id', only: 'gifts', def: true },
    { key: 'gift_date', label: 'Gift date', type: 'date', sql: 'g.gift_date', only: 'gifts', def: true },
    { key: 'amount', label: 'Gift amount', type: 'money', sql: 'g.amount', only: 'gifts' },
    { key: 'credited', label: 'Credited to partner', type: 'money', sql: 'g.credited', only: 'gifts', def: true },
    { key: 'gift_kind', label: 'Gift type', type: 'text', sql: `CASE g.kind WHEN 'recurring' THEN 'Recurring' ELSE 'One-time' END`, only: 'gifts', def: true },
    { key: 'method', label: 'Payment method', type: 'text', sql: 'g.method', only: 'gifts' },
    { key: 'fund', label: 'Fund', type: 'text', sql: 'g.fund_names', only: 'gifts', def: true },
    { key: 'fund_cat', label: 'Fund category', type: 'text', sql: `replace(trim(g.fund_cats, '|'), '|', '; ')`, only: 'gifts' },
    { key: 'appeal', label: 'Appeal', type: 'text', sql: 'g.appeal_codes', only: 'gifts', def: true },
    { key: 'appeal_cat', label: 'Appeal category', type: 'text', sql: `replace(trim(g.appeal_cats, '|'), '|', '; ')`, only: 'gifts' },
    { key: 'credit_to', label: 'Fundraiser credit', type: 'text', sql: 'g.cred_names', only: 'gifts' },
    { key: 'soft', label: 'Soft credit', type: 'text', sql: `CASE WHEN g.soft = 1 THEN 'Yes' ELSE '' END`, only: 'gifts' },
  ];
}

// ---- normalizing ----
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const t = Date.parse(s + 'T12:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};
const date = (s: unknown): string => (validDate(s) ? s : '');
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) < 1e12 ? n : null;
};
const range = (r: any): Range => ({ min: num(r?.min), max: num(r?.max) });
const span = (r: any): Span => ({ from: date(r?.from), to: date(r?.to) });
const strs = (v: unknown, max = 60, len = 80): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' || typeof x === 'number').map((x) => String(x).trim()).filter((x) => x && x.length <= len))].slice(0, max) : [];
const ids = (v: unknown, max = 60): string[] => strs(v, max, 12).filter((x) => /^\d{1,12}$/.test(x));
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const picks = <T extends string>(v: unknown, allowed: readonly T[]): T[] => (Array.isArray(v) ? allowed.filter((a) => v.includes(a)) : []);

/** Clean anything a browser sent into a spec the compiler accepts. Unknown keys and bad values are dropped, never guessed at. */
export function normalizeSpec(input: unknown): ListSpec {
  const i: any = input && typeof input === 'object' ? input : {};
  const p: any = i.partner && typeof i.partner === 'object' ? i.partner : {};
  const g: any = i.gift && typeof i.gift === 'object' ? i.gift : {};
  const kind = pick(i.kind, KINDS, 'partners');
  const out = emptySpec(kind);
  out.partner = {
    status: picks(p.status, STATUSES),
    deceased: pick(p.deceased, ['exclude', 'include', 'only'] as const, 'exclude'),
    major: pick(p.major, ['any', 'yes', 'no'] as const, 'any'),
    type: pick(p.type, ['any', 'individual', 'organization'] as const, 'any'),
    cameIn: pick(p.cameIn, ['any', 'acquisition', 'other'] as const, 'any'),
    firstCats: strs(p.firstCats),
    holders: ids(p.holders),
    holderTypes: strs(p.holderTypes, 12),
    teams: strs(p.teams, 12, 24).filter((t) => /^[a-z_]+$/.test(t)),
    holder: pick(p.holder, ['any', 'none', 'some'] as const, 'any'),
    states: strs(p.states, 60, 2).map((s) => s.toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)),
    cities: strs(p.cities, 10, 60),
    zips: strs(p.zips, 30, 10).filter((z) => /^[0-9A-Za-z -]{2,10}$/.test(z)),
    lifetime: range(p.lifetime),
    largest: range(p.largest),
    gifts: range(p.gifts),
    giving: (Array.isArray(p.giving) ? p.giving : []).slice(0, 3).map((x: any) => ({ ...span(x), ...range(x) })).filter((x: Giving) => x.from || x.to || x.min !== null || x.max !== null),
    firstGift: span(p.firstGift),
    lastGift: span(p.lastGift),
    contactBefore: date(p.contactBefore),
    neverContacted: p.neverContacted === true,
    mailReady: p.mailReady === true,
    solicitHas: strs(p.solicitHas, 20),
    solicitNot: strs(p.solicitNot, 20),
    codesHas: strs(p.codesHas, 20),
    codesNot: strs(p.codesNot, 20),
    attrsHas: strs(p.attrsHas, 20),
    attrsNot: strs(p.attrsNot, 20),
    relsHas: strs(p.relsHas, 20),
    eventsHas: strs(p.eventsHas, 20),
  };
  out.gift = {
    ...span(g),
    ...range(g),
    funds: ids(g.funds),
    fundCats: strs(g.fundCats, 12),
    appeals: ids(g.appeals, 100),
    appealCats: strs(g.appealCats, 30),
    kinds: picks(g.kinds, ['one_time', 'recurring'] as const),
    methods: strs(g.methods, 10),
    creditedTo: ids(g.creditedTo),
    soft: pick(g.soft, ['any', 'yes', 'no'] as const, 'any'),
  };
  const cols = Array.isArray(i.columns) ? i.columns.filter((c: unknown) => typeof c === 'string' && /^[a-z_]{2,20}$/.test(c as string)).slice(0, 40) : [];
  out.columns = [...new Set<string>(cols)];
  const sk = i.sort && typeof i.sort.key === 'string' && /^[a-z_]{2,20}$/.test(i.sort.key) ? i.sort.key : '';
  out.sort = { key: sk, dir: i.sort?.dir === 'asc' ? 'asc' : 'desc' };
  return out;
}

// ---- compiling ----
export const addMonthsSql = (day: string, months: number): string => {
  // SQLite's date(day, '-12 months') rule: month arithmetic that overflows into the next month (Feb 30 is Mar 2).
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
};

export interface Windows {
  today: string;
  t12: string;
  t24: string;
  t36: string;
}
export const windowsFor = (today: string): Windows => {
  // These dates are written into the SQL text of the status columns, so they must be dates and nothing else.
  if (!validDate(today)) throw new Error('today must be YYYY-MM-DD');
  return { today, t12: addMonthsSql(today, -12), t24: addMonthsSql(today, -24), t36: addMonthsSql(today, -36) };
};

class P {
  params: unknown[] = [];
  v(x: unknown): string {
    this.params.push(x);
    return `?${this.params.length}`;
  }
  list(xs: unknown[]): string {
    return `(SELECT value FROM json_each(${this.v(JSON.stringify(xs))}))`;
  }
}

export interface Scope {
  /** True for admins and for roles that see every partner. */
  all: boolean;
  /** Fundraiser ids whose partners this person sees. */
  fids: string[];
}

export interface Compiled {
  /** Rows: kind, columns, sort, limit and offset are applied by list(). */
  where: string[];
  from: string;
  params: unknown[];
  cols: ColumnDef[];
  w: Windows;
  periodSql: string;
  p: P;
}

const like = (col: string, p: P, id: string) => `${col} LIKE ${p.v(`%|${id}|%`)}`;

function periodExpr(gv: Giving, p: P, hAlias = 'h'): string {
  const conds = [`x.household_id = ${hAlias}.household_id`];
  if (gv.from) conds.push(`x.gift_date >= ${p.v(gv.from)}`);
  if (gv.to) conds.push(`x.gift_date <= ${p.v(gv.to)}`);
  return `COALESCE((SELECT SUM(x.credited) FROM lr_gift x WHERE ${conds.join(' AND ')}), 0)`;
}

/** The partner conditions, over h. Shared by the partner list and the gift list. */
export function partnerConditions(c: PartnerCrit, w: Windows, p: P, scope: Scope): string[] {
  const out: string[] = [];
  if (c.deceased === 'exclude') out.push('h.alive = 1');
  if (c.deceased === 'only') out.push('h.alive = 0');
  if (c.status.length) {
    const parts = c.status.map((s) => (s === 'active' ? `h.last_gift > ${p.v(w.t12)}` : s === 'lybunt' ? `(h.last_gift <= ${p.v(w.t12)} AND h.last_gift > ${p.v(w.t24)})` : `h.last_gift <= ${p.v(w.t24)}`));
    out.push(`(${parts.join(' OR ')})`);
  }
  if (c.major === 'yes') out.push(`h.largest >= ${MAJOR_MIN}`);
  if (c.major === 'no') out.push(`h.largest < ${MAJOR_MIN}`);
  if (c.type !== 'any') out.push(`h.ctype = ${p.v(c.type === 'individual' ? 'Individual' : 'Organization')}`);
  if (c.cameIn === 'acquisition') out.push(`h.first_cat = 'Acquisition'`);
  if (c.cameIn === 'other') out.push(`COALESCE(h.first_cat, '') <> 'Acquisition'`);
  if (c.firstCats.length) out.push(`h.first_cat IN ${p.list(c.firstCats)}`);
  if (c.holder === 'none') out.push('NOT EXISTS (SELECT 1 FROM lr_holder x WHERE x.household_id = h.household_id)');
  if (c.holder === 'some') out.push('EXISTS (SELECT 1 FROM lr_holder x WHERE x.household_id = h.household_id)');
  const holdParts: string[] = [];
  if (c.holders.length) holdParts.push(`x.fundraiser_id IN ${p.list(c.holders)}`);
  if (c.teams.length) holdParts.push(`x.fundraiser_id IN (SELECT bb_fundraiser_id FROM act_staff WHERE active = 1 AND bb_fundraiser_id IS NOT NULL AND team IN ${p.list(c.teams)})`);
  if (holdParts.length || c.holderTypes.length) {
    const conds = [...holdParts];
    if (c.holderTypes.length) conds.push(`x.atype IN ${p.list(c.holderTypes)}`);
    out.push(`EXISTS (SELECT 1 FROM lr_holder x WHERE x.household_id = h.household_id AND ${conds.join(' AND ')})`);
  }
  if (c.states.length) out.push(`upper(h.state) IN ${p.list(c.states)}`);
  if (c.cities.length) out.push(`lower(h.city) IN ${p.list(c.cities.map((x) => x.toLowerCase()))}`);
  if (c.zips.length) out.push(`(${c.zips.map((z) => `upper(h.zip) LIKE ${p.v(z.toUpperCase().replace(/[%_]/g, '') + '%')}`).join(' OR ')})`);
  const rng = (col: string, r: Range) => {
    if (r.min !== null) out.push(`${col} >= ${p.v(r.min)}`);
    if (r.max !== null) out.push(`${col} <= ${p.v(r.max)}`);
  };
  rng('h.lifetime', c.lifetime);
  rng('h.largest', c.largest);
  rng('h.gifts', c.gifts);
  for (const gv of c.giving) {
    const e = periodExpr(gv, p);
    if (gv.min !== null) out.push(`${e} >= ${p.v(gv.min)}`);
    if (gv.max !== null) out.push(`${e} <= ${p.v(gv.max)}`);
    if (gv.min === null && gv.max === null) out.push(`${e} > 0`);
  }
  const sp = (col: string, s: Span) => {
    if (s.from) out.push(`${col} >= ${p.v(s.from)}`);
    if (s.to) out.push(`${col} <= ${p.v(s.to)}`);
  };
  sp('h.first_gift', c.firstGift);
  sp('h.last_gift', c.lastGift);
  if (c.neverContacted) out.push('h.last_contact IS NULL');
  else if (c.contactBefore) out.push(`(h.last_contact IS NULL OR h.last_contact < ${p.v(c.contactBefore)})`);
  const tag = (kind: string, has: string[], not: string[]) => {
    for (const v of has) out.push(`EXISTS (SELECT 1 FROM lr_tag t WHERE t.household_id = h.household_id AND t.kind = '${kind}' AND t.value = ${p.v(v)})`);
    if (not.length) out.push(`NOT EXISTS (SELECT 1 FROM lr_tag t WHERE t.household_id = h.household_id AND t.kind = '${kind}' AND t.value IN ${p.list(not)})`);
  };
  tag('solicit', c.solicitHas, c.solicitNot);
  tag('code', c.codesHas, c.codesNot);
  tag('attr', c.attrsHas, c.attrsNot);
  tag('rel', c.relsHas, []);
  tag('event', c.eventsHas, []);
  if (c.mailReady) out.push(`h.no_addr = 0`, `NOT EXISTS (SELECT 1 FROM lr_tag t WHERE t.household_id = h.household_id AND t.kind = 'solicit' AND t.value IN ('Do Not Mail', 'Do Not Contact', 'Do Not Mail Solicitation'))`);
  if (!scope.all) out.push(scope.fids.length ? `h.household_id IN (SELECT household_id FROM lr_holder WHERE fundraiser_id IN ${p.list(scope.fids)})` : '0 = 1');
  return out;
}

/** The gift conditions, over alias a (lr_gift). */
export function giftConditions(c: GiftCrit, p: P, a = 'g'): string[] {
  const out: string[] = [];
  if (c.from) out.push(`${a}.gift_date >= ${p.v(c.from)}`);
  if (c.to) out.push(`${a}.gift_date <= ${p.v(c.to)}`);
  if (c.min !== null) out.push(`${a}.amount >= ${p.v(c.min)}`);
  if (c.max !== null) out.push(`${a}.amount <= ${p.v(c.max)}`);
  const any = (col: string, xs: string[]) => xs.length && out.push(`(${xs.map((x) => like(col, p, x)).join(' OR ')})`);
  any(`${a}.funds`, c.funds);
  any(`${a}.fund_cats`, c.fundCats);
  any(`${a}.appeals`, c.appeals);
  any(`${a}.appeal_cats`, c.appealCats);
  any(`${a}.creds`, c.creditedTo);
  if (c.kinds.length) out.push(`${a}.kind IN ${p.list(c.kinds)}`);
  if (c.methods.length) out.push(`${a}.method IN ${p.list(c.methods)}`);
  if (c.soft === 'yes') out.push(`${a}.soft = 1`);
  if (c.soft === 'no') out.push(`${a}.soft = 0`);
  return out;
}

export const hasGiftCrit = (c: GiftCrit): boolean =>
  Boolean(c.from || c.to || c.min !== null || c.max !== null || c.funds.length || c.fundCats.length || c.appeals.length || c.appealCats.length || c.kinds.length || c.methods.length || c.creditedTo.length || c.soft !== 'any');

export function compile(spec: ListSpec, today: string, scope: Scope): Compiled {
  const w = windowsFor(today);
  const p = new P();
  const cols = columns(w);
  const where = partnerConditions(spec.partner, w, p, scope);
  let from = 'lr_hh h';
  if (spec.kind === 'gifts') {
    from = 'lr_gift g JOIN lr_hh h ON h.household_id = g.household_id';
    where.push(...giftConditions(spec.gift, p));
  } else if (hasGiftCrit(spec.gift)) {
    where.push(`EXISTS (SELECT 1 FROM lr_gift g WHERE g.household_id = h.household_id AND ${giftConditions(spec.gift, p).join(' AND ')})`);
  }
  // The giving-in-the-period column follows the first giving criterion.
  const first = spec.partner.giving[0];
  const periodSql = first ? periodExpr(first, p) : '0';
  return { where, from, params: p.params, cols, w, periodSql, p };
}

export interface Plan {
  countSql: string;
  listSql: string;
  /** The count and list statements share these parameters. */
  params: unknown[];
  columns: ColumnDef[];
}

/** Compile the spec into a count statement and a list statement. limit and offset are bound, never inlined. */
export function plan(spec: ListSpec, today: string, scope: Scope, opts: { limit: number; offset: number; contacts?: boolean }): Plan {
  const c = compile(spec, today, scope);
  const wh = c.where.length ? `WHERE ${c.where.join(' AND ')}` : '';
  const avail = c.cols.filter((x) => (!x.only || x.only === spec.kind) && (x.live !== 'contact' || opts.contacts));
  const wanted = spec.columns.length ? spec.columns.map((k) => avail.find((x) => x.key === k)).filter((x): x is ColumnDef => Boolean(x)) : avail.filter((x) => x.def);
  const shown = wanted.length ? wanted : avail.filter((x) => x.def);
  const sqlOf = (x: ColumnDef) => (x.key === 'period_total' ? c.periodSql : x.sql);
  const select = shown.filter((x) => !x.live).map((x) => `${sqlOf(x)} AS ${x.key}`);
  // The row id the page needs to open a partner or a gift.
  select.push('h.household_id AS _hid', 'h.record_id AS _rid');
  if (spec.kind === 'gifts') select.push('g.gift_id AS _gid');
  const sortCol = avail.find((x) => x.key === (spec.sort.key || (spec.kind === 'gifts' ? 'gift_date' : 'last_gift'))) ?? shown[0];
  const dir = spec.sort.dir === 'asc' ? 'ASC' : 'DESC';
  const orderBy = sortCol && !sortCol.live ? `${sortCol.sort ?? sqlOf(sortCol)} ${dir}, ${spec.kind === 'gifts' ? 'g.gift_id' : 'h.household_id'}` : 'h.household_id';
  const params = c.params;
  const lim = `LIMIT ${c.p.v(Math.min(Math.max(1, opts.limit), MAX_ROWS))} OFFSET ${c.p.v(Math.max(0, opts.offset))}`;
  const count = spec.kind === 'gifts' ? 'COUNT(*) AS n, ROUND(COALESCE(SUM(g.credited), 0), 2) AS total, COUNT(DISTINCT h.household_id) AS partners' : 'COUNT(*) AS n, ROUND(COALESCE(SUM(h.lifetime), 0), 2) AS total, COUNT(*) AS partners';
  return {
    // The count binds only the criteria parameters; the list adds its two limit parameters after them.
    countSql: `SELECT ${count} FROM ${c.from} ${wh}`,
    listSql: `SELECT ${select.join(', ')} FROM ${c.from} ${wh} ORDER BY ${orderBy} ${lim}`,
    params,
    columns: shown,
  };
}

/** The criteria in words for a saved list's card and the Sheets provenance line: short labels, never a sentence. */
export function summarize(spec: ListSpec, names: { fund?: (id: string) => string; appeal?: (id: string) => string; fr?: (id: string) => string } = {}): string[] {
  const c = spec.partner;
  const g = spec.gift;
  const out: string[] = [];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (c.status.length) out.push(c.status.map((s) => (s === 'lybunt' ? 'LYBUNT' : cap(s))).join(' or '));
  if (c.deceased !== 'exclude') out.push(c.deceased === 'only' ? 'Deceased or inactive only' : 'Includes deceased and inactive');
  if (c.major !== 'any') out.push(c.major === 'yes' ? 'Major' : 'Not major');
  if (c.type !== 'any') out.push(cap(c.type) + 's');
  if (c.cameIn !== 'any') out.push(c.cameIn === 'acquisition' ? 'Came in through acquisition' : 'Did not come in through acquisition');
  if (c.firstCats.length) out.push('First appeal: ' + c.firstCats.join(', '));
  if (c.holders.length) out.push('Held by ' + c.holders.map((x) => names.fr?.(x) ?? x).join(', '));
  if (c.teams.length) out.push('Team: ' + c.teams.join(', '));
  if (c.holderTypes.length) out.push('Holder role: ' + c.holderTypes.join(', '));
  if (c.holder === 'none') out.push('No holder');
  if (c.states.length) out.push('State: ' + c.states.join(', '));
  if (c.cities.length) out.push('City: ' + c.cities.join(', '));
  if (c.zips.length) out.push('ZIP: ' + c.zips.join(', '));
  const r = (label: string, x: Range) => (x.min !== null || x.max !== null ? out.push(`${label} ${x.min ?? ''}${x.max !== null ? ' to ' + x.max : ' and up'}`) : undefined);
  r('Lifetime', c.lifetime);
  r('Largest gift', c.largest);
  r('Gifts', c.gifts);
  for (const gv of c.giving) out.push(`Gave ${gv.from || 'ever'} to ${gv.to || 'today'}${gv.min !== null || gv.max !== null ? `: ${gv.min ?? 0} to ${gv.max ?? 'any'}` : ''}`);
  if (c.firstGift.from || c.firstGift.to) out.push(`First gift ${c.firstGift.from || 'any'} to ${c.firstGift.to || 'today'}`);
  if (c.lastGift.from || c.lastGift.to) out.push(`Last gift ${c.lastGift.from || 'any'} to ${c.lastGift.to || 'today'}`);
  if (c.mailReady) out.push('Mail-ready only');
  if (c.neverContacted) out.push('Never contacted');
  else if (c.contactBefore) out.push('No contact since ' + c.contactBefore);
  for (const [l, xs] of [['Solicit code', c.solicitHas], ['No solicit code', c.solicitNot], ['Code', c.codesHas], ['Not code', c.codesNot], ['Attribute', c.attrsHas], ['No attribute', c.attrsNot], ['Relationship', c.relsHas], ['Event', c.eventsHas]] as const) {
    if (xs.length) out.push(`${l}: ${xs.join(', ')}`);
  }
  if (g.from || g.to) out.push(`Gifts ${g.from || 'any'} to ${g.to || 'today'}`);
  if (g.min !== null || g.max !== null) out.push(`Gift amount ${g.min ?? ''}${g.max !== null ? ' to ' + g.max : ' and up'}`);
  if (g.funds.length) out.push('Fund: ' + g.funds.map((x) => names.fund?.(x) ?? x).join(', '));
  if (g.fundCats.length) out.push('Fund category: ' + g.fundCats.join(', '));
  if (g.appeals.length) out.push('Appeal: ' + g.appeals.map((x) => names.appeal?.(x) ?? x).join(', '));
  if (g.appealCats.length) out.push('Appeal category: ' + g.appealCats.join(', '));
  if (g.kinds.length) out.push(g.kinds.map((k) => (k === 'recurring' ? 'Recurring' : 'One-time')).join(' or '));
  if (g.methods.length) out.push('Paid by ' + g.methods.join(', '));
  if (g.creditedTo.length) out.push('Credit: ' + g.creditedTo.map((x) => names.fr?.(x) ?? x).join(', '));
  if (g.soft !== 'any') out.push(g.soft === 'yes' ? 'Soft credit' : 'No soft credit');
  return out;
}
