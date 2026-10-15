// Foundations reads and writes. Reads are queryOptions over /api/foundations (the server's lock and privacy rules apply unchanged);
// writes carry the name in "Entered by" in X-Fnd-Actor, as the classic page does.
import { queryOptions } from '@tanstack/react-query';
import { hubGet, HubReadError } from '../../../lib/hub';

export { HubReadError };
const enc = encodeURIComponent;

export const fKeys = {
  me: ['fnd', 'me'] as const,
  list: ['fnd', 'list'] as const,
  check: (q: string) => ['fnd', 'check', q] as const,
  detail: (id: string) => ['fnd', 'detail', id] as const,
  bb: (id: string) => ['fnd', 'bb', id] as const,
  cleanup: ['fnd', 'cleanup'] as const,
  activity: ['fnd', 'activity'] as const,
  health: ['fnd', 'health'] as const,
};

export const meQuery = queryOptions({
  queryKey: fKeys.me,
  queryFn: async () => (await hubGet('/api/foundations/me').catch(() => ({ unlocked: false }))) as { name?: string; unlocked?: boolean },
  staleTime: 60_000,
});
export const listQuery = queryOptions({ queryKey: fKeys.list, queryFn: async () => (await hubGet('/api/foundations')) as any, staleTime: 30_000 });
export const checkQuery = (q: string) => queryOptions({ queryKey: fKeys.check(q), queryFn: async () => (await hubGet('/api/foundations/check?q=' + enc(q))) as any, staleTime: 30_000 });
export const detailQuery = (id: string) => queryOptions({ queryKey: fKeys.detail(id), queryFn: async () => (await hubGet('/api/foundations/' + enc(id))) as any, staleTime: 0 });
export const bbQuery = (id: string) => queryOptions({ queryKey: fKeys.bb(id), queryFn: async () => (await hubGet('/api/foundations/' + enc(id) + '/blackbaud').catch(() => null)) as any, staleTime: 60_000 });
export const cleanupQuery = queryOptions({ queryKey: fKeys.cleanup, queryFn: async () => (await hubGet('/api/foundations/cleanup')) as any, staleTime: 0 });
export const activityQuery = queryOptions({ queryKey: fKeys.activity, queryFn: async () => (await hubGet('/api/foundations/activity')) as any, staleTime: 0 });
export const healthQuery = queryOptions({ queryKey: fKeys.health, queryFn: async () => (await hubGet('/api/foundations/health').catch(() => null)) as any, staleTime: 0 });

export function prefetchFoundationsReads(qc: import('@tanstack/react-query').QueryClient) {
  void qc.prefetchQuery(meQuery);
  void qc.prefetchQuery(listQuery);
}

let actor = '';
export const setActor = (name: string) => {
  actor = name.trim();
};

export class FndError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}
/** A write from the browser. A 401 with "unauthorized" means the code was asked for again; the caller shows the lock. */
export async function fApi<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Hub-Request': '1' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (actor) headers['X-Fnd-Actor'] = enc(actor);
  const res = await fetch(path, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), credentials: 'same-origin', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const data = (await res.json().catch(() => ({}))) as any;
  if (res.status === 401 && path !== '/api/foundations/login' && data.error === 'unauthorized') {
    window.dispatchEvent(new Event('fnd:locked'));
    throw new FndError('Enter the code again.', 401, data);
  }
  if (!res.ok || data.ok === false) throw new FndError(data.message || 'Something went wrong. Try again.', res.status, data);
  return data as T;
}
