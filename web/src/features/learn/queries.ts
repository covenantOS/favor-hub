// The reads behind the learner pages. Light on purpose: route files import this module (never a component) so the first-screen script
// stays under the budget. Each read answers with a state instead of throwing for the answers a page expects (not found, not open yet,
// signed out), so a Suspense boundary only ever sees real failures.
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { LearnError, readJson } from './shared/api';
import type { Card, Certificate, Course, Home, LearnPath, PracticeState } from './logic';

export type Read<T> = { state: 'ok'; data: T; preview: boolean } | { state: 'error'; status: number; code: string; message: string };

export const learnKeys = {
  all: ['learn'] as const,
  home: ['learn', 'home'] as const,
  catalog: ['learn', 'catalog'] as const,
  course: (slug: string) => ['learn', 'course', slug] as const,
  path: (slug: string) => ['learn', 'path', slug] as const,
  cert: (slug: string, email: string) => ['learn', 'cert', slug, email] as const,
  practice: ['learn', 'practice'] as const,
};

const fail = (e: unknown): Read<never> => {
  const err = e instanceof LearnError ? e : new LearnError((e as Error)?.message || 'Something went wrong. Try again.');
  return { state: 'error', status: err.status, code: err.code, message: err.message };
};

async function read<T>(path: string, pick: (d: Record<string, unknown>) => T): Promise<Read<T>> {
  try {
    const d = await readJson(path);
    return { state: 'ok', data: pick(d), preview: Boolean(d.preview) };
  } catch (e) {
    return fail(e);
  }
}

export const homeQuery = queryOptions({
  queryKey: learnKeys.home,
  queryFn: () => read('/api/learn/home', (d) => d as unknown as Home),
  staleTime: 10_000,
});

export interface CatalogData {
  paths: Card[];
  courses: Card[];
}
export const catalogQuery = queryOptions({
  queryKey: learnKeys.catalog,
  queryFn: () => read('/api/learn/catalog', (d) => ({ paths: (d.paths as Card[]) || [], courses: (d.courses as Card[]) || [] }) as CatalogData),
  staleTime: 10_000,
});

export const courseQuery = (slug: string) =>
  queryOptions({
    queryKey: learnKeys.course(slug),
    queryFn: () => read('/api/learn/course/' + encodeURIComponent(slug), (d) => d.course as Course),
    // The page keeps its own copy current as lessons are finished, so a visit inside the same course reads the copy in hand first.
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

export const pathQuery = (slug: string) =>
  queryOptions({
    queryKey: learnKeys.path(slug),
    queryFn: () => read('/api/learn/path/' + encodeURIComponent(slug), (d) => d.path as LearnPath),
    staleTime: 10_000,
  });

export const certQuery = (slug: string, email: string) =>
  queryOptions({
    queryKey: learnKeys.cert(slug, email),
    queryFn: () => read('/api/learn/certificate/' + encodeURIComponent(slug) + (email ? '?email=' + encodeURIComponent(email) : ''), (d) => d.certificate as Certificate),
    staleTime: 60_000,
  });

export const practiceQuery = queryOptions({
  queryKey: learnKeys.practice,
  queryFn: () => read('/api/growth/practice', (d) => d as unknown as PracticeState),
  staleTime: 60_000,
  refetchOnWindowFocus: false,
});

/** After progress changes: My learning, the catalog, paths and the other courses read again; the course on screen keeps its own copy. */
export function refreshLearn(qc: QueryClient, keepSlug?: string): void {
  void qc.invalidateQueries({
    queryKey: learnKeys.all,
    predicate: (q) => !(q.queryKey[1] === 'course' && q.queryKey[2] === keepSlug) && q.queryKey[1] !== 'practice',
  });
}
