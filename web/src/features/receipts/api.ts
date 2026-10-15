// Receipts reads and writes. Reads are queryOptions over /api/receipts (the server's sign-in, code and desk rules apply unchanged);
// writes carry the person's name in X-Rcp-Actor, as the classic page does. This module imports no components, so the route file can use it.
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

export type Segment = 'regular' | 'major' | 'recurring';

export interface Issue {
  code: string;
  group: 'address' | 'greeting' | 'duplicate';
  text: string;
  fix: string;
  other?: { lookup: string; name: string };
}

export interface Item {
  id: string;
  lookup: string;
  date: string;
  amount: number;
  type: string;
  segment: string;
  addressee: string;
  sortName: string;
  place: string;
  fund: string;
  constituentLookup: string;
  addressKey: string;
  reason: string;
  key: string;
  canAdd: boolean;
  issues?: Issue[];
  batch?: { id: string; letterDate: string };
}

export interface Waiting {
  ok: boolean;
  sample?: boolean;
  asOf: string;
  days: number;
  appealCode: string;
  letters: Item[];
  held: Item[];
  check: { partners: number; address: number; greeting: number; duplicate: number };
}

export interface Batch {
  id: string;
  kind: 'new' | 'reprint' | string;
  letterDate: string;
  appealCode: string;
  count: number;
  gifts: number;
  amount: number;
  regular: number;
  major: number;
  recurring: number;
  firstGift: string;
  lastGift: string;
  sourceDate: string;
  marked: number;
  markFailed: number;
  status: string;
  createdBy: string;
  createdAt: string;
  markedBy: string;
  markedAt: string | null;
  downloadedAt: string | null;
}

export interface Me {
  ok: boolean;
  unlocked: boolean;
  restricted: boolean;
  name: string;
  signin: boolean;
}

export interface Copy {
  paragraphs: string[];
  closing: string;
  signerName: string;
  signerTitle: string;
  greeting: 'full' | 'first';
  asks: { regular: number[]; major: number[] };
}

export interface Wording {
  ok: boolean;
  copy: Copy;
  fit: { fits: boolean };
  saved: { updated_by: string; updated_at: string } | null;
}

export const DEFAULT_DAYS = 90;

export const rcpKeys = {
  me: ['rcp', 'me'] as const,
  waiting: (days: number) => ['rcp', 'waiting', days] as const,
  batches: ['rcp', 'batches'] as const,
  wording: ['rcp', 'wording'] as const,
};

export const waitingPath = (days: number, fresh = false) => `/api/receipts/waiting?days=${days}${fresh ? '&fresh=1' : ''}`;

export const meQuery = queryOptions({
  queryKey: rcpKeys.me,
  queryFn: async () => (await hubGet('/api/receipts/me')) as Me,
  staleTime: 30_000,
});

export const waitingQuery = (days: number) =>
  queryOptions({
    queryKey: rcpKeys.waiting(days),
    queryFn: async () => (await hubGet(waitingPath(days))) as Waiting,
    staleTime: 60_000,
    retry: false,
  });

const noBatches = { batches: [] as Batch[] };
export const batchesQuery = queryOptions({
  queryKey: rcpKeys.batches,
  queryFn: async () => (await hubGet('/api/receipts/batches').catch(() => noBatches)) as { batches: Batch[] },
  staleTime: 30_000,
});

export const wordingQuery = queryOptions({
  queryKey: rcpKeys.wording,
  queryFn: async () => (await hubGet('/api/receipts/wording')) as Wording,
  staleTime: 0,
  retry: false,
});

export class RcpError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * A call from the browser: the same-origin rules of every hub write plus the person's name. A 401 "signin" sends the person to sign in; a 401
 * "unauthorized" means the code is asked for again (onLocked runs and the call fails).
 */
export async function rcpApi<T = Record<string, any>>(path: string, opts: { method?: string; body?: unknown; who?: string; onLocked?: () => void } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Hub-Request': '1' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const who = (opts.who || '').trim();
  if (who) headers['X-Rcp-Actor'] = encodeURIComponent(who);
  const res = await fetch(path, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), credentials: 'same-origin', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const data = (await res.json().catch(() => ({}))) as any;
  if (res.status === 401 && data.error === 'signin') {
    location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search);
    throw new RcpError('Sign in again.', 401, 'signin');
  }
  if (res.status === 401 && data.error === 'unauthorized') {
    opts.onLocked?.();
    throw new RcpError('Enter the code again.', 401, 'unauthorized');
  }
  if (!res.ok || data.ok === false) throw new RcpError(data.message || 'Something went wrong. Try again.', res.status, data.error || '');
  return data as T;
}

export function prefetchReceipts(qc: import('@tanstack/react-query').QueryClient): void {
  void qc.prefetchQuery(meQuery);
  void qc.prefetchQuery(waitingQuery(DEFAULT_DAYS));
  void qc.prefetchQuery(batchesQuery);
}
