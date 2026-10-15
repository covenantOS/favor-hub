// Data hooks: one hook per API route, each with its schema and its query key. A route component calls these and never fetches itself.
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/query';
import { KEYS, readJson, readString, writeJson } from '@/lib/storage';
import type { NavResponse } from '@shared/schemas';

// The schemas (and zod under them, 39 KB gzipped) load on the first read that needs them, not with the page's first script: the shell
// asks the menu answer again only after it has gone stale, and the server already checked the copy it drew the page from.
type Schemas = typeof import('@shared/schemas');
const apiLazy = async <T,>(path: string, pick: (m: Schemas) => import('zod').ZodType<T>): Promise<T> => api(path, pick(await import('@shared/schemas')));

/** The menu answer this browser last saved. The classic pages save the same record, so the menu paints on the first frame on either side. */
function savedNav(): NavResponse | undefined {
  const raw = readJson<unknown>('local', KEYS.nav, null);
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Partial<NavResponse>;
  if (!o.user || typeof o.user.email !== 'string' || !o.access || typeof o.access !== 'object') return undefined;
  return { ok: true, user: { ...o.user, picture: o.user.picture ?? '' }, access: o.access, counts: o.counts ?? {}, kpiTeams: o.kpiTeams ?? [], jobs: o.jobs } as NavResponse;
}

export function useNav() {
  const q = useQuery({
    queryKey: keys.nav,
    queryFn: () => apiLazy('/api/hub/nav', (m) => m.navResponse),
    placeholderData: savedNav,
    staleTime: 20_000,
    refetchInterval: 120_000,
  });
  const fresh = q.data && !q.isPlaceholderData ? q.data : undefined;
  useEffect(() => {
    if (!fresh) return;
    const w = window as unknown as { FAVOR_HUB?: unknown };
    w.FAVOR_HUB = fresh;
    writeJson('local', KEYS.nav, { user: fresh.user, access: fresh.access, kpiTeams: fresh.kpiTeams, counts: fresh.counts, jobs: fresh.jobs });
    document.dispatchEvent(new CustomEvent('favor-hub', { detail: fresh }));
  }, [fresh]);
  return q;
}

export const useToday = () => useQuery({ queryKey: keys.today, queryFn: () => apiLazy('/api/hub/today', (m) => m.todayResponse) });

export const useKpi = (enabled: boolean) => useQuery({ queryKey: keys.kpi, queryFn: () => apiLazy('/api/hub/kpi', (m) => m.kpiResponse), enabled, staleTime: 5 * 60_000 });

export const useDay = () => useQuery({ queryKey: keys.day, queryFn: () => apiLazy('/api/hub/day', (m) => m.dayResponse) });

export const useApp2 = () => useQuery({ queryKey: keys.app2, queryFn: () => apiLazy('/api/hub/app2', (m) => m.app2Response), staleTime: 5 * 60_000 });

/** Tours and walkthroughs this person has not finished (src/scripts/tour.ts keeps the number). */
export const pendingTours = () => Number(readString(KEYS.tours, '0')) || 0;
