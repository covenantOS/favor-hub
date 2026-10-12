// TanStack Query with this tab's answers kept in sessionStorage, so a reload or a visit to a classic page and back paints the
// last answers at once and refreshes them behind. Refetch on focus, a short staleness window, and invalidation helpers.
import { dehydrate, hydrate, QueryClient } from '@tanstack/react-query';
import { onApiWrite } from './api';

export const PERSIST_KEY = 'favor.app.rq.v1';
/** Bumped when a schema in shared/schemas changes shape, so a stored answer from the old shape is dropped. */
export const CACHE_BUSTER = '1';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        gcTime: 24 * 60 * 60 * 1000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (count, err) => count < 2 && !(err as { status?: number }).status,
      },
    },
  });
}

const PERSISTED = ['nav', 'today', 'kpi', 'day'];
const MAX_AGE = 24 * 60 * 60 * 1000;

/** Put the last answers into the cache before the first render, so the page paints with them at once and refreshes behind. */
export function restoreCache(qc: QueryClient): void {
  try {
    const raw = sessionStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { buster?: string; timestamp?: number; clientState?: Parameters<typeof hydrate>[1] };
    if (saved.buster !== CACHE_BUSTER || !saved.clientState || Date.now() - (saved.timestamp || 0) > MAX_AGE) return;
    hydrate(qc, saved.clientState);
  } catch {
    // an unreadable copy is dropped; the page fetches as usual
  }
}

/** Save the answers of the first-screen queries a moment after they change. */
export function persistCache(qc: QueryClient): void {
  let t: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    try {
      const clientState = dehydrate(qc, { shouldDehydrateQuery: (q) => q.state.status === 'success' && PERSISTED.includes(String(q.queryKey[0])) });
      sessionStorage.setItem(PERSIST_KEY, JSON.stringify({ buster: CACHE_BUSTER, timestamp: Date.now(), clientState }));
    } catch {
      // storage refused or full
    }
  };
  qc.getQueryCache().subscribe(() => {
    clearTimeout(t);
    t = setTimeout(save, 800);
  });
}

export const keys = {
  nav: ['nav'] as const,
  today: ['today'] as const,
  kpi: ['kpi'] as const,
  day: ['day'] as const,
  app2: ['app2'] as const,
  entity: (kind: string, id: string) => ['entity', kind, id] as const,
  notifications: ['notifications'] as const,
};

/** Re-read the menu counts a moment after a write, the way the classic pages do (a request approved, a mention read). */
export function watchWrites(qc: QueryClient): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return onApiWrite(() => {
    clearTimeout(t);
    t = setTimeout(() => void qc.invalidateQueries({ queryKey: keys.nav }), 1500);
  });
}

/** Everything Today shows, read again. */
export const invalidateToday = (qc: QueryClient) =>
  Promise.all([qc.invalidateQueries({ queryKey: keys.today }), qc.invalidateQueries({ queryKey: keys.day }), qc.invalidateQueries({ queryKey: keys.nav })]);

/** Wipe every stored answer (sign out). */
export function clearStored(qc: QueryClient) {
  qc.clear();
  try {
    sessionStorage.removeItem(PERSIST_KEY);
  } catch {
    // storage refused; nothing was kept
  }
}
