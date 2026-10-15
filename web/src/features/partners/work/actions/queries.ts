// One queryOptions per Work Center read. The route loader starts them on the server (never awaited) and the components read them with
// useSuspenseQuery. They never refetch on their own: a person's own writes refetch the board and Recent (engine.ts), like the classic page.
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../../../lib/hub';
import type { BoardData, Batch, Gate } from './types';

const qs = (as?: string) => (as ? '&as=' + encodeURIComponent(as) : '');
const first = (path: string, as?: string) => path + (as ? (path.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(as) : '');
const still = { staleTime: 5 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

export const wcKeys = {
  all: ['work'] as const,
  gate: (as = '') => ['work', 'gate', as] as const,
  board: (as = '') => ['work', 'board', as] as const,
  recent: (as = '') => ['work', 'recent', as] as const,
  codes: (as = '') => ['work', 'codes', as] as const,
  views: (as = '') => ['work', 'views', as] as const,
  start: (as = '') => ['work', 'start', as] as const,
  opps: (as = '') => ['work', 'opps', as] as const,
  giftImages: (as = '') => ['work', 'giftimages', as] as const,
  entry: (owner = '', as = '') => ['work', 'entry', owner, as] as const,
  mail: (as = '') => ['work', 'mail', as] as const,
};

export const gateQuery = (as?: string) =>
  queryOptions({ queryKey: wcKeys.gate(as), queryFn: async () => (await hubGet(first('/api/work/gate', as))) as Gate, ...still });

/** Every open action (up to 3,000) with the people, the meter and the counts. The lists filter and sort it in the browser. */
export const boardQuery = (as?: string) =>
  queryOptions({ queryKey: wcKeys.board(as), queryFn: async () => (await hubGet('/api/work/board?limit=3000' + qs(as))) as BoardData, ...still });

export const recentQuery = (as?: string) =>
  queryOptions({
    queryKey: wcKeys.recent(as),
    queryFn: async () => ((await hubGet(first('/api/work/recent', as))) as { batches: Batch[] }).batches,
    ...still,
  });

export interface Codes {
  types?: string[];
  statuses?: string[];
  locations?: string[];
  noteTypes?: string[];
  oppStatuses?: string[];
  oppPurposes?: string[];
  tagCategories?: { name: string; type: string; values?: string[] }[];
  [k: string]: unknown;
}
export interface CodesAnswer {
  codes: Codes;
  me?: { fid: string | null; type: string | null; name: string | null };
  types?: Record<string, string>;
}
export const codesQuery = (as?: string) =>
  queryOptions({ queryKey: wcKeys.codes(as), queryFn: async () => (await hubGet(first('/api/work/codes', as))) as CodesAnswer, ...still, staleTime: 30 * 60_000 });

export interface SavedWorkView {
  id: string;
  name: string;
  default?: boolean;
  spec: { view?: string; f?: Record<string, unknown>; sort?: string; dir?: number; cols?: Record<string, number> };
}
export const viewsQuery = (as?: string) =>
  queryOptions({ queryKey: wcKeys.views(as), queryFn: async () => ((await hubGet(first('/api/work/views', as))) as { views: SavedWorkView[] }).views || [], ...still });

export interface StartPref {
  pref: { tab: string; scope?: string } | null;
  defaultTab: string;
  role: string;
}
export const startQuery = (as?: string) =>
  queryOptions({ queryKey: wcKeys.start(as), queryFn: async () => ((await hubGet(first('/api/work/views/default', as))) as { start: StartPref }).start, ...still });

export interface OppRow {
  id: string;
  cid: string;
  name: string;
  status: string;
  purpose: string;
  ask: number;
  expected: number;
  funded: number;
  askDate: string;
  expectedDate: string;
  fundedDate: string;
  deadline: string;
  inactive: boolean;
  summary: string;
  fundraisers: string[];
}
export const oppsQuery = (as?: string) =>
  queryOptions({
    queryKey: wcKeys.opps(as),
    queryFn: async () => (await hubGet(first('/api/work/opps', as))) as { rows: OppRow[]; names: Record<string, string> },
    ...still,
  });

export interface GiftImageRow {
  giftId: string;
  cid: string;
  name: string;
  amount: number;
  date: string;
  age: number;
  method: string;
  batch: string;
  fund: string;
  why: string;
  whyLabel: string;
  state: 'none' | 'unknown' | string;
}
export interface GiftImages {
  rows: GiftImageRow[];
  stats: { need: number; unchecked: number; big: number; giving: number; designated: number };
  lane?: { left: number } | null;
  checkMax: number;
  window: number;
}
export const giftImagesQuery = (as?: string) =>
  queryOptions({ queryKey: wcKeys.giftImages(as), queryFn: async () => (await hubGet(first('/api/work/giftimages', as))) as GiftImages & { ok: boolean }, ...still });

export interface MailPrefs {
  name: string;
  email: string;
  sections: { key: string; label: string }[];
  prefs: { sections: Record<string, boolean>; send_time: string; skip_empty: boolean };
  group?: string;
  groupLabel?: string;
  live?: boolean;
  from?: string | null;
}
export const mailQuery = (as?: string) =>
  queryOptions({ queryKey: wcKeys.mail(as), queryFn: async () => (await hubGet(first('/api/work/mail', as))) as MailPrefs, ...still });

// The Entry tab's read is typed in entry/types.ts by the Entry port; this key is shared so writes can refetch it.
export const entryKey = wcKeys.entry;
