// Projects: row types, small helpers and the reads every route shares. Tables are in db/projects.sql.
import { HttpError, newId, nowIso, type Env } from '../http';
import { staffDirectory, type Person } from '../people';

export { newId, nowIso };

export interface ProjectRow {
  id: string;
  key: string;
  name: string;
  description: string;
  team: string;
  lead_email: string;
  visibility: 'staff' | 'members';
  status: string;
  color: string;
  start_date: string | null;
  due_date: string | null;
  chat_channel_id: string | null;
  drive_folder_id: string | null;
  next_num: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SectionRow {
  id: string;
  project_id: string;
  name: string;
  sort: number;
}

export interface TaskRow {
  id: string;
  project_id: string | null;
  section_id: string | null;
  code: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  owner_email: string | null;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  done_at: string | null;
  done_by: string | null;
  parent_id: string | null;
  sort: number;
  waiting_on_email: string | null;
  waiting_on_task: string | null;
  appeal_code: string | null;
  source_code: string | null;
  fund_code: string | null;
  campaign_code: string | null;
  request_id: string | null;
  meeting_id: string | null;
  meeting_action_idx: number | null;
  chat_message_id: string | null;
  expense_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const STATUSES = ['open', 'doing', 'waiting', 'done', 'dropped'] as const;
export const PRIORITIES = ['low', 'normal', 'high'] as const;
export const COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal', 'slate'] as const;
export const FAVOR = /^[a-z0-9._%+-]+@favorintl\.org$/;
export const lower = (s: unknown) => String(s || '').trim().toLowerCase();

/** Today's date in Eastern, YYYY-MM-DD. Due dates are dates, not instants. */
export function todayEastern(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** False until db/projects.sql is applied; every route then answers 503 instead of failing. */
export async function projectsReady(env: Env): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT id FROM hub_tasks LIMIT 1').first();
    await env.DB.prepare('SELECT id FROM hub_projects LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

export const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** Splits a list so no statement binds more than D1's limit of 100 values. */
export function chunk<T>(list: T[], size = 80): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function projectOf(env: Env, idOrKey: string): Promise<ProjectRow> {
  const v = String(idOrKey || '');
  const row = await env.DB.prepare('SELECT * FROM hub_projects WHERE id = ? OR key = ? LIMIT 1').bind(v, v.toUpperCase()).first<ProjectRow>();
  if (!row) throw new HttpError(404, 'not_found', 'Project not found.');
  return row;
}

export async function taskById(env: Env, idOrCode: string): Promise<TaskRow> {
  const v = String(idOrCode || '');
  const row = await env.DB.prepare('SELECT * FROM hub_tasks WHERE id = ? OR code = ? LIMIT 1').bind(v, v.toUpperCase()).first<TaskRow>();
  if (!row) throw new HttpError(404, 'not_found', 'Task not found.');
  return row;
}

export async function membersOf(env: Env, projectId: string): Promise<{ email: string; role: string }[]> {
  const r = await env.DB.prepare('SELECT email, role FROM hub_project_members WHERE project_id = ? ORDER BY added_at, email').bind(projectId).all<{ email: string; role: string }>();
  return r.results || [];
}

export async function sectionsOf(env: Env, projectId: string): Promise<SectionRow[]> {
  const r = await env.DB.prepare('SELECT id, project_id, name, sort FROM hub_project_sections WHERE project_id = ? ORDER BY sort, id').bind(projectId).all<SectionRow>();
  return r.results || [];
}

/** The staff directory as a map; one read of three small tables. */
export async function directory(env: Env): Promise<Map<string, Person>> {
  return new Map((await staffDirectory(env)).map((p) => [p.email, p]));
}

export interface Brief {
  email: string;
  name: string;
  picture: string;
}

export function brief(dir: Map<string, Person>, email: string | null | undefined): Brief | null {
  const e = lower(email);
  if (!e) return null;
  const p = dir.get(e);
  if (p) return { email: e, name: p.name, picture: p.picture };
  const name = e.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { email: e, name, picture: '' };
}

/** A person as the drawer lists them (the directory row, or a plain stand-in for someone no longer listed). */
export function person(dir: Map<string, Person>, email: string): Person {
  const e = lower(email);
  return dir.get(e) || { email: e, name: brief(dir, e)?.name || e, title: '', team: '', picture: '' };
}

export async function addEvent(env: Env, a: { task_id?: string | null; project_id?: string | null; actor: string; kind: string; detail?: unknown }): Promise<string> {
  const id = newId('evt');
  await env.DB.prepare('INSERT INTO hub_task_events (id, task_id, project_id, actor_email, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, a.task_id ?? null, a.project_id ?? null, a.actor, a.kind, JSON.stringify(a.detail ?? {}), nowIso())
    .run();
  return id;
}

/** Reads a date field: YYYY-MM-DD or empty. */
export function asDate(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T12:00:00Z'))) throw new HttpError(400, 'bad_date', `${field} must be a date like 2026-10-31.`);
  return s;
}

export function asTime(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new HttpError(400, 'bad_time', 'due_time must be like 14:30.');
  return s;
}

export function asEmail(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  const e = lower(v);
  if (!FAVOR.test(e)) throw new HttpError(400, 'bad_email', `${field} must be a Favor email address.`);
  return e;
}

export function asText(v: unknown, field: string, max: number, required = false): string {
  const s = typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '';
  if (!s && required) throw new HttpError(400, 'missing_field', `${field} is required.`);
  return s.slice(0, max);
}

export function asCode(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, 40);
  return s || null;
}

export function oneOf<T extends readonly string[]>(v: unknown, list: T, field: string): T[number] {
  const s = lower(v);
  if (!(list as readonly string[]).includes(s)) throw new HttpError(400, 'bad_value', `${field} must be one of ${list.join(', ')}.`);
  return s as T[number];
}
