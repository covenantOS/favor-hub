// Shared bits for the links between Projects and the rest of the hub: Chat, Meetings, Today, the bell, search, Favor Brain,
// Google Calendar, expense requests and email. Nothing here writes; each module imports what it needs.
import type { Env } from '../../http';
import { staffDirectory, type Person } from '../../people';
import { noticeGate } from '../../requests/tasks';
import { lower, type ProjectRow, type TaskRow } from '../db';

export const ORIGIN = 'https://dash.favorintl.org';
export const TZ = 'America/New_York';
export const FAVOR = /^[a-z0-9._%+-]+@favorintl\.org$/;
export { lower, noticeGate };

export const short = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 2).trimEnd() + '...' : s);

/** Where a task opens in the hub: its project page with the task drawer, or My tasks for a task with no project. */
export function taskUrl(t: Pick<TaskRow, 'id' | 'code'>, p?: Pick<ProjectRow, 'key'> | null, origin = ''): string {
  if (p && t.code) return `${origin}/projects/p/?p=${encodeURIComponent(p.key)}&t=${encodeURIComponent(t.code)}`;
  return `${origin}/projects/?t=${encodeURIComponent(t.id)}`;
}

export function projectUrl(p: Pick<ProjectRow, 'key'>, origin = ''): string {
  return `${origin}/projects/p/?p=${encodeURIComponent(p.key)}`;
}

export async function dirMap(env: Pick<Env, 'DB'>): Promise<Map<string, Person>> {
  return new Map((await staffDirectory(env)).map((p) => [p.email, p]));
}

export function nameOf(dir: Map<string, Person>, email: string | null | undefined): string {
  const e = lower(email);
  if (!e) return '';
  return dir.get(e)?.name || e.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Mention tokens (<@email>) written as @First Last, for notices, emails and search lines. */
export function plain(text: string, dir: Map<string, Person>): string {
  return String(text || '')
    .replace(/<@([^>\s]+)>/g, (_a, id: string) => '@' + (id === 'brain' ? 'Favor Brain' : id === 'channel' || id === 'all' ? 'channel' : nameOf(dir, id)))
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TaskLine {
  id: string;
  code: string | null;
  title: string;
  status: string;
  owner_email: string | null;
  due_date: string | null;
  due_time: string | null;
  project_id: string | null;
  project_key: string | null;
  project_name: string | null;
  project_color: string | null;
}

/** One task with its project, for cards, notices and search lines. Null when the task is gone. */
export async function taskLine(env: Pick<Env, 'DB'>, idOrCode: string): Promise<TaskLine | null> {
  const v = String(idOrCode || '');
  return env.DB.prepare(
    `SELECT t.id, t.code, t.title, t.status, t.owner_email, t.due_date, t.due_time, t.project_id, p.key AS project_key, p.name AS project_name, p.color AS project_color
       FROM hub_tasks t LEFT JOIN hub_projects p ON p.id = t.project_id WHERE t.id = ? OR t.code = ? LIMIT 1`
  )
    .bind(v, v.toUpperCase())
    .first<TaskLine>()
    .catch(() => null);
}

export const STATUS_WORD: Record<string, string> = { open: 'Open', doing: 'In progress', waiting: 'Waiting', done: 'Done', dropped: 'Dropped' };

/** A date as Eastern "Oct 31", or "Oct 31, 2:30 PM" when a time is set. */
export function dueLabel(date: string | null, time?: string | null): string {
  if (!date) return '';
  const d = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  if (!time) return d;
  const [h, m] = time.split(':').map(Number);
  return `${d}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export const todayEt = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: TZ });
export const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export type Waiter = (p: Promise<unknown>) => void;
