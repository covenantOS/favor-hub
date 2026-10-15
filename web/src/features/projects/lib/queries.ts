// Reads for the Projects pages, as queryOptions. A route's loader starts them without waiting (void queryClient.prefetchQuery(q)), so
// the frame streams at once; the component reads them with useSuspenseQuery inside <Suspense> and a skeleton of the final size.
// hubGet runs on the server (through the relay, with the visitor's cookie) and in the browser (same-origin).
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../../lib/hub';
import type { Member, MineCounts, Project, Section, Task, TaskCounts, TasksPage } from '../types';
import { fetchAllTasks, type Reader } from './store';
import { qs } from './api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export const pjKeys = {
  projects: ['projects', 'list'] as const,
  project: (key: string) => ['projects', 'one', key.toUpperCase()] as const,
  tasks: (scope: string, status: string) => ['projects', 'tasks', scope, status] as const,
  asana: ['projects', 'asana-me'] as const,
};

const readTasks: Reader = (q) => hubGet('/api/tasks' + qs(q)) as Promise<Any>;

export const projectsQuery = queryOptions({
  queryKey: pjKeys.projects,
  queryFn: async (): Promise<{ projects: Project[]; mine: MineCounts }> => {
    const d = (await hubGet('/api/projects')) as Any;
    return { projects: d.projects || [], mine: d.mine || { open: 0, overdue: 0, dueToday: 0 } };
  },
  staleTime: 15_000,
});

export interface ProjectDetail {
  project: Project;
  sections: Section[];
  members: Member[];
  counts: TaskCounts | null;
  can: { manage: boolean; edit: boolean };
}
export const projectQuery = (key: string) =>
  queryOptions({
    queryKey: pjKeys.project(key),
    queryFn: async (): Promise<ProjectDetail> => {
      const d = (await hubGet('/api/projects/' + encodeURIComponent(key))) as Any;
      return { project: d.project, sections: d.sections || [], members: d.members || [], counts: d.counts || null, can: d.can || { manage: false, edit: false } };
    },
    staleTime: 15_000,
  });

/** Every top-level task of a project (open ones, or all), read page by page. */
export const projectTasksQuery = (key: string, showDone: boolean) =>
  queryOptions({
    queryKey: pjKeys.tasks('p:' + key.toUpperCase(), showDone ? 'all' : 'open'),
    queryFn: (): Promise<TasksPage> => fetchAllTasks(readTasks, { project: key, status: showDone ? 'all' : 'open' }),
    staleTime: 15_000,
  });

/** The signed-in person's tasks in any project. */
export const mineTasksQuery = (showDone: boolean) =>
  queryOptions({
    queryKey: pjKeys.tasks('mine', showDone ? 'all' : 'open'),
    queryFn: (): Promise<TasksPage> => fetchAllTasks(readTasks, { owner: 'me', status: showDone ? 'all' : 'open' }),
    staleTime: 15_000,
  });

export interface AsanaMe {
  ok?: boolean;
  required?: boolean;
  connected?: boolean;
  asana_user?: unknown;
  asana_name?: string;
}
/** Whether this person must connect Asana before Projects opens. A failed read counts as "no gate". */
export const asanaMeQuery = queryOptions({
  queryKey: pjKeys.asana,
  queryFn: async (): Promise<AsanaMe | null> => {
    try {
      return (await hubGet('/api/asana/oauth/me')) as AsanaMe;
    } catch {
      return null;
    }
  },
  staleTime: 60_000,
});

export type { Task };
