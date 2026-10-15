// Address checks for the routes that read their search or params before their page chunk loads (validateSearch, loaderDeps). They live
// here, apart from each feature's logic module, so a route file imports a few hundred bytes and not the whole feature: everything a route
// file imports outside its component rides in the entry chunk that every web page downloads.

/** The evaluations address: ?c= the case, ?v= the tab. ?s= was read by the old page and never used. Anything else is dropped. */
export interface EvalSearch {
  c?: string;
  v?: string;
  s?: number;
}

export function validateEvalSearch(raw: Record<string, unknown>): EvalSearch {
  const out: EvalSearch = {};
  if (typeof raw.c === 'string' && raw.c) out.c = raw.c;
  if (typeof raw.v === 'string' && raw.v) out.v = raw.v;
  const s = Number(raw.s);
  if (s) out.s = s;
  return out;
}

export interface AdminSearch {
  t?: string;
}

export function validateAdminSearch(raw: Record<string, unknown>): AdminSearch {
  return typeof raw.t === 'string' && raw.t ? { t: raw.t } : {};
}

/** What the expense email link carries: the page needs a token or an id. A token wins. */
export function reviewTarget(search: Record<string, unknown>): { token: string; id: string } {
  const token = typeof search.token === 'string' ? search.token : '';
  const id = token ? '' : typeof search.id === 'string' ? search.id : '';
  return { token, id };
}

/** A search value from the address as a plain string. */
export const slugOf = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** The run id an onboarding link names: ?id=. */
export const runIdOf = (search: Record<string, unknown>): string => (typeof search.id === 'string' ? search.id : '');

/** The partner directory's filters, sort and page as they sit in the address (?q=...&kinds=a,b&page=2). */
export interface DirSearch {
  q?: string;
  kinds?: string;
  status?: string;
  states?: string;
  holder?: string;
  codes?: string;
  codesNot?: string;
  solicit?: string;
  solicitNot?: string;
  tags?: string;
  band?: string;
  firstFrom?: string;
  firstTo?: string;
  lastFrom?: string;
  lastTo?: string;
  noContactDays?: number;
  major?: boolean;
  recurring?: boolean;
  openActions?: boolean;
  starred?: boolean;
  deceased?: 'include' | 'only';
  inactive?: 'include' | 'only';
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pane?: 'recent' | 'dups' | 'merges';
  view?: string;
}

const STR = ['q', 'kinds', 'status', 'states', 'holder', 'codes', 'codesNot', 'solicit', 'solicitNot', 'tags', 'band', 'firstFrom', 'firstTo', 'lastFrom', 'lastTo', 'sort', 'view'] as const;
const BOOL = ['major', 'recurring', 'openActions', 'starred'] as const;

/** Checks the address's search part; anything unknown is dropped. */
export function validateDirSearch(raw: Record<string, unknown>): DirSearch {
  const out: DirSearch = {};
  for (const k of STR) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) (out as Record<string, unknown>)[k] = v.slice(0, 200);
    else if (typeof v === 'number') (out as Record<string, unknown>)[k] = String(v);
  }
  for (const k of BOOL) if (raw[k] === true || raw[k] === '1' || raw[k] === 1 || raw[k] === 'true') out[k] = true;
  const n = Number(raw.noContactDays);
  if ([30, 90, 180, 365, 730].includes(n)) out.noContactDays = n;
  if (raw.deceased === 'include' || raw.deceased === 'only') out.deceased = raw.deceased;
  if (raw.inactive === 'include' || raw.inactive === 'only') out.inactive = raw.inactive;
  if (raw.dir === 'asc' || raw.dir === 'desc') out.dir = raw.dir;
  const p = Number(raw.page);
  if (Number.isInteger(p) && p > 1) out.page = p;
  if (raw.pane === 'recent' || raw.pane === 'dups' || raw.pane === 'merges') out.pane = raw.pane;
  return out;
}

/** The gift desk pages (letters, declines): ?as= is the person an admin looks at the desk as. */
export interface DeskSearch {
  as?: string;
}
export const deskSearch = (s: Record<string, unknown>): DeskSearch => (typeof s.as === 'string' && s.as ? { as: s.as } : {});

/** Online gifts: the page's search, as the classic page read it from the address: days (default 3), test=1 and a gift ID. */
export interface OgSearch {
  days: string;
  test: boolean;
  gift: string;
}

export function ogSearch(s: Record<string, unknown>): OgSearch {
  return { days: typeof s.days === 'string' || typeof s.days === 'number' ? String(s.days) : '3', test: String(s.test ?? '') === '1', gift: /^\d+$/.test(String(s.gift ?? '')) ? String(s.gift) : '' };
}
