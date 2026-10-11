// Appeal codes (Admin > Appeal codes). Favor's appeal lookup codes follow one scheme: a prefix letter for the kind, the two-digit year, a month
// character (1 to 9 for January to September, A, B, C for October to December; 0 stands for an evergreen code), a dash and a suffix. Gifts
// are coded to an appeal, so a mailing or a newsletter needs its code in Blackbaud before the first gift. The page builds the code and
// description from the scheme, checks them against the D1 copy of Blackbaud, and creates the appeal through favorintl.org's guarded
// /api/blackbaud/appeals route (the NXT Data Integration API; the Fundraising API cannot create one). Nothing here charges a card or
// contacts a partner. The Blackbaud API has no route to delete an appeal; a wrong code is set inactive in Blackbaud.
import { HttpError, type Env } from '../http';
import { mirror, opsUrl } from '../foundations/blackbaud';
import { getSetting, setSetting } from '../work/db';
import { audit } from './settings';
import { readOnly } from '../work/repo';

export interface Prefix {
  letter: string;
  label: string;
  /** The category Blackbaud holds these appeals under. */
  category: string;
  /** The usual suffix, or a hint when the suffix is chosen per appeal. */
  suffix: string;
  hint: string;
}

export const PREFIXES: Prefix[] = [
  { letter: 'N', label: 'Digital newsletter', category: 'Digital Newsletter', suffix: 'EMW', hint: 'EMW and the week of the month the issue is sent (1 to 5)' },
  { letter: 'L', label: 'Direct mail appeal letter', category: 'Direct Mail Appeal', suffix: 'AD', hint: 'AD active partners, ND new partners, FD former partners' },
  { letter: 'Q', label: 'Direct mail newsletter', category: 'Direct Mail Newsletter', suffix: 'AD', hint: 'The audience initials' },
  { letter: 'Y', label: 'Thank-you letter', category: 'Thank You Letter', suffix: 'TY', hint: 'TY, or TY and the source (TYAQ for acquisition)' },
  { letter: 'K', label: 'Mass acquisition mailing', category: 'Acquisition', suffix: '', hint: 'The split letters, for example SATB' },
  { letter: 'X', label: 'Special mailout', category: 'Acquisition', suffix: '', hint: 'Who it goes to, for example AQHQ' },
  { letter: 'R', label: 'Reactivation', category: 'Reactivation', suffix: '', hint: 'The channel, for example AL, ND or WS (website)' },
  { letter: 'M', label: 'Media or website', category: 'Media', suffix: '', hint: 'The channel, for example FB, YT or CWYT' },
  { letter: 'D', label: 'E-blast', category: 'E-blast', suffix: '', hint: 'Four letters for the subject' },
  { letter: 'E', label: 'Event', category: 'Event', suffix: '', hint: 'Four letters for the event' },
  { letter: 'F', label: 'Flyer', category: 'Flyer', suffix: '', hint: 'Four letters for the flyer' },
  { letter: 'B', label: 'Book', category: 'Book', suffix: '', hint: 'BOOK and the title letters' },
  { letter: 'W', label: 'White mail', category: 'White Mail', suffix: '', hint: 'The decision table in the Appeal Codes note' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_CHARS = '123456789ABC';
export const monthChar = (m: number): string => MONTH_CHARS[m - 1] || '';
export const monthWord = (m: number): string => MONTHS[m - 1] || '';
/** The week of the month a newsletter goes out in: the send day divided by seven, rounded up. */
export const weekOf = (day: number): number => Math.ceil(day / 7);

const CODE = /^[A-Z][0-9]{2}[0-9A-C]-[A-Z0-9]{1,14}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface Draft { letter: string; date: string; suffix: string; title?: string; description?: string; category?: string }
export interface Built { code: string; description: string; category: string; start: string; label: string }

/** The code, description, category and start date the scheme gives. Throws a staff-worded error when something does not fit. */
export function build(d: Draft): Built {
  const p = PREFIXES.find((x) => x.letter === String(d.letter || '').toUpperCase());
  if (!p) throw new HttpError(400, 'bad_prefix', 'Pick the kind of appeal from the list.');
  if (!DATE.test(String(d.date || ''))) throw new HttpError(400, 'bad_date', 'Pick the date the appeal starts.');
  const y = Number(d.date.slice(0, 4));
  const m = Number(d.date.slice(5, 7));
  const day = Number(d.date.slice(8, 10));
  if (y < 2020 || y > 2040 || m < 1 || m > 12 || day < 1 || day > 31) throw new HttpError(400, 'bad_date', 'Pick a real date.');
  let suffix = String(d.suffix || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (p.letter === 'N' && (!suffix || suffix === 'EMW')) suffix = 'EMW' + weekOf(day);
  if (!suffix) suffix = p.suffix;
  if (!suffix) throw new HttpError(400, 'need_suffix', `Write the suffix: ${p.hint}.`);
  const code = `${p.letter}${String(y).slice(2)}${monthChar(m)}-${suffix}`;
  if (!CODE.test(code)) throw new HttpError(400, 'bad_code', 'That code does not fit the scheme. The suffix is letters and digits, 14 characters at most.');
  const title = String(d.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const when = `${monthWord(m)} ${y}`;
  const auto = p.letter === 'N'
    ? `Digital Newsletters, ${when}, Week ${weekOf(day)}, Email Newsletter${title ? ', ' + title : ''}`
    : `${p.label.replace(/^Direct mail appeal letter$/, 'Direct Mail Appeal')}, ${when}${title ? ', ' + title : ''}`;
  const description = String(d.description || '').replace(/\s+/g, ' ').trim() || auto;
  if (description.length > 255) throw new HttpError(400, 'long_description', 'The description can be 255 characters at most.');
  return { code, description, category: String(d.category || '').trim() || p.category, start: d.date, label: p.label };
}

/** The same appeal for the website: the code with the -WS suffix (R255-WS is the pattern). */
export function onlineTwin(b: Built): Built {
  const base = b.code.split('-')[0];
  return { ...b, code: `${base}-WS`, description: `${b.description} (online)`.slice(0, 255) };
}

/* ------------------------------------------------------------------ reads */

export const RECENT_SQL = readOnly(`SELECT id AS id, appeal_id AS code, appeal_description AS description, appeal_category AS category,
       substr(appeal_start_date, 1, 10) AS start, appeal_inactive AS inactive, substr(date_added, 1, 10) AS added
  FROM appeals ORDER BY date_added DESC, id DESC LIMIT 40`);
export const CATEGORIES_SQL = readOnly("SELECT appeal_category AS category, COUNT(*) AS n FROM appeals WHERE appeal_category IS NOT NULL AND appeal_category <> '' GROUP BY 1 ORDER BY n DESC");
export const EXISTS_SQL = readOnly('SELECT id AS id, appeal_id AS code FROM appeals WHERE upper(appeal_id) IN (SELECT value FROM json_each(?1))');
export const SAMPLE_SQL = readOnly("SELECT id AS id FROM appeals WHERE appeal_category = ?1 ORDER BY date_added DESC LIMIT 1");

export interface AppealsOut {
  recent: { id: string; code: string; description: string; category: string; start: string; inactive: boolean; added: string }[];
  categories: { category: string; n: number }[];
  prefixes: Prefix[];
}

export async function appealsOverview(env: Env): Promise<AppealsOut> {
  const [recent, cats] = await Promise.all([mirror<any>(env, RECENT_SQL, []), mirror<any>(env, CATEGORIES_SQL, [])]);
  return {
    recent: recent.map((r) => ({ id: String(r.id), code: String(r.code || ''), description: String(r.description || ''), category: String(r.category || ''), start: String(r.start || ''), inactive: Number(r.inactive) === 1, added: String(r.added || '') })),
    categories: cats.map((c) => ({ category: String(c.category), n: Number(c.n) || 0 })),
    prefixes: PREFIXES,
  };
}

/** The codes that already exist in the copy, so a duplicate is caught before the call. */
export async function existing(env: Env, codes: string[]): Promise<string[]> {
  const rows = await mirror<{ code: string }>(env, EXISTS_SQL, [JSON.stringify(codes.map((c) => c.toUpperCase()))]);
  return rows.map((r) => String(r.code).toUpperCase());
}

/* ------------------------------------------------------------------ the route */

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

async function appealsUrl(env: Env): Promise<string> {
  const ops = await opsUrl(env);
  return ops.replace(/\/ops\/?$/, '/appeals');
}

async function callRoute(env: Env, method: 'GET' | 'POST', query: string, body: unknown, f: Fetcher): Promise<{ status: number; data: any }> {
  if (!env.BLACKBAUD_SETUP_KEY) throw new HttpError(503, 'not_set_up', 'The Blackbaud connection is not set up on the hub yet.');
  const base = await appealsUrl(env);
  const res = await f(base + query, { method, headers: { 'X-Setup-Key': env.BLACKBAUD_SETUP_KEY, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 favor-hub-appeals' }, body: method === 'POST' ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

/** The numeric category id Blackbaud wants. Read once from an existing appeal in that category, then kept. */
export async function categoryId(env: Env, name: string, f: Fetcher): Promise<number | null> {
  const key = 'appeal_cat:' + name.toLowerCase();
  const kept = Number(await getSetting(env, key, ''));
  if (Number.isInteger(kept) && kept > 0) return kept;
  const sample = await mirror<{ id: string }>(env, SAMPLE_SQL, [name]);
  if (!sample[0]) return null;
  const r = await callRoute(env, 'GET', `?id=${encodeURIComponent(String(sample[0].id))}`, null, f);
  const id = Number(r.data && r.data.record && r.data.record.appeal_category_id);
  if (!Number.isInteger(id) || id <= 0) return null;
  await setSetting(env, key, String(id));
  return id;
}

export interface CreateInput { draft: Draft; online?: boolean }
export interface Created { code: string; id: string | null; description: string; ok: boolean; error?: string }

/** Create the appeal (and its -WS twin when asked). Each is checked against the copy first and audited. */
export async function createAppeals(env: Env, actor: string, input: CreateInput, f: Fetcher = (u, i) => fetch(u, i)): Promise<{ created: Created[]; wiring: string[] }> {
  const main = build(input.draft);
  const list = [main, ...(input.online ? [onlineTwin(main)] : [])];
  const have = await existing(env, list.map((b) => b.code));
  if (have.length) throw new HttpError(409, 'duplicate', `${have.join(' and ')} already ${have.length === 1 ? 'exists' : 'exist'} in Blackbaud. Change the suffix or the date.`);
  const cat = await categoryId(env, main.category, f);
  const created: Created[] = [];
  for (const b of list) {
    const r = await callRoute(env, 'POST', '', { appeal_id: b.code, description: b.description, start_date: b.start, ...(cat ? { appeal_category_id: cat } : {}) }, f);
    const ok = r.status >= 200 && r.status < 300 && r.data && r.data.ok !== false;
    if (!ok && r.status === 409) { created.push({ code: b.code, id: null, description: b.description, ok: false, error: 'That code already exists in Blackbaud.' }); continue; }
    if (!ok) { created.push({ code: b.code, id: null, description: b.description, ok: false, error: String((r.data && (r.data.message || r.data.error)) || 'Blackbaud turned it down.').slice(0, 200) }); continue; }
    created.push({ code: b.code, id: String(r.data.id || ''), description: b.description, ok: true });
    await audit(env, { actor, area: 'appeal-codes', key: b.code, label: `Appeal ${b.code}`, before: null, after: `${b.description} (${b.category}${cat ? '' : ', no category'})`, note: 'created in Blackbaud' });
  }
  const wiring: string[] = [];
  if (!cat) wiring.push(`Blackbaud has no category called ${main.category} to copy, so the appeal has none. Set one in Blackbaud.`);
  const base = main.code.split('-')[0].toLowerCase();
  if (main.code.startsWith('N') && /^N\d{2}[1-9A-C]-EMW[1-5]$/.test(main.code)) wiring.push(`The giving form takes the link ?src=${main.code.toLowerCase()} with no website change.`);
  else if (main.code.startsWith('L')) wiring.push(input.online ? `The giving form takes the link ?src=${base} and codes the gift to ${base.toUpperCase()}-WS, with no website change.` : `The giving form codes online gifts from ?src=${base} to ${base.toUpperCase()}-WS. That appeal does not exist yet, so create it too.`);
  else wiring.push('A code of this kind reaches the giving form only through a src key on the website. Ask the technology team to add it if gifts will arrive through a link.');
  return { created, wiring };
}
