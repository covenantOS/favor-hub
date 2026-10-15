// First-gift letters reads and writes. Reads are queryOptions over /api/gifts/first-gifts (the server's sign-in and role rules apply unchanged).
// Writes carry the X-Hub-Request header every hub write needs. This module imports no components, so the route file can use it.
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

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
  addressee: string;
  sortName: string;
  place: string;
  fund: string;
  appeals: string[];
  constituentLookup: string;
  addressKey: string;
  reason: string;
  key: string;
  canAdd: boolean;
  issues?: Issue[];
  batch?: { id: string; letterDate: string };
}

export type SignerKey = 'carole' | 'terry' | 'rachel' | 'michael';

export interface Wording {
  text: string;
  closing: string;
  greeting: 'full' | 'first';
  signer: SignerKey;
}

export interface View {
  ok: boolean;
  sample: boolean;
  asOf: string;
  days: number;
  letters: Item[];
  held: Item[];
  check: { partners: number; address: number; greeting: number; duplicate: number };
  wording: Wording;
  receiptsKeep: number;
}

export interface Batch {
  id: string;
  letterDate: string;
  count: number;
  gifts: number;
  amount: number;
  firstGift: string;
  lastGift: string;
  appeals: string[];
  signer: string;
  signerName: string;
  marked: number;
  markFailed: number;
  status: string;
  simulated: boolean;
  createdBy: string;
  createdAt: string;
  markedBy: string;
  markedAt: string | null;
  downloadedAt: string | null;
}

export interface LetterDoc {
  dateLine: string;
  addressLines: string[];
  greeting: string;
  paragraphs: string[];
  closing: string;
  signerName: string;
  signerTitle: string;
}

export interface WordingRead {
  ok: boolean;
  wording: Wording;
  defaults: Wording;
  saved: { updated_at: string } | null;
  signers: { key: SignerKey; label: string; title: string }[];
  preview: LetterDoc;
}

export const DEFAULT_DAYS = 90;

export const fglKeys = {
  view: (days: number) => ['fgl', 'view', days] as const,
  batches: ['fgl', 'batches'] as const,
  wording: ['fgl', 'wording'] as const,
};

export const viewPath = (days: number, fresh = false) => `/api/gifts/first-gifts?days=${days}${fresh ? '&fresh=1' : ''}`;

export const viewQuery = (days: number) =>
  queryOptions({
    queryKey: fglKeys.view(days),
    queryFn: async () => (await hubGet(viewPath(days))) as View,
    staleTime: 60_000,
    retry: false,
  });

export const batchesQuery = queryOptions({
  queryKey: fglKeys.batches,
  queryFn: async () => (await hubGet('/api/gifts/first-gifts/batches').catch(() => ({ batches: [] }))) as { batches: Batch[] },
  staleTime: 30_000,
});

export const wordingQuery = queryOptions({
  queryKey: fglKeys.wording,
  queryFn: async () => (await hubGet('/api/gifts/first-gifts/wording')) as WordingRead,
  staleTime: 0,
  retry: false,
});

export class FglError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** A write from the browser. */
export async function fglApi<T = Record<string, any>>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Hub-Request': '1' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), credentials: 'same-origin', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const data = (await res.json().catch(() => ({}))) as any;
  if (res.status === 401) {
    location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search);
    throw new FglError('Sign in again.', 401, 'signin');
  }
  if (!res.ok || data.ok === false) throw new FglError(data.message || 'Something went wrong. Try again.', res.status, data.error || '');
  return data as T;
}

export function prefetchFirstGifts(qc: QueryClient): void {
  void qc.prefetchQuery(viewQuery(DEFAULT_DAYS));
  void qc.prefetchQuery(batchesQuery);
}
