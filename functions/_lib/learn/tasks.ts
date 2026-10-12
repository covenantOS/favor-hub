// Learn in Projects. When Projects is on (the hub_tasks table exists and the setting projects.enabled is not off), an assignment also
// becomes a personal task for the person, with a link back to the course, so it shows on their Today and in My tasks. Finishing or
// removing the assignment closes the task. Without Projects nothing here does anything.
import { nowIso, type Env } from '../http';
import { effective } from '../admin/settings';
import { id } from './db';

export async function projectsOn(env: Env): Promise<boolean> {
  const mode = String(await effective(env, 'projects.enabled', undefined, 'admins').catch(() => 'admins')).toLowerCase();
  if (mode === 'off') return false;
  try {
    await env.DB.prepare('SELECT id FROM hub_tasks LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

export interface TaskInput {
  email: string;
  title: string;
  due: string | null;
  by: string;
  href: string;
  note: string;
}

/** Makes the person's task and returns its id, or null when Projects is off or the task could not be written. */
export async function makeTask(env: Env, t: TaskInput): Promise<string | null> {
  if (!(await projectsOn(env))) return null;
  const now = nowIso();
  const tid = id('tsk');
  try {
    await env.DB.prepare(
      `INSERT INTO hub_tasks (id, project_id, title, description, status, priority, owner_email, due_date, created_by, created_at, updated_at)
       VALUES (?, NULL, ?, ?, 'open', 'normal', ?, ?, ?, ?, ?)`
    )
      .bind(tid, t.title.slice(0, 200), (t.note ? t.note + '\n\n' : '') + `Open it in Learn: ${t.href}`, t.email, t.due, t.by || t.email, now, now)
      .run();
    await env.DB.prepare(`INSERT INTO hub_task_files (id, task_id, kind, name, url, added_by, added_at) VALUES (?, ?, 'link', 'Open in Learn', ?, ?, ?)`)
      .bind(id('tfl'), tid, t.href, t.by || t.email, now)
      .run()
      .catch(() => undefined);
    await env.DB.prepare(`INSERT INTO hub_task_events (id, task_id, project_id, actor_email, kind, detail, created_at) VALUES (?, ?, NULL, ?, 'created', ?, ?)`)
      .bind(id('tev'), tid, t.by || t.email, JSON.stringify({ from: 'learn' }), now)
      .run()
      .catch(() => undefined);
    return tid;
  } catch {
    return null;
  }
}

export async function closeTask(env: Env, taskId: string | null, how: 'done' | 'dropped', by: string): Promise<void> {
  if (!taskId) return;
  const now = nowIso();
  try {
    if (how === 'done') {
      await env.DB.prepare("UPDATE hub_tasks SET status = 'done', done_at = ?, done_by = ?, updated_at = ? WHERE id = ? AND status NOT IN ('done', 'dropped')").bind(now, by, now, taskId).run();
    } else {
      await env.DB.prepare("UPDATE hub_tasks SET status = 'dropped', updated_at = ? WHERE id = ? AND status NOT IN ('done', 'dropped')").bind(now, taskId).run();
    }
  } catch {
    // Projects went away or the row is gone; the assignment still closes.
  }
}

export async function moveTask(env: Env, taskId: string | null, due: string | null): Promise<void> {
  if (!taskId) return;
  try {
    await env.DB.prepare("UPDATE hub_tasks SET due_date = ?, updated_at = ? WHERE id = ? AND status NOT IN ('done', 'dropped')").bind(due, nowIso(), taskId).run();
  } catch {
    // see closeTask
  }
}

/** Reopens a task the person had finished or dropped when the same course is given again. */
export async function reopenTask(env: Env, taskId: string | null, due: string | null): Promise<void> {
  if (!taskId) return;
  try {
    await env.DB.prepare("UPDATE hub_tasks SET status = 'open', done_at = NULL, done_by = NULL, due_date = ?, updated_at = ? WHERE id = ?").bind(due, nowIso(), taskId).run();
  } catch {
    // see closeTask
  }
}
