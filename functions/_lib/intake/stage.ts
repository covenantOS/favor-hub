// Keeps a request and its card in step. requests.status stays the one record of where a request is (Sent, Approved, In progress, Done);
// the card's section says it too, and either may be changed first:
//   dragging the card between stages, or moving it to another project's stage, sets the request's status from the section's name;
//   landing in Done ticks the card and sends the done email, exactly as ticking the card does (taskDoneToRequest);
//   ticking a card in a team pipeline moves it to Done, and reopening one in Done moves it back to In progress;
//   the first time a card leaves Intake the person who asked is told, once (tellAccepted).
// Events the intake routes fire themselves carry detail.from = 'intake' and are skipped here, so nothing runs twice.
import { nowIso, type Env } from '../http';
import { getRequest, setStatus } from '../db';
import { taskDoneToRequest, tellAccepted } from '../integrations/accept';
import type { Actor, TaskEnv } from '../requests/tasks';
import { addEvent, lower, FAVOR, type TaskRow } from '../projects/db';
import type { ProjectEvent } from '../projects/hooks';
import { statusForSection, type RequestStatus } from '../../../shared/intake-model';
import { pipelineIds } from './pipeline';

const RANK: Record<RequestStatus, number> = { inbox: 0, approved: 1, in_progress: 2, done: 3, declined: 4 };

async function sectionNamed(env: Env, projectId: string, name: string): Promise<{ id: string; name: string } | null> {
  return env.DB.prepare('SELECT id, name FROM hub_project_sections WHERE project_id = ? AND lower(name) = lower(?) ORDER BY sort LIMIT 1').bind(projectId, name).first<{ id: string; name: string }>().catch(() => null);
}

async function setSection(env: Env, t: TaskRow, name: string): Promise<void> {
  if (!t.project_id) return;
  const s = await sectionNamed(env, t.project_id, name);
  if (!s || s.id === t.section_id) return;
  const mx = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM hub_tasks WHERE project_id = ? AND section_id = ? AND parent_id IS NULL').bind(t.project_id, s.id).first<{ m: number }>();
  await env.DB.prepare('UPDATE hub_tasks SET section_id = ?, sort = ?, updated_at = ? WHERE id = ?').bind(s.id, (Number(mx?.m) || 0) + 1024, nowIso(), t.id).run();
}

export interface Aligned {
  from: RequestStatus;
  to: RequestStatus;
  changed: boolean;
}

/**
 * Sets the request's status from where its card is. `actor` is who moved it (for the history and for telling the person who asked).
 * `minimum` stops a card that was just accepted from reading as Sent when it was put in a stage called Intake.
 */
export async function alignRequest(env: TaskEnv, taskId: string, actor: Actor, opts: { minimum?: RequestStatus; note?: string } = {}): Promise<Aligned | null> {
  const t = await env.DB.prepare('SELECT * FROM hub_tasks WHERE id = ?').bind(taskId).first<TaskRow>().catch(() => null);
  if (!t || !t.request_id) return null;
  const row = await getRequest(env, t.request_id).catch(() => null);
  if (!row || row.status === 'declined') return null;
  const pipes = await pipelineIds(env);
  const inPipeline = !!t.project_id && pipes.has(t.project_id);
  const sec = t.section_id ? await env.DB.prepare('SELECT name FROM hub_project_sections WHERE id = ?').bind(t.section_id).first<{ name: string }>() : null;

  let want: RequestStatus;
  if (t.status === 'done') want = 'done';
  else if (!sec && !inPipeline) want = row.status === 'inbox' ? 'approved' : row.status;
  else want = statusForSection(sec?.name, inPipeline);
  if (opts.minimum && RANK[want] < RANK[opts.minimum]) want = opts.minimum;
  const from = row.status as RequestStatus;
  if (want === from) return { from, to: want, changed: false };

  if (want === 'done') {
    // Landing in Done ticks the card, then closes the request and sends the done email, as ticking it does.
    if (t.status !== 'done') {
      const now = nowIso();
      const by = FAVOR.test(lower(actor.email)) ? lower(actor.email) : null;
      await env.DB.prepare(`UPDATE hub_tasks SET status = 'done', done_at = ?, done_by = ?, updated_at = ? WHERE id = ? AND status <> 'done'`).bind(now, by, now, t.id).run();
      await addEvent(env, { task_id: t.id, project_id: t.project_id, actor: actor.email, kind: 'done', detail: { from: 'intake' } }).catch(() => undefined);
    }
    const closed = await taskDoneToRequest(env, { id: t.id, request_id: t.request_id, status: 'done', done_by: lower(actor.email) }, actor.name);
    return { from, to: 'done', changed: closed };
  }

  // Out of Done: the card is open again.
  if (from === 'done' && t.status === 'done') {
    await env.DB.prepare(`UPDATE hub_tasks SET status = 'open', done_at = NULL, done_by = NULL, updated_at = ? WHERE id = ?`).bind(nowIso(), t.id).run();
    await addEvent(env, { task_id: t.id, project_id: t.project_id, actor: actor.email, kind: 'reopened', detail: { from: 'intake' } }).catch(() => undefined);
  }
  await setStatus(env, row.id, want, actor.name);
  if (from === 'inbox' && want !== 'inbox') {
    const owner = lower(t.owner_email) || lower(actor.email);
    await tellAccepted(env, row, actor, owner, t, opts.note || '').catch((err) => console.error('[intake] tell', err));
  }
  return { from, to: want, changed: true };
}

/** The project event hook: a card moved, changed project, ticked or reopened. Registered in functions/_lib/projects/hooks.ts. */
export async function onTaskEvent(env: Env, ev: ProjectEvent): Promise<void> {
  const t = ev.task;
  if (!t || !t.request_id) return;
  const from = ev.detail?.from;
  if (from === 'intake' || from === 'request') return;
  const fields = Array.isArray(ev.detail?.fields) ? (ev.detail!.fields as string[]) : [];
  const actor: Actor = { email: lower(ev.actor), name: ev.actorName || ev.actor, admin: false };
  const pipes = await pipelineIds(env);
  const inPipeline = !!t.project_id && pipes.has(t.project_id);
  if (ev.kind === 'task.done') {
    // Ticked in a team pipeline: the card goes to Done. The done email is the other hook's (integrations/accept.ts onTaskEvent).
    if (inPipeline) await setSection(env, t, 'Done');
    return;
  }
  if (ev.kind === 'task.reopened') {
    const sec = t.section_id ? await env.DB.prepare('SELECT name FROM hub_project_sections WHERE id = ?').bind(t.section_id).first<{ name: string }>() : null;
    if (inPipeline && /^done$/i.test(sec?.name || '')) await setSection(env, t, 'In progress');
    await alignRequest(env, t.id, actor);
    return;
  }
  if (ev.kind === 'task.moved' || (ev.kind === 'task.updated' && fields.some((f) => f === 'section_id' || f === 'project_id'))) {
    await alignRequest(env, t.id, actor);
  }
}
