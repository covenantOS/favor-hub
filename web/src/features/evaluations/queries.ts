// The reads behind the Evaluations screens. Light on purpose: route files import this module and never a component, so the first-screen
// script stays under the budget. Every read is browser-only (a plain useQuery after mount): a case carries answers and reviewer feedback.
import { queryOptions } from '@tanstack/react-query';
import { evalGet } from './api';
import type { CaseView, FormsPayload, Mine, Person, PickPerson } from './logic';

export const evKeys = {
  forms: ['evals', 'forms'] as const,
  me: ['evals', 'me'] as const,
  case: (id: string) => ['evals', 'case', id] as const,
  people: ['evals', 'people'] as const,
  courses: ['evals', 'courses'] as const,
  terms: ['evals', 'admin', 'terms'] as const,
  pick: ['evals', 'admin', 'pick'] as const,
  term: (id: string) => ['evals', 'admin', 'term', id] as const,
};

/** The three forms, the scale and the limits. They change only with a deploy. */
export const formsQuery = queryOptions({
  queryKey: evKeys.forms,
  queryFn: () => evalGet<FormsPayload>('forms'),
  staleTime: Infinity,
  refetchOnWindowFocus: false,
});

/** My evaluation, the feedback I owe, my team and who is waiting for HR. Read again each time the home page opens. */
export const mineQuery = queryOptions({
  queryKey: evKeys.me,
  queryFn: () => evalGet<Mine>('me'),
  staleTime: 0,
  refetchOnWindowFocus: false,
});

/** One evaluation as this person may see it. It is never kept once the page that showed it is gone, and it is read fresh on each visit. */
export const caseQuery = (id: string) =>
  queryOptions({
    queryKey: evKeys.case(id),
    queryFn: async () => (await evalGet<{ view: CaseView }>('case/' + encodeURIComponent(id))).view,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

export const peopleQuery = queryOptions({
  queryKey: evKeys.people,
  queryFn: async () => (await evalGet<{ people: Person[] }>('people')).people,
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
});

export const coursesQuery = queryOptions({
  queryKey: evKeys.courses,
  queryFn: async () => (await evalGet<{ courses: Array<{ id: string; title: string }> }>('courses')).courses,
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
});

export interface TermLine {
  id: string;
  name: string;
  periodLabel?: string;
  startsOn: string;
  status: string;
  people: number;
  done: number;
}
export interface GapsState {
  total: number;
  missing: Array<{ email: string; name: string; title: string; team: string }>;
}
export interface TermsState {
  terms: TermLine[];
  folder: string;
  gaps: GapsState | null;
}

/** The terms page: every term, the filing folder, and who has no supervisor (that last read may fail without breaking the page). */
export const termsQuery = queryOptions({
  queryKey: evKeys.terms,
  queryFn: async (): Promise<TermsState> => {
    const [t, g] = await Promise.all([evalGet<{ terms: TermLine[]; folder: string }>('admin/terms'), evalGet<GapsState>('admin/gaps').catch(() => null)]);
    return { terms: t.terms, folder: t.folder || '', gaps: g ? { total: g.total, missing: g.missing } : null };
  },
  staleTime: 0,
  refetchOnWindowFocus: false,
  retry: false,
});

export const pickQuery = queryOptions({
  queryKey: evKeys.pick,
  queryFn: async () => (await evalGet<{ people: PickPerson[] }>('admin/pick')).people,
  staleTime: 0,
  refetchOnWindowFocus: false,
});

export interface TermCase {
  id: string;
  employee: { email: string; name: string };
  supervisor: { email: string; name: string };
  stageWord: string;
  self: boolean;
  reviewers: number;
  reviewersDone: number;
  summary: boolean;
  signed: boolean;
  behind: Array<{ who: string; what: string; due: string }>;
}
export interface TermDetail {
  term: { id: string; name: string; periodLabel: string; startsOn: string; status: string };
  cases: TermCase[];
}

export const termQuery = (id: string) =>
  queryOptions({
    queryKey: evKeys.term(id),
    queryFn: () => evalGet<TermDetail>('admin/term/' + encodeURIComponent(id)),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
