// The reads behind the two onboarding screens. Light on purpose: route files import this module, never a component, so the first-screen
// script stays under the budget. Each read answers with a state for the answers a page expects (not switched on, not allowed, no such
// run) instead of throwing, so a Suspense boundary only ever sees real failures.
import { queryOptions } from '@tanstack/react-query';
import { OnboardError, readJson, sendJson } from './api';
import type { Detail, Duty, Group, Owned, Person, RunSummary, Template } from './logic';
import { failureWord } from './logic';

/** The answers a page draws as words: not signed in, not allowed, no such run, not switched on. */
const EXPECTED = [401, 403, 404, 503];

export const obKeys = {
  all: ['onboarding'] as const,
  list: (status: string) => ['onboarding', 'list', status] as const,
  run: (id: string) => ['onboarding', 'run', id] as const,
  owned: (id: string) => ['onboarding', 'owned', id] as const,
  template: (kind: string) => ['onboarding', 'template', kind] as const,
  staff: ['onboarding', 'staff'] as const,
};

export interface ListOk {
  state: 'ok';
  manage: boolean;
  runs: RunSummary[];
  owners: Record<string, string>;
  duties: Duty[];
  groups: unknown;
}
export type ListState = ListOk | { state: 'error'; message: string };

/** The runs in progress, who owns each duty, and whether this person manages onboarding. */
export const listQuery = queryOptions({
  queryKey: obKeys.list('active'),
  queryFn: async (): Promise<ListState> => {
    try {
      const d = await readJson('/api/onboarding');
      return { state: 'ok', manage: !!(d.can as { manage?: boolean } | undefined)?.manage, runs: (d.runs as RunSummary[]) || [], owners: (d.owners as Record<string, string>) || {}, duties: (d.duties as Duty[]) || [], groups: d.groups };
    } catch (e) {
      const err = e as OnboardError;
      // A read that failed for any other reason (a timeout, a server error) is thrown, so the browser asks again instead of keeping the failure.
      if (!EXPECTED.includes(err.status)) throw e;
      return { state: 'error', message: failureWord(err.status, err.message, 'list') };
    }
  },
  staleTime: 20_000,
});

/** The finished and cancelled runs. Browser only, read when the Finished tab opens. */
export const doneQuery = queryOptions({
  queryKey: obKeys.list('done'),
  queryFn: async (): Promise<RunSummary[]> => ((await readJson('/api/onboarding?status=done')).runs as RunSummary[]) || [],
  staleTime: 20_000,
});

/** The checklist template for one kind. Browser only: it is the editor's own copy. */
export const templateQuery = (kind: string) =>
  queryOptions({
    queryKey: obKeys.template(kind),
    queryFn: async (): Promise<Template> => {
      const d = await readJson('/api/onboarding/template?kind=' + encodeURIComponent(kind));
      return { kind: d.kind as Template['kind'], steps: (d.steps as Template['steps']) || [], groups: (d.groups as Group[]) || [], duties: (d.duties as Duty[]) || [] };
    },
    staleTime: 60_000,
  });

export type RunState = { state: 'ok'; d: Detail } | { state: 'none' } | { state: 'error'; message: string };

/** One run with its steps, HR file marks, people and history. */
export const runQuery = (id: string) =>
  queryOptions({
    queryKey: obKeys.run(id),
    queryFn: async (): Promise<RunState> => {
      if (!id) return { state: 'none' };
      try {
        const d = await readJson('/api/onboarding/runs/' + encodeURIComponent(id));
        return { state: 'ok', d: d as unknown as Detail };
      } catch (e) {
        const err = e as OnboardError;
        if (!EXPECTED.includes(err.status)) throw e;
        return { state: 'error', message: failureWord(err.status, err.message, 'run') };
      }
    },
    staleTime: 20_000,
  });

/** What a leaving person still owns. Browser only, read after the page draws, for people who manage. */
export const ownedQuery = (id: string) =>
  queryOptions({
    queryKey: obKeys.owned(id),
    queryFn: async (): Promise<Owned | null> => {
      try {
        return ((await readJson(`/api/onboarding/runs/${encodeURIComponent(id)}/owned`)).owned as Owned) || null;
      } catch {
        // The panel stays out when the read fails.
        return null;
      }
    },
    staleTime: 20_000,
  });

export interface StaffState {
  me: string;
  people: Person[];
}

/** The staff list for names, pictures and the person search. */
export const staffQuery = queryOptions({
  queryKey: obKeys.staff,
  queryFn: async (): Promise<StaffState> => {
    try {
      const d = await readJson('/api/requests/people');
      return { me: String(d.me || ''), people: (d.people as Person[]) || [] };
    } catch {
      return { me: '', people: [] };
    }
  },
  staleTime: 5 * 60_000,
});

export { sendJson };
