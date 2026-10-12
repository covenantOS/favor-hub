// The link to Projects. Each onboarding step that a person does becomes a task in the Onboarding project (hub_tasks), with the
// step's owner and due date, so it lands on that person's Today and in their notices. The tables belong to the Projects lane
// (db/projects.sql); until they exist every function here answers "not there" and onboarding works on its own list.
// Rows follow the Projects build contract: code KEY-0001, status open | doing | waiting | done | dropped.
import { newId, nowIso, type Env } from '../http';
import { effective } from '../admin/settings';

type Db = Pick<Env, 'DB'>;
const lower = (s: unknown) => String(s || '').trim().toLowerCase();
export const PROJECT_KEY = 'ONB';

export async function tasksReady(env: Db): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT id FROM hub_tasks LIMIT 1').first();
    await env.DB.prepare('SELECT id FROM hub_projects LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

/** The one Onboarding project. Created by the first run. Anyone with a task in it sees that task; the lead and admins see all. */
export async function ensureProject(env: Db, leadEmail: string): Promise<string | null> {
  if (!(await tasksReady(env))) return null;
  const have = await env.DB.prepare('SELECT id FROM hub_projects WHERE key = ?').bind(PROJECT_KEY).first<{ id: string }>();
  if (have) return have.id;
  const id = newId('prj');
  const now = nowIso();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO hub_projects (id, key, name, description, team, lead_email, visibility, status, color, next_num, created_by, created_at, updated_at)
     VALUES (?, ?, 'Onboarding and offboarding', 'Every step of a new hire’s start and a departing person’s exit, with its owner and due date.', 'People', ?, 'members', 'active', 'leaf', 1, ?, ?, ?)`
  )
    .bind(id, PROJECT_KEY, lower(leadEmail), lower(leadEmail), now, now)
    .run();
  const row = await env.DB.prepare('SELECT id FROM hub_projects WHERE key = ?').bind(PROJECT_KEY).first<{ id: string }>();
  return row ? row.id : null;
}

export interface NewTask {
  projectId: string;
  title: string;
  description: string;
  owner: string;
  due: string | null;
  by: string;
  runId: string;
  stepKey: string;
}

/** Makes the task and returns its id. The code counts up inside the project. */
export async function makeTask(env: Db, t: NewTask): Promise<string> {
  const id = newId('tsk');
  const now = nowIso();
  const bumped = await env.DB.prepare('UPDATE hub_projects SET next_num = next_num + 1, updated_at = ? WHERE id = ? RETURNING next_num - 1 AS n')
    .bind(now, t.projectId)
    .first<{ n: number }>();
  const code = `${PROJECT_KEY}-${String(bumped?.n || 1).padStart(4, '0')}`;
  await env.DB.prepare(
    `INSERT INTO hub_tasks (id, project_id, code, title, description, status, priority, owner_email, due_date, sort, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', 'normal', ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, t.projectId, code, t.title.slice(0, 200), t.description.slice(0, 4000), lower(t.owner) || null, t.due, Date.now() % 100000000, lower(t.by), now, now)
    .run();
  await env.DB.prepare('INSERT INTO hub_task_events (id, task_id, project_id, actor_email, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(newId('evt'), id, t.projectId, lower(t.by), 'created', JSON.stringify({ from: 'onboarding', run: t.runId, step: t.stepKey }), now)
    .run()
    .catch(() => null);
  return id;
}

export interface TaskState {
  id: string;
  status: string;
  done_by: string | null;
  owner_email: string | null;
  due_date: string | null;
  code: string | null;
}

export async function taskStates(env: Db, ids: string[]): Promise<Map<string, TaskState>> {
  const out = new Map<string, TaskState>();
  const list = ids.filter(Boolean);
  if (!list.length) return out;
  try {
    for (let i = 0; i < list.length; i += 40) {
      const part = list.slice(i, i + 40);
      const r = await env.DB.prepare(`SELECT id, status, done_by, owner_email, due_date, code FROM hub_tasks WHERE id IN (${part.map(() => '?').join(',')})`)
        .bind(...part)
        .all<TaskState>();
      for (const t of r.results || []) out.set(t.id, t);
    }
  } catch {
    /* Projects is not applied */
  }
  return out;
}

export async function setTaskDone(env: Db, id: string, done: boolean, by: string): Promise<void> {
  const now = nowIso();
  await env.DB.prepare(`UPDATE hub_tasks SET status = ?, done_at = ?, done_by = ?, updated_at = ? WHERE id = ?`)
    .bind(done ? 'done' : 'open', done ? now : null, done ? lower(by) : null, now, id)
    .run()
    .catch(() => null);
}

export async function patchTask(env: Db, id: string, fields: { owner?: string; due?: string | null; title?: string }): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (fields.owner !== undefined) { sets.push('owner_email = ?'); args.push(lower(fields.owner) || null); }
  if (fields.due !== undefined) { sets.push('due_date = ?'); args.push(fields.due); }
  if (fields.title !== undefined) { sets.push('title = ?'); args.push(fields.title.slice(0, 200)); }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  args.push(nowIso(), id);
  await env.DB.prepare(`UPDATE hub_tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run().catch(() => null);
}

export async function dropTask(env: Db, id: string): Promise<void> {
  await env.DB.prepare(`UPDATE hub_tasks SET status = 'dropped', updated_at = ? WHERE id = ? AND status <> 'done'`).bind(nowIso(), id).run().catch(() => null);
}

/** Who may be told: the same gate as the request board (requests.notify on, or the address is in requests.notify.only). */
export async function noticeGate(env: Db & { [k: string]: unknown }): Promise<(email: string) => boolean> {
  const mode = lower(await effective(env as unknown as Env, 'requests.notify', undefined, 'off').catch(() => 'off'));
  if (mode === 'on') return () => true;
  const only = new Set(
    String(await effective(env as unknown as Env, 'requests.notify.only', undefined, '').catch(() => ''))
      .split(/[\s,;]+/)
      .map(lower)
      .filter(Boolean)
  );
  return (email: string) => only.has(lower(email));
}

/** A notice on Today and the bell for the task's owner. Nothing for the person who acted, nothing outside the gate. */
export async function noticeAssigned(env: Db, taskId: string, to: string, actor: string, body: string, gate: (e: string) => boolean): Promise<boolean> {
  const e = lower(to);
  if (!e || e === lower(actor) || !gate(e)) return false;
  try {
    await env.DB.prepare('INSERT INTO hub_task_notices (id, email, task_id, kind, actor_email, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId('ntc'), e, taskId, 'assigned', lower(actor), body.slice(0, 300), nowIso())
      .run();
    return true;
  } catch {
    return false;
  }
}
