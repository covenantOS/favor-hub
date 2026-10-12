// Data hooks: one hook per API route, each with its schema and its query key. A route component calls these and never fetches itself.
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/query';
import { KEYS, readJson, readString, writeJson } from '@/lib/storage';
import { app2Response, dayResponse, kpiResponse, navResponse, todayResponse, type NavResponse } from '@shared/schemas';

/** The menu answer this browser last saved. The classic pages save the same record, so the menu paints on the first frame on either side. */
function savedNav(): NavResponse | undefined {
  const raw = readJson<unknown>('local', KEYS.nav, null);
  if (!raw || typeof raw !== 'object') return undefined;
  const parsed = navResponse.safeParse({ ok: true, ...(raw as object) });
  return parsed.success ? parsed.data : undefined;
}

export function useNav() {
  const q = useQuery({
    queryKey: keys.nav,
    queryFn: () => api('/api/hub/nav', navResponse),
    placeholderData: savedNav,
    staleTime: 20_000,
    refetchInterval: 120_000,
  });
  const fresh = q.data && !q.isPlaceholderData ? q.data : undefined;
  useEffect(() => {
    if (!fresh) return;
    const w = window as unknown as { FAVOR_HUB?: unknown };
    w.FAVOR_HUB = fresh;
    writeJson('local', KEYS.nav, { user: fresh.user, access: fresh.access, kpiTeams: fresh.kpiTeams, counts: fresh.counts });
    document.dispatchEvent(new CustomEvent('favor-hub', { detail: fresh }));
  }, [fresh]);
  return q;
}

export const useToday = () => useQuery({ queryKey: keys.today, queryFn: () => api('/api/hub/today', todayResponse) });

export const useKpi = (enabled: boolean) => useQuery({ queryKey: keys.kpi, queryFn: () => api('/api/hub/kpi', kpiResponse), enabled, staleTime: 5 * 60_000 });

export const useDay = () => useQuery({ queryKey: keys.day, queryFn: () => api('/api/hub/day', dayResponse) });

export const useApp2 = () => useQuery({ queryKey: keys.app2, queryFn: () => api('/api/hub/app2', app2Response), staleTime: 5 * 60_000 });

/** Tours and walkthroughs this person has not finished (src/scripts/tour.ts keeps the number). */
export const pendingTours = () => Number(readString(KEYS.tours, '0')) || 0;
