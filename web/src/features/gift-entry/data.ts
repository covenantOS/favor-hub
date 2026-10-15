// Gift entry's reads and writes. Reads go through hubGet (the server asks with the visitor's cookie while the page renders, the browser
// asks the usual way) and are drawn with useSuspenseQuery inside Suspense. Writes use the same headers and error words as the classic
// page's api() in public/js/gift-entry.js.
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';
import type { Catalog, DepositView, GeIndex, GeMonth, GeOverview, GeSummary, History, NeedsItem, Revenue } from './types';

export const geKeys = {
  all: ['ge'] as const,
  index: ['ge', 'index'] as const,
  summary: (date: string) => ['ge', 'summary', date] as const,
  needs: ['ge', 'needs'] as const,
  month: ['ge', 'month'] as const,
  overview: ['ge', 'overview'] as const,
  deposit: (id: string) => ['ge', 'deposit', id] as const,
  catalog: ['ge', 'catalog'] as const,
  history: (cid: string, before: string) => ['ge', 'history', cid, before] as const,
  revenue: (id: string, status: string) => ['ge', 'revenue', id, status] as const,
};

export const indexQuery = queryOptions({ queryKey: geKeys.index, queryFn: (): Promise<GeIndex> => hubGet('/api/gift-entry') as Promise<GeIndex>, staleTime: 15_000 });

export const summaryQuery = (date: string) =>
  queryOptions({
    queryKey: geKeys.summary(date),
    queryFn: (): Promise<GeSummary> => hubGet('/api/gift-entry/summary' + (date ? '?date=' + encodeURIComponent(date) : '')) as Promise<GeSummary>,
    staleTime: 15_000,
  });

// Three of the home reads may fail without taking the page down: the classic page drew the page with what it had.
export const needsQuery = queryOptions({
  queryKey: geKeys.needs,
  queryFn: async (): Promise<{ items: NeedsItem[] }> => ((await hubGet('/api/gift-entry/needs-coding').catch(() => ({ items: [] }))) as { items: NeedsItem[] }),
  staleTime: 15_000,
});
export const monthQuery = queryOptions({
  queryKey: geKeys.month,
  queryFn: async (): Promise<GeMonth | null> => ((await hubGet('/api/gift-entry/month').catch(() => null)) as GeMonth | null),
  staleTime: 15_000,
});
export const overviewQuery = queryOptions({
  queryKey: geKeys.overview,
  queryFn: async (): Promise<GeOverview | null> => ((await hubGet('/api/gifts/overview').catch(() => null)) as GeOverview | null),
  staleTime: 15_000,
});

export const depositQuery = (id: string) =>
  queryOptions({ queryKey: geKeys.deposit(id), queryFn: (): Promise<DepositView> => hubGet('/api/gift-entry/deposits/' + encodeURIComponent(id)) as Promise<DepositView>, staleTime: 5_000 });

export const catalogQuery = queryOptions({ queryKey: geKeys.catalog, queryFn: (): Promise<Catalog> => hubGet('/api/gift-entry/catalog') as Promise<Catalog>, staleTime: 10 * 60_000 });

export const historyQuery = (cid: string, before: string) =>
  queryOptions({
    queryKey: geKeys.history(cid, before),
    queryFn: async (): Promise<History> => ((await hubGet('/api/gift-entry/history?cid=' + encodeURIComponent(cid) + (before ? '&before=' + encodeURIComponent(before) : ''))) as { history: History }).history,
    staleTime: 5 * 60_000,
  });

export const revenueQuery = (id: string, status: string) =>
  queryOptions({
    queryKey: geKeys.revenue(id, status),
    queryFn: async (): Promise<Revenue> => ((await hubGet('/api/gift-entry/deposits/' + encodeURIComponent(id) + '/revenue')) as { revenue: Revenue }).revenue,
    staleTime: Infinity,
    retry: false,
  });

export class GeError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.name = 'GeError';
    this.status = status;
    this.data = data;
  }
}

/** The classic page's api(): same headers, a Blob or string body goes up as it is, an object goes up as JSON, a 401 sends the person to sign in. */
export async function geApi<T = Record<string, unknown>>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Hub-Request': '1', ...(opts.headers || {}) };
  let body: BodyInit | undefined;
  if (opts.body !== undefined && opts.body !== null) {
    if (opts.body instanceof Blob || typeof opts.body === 'string') body = opts.body;
    else {
      body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(path, { method: opts.method || 'GET', credentials: 'same-origin', headers, body });
  const data = ((await res.json().catch(() => ({}))) || {}) as Record<string, unknown>;
  if (res.status === 401 && data.error === 'signin') {
    location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search);
    throw new GeError('Sign in again.', 401, data);
  }
  if (!res.ok || data.ok === false) throw new GeError(String(data.message || 'Something went wrong. Try again.'), res.status, data);
  return data as T;
}

const dep = (id: string) => '/api/gift-entry/deposits/' + encodeURIComponent(id);

export const geWrites = {
  createDeposit: (b: { kind: string; date: string; tapeTotal: string; tapeCount: string }) => geApi<{ deposit: { id: string }; sameDayExists?: string | null }>('/api/gift-entry', { method: 'POST', body: b }),
  patchGift: (id: string, b: Record<string, unknown>) => geApi<{ view: DepositView }>('/api/gift-entry/gifts/' + encodeURIComponent(id), { method: 'PATCH', body: b }),
  reread: (id: string) => geApi<{ view: DepositView }>('/api/gift-entry/gifts/' + encodeURIComponent(id) + '/reread', { method: 'POST', body: {} }),
  addCash: (id: string, amountCents: number) => geApi<{ giftId: string }>(dep(id) + '/cash', { method: 'POST', body: { amountCents } }),
  discard: (id: string) => geApi(dep(id), { method: 'DELETE' }),
  send: (id: string) => geApi(dep(id) + '/send', { method: 'POST', body: {} }),
  run: (id: string, force: boolean) => geApi<DepositView>(dep(id) + '/run' + (force ? '?force=1' : ''), { method: 'POST', body: {} }),
  retry: (id: string) => geApi(dep(id) + '/retry', { method: 'POST', body: {} }),
  undo: (id: string, reason: string) => geApi<DepositView & { undone: { batch?: string } }>(dep(id) + '/undo', { method: 'POST', body: { reason } }),
  photo: (id: string, blob: Blob, kind: string, gift: string) =>
    geApi<{ status?: string; giftId?: string | null }>(dep(id) + '/photos?kind=' + kind + (gift ? '&gift=' + encodeURIComponent(gift) : ''), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob }),
  comment: (giftId: string, b: { kind: string; body: string }) => geApi(`/api/gift-entry/gifts/${encodeURIComponent(giftId)}/comments`, { method: 'POST', body: b }),
};

export const searchPartners = async (q: string) => (await geApi<{ hits: { cid: string; lookup: string; name: string; place: string }[] }>('/api/gift-entry/partners?q=' + encodeURIComponent(q))).hits;
export const lastCoding = async (cid: string) => (await geApi<{ last: { appealId: string } | null }>('/api/gift-entry/partners?coding=' + encodeURIComponent(cid)).catch(() => null))?.last ?? null;

/** Writes the deposit answer into the cache (the PATCH, run and undo routes answer with the whole view). */
export function useDepositCache() {
  const qc = useQueryClient();
  return {
    set: (id: string, view: Partial<DepositView>) => qc.setQueryData<DepositView>(geKeys.deposit(id), (old) => ({ ...(old as DepositView), ...view })),
    refetch: async (id: string): Promise<DepositView> => {
      const v = (await geApi<DepositView>(dep(id))) as DepositView;
      qc.setQueryData(geKeys.deposit(id), v);
      return v;
    },
    drop: (id: string) => qc.removeQueries({ queryKey: geKeys.deposit(id) }),
    home: () => {
      void qc.invalidateQueries({ queryKey: geKeys.index });
      void qc.invalidateQueries({ queryKey: ['ge', 'summary'] });
      void qc.invalidateQueries({ queryKey: geKeys.month });
      void qc.invalidateQueries({ queryKey: geKeys.needs });
    },
  };
}
