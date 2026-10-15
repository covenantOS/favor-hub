// The Partners directory's filters, sort and pages over pd_partner (functions/_lib/partners/directory.ts). Everything a person picks is
// checked against a whitelist or a shape and bound as a parameter; nothing a person types is placed in the SQL text.
import { windowsFor } from '../lists/criteria.ts';

export const KINDS = ['individual', 'household', 'organization', 'church', 'foundation'] as const;
export const STATUSES = ['active', 'lybunt', 'lapsed', 'never'] as const;
export const BANDS: Record<string, [number, number | null]> = {
  none: [0, 0],
  u100: [0.01, 99.99],
  '100': [100, 999.99],
  '1k': [1000, 9999.99],
  '10k': [10000, 99999.99],
  '100k': [100000, null],
};
export const BAND_LABEL: Record<string, string> = { none: 'No gifts', u100: 'Under $100', '100': '$100 to $999', '1k': '$1,000 to $9,999', '10k': '$10,000 to $99,999', '100k': '$100,000 and up' };

/** Sort keys a person may pick, and the column each sorts on. Ties fall back to the name. */
export const SORTS: Record<string, string> = {
  name: 'p.sort_name',
  lookup: 'CAST(p.lookup AS INTEGER)',
  kind: 'p.kind',
  place: 'p.state, p.city',
  state: 'p.state',
  lifetime: 'p.lifetime',
  last_gift: 'p.last_gift',
  last_amt: 'p.last_amt',
  first_gift: 'p.first_gift',
  ytd: 'p.ytd',
  l12: 'p.l12',
  last_year: 'p.last_year',
  largest: 'p.largest',
  gifts: 'p.gifts',
  last_contact: 'p.last_contact',
  holder: 'p.holder_names',
  added: 'p.added',
  status: 'p.hh_last',
  open: 'p.open_actions',
};

export interface DirSpec {
  q: string;
  kinds: string[];
  status: string[];
  states: string[];
  holder: string; // '' any, '_none', '_mine' or a fundraiser id
  codes: string[];
  codesNot: string[];
  solicit: string[];
  solicitNot: string[];
  tags: string[];
  band: string;
  firstFrom: string;
  firstTo: string;
  lastFrom: string;
  lastTo: string;
  noContactDays: number;
  major: boolean;
  recurring: boolean;
  openActions: boolean;
  starred: boolean;
  deceased: 'exclude' | 'include' | 'only';
  inactive: 'exclude' | 'include' | 'only';
  sort: string;
  dir: 'asc' | 'desc';
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 120): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const arr = (v: unknown, max = 40): string[] => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []).map((x) => str(x, 80)).filter(Boolean).slice(0, max);
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

export function emptySpec(): DirSpec {
  return {
    q: '', kinds: [], status: [], states: [], holder: '', codes: [], codesNot: [], solicit: [], solicitNot: [], tags: [], band: '', firstFrom: '', firstTo: '',
    lastFrom: '', lastTo: '', noContactDays: 0, major: false, recurring: false, openActions: false, starred: false, deceased: 'exclude', inactive: 'exclude', sort: 'name', dir: 'asc',
  };
}

export function normalizeSpec(raw: any): DirSpec {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = (v: unknown) => (DATE.test(str(v, 10)) ? str(v, 10) : '');
  const holder = str(r.holder, 20);
  return {
    q: str(r.q, 80),
    kinds: arr(r.kinds).filter((k) => (KINDS as readonly string[]).includes(k)),
    status: arr(r.status).filter((k) => (STATUSES as readonly string[]).includes(k)),
    states: arr(r.states, 60).map((s) => s.toUpperCase()).filter((s) => /^[A-Z]{2,3}$/.test(s)),
    holder: holder === '_none' || holder === '_mine' || /^\d{1,12}$/.test(holder) ? holder : '',
    codes: arr(r.codes),
    codesNot: arr(r.codesNot),
    solicit: arr(r.solicit),
    solicitNot: arr(r.solicitNot),
    tags: arr(r.tags),
    band: BANDS[str(r.band, 6)] ? str(r.band, 6) : '',
    firstFrom: d(r.firstFrom),
    firstTo: d(r.firstTo),
    lastFrom: d(r.lastFrom),
    lastTo: d(r.lastTo),
    noContactDays: [30, 90, 180, 365, 730].includes(Number(r.noContactDays)) ? Number(r.noContactDays) : 0,
    major: r.major === true || r.major === '1' || r.major === 'true',
    recurring: r.recurring === true || r.recurring === '1' || r.recurring === 'true',
    openActions: r.openActions === true || r.openActions === '1' || r.openActions === 'true',
    starred: r.starred === true || r.starred === '1' || r.starred === 'true',
    deceased: pick(r.deceased, ['exclude', 'include', 'only'] as const, 'exclude'),
    inactive: pick(r.inactive, ['exclude', 'include', 'only'] as const, 'exclude'),
    sort: SORTS[str(r.sort, 20)] ? str(r.sort, 20) : 'name',
    dir: r.dir === 'desc' ? 'desc' : 'asc',
  };
}

/** The spec read from a query string (?q=&kinds=a,b&sort=...). */
export function specFromParams(u: URLSearchParams): DirSpec {
  const o: Record<string, unknown> = {};
  for (const [k, v] of u.entries()) o[k] = v;
  return normalizeSpec(o);
}

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

export interface Ctx {
  today: string;
  email: string;
  fid: string | null;
}

const statusSql = (t12: string, t24: string) =>
  `CASE WHEN p.hh_last IS NULL THEN 'never' WHEN p.hh_last > '${t12}' THEN 'active' WHEN p.hh_last > '${t24}' THEN 'lybunt' ELSE 'lapsed' END`;

/** WHERE parts for a spec. skip names one filter to leave out (for the counts on that filter's own buttons). */
export function where(spec: DirSpec, ctx: Ctx, skip = ''): { sql: string; params: unknown[]; status: string } {
  const w = windowsFor(ctx.today);
  const p = new P();
  const out: string[] = [];
  const status = statusSql(w.t12, w.t24);
  // A phone number typed with spaces, brackets or dashes is one term: its digits.
  const phone = /^[\d\s()+.-]+$/.test(spec.q) && spec.q.replace(/\D/g, '').length >= 7;
  const toks = phone ? [spec.q.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')] : spec.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  for (const t of toks) {
    const dig = t.replace(/\D/g, '');
    // A phone typed with dashes or brackets is matched on its digits.
    const term = dig.length >= 7 && dig.length >= t.length - 4 ? dig : t;
    out.push(`p.q LIKE ${p.v('%' + term.replace(/[%_]/g, '') + '%')}`);
  }
  if (spec.kinds.length && skip !== 'kinds') {
    const parts: string[] = [];
    const plain = spec.kinds.filter((k) => k !== 'household');
    if (plain.length) parts.push(`p.kind IN ${p.list(plain)}`);
    if (spec.kinds.includes('household')) parts.push(`(p.kind = 'individual' AND p.spouse_id IS NOT NULL)`);
    out.push(`(${parts.join(' OR ')})`);
  }
  if (spec.status.length && skip !== 'status') out.push(`${status} IN ${p.list(spec.status)}`);
  if (spec.states.length) out.push(`p.state IN ${p.list(spec.states)}`);
  if (spec.holder === '_none') out.push(`COALESCE(p.holders, '') = ''`);
  else if (spec.holder === '_mine') out.push(ctx.fid ? `p.holders LIKE ${p.v('%|' + ctx.fid + '|%')}` : '0');
  else if (spec.holder) out.push(`p.holders LIKE ${p.v('%|' + spec.holder + '|%')}`);
  for (const c of spec.codes) out.push(`p.codes LIKE ${p.v('%|' + c + '|%')}`);
  for (const c of spec.codesNot) out.push(`COALESCE(p.codes, '') NOT LIKE ${p.v('%|' + c + '|%')}`);
  for (const c of spec.solicit) out.push(`p.solicit LIKE ${p.v('%|' + c + '|%')}`);
  for (const c of spec.solicitNot) out.push(`COALESCE(p.solicit, '') NOT LIKE ${p.v('%|' + c + '|%')}`);
  for (const t of spec.tags) out.push(`EXISTS (SELECT 1 FROM pd_tag t WHERE t.cid = p.id AND t.tag = ${p.v(t)})`);
  if (spec.band) {
    const [lo, hi] = BANDS[spec.band];
    if (spec.band === 'none') out.push('p.lifetime <= 0');
    else out.push(`p.lifetime >= ${p.v(lo)}` + (hi == null ? '' : ` AND p.lifetime <= ${p.v(hi)}`));
  }
  if (spec.firstFrom) out.push(`p.first_gift >= ${p.v(spec.firstFrom)}`);
  if (spec.firstTo) out.push(`p.first_gift <= ${p.v(spec.firstTo)}`);
  if (spec.lastFrom) out.push(`p.last_gift >= ${p.v(spec.lastFrom)}`);
  if (spec.lastTo) out.push(`p.last_gift <= ${p.v(spec.lastTo)}`);
  if (spec.noContactDays) {
    const d = new Date(Date.parse(ctx.today + 'T12:00:00Z') - spec.noContactDays * 86400000).toISOString().slice(0, 10);
    out.push(`(p.last_contact IS NULL OR p.last_contact < ${p.v(d)})`);
  }
  if (spec.major) out.push('p.largest >= 1000');
  if (spec.recurring) out.push('p.recurring = 1');
  if (spec.openActions) out.push('p.open_actions > 0');
  if (spec.starred) out.push(`EXISTS (SELECT 1 FROM pd_fav f WHERE f.cid = p.id AND f.email = ${p.v(ctx.email)})`);
  if (spec.deceased !== 'include') out.push(spec.deceased === 'only' ? 'p.deceased = 1' : 'p.deceased = 0');
  if (spec.inactive !== 'include') out.push(spec.inactive === 'only' ? 'p.inactive = 1' : 'p.inactive = 0');
  return { sql: out.length ? out.join(' AND ') : '1 = 1', params: p.params, status };
}

export function orderBy(spec: DirSpec): string {
  const col = SORTS[spec.sort] || SORTS.name;
  const dir = spec.dir === 'desc' ? 'DESC' : 'ASC';
  // Empty values sort last either way.
  const first = col.split(',')[0].trim();
  return `ORDER BY (${first} IS NULL) ASC, ${col.split(',').map((c) => `${c.trim()} ${dir}`).join(', ')}, p.sort_name ASC, p.id ASC`;
}

/** The columns the list returns. Contact details come only for people who may see them (see route). */
export function selectCols(status: string, contacts: boolean): string {
  return `p.id, p.lookup, p.name, p.kind, p.spouse_id, p.spouse_name, p.city, p.state, p.zip, p.deceased, p.inactive, p.anon, p.no_addr, p.dnm, p.dne, p.dnc,
    p.added, p.codes, p.solicit, p.holders, p.holder_names, p.gifts, p.lifetime, p.first_gift, p.last_gift, p.last_amt, p.largest, p.ytd, p.last_year, p.l12,
    p.recurring, p.passed_on, p.passed_n, p.last_contact, p.open_actions, ${status} AS status${contacts ? ', p.email, p.phone, p.addr, p.country' : ''}`;
}

export interface ListQuery {
  sql: string;
  params: unknown[];
  countSql: string;
  countParams: unknown[];
}

export function listQuery(spec: DirSpec, ctx: Ctx, page: number, size: number, contacts: boolean): ListQuery {
  const w = where(spec, ctx);
  const lim = Math.min(Math.max(1, Math.floor(size)), 200);
  const off = (Math.max(1, Math.floor(page)) - 1) * lim;
  // A search sorted by name puts the records whose name holds the typed words first.
  let order = orderBy(spec);
  const params = w.params.slice();
  if (spec.q && spec.sort === 'name') {
    params.push(spec.q.toLowerCase());
    order = order.replace('ORDER BY ', `ORDER BY (instr(lower(p.name), ?${params.length}) = 0) ASC, `);
  }
  return {
    sql: `SELECT ${selectCols(w.status, contacts)} FROM pd_partner p WHERE ${w.sql} ${order} LIMIT ${lim} OFFSET ${off}`,
    params,
    countSql: `SELECT COUNT(*) AS n, COALESCE(SUM(p.lifetime), 0) AS lifetime FROM pd_partner p WHERE ${w.sql}`,
    countParams: w.params,
  };
}

/** Counts for the Kind and Status buttons under the other filters. */
export function facetQueries(spec: DirSpec, ctx: Ctx): { kinds: { sql: string; params: unknown[] }; status: { sql: string; params: unknown[] } } {
  const k = where(spec, ctx, 'kinds');
  const s = where(spec, ctx, 'status');
  return {
    kinds: {
      sql: `SELECT p.kind AS k, COUNT(*) AS n, SUM(CASE WHEN p.kind = 'individual' AND p.spouse_id IS NOT NULL THEN 1 ELSE 0 END) AS hh FROM pd_partner p WHERE ${k.sql} GROUP BY p.kind`,
      params: k.params,
    },
    status: { sql: `SELECT ${s.status} AS k, COUNT(*) AS n FROM pd_partner p WHERE ${s.sql} GROUP BY 1`, params: s.params },
  };
}

export const MAX_EXPORT = 25000;

export function exportQuery(spec: DirSpec, ctx: Ctx, contacts: boolean, ids?: string[]): { sql: string; params: unknown[] } {
  const w = where(spec, ctx);
  if (ids && ids.length) {
    return { sql: `SELECT ${selectCols(w.status, contacts)} FROM pd_partner p WHERE p.id IN (SELECT value FROM json_each(?1)) ${orderBy(spec)} LIMIT ${MAX_EXPORT}`, params: [JSON.stringify(ids.slice(0, MAX_EXPORT))] };
  }
  return { sql: `SELECT ${selectCols(w.status, contacts)} FROM pd_partner p WHERE ${w.sql} ${orderBy(spec)} LIMIT ${MAX_EXPORT}`, params: w.params };
}

export const STATUS_LABEL: Record<string, string> = { active: 'Active', lybunt: 'LYBUNT', lapsed: 'Lapsed', never: 'Never gave' };
export const KIND_LABEL: Record<string, string> = { individual: 'Individual', household: 'Household', organization: 'Organization', church: 'Church', foundation: 'Foundation' };
