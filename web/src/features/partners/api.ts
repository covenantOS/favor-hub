// Partners reads and writes for the web app. Every read is a queryOptions over the hub's own /api routes (functions/api/partners and
// functions/api/work), so the server's access and privacy rules apply unchanged.
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

export interface DirRow {
  id: string;
  lookup: string | null;
  name: string;
  kind: 'individual' | 'organization' | 'church' | 'foundation';
  spouse_id: string | null;
  spouse_name: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  deceased: number;
  inactive: number;
  anon: number;
  no_addr: number;
  dnm: number;
  dne: number;
  dnc: number;
  added: string | null;
  codes: string | null;
  solicit: string | null;
  holders: string | null;
  holder_names: string | null;
  gifts: number;
  lifetime: number;
  first_gift: string | null;
  last_gift: string | null;
  last_amt: number | null;
  largest: number;
  ytd: number;
  last_year: number;
  l12: number;
  recurring: number;
  passed_on: number;
  passed_n: number;
  last_contact: string | null;
  open_actions: number;
  status: 'active' | 'lybunt' | 'lapsed' | 'never';
  email?: string | null;
  phone?: string | null;
  addr?: string | null;
  hidden?: boolean;
  star: boolean;
}

export interface Menus {
  codes: { v: string; n: number }[];
  solicit: { v: string; n: number }[];
  states: { v: string; n: number }[];
  holders: { v: string; n: number; name: string }[];
  tags: { tag: string; n: number }[];
  bands: Record<string, string>;
}

export interface DirAnswer {
  rows: DirRow[];
  total: number;
  page: number;
  size: number;
  facets: { kinds: Record<string, number>; status: Record<string, number> };
  builtAt: string;
  records: number;
  contacts: boolean;
  fid: string | null;
  menus?: Menus;
}

/** The directory's filters, sort and page as they sit in the address (?q=...&kinds=a,b&page=2). */
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

/** The query string the API takes for a search (the page and the pane are not filters). */
export function dirParams(s: DirSearch, extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) {
    if (k === 'page' || k === 'pane' || k === 'view' || v === undefined || v === '' || v === false) continue;
    p.set(k, v === true ? '1' : String(v));
  }
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
}

export const pdKeys = {
  all: ['partners'] as const,
  dir: (qs: string) => ['partners', 'dir', qs] as const,
  menus: ['partners', 'menus'] as const,
  views: ['partners', 'views'] as const,
  recent: ['partners', 'recent'] as const,
  dups: ['partners', 'dups'] as const,
  merges: (state: string) => ['partners', 'merges', state] as const,
};

export const dirQuery = (s: DirSearch, size: number) => {
  const qs = dirParams(s, { page: s.page || 1, size });
  return queryOptions({
    queryKey: pdKeys.dir(qs),
    queryFn: async () => (await hubGet('/api/partners?' + qs)) as DirAnswer,
    staleTime: 30_000,
  });
};

export const menusQuery = queryOptions({
  queryKey: pdKeys.menus,
  queryFn: async () => ((await hubGet('/api/partners/menus')) as { menus: Menus }).menus,
  staleTime: 10 * 60_000,
});

export interface SavedView {
  id: string;
  name: string;
  spec: Record<string, unknown>;
  cols: string[];
  scope: 'private' | 'all';
  owner: string;
  ownerName: string;
  mine: boolean;
}
export const viewsQuery = queryOptions({
  queryKey: pdKeys.views,
  queryFn: async () => ((await hubGet('/api/partners/views')) as { views: SavedView[] }).views,
  staleTime: 60_000,
});

export interface Card {
  id: string;
  lookup: string | null;
  name: string;
  kind: string;
  city: string | null;
  state: string | null;
  lifetime: number;
  last_gift: string | null;
  last_amt: number | null;
  holder_names: string | null;
  deceased: number;
  passed_on: number;
}
export const recentQuery = queryOptions({
  queryKey: pdKeys.recent,
  queryFn: async () => ((await hubGet('/api/partners/recent')) as { rows: Card[] }).rows,
  staleTime: 15_000,
});
export const dupsQuery = queryOptions({
  queryKey: pdKeys.dups,
  queryFn: async () => ((await hubGet('/api/partners/duplicates')) as { pairs: { a: Card; b: Card; why: string[] }[] }).pairs,
  staleTime: 60_000,
});
export interface MergeRow {
  id: string;
  keep: Card;
  other: Card;
  note: string;
  by: string;
  at: string;
  state: string;
}
export const mergesQuery = (state: 'open' | 'done' = 'open') =>
  queryOptions({
    queryKey: pdKeys.merges(state),
    queryFn: async () => ((await hubGet('/api/partners/merges?state=' + state)) as { merges: MergeRow[] }).merges,
    staleTime: 15_000,
  });

/** A write to /api/partners: POST with the hub's request header, the answer's message on failure. */
export async function pdPost<T = Record<string, unknown>>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'X-Hub-Request': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (!res.ok || data.ok === false) throw new Error(data.message || 'Something went wrong. Try again.');
  return data as T;
}

// Words and numbers, one way everywhere on the Partners pages.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const todayEt = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
/** "Sep 5" this year, "Sep 5, 2024" otherwise. today is passed in so the server and the browser draw the same text. */
export const fd = (iso: string | null | undefined, today: string) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return MON[m - 1] + ' ' + d + (String(y) !== today.slice(0, 4) ? ', ' + y : '');
};
export const ago = (iso: string | null | undefined, today: string) => {
  if (!iso) return '';
  const n = Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z')) / 86400000);
  return n <= 0 ? 'today' : n === 1 ? '1 day ago' : n < 60 ? n + ' days ago' : n < 730 ? Math.round(n / 30.4) + ' months ago' : Math.round(n / 365) + ' years ago';
};
export const whole = (v: number | null | undefined) => '$' + Math.round(Number(v) || 0).toLocaleString('en-US');
export const money = (v: number | null | undefined) => {
  const n = Number(v) || 0;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: Math.round(n) === n ? 0 : 2, maximumFractionDigits: 2 });
};
export const short = (v: number | null | undefined) => {
  const n = Number(v) || 0;
  const f = (x: number) => String(+x.toFixed(1));
  return n >= 999500 ? '$' + f(n / 1e6) + 'M' : n >= 10000 ? '$' + Math.round(n / 1000) + 'K' : whole(n);
};
export const N = (n: number | null | undefined) => (Number(n) || 0).toLocaleString('en-US');
export const pipes = (s: string | null | undefined) => String(s || '').split('|').filter(Boolean);
export const KIND: Record<string, string> = { individual: 'Individual', household: 'Household', organization: 'Organization', church: 'Church', foundation: 'Foundation' };
export const STATUS: Record<string, string> = { active: 'Active', lybunt: 'LYBUNT', lapsed: 'Lapsed', never: 'Never gave' };
export const STATUS_TIP: Record<string, string> = {
  active: 'The household gave in the last 12 months',
  lybunt: 'The household last gave 12 to 24 months ago',
  lapsed: 'The household last gave more than 24 months ago',
  never: 'No gift credited to this record or its household',
};
