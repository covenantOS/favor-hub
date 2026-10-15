// Reads for the request screens, as queryOptions, the same way lib/queries.ts does them: hubGet runs on the server (through the relay,
// with the visitor's cookie) and in the browser (same-origin). A route's loader may start them without waiting
// (prefetchIntake(qc)); the screens read them with useSuspenseQuery inside <Suspense> and a skeleton of the final size.
// The two the tabs need (my requests, the teams I triage) swallow a failed read into an empty answer with the message beside it, so a
// request route that is not switched on yet never takes the whole Projects home down.
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { hubGet } from '../../../lib/hub';
import type { IntakeDetail, IntakeItem, IntakeTeam } from '@shared/intake-model';
import { intakeKeys } from './api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface MineData {
  items: IntakeItem[];
  /** The message when the read failed, else ''. */
  error: string;
}
export interface TeamsData {
  teams: IntakeTeam[];
  error: string;
}

const msg = (e: unknown): string => (e as Error)?.message || 'This did not load.';

/** My requests with where each one is. */
export const intakeMineQuery = queryOptions({
  queryKey: intakeKeys.mine,
  queryFn: async (): Promise<MineData> => {
    try {
      const d = (await hubGet('/api/tasks/intake/mine')) as Any;
      return { items: d.requests || [], error: '' };
    } catch (e) {
      return { items: [], error: msg(e) };
    }
  },
  // A failed read is not kept: the next mount asks again.
  staleTime: (q) => (q.state.data?.error ? 0 : 15_000),
});

/** The teams I triage (none for most people), with their pipeline sections and what waits. */
export const intakeTeamsQuery = queryOptions({
  queryKey: intakeKeys.teams,
  queryFn: async (): Promise<TeamsData> => {
    try {
      const d = (await hubGet('/api/tasks/intake/teams')) as Any;
      return { teams: d.teams || [], error: '' };
    } catch (e) {
      return { teams: [], error: msg(e) };
    }
  },
  staleTime: (q) => (q.state.data?.error ? 0 : 15_000),
});

/** The requests of one team: the open ones by default, or every one (to decorate cards that are already Done). */
export const intakeQueueQuery = (team: string, scope: 'open' | 'all' = 'open') =>
  queryOptions({
    queryKey: intakeKeys.queue(scope, team),
    queryFn: async (): Promise<IntakeItem[]> => {
      const d = (await hubGet('/api/tasks/intake/queue?scope=' + scope + '&team=' + encodeURIComponent(team))) as Any;
      return d.requests || [];
    },
    staleTime: 5_000,
  });

/** One request in full (the drawer's panel and the inline conversation read the same one). */
export const intakeDetailQuery = (id: string) =>
  queryOptions({
    queryKey: intakeKeys.request(id),
    queryFn: async (): Promise<{ ok: true } & IntakeDetail> => (await hubGet('/api/tasks/intake/r/' + encodeURIComponent(id))) as Any,
    staleTime: 5_000,
    retry: false,
  });

/** Starts the two reads the tabs need, without waiting. Call it from the route's loader beside the Projects ones. */
export function prefetchIntake(qc: QueryClient): void {
  void qc.prefetchQuery(intakeMineQuery);
  void qc.prefetchQuery(intakeTeamsQuery);
}
