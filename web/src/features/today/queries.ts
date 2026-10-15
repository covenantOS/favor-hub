// Every read Today makes, one queryOptions each. A read the person may not have (the KPI figures, the gift desk, mail that is slow) answers
// null instead of throwing, so its card hides quietly and the rest of the page draws. Numbers are the server's, never recomputed here.
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';
import type { J } from './rank';

/** A read that never throws: any failure (a 403 for staff, a Gmail timeout) is "nothing", and the part stays out. */
export const soft = async (path: string): Promise<J | null> => {
  try {
    return await hubGet(path);
  } catch {
    return null;
  }
};

export const todayQ = queryOptions({ queryKey: ['today', 'hub'], queryFn: async () => (await hubGet('/api/hub/today')) as J, staleTime: 20_000 });
export const dayQ = queryOptions({ queryKey: ['today', 'day'], queryFn: () => soft('/api/hub/day'), staleTime: 30_000 });
export const homeQ = queryOptions({ queryKey: ['today', 'home'], queryFn: () => soft('/api/hub/home'), staleTime: 20_000 });
export const kpiQ = queryOptions({ queryKey: ['today', 'kpi'], queryFn: () => soft('/api/hub/kpi'), staleTime: 120_000 });
export const giftsQ = queryOptions({ queryKey: ['today', 'gifts'], queryFn: () => soft('/api/today/gifts'), staleTime: 20_000 });
export const overviewQ = queryOptions({ queryKey: ['today', 'overview'], queryFn: () => soft('/api/gifts/overview'), staleTime: 60_000 });
export const welcomeQ = queryOptions({ queryKey: ['today', 'welcome'], queryFn: () => soft('/api/onboarding/welcome'), staleTime: 120_000 });
export const upcomingQ = queryOptions({ queryKey: ['today', 'upcoming'], queryFn: () => soft('/api/meet/meetings?scope=upcoming'), staleTime: 60_000 });

/** The briefing. A stale answer is asked for again fresh once, as today3.js did. */
export const briefQ = (owner: string) =>
  queryOptions({
    queryKey: ['today', 'brief', owner],
    queryFn: async () => {
      const base = '/api/brief/today' + (owner ? '?owner=' + encodeURIComponent(owner) : '');
      const d = await soft(base);
      if (d && d.stale) return (await soft(base + (owner ? '&' : '?') + 'fresh=1')) || d;
      return d;
    },
    staleTime: 60_000,
  });

export const inboxQ = (part: 'fast' | 'mail') => queryOptions({ queryKey: ['today', 'inbox', part], queryFn: async () => ((await soft('/api/today/inbox?part=' + part)) || { items: [] }) as J, staleTime: 15_000 });
export const waitingQ = (part: 'fast' | 'mail') => queryOptions({ queryKey: ['today', 'waiting', part], queryFn: async () => ((await soft('/api/today/waiting?part=' + part)) || { items: [] }) as J, staleTime: 15_000 });

/** Start the reads the list and the schedule are drawn from, at once and without waiting for any (the route's loader). The work summary and the
 * gift desk are the slowest reads and nothing in the first frame needs them, so the server does not ask for them: the browser does, after it hydrates. */
export function startFirstReads(client: QueryClient) {
  for (const q of [todayQ, dayQ, inboxQ('fast'), waitingQ('fast'), briefQ('')]) void client.prefetchQuery(q);
}
