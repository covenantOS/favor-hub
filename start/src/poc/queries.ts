import { queryOptions } from '@tanstack/react-query';
import { navResponse, type NavResponse } from '@shared/schemas';
import { hubGet } from './hub';

export const navQuery = queryOptions({
  queryKey: ['nav'],
  queryFn: async (): Promise<NavResponse> => navResponse.parse(await hubGet('/api/hub/nav')),
  staleTime: 20_000,
});

export interface Person { email?: string; name?: string; picture?: string }
export interface Project {
  id: string; key: string; name: string; description?: string; team?: string; status: string; visibility?: string; color?: string;
  due_date?: string | null; open: number; done: number; overdue: number; lead?: Person | null;
}
export interface Task { id: string; title: string; status: string; due_date?: string | null; project_key?: string; project?: { key?: string; name?: string; color?: string } | null; owner?: Person | null; parent_id?: string | null }

export const projectsQuery = queryOptions({
  queryKey: ['projects'],
  queryFn: async () => (await hubGet('/api/projects')) as { projects: Project[]; mine: { open: number; overdue: number; dueToday: number } },
});

export const myTasksQuery = queryOptions({
  queryKey: ['tasks', 'mine', 'open'],
  queryFn: async () => (await hubGet('/api/tasks?owner=me&status=open&limit=500')) as { tasks: Task[]; total: number },
});
