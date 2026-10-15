// The reads behind Learn, Manage and the course editor. Light on purpose: route files import this module (never a component) so the
// first-screen script stays under the budget. An answer a page expects (not allowed, not found) comes back as a state, never thrown,
// so a Suspense boundary only ever sees real failures.
import { queryOptions } from '@tanstack/react-query';
import { LearnError, readHelpIndex, readJson } from './api';
import { helpItems, type Course, type HelpItem, type Overview, type People, type Report } from './logic';

export const laKeys = {
  overview: ['learn-admin', 'overview'] as const,
  people: ['learn-admin', 'people'] as const,
  reports: ['learn-admin', 'report'] as const,
  report: (qs: string) => ['learn-admin', 'report', qs] as const,
  course: (id: string) => ['learn-admin', 'course', id] as const,
  help: ['learn-admin', 'help'] as const,
  clips: (q: string) => ['learn-admin', 'clips', q] as const,
  drive: (q: string) => ['learn-admin', 'drive', q] as const,
  mode: ['learn-admin', 'mode'] as const,
};

/** An answer that is data, or the reason there is none (a 403 means this person is not an author). */
export type Gate<T> = { state: 'ok'; data: T } | { state: 'fail'; status: number; message: string };

const fail = (e: unknown): { state: 'fail'; status: number; message: string } => ({
  state: 'fail',
  status: e instanceof LearnError ? e.status : 0,
  message: (e as Error)?.message || 'Try again.',
});

export const overviewQuery = queryOptions({
  queryKey: laKeys.overview,
  queryFn: async (): Promise<Gate<Overview>> => {
    try {
      const d = await readJson('/api/learn/admin/overview');
      return { state: 'ok', data: { courses: (d.courses as Overview['courses']) || [], paths: (d.paths as Overview['paths']) || [] } };
    } catch (e) {
      return fail(e);
    }
  },
  staleTime: 20_000,
});

/** The course editor's read: the course with every lesson, quiz answers included (authors only). */
export const courseQuery = (id: string) =>
  queryOptions({
    queryKey: laKeys.course(id),
    queryFn: async (): Promise<Gate<Course>> => {
      try {
        const d = await readJson('/api/learn/admin/course/' + encodeURIComponent(id));
        return { state: 'ok', data: d.course as Course };
      } catch (e) {
        return fail(e);
      }
    },
    staleTime: 20_000,
  });

/** Staff and teams for the assign pickers. Browser only: it lists every person. */
export const peopleQuery = queryOptions({
  queryKey: laKeys.people,
  queryFn: async (): Promise<Gate<People>> => {
    try {
      const d = await readJson('/api/learn/admin/people');
      return { state: 'ok', data: { people: (d.people as People['people']) || [], teams: (d.teams as string[]) || [] } };
    } catch (e) {
      return fail(e);
    }
  },
  staleTime: 5 * 60_000,
});

/** Who is done, late and how they scored. Browser only: names and scores. */
export const reportQuery = (qs: string) =>
  queryOptions({
    queryKey: laKeys.report(qs),
    queryFn: async (): Promise<Gate<Report>> => {
      try {
        const d = await readJson('/api/learn/admin/report' + (qs ? '?' + qs : ''));
        return { state: 'ok', data: { summary: d.summary as Report['summary'], teams: (d.teams as string[]) || [], rows: (d.rows as Report['rows']) || [] } };
      } catch (e) {
        return fail(e);
      }
    },
    staleTime: 0,
  });

/** The help library (videos and articles) as lesson candidates, read once. */
export const helpQuery = queryOptions({
  queryKey: laKeys.help,
  queryFn: async (): Promise<HelpItem[]> => {
    try {
      return helpItems(await readHelpIndex());
    } catch {
      return [];
    }
  },
  staleTime: Infinity,
});

export interface ClipHit {
  id: string;
  title: string;
  summary: string;
}
export interface DriveHit {
  url: string;
  name: string;
  path?: string;
}
export const clipsQuery = (q: string) =>
  queryOptions({
    queryKey: laKeys.clips(q),
    queryFn: async (): Promise<ClipHit[]> => {
      try {
        return ((await readJson('/api/learn/admin/clips?q=' + encodeURIComponent(q))).clips as ClipHit[]) || [];
      } catch {
        return [];
      }
    },
    staleTime: 15_000,
  });
export const driveQuery = (q: string) =>
  queryOptions({
    queryKey: laKeys.drive(q),
    queryFn: async (): Promise<DriveHit[]> => {
      try {
        return ((await readJson('/api/learn/admin/drive?q=' + encodeURIComponent(q))).files as DriveHit[]) || [];
      } catch {
        return [];
      }
    },
    staleTime: 15_000,
  });

/** The "Who can use Learn" setting (admins only). */
export const modeQuery = queryOptions({
  queryKey: laKeys.mode,
  queryFn: async (): Promise<string> => {
    try {
      const d = await readJson('/api/admin/settings?area=chat');
      const s = ((d.settings as { id: string; value: string }[]) || []).find((x) => x.id === 'learn.enabled');
      return s ? String(s.value) : '';
    } catch {
      return '';
    }
  },
  staleTime: 20_000,
});
