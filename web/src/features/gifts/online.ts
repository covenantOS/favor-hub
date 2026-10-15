// Online gifts: the read (one answer per period, with the optional ?test and ?gift parameters) and the types of what it returns.
// The rules and every decision are on the server (functions/_lib/online-gifts); this page shows what it returns and posts choices.
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

export interface OgFund { id: string; code?: string; name: string }
export interface OgReview {
  state: string;
  chosen_fund: string;
  result?: string;
  approved_by?: string;
  approved_name?: string;
  approved_at?: string;
}
export interface OgFlag { kind: string; key?: string; days?: number; words?: string; wantedFund?: string }
export interface OgRow {
  key: string;
  source: string;
  giftId?: string;
  recordId?: string;
  name?: string;
  amount: number;
  original?: string;
  date: string;
  monthly?: boolean;
  tribute?: boolean;
  test?: boolean;
  comment?: string;
  currentFund: string;
  splits?: number;
  inBlackbaud?: boolean;
  read: { fundId: string; by?: string; word?: string };
  review: OgReview | null;
  flag: OgFlag | null;
}
export interface OgBatch { number?: string; gifts: number; amount: number; days: number; by?: string; link: string }
export interface OgHealth { name?: string; label: string; lastOk?: string; lastError?: string; state: string }
export interface OgOverview {
  ok: true;
  from: string;
  rows: OgRow[];
  funds: OgFund[];
  batches?: { waiting?: { gifts: number; amount: number }[] };
  batchFlags?: OgBatch[];
  flags?: { count: number };
  health?: OgHealth[];
  apply?: boolean;
  testLimit?: string;
  admin?: boolean;
  blackbaud: string;
}

export interface OgSearch {
  days: string;
  test: boolean;
  gift: string;
}

export const DAYS: Record<string, string> = { '1': 'Today', '3': 'Last 3 days', '7': 'Last 7 days', '14': 'Last 14 days' };

/** The page's search, as the classic page read it from the address: days (default 3), test=1 and a gift ID. */
export function ogSearch(s: Record<string, unknown>): OgSearch {
  return { days: typeof s.days === 'string' || typeof s.days === 'number' ? String(s.days) : '3', test: String(s.test ?? '') === '1', gift: /^\d+$/.test(String(s.gift ?? '')) ? String(s.gift) : '' };
}

export const onlineQuery = (s: OgSearch) =>
  queryOptions({
    queryKey: ['online-gifts', s.days, s.test, s.gift] as const,
    queryFn: async () => (await hubGet(`/api/online-gifts?days=${encodeURIComponent(s.days)}${s.test ? '&test=1' : ''}${s.gift ? '&gift=' + s.gift : ''}`)) as OgOverview,
    staleTime: 15_000,
  });
