// Learn in Projects. When Projects is on (setting projects.enabled not off, tables applied), an assignment becomes a personal task for
// the person through Projects' own task code (createTask, patchTask, deleteTask), so it shows on their Today and in My tasks, with a
// link back to the course. Finishing or removing the assignment closes the task. Without Projects nothing here does anything.
import type { Env } from '../http';
import { effective } from '../admin/settings';
import type { Actor } from '../requests/tasks';

export async function projectsOn(env: Env): Promise<boolean> {
  const mode = String(await effective(env, 'projects.enabled', undefined, 'admins').catch(() => 'admins')).toLowerCase();
  if (mode === 'off') return false;
  try {
    const { projectsReady } = await import('../projects/db');
    return await projectsReady(env);
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

const system = (email: string): Actor => ({ email: email || 'learn', name: 'Learn', admin: true });

/** Makes the person's task and returns its id, or null when Projects is off or refuses. */
export async function makeTask(env: Env, t: TaskInput): Promise<string | null> {
  if (!(await projectsOn(env))) return null;
  try {
    const { createTask, addFile } = await import('../projects/tasks');
    const actor = system(t.by);
    const made = await createTask(env, actor, {
      title: t.title,
      owner_email: t.email,
      due_date: t.due,
      description: (t.note ? t.note + '\n\n' : '') + `Open it in Learn: ${t.href}`,
    });
    await addFile(env, actor, made.task.id, { kind: 'link', name: 'Open in Learn', url: (/^https?:/.test(t.href) ? '' : 'https://dash.favorintl.org') + t.href }).catch(() => undefined);
    return made.task.id;
  } catch {
    return null;
  }
}

export async function closeTask(env: Env, taskId: string | null, how: 'done' | 'dropped', by: string): Promise<void> {
  if (!taskId) return;
  try {
    const { patchTask, deleteTask } = await import('../projects/tasks');
    if (how === 'done') await patchTask(env, system(by), taskId, { done: true });
    else await deleteTask(env, system(by), taskId, false);
  } catch {
    // Projects went away or the task is gone; the assignment still closes.
  }
}

export async function moveTask(env: Env, taskId: string | null, due: string | null): Promise<void> {
  if (!taskId) return;
  try {
    const { patchTask } = await import('../projects/tasks');
    await patchTask(env, system('learn'), taskId, { due_date: due });
  } catch {
    // see closeTask
  }
}

/** Reopens a task the person had finished or dropped when the same course is given again. */
export async function reopenTask(env: Env, taskId: string | null, due: string | null): Promise<void> {
  if (!taskId) return;
  try {
    const { patchTask } = await import('../projects/tasks');
    await env.DB.prepare("UPDATE hub_tasks SET status = 'open', done_at = NULL, done_by = NULL WHERE id = ?").bind(taskId).run();
    await patchTask(env, system('learn'), taskId, { due_date: due });
  } catch {
    // see closeTask
  }
}
