// TanStack Query with this tab's answers kept in sessionStorage, so a reload or a visit to a classic page and back paints the
// last answers at once and refreshes them behind. Refetch on focus, a short staleness window, and invalidation helpers.
import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
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

export function makePersister() {
  return createSyncStoragePersister({ storage: typeof sessionStorage === 'undefined' ? undefined : sessionStorage, key: PERSIST_KEY, throttleTime: 800 });
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
