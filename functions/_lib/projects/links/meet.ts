// Meetings to tasks. When a meeting's notes are ready, every action item whose owner the talk named becomes a task for that person
// (meetActionsToTasks, called from the Meetings notes step). An item with no named owner becomes a task on one press from the
// notes page (makeActionTask). A task made from an item keeps the meeting, the item number and the moment in the transcript, and
// ticking either side ticks the other.
// Only the meeting whose notes were just made is read; older meetings are never swept. Notices follow the usual gate.
import { HttpError, type Env } from '../../http';
import { effective } from '../../admin/settings';
import type { Actor } from '../access';
import { projectsMode } from '../access';
import { lower, projectOf, type ProjectRow, type TaskRow } from '../db';
import { createTask, patchTask } from '../tasks';
import { fire } from '../hooks';
import { parseWhen, projectOfChannel } from './chat';
import { FAVOR, ORIGIN, dirMap, nameOf } from './shared';

interface MeetingRow { id: string; title: string; host_email: string; host_name: string; started_at: string | null; created_at: string; status: string }
interface ActionRow { idx: number; text: string; owner_name: string; owner_email: string; due: string; t: number; done: number }

export const stamp = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

async function meetingOf(env: Env, id: string): Promise<MeetingRow> {
  const m = await env.DB.prepare('SELECT id, title, host_email, host_name, started_at, created_at, status FROM hub_meetings WHERE id = ?').bind(id).first<MeetingRow>();
  if (!m) throw new HttpError(404, 'not_found', 'That meeting does not exist.');
  return m;
}

/** The project a meeting belongs to: the one whose Chat channel the huddle was started in. */
async function projectOfMeeting(env: Env, meetingId: string): Promise<ProjectRow | null> {
  const l = await env.DB.prepare('SELECT channel_id FROM chat_meetings WHERE meeting_id = ?').bind(meetingId).first<{ channel_id: string }>().catch(() => null);
  return l ? projectOfChannel(env, l.channel_id) : null;
}

/** Who creates the task: the host when the host may add to the project, else the project's lead. */
async function creatorFor(env: Env, m: MeetingRow, project: ProjectRow | null): Promise<Actor> {
  const host: Actor = { email: lower(m.host_email), name: m.host_name || m.host_email, admin: false };
  if (!project) return host;
  const member = lower(project.lead_email) === host.email || !!(await env.DB.prepare('SELECT 1 AS ok FROM hub_project_members WHERE project_id = ? AND email = ?').bind(project.id, host.email).first());
  return member ? host : { email: lower(project.lead_email), name: project.lead_email, admin: false };
}

async function make(env: Env, m: MeetingRow, a: ActionRow, owner: string | null, project: ProjectRow | null, actor: Actor): Promise<{ task: TaskRow; existing: boolean }> {
  const day = (m.started_at || m.created_at).slice(0, 10);
  const when = a.due ? parseWhen(a.due, new Date(day + 'T12:00:00Z')) : null;
  const where = `${ORIGIN}/meet/notes/?m=${m.id}`;
  const made = await createTask(env, actor, {
    title: a.text.slice(0, 300),
    project_id: project?.id,
    owner_email: owner || undefined,
    due_date: when || undefined,
    description: `From the meeting "${m.title || 'Meeting'}", ${a.t ? `at ${stamp(a.t)} in the transcript` : 'in the notes'}: ${where}${a.due && !when ? `\nDue, as said in the meeting: ${a.due}` : ''}`,
    meeting_id: m.id,
    meeting_action_idx: a.idx,
  });
  if (!made.existing) await fire(env, { kind: 'task.created', actor: actor.email, actorName: actor.name, task: made.task, project: made.project, detail: { from: 'meeting', meeting: m.id, idx: a.idx }, told: made.told });
  return { task: made.task, existing: made.existing };
}

export async function autoOn(env: Env): Promise<boolean> {
  if ((await projectsMode(env)) === 'off') return false;
  return lower(await effective(env, 'projects.meet.auto', undefined, 'on').catch(() => 'on')) !== 'off';
}

/** Called when a meeting's notes have just been made. Items with a named owner who is on the staff list become tasks. Returns how many. */
export async function meetActionsToTasks(env: Env, meetingId: string): Promise<number> {
  try {
    if (!(await autoOn(env))) return 0;
    await env.DB.prepare('SELECT id FROM hub_tasks LIMIT 1').first();
    const m = await meetingOf(env, meetingId);
    const dir = await dirMap(env);
    const rows = (await env.DB.prepare('SELECT idx, text, owner_name, owner_email, due, t, done FROM hub_meeting_actions WHERE meeting_id = ? ORDER BY idx').bind(meetingId).all<ActionRow>()).results || [];
    const project = await projectOfMeeting(env, meetingId);
    const actor = await creatorFor(env, m, project);
    let n = 0;
    for (const a of rows) {
      const owner = lower(a.owner_email);
      if (!owner || !FAVOR.test(owner) || !dir.has(owner) || !a.text.trim()) continue;
      try {
        const r = await make(env, m, a, owner, project, actor);
        if (!r.existing) n++;
      } catch (err) {
        console.warn('[projects] meeting action', meetingId, a.idx, err);
      }
    }
    return n;
  } catch (err) {
    console.warn('[projects] meeting tasks', err);
    return 0;
  }
}

/** One item to a task, on a press. The owner defaults to the person pressing. */
export async function makeActionTask(env: Env, actor: Actor, input: { meeting_id: string; idx: number; owner?: string | null; project?: string | null }): Promise<{ task: TaskRow; project: ProjectRow | null; existing: boolean }> {
  const m = await meetingOf(env, String(input.meeting_id));
  const a = await env.DB.prepare('SELECT idx, text, owner_name, owner_email, due, t, done FROM hub_meeting_actions WHERE meeting_id = ? AND idx = ?').bind(m.id, Number(input.idx)).first<ActionRow>();
  if (!a) throw new HttpError(404, 'not_found', 'That action item is not there.');
  const project = input.project ? await projectOf(env, String(input.project)) : await projectOfMeeting(env, m.id);
  const owner = lower(input.owner) || lower(a.owner_email) || actor.email;
  const r = await make(env, m, a, owner, project, actor);
  return { task: r.task, project, existing: r.existing };
}

/** Which action items of a meeting already have a task, for the notes page. */
export async function actionTasks(env: Env, meetingId: string): Promise<Record<number, { id: string; code: string | null; status: string; url: string; owner: string }>> {
  const rows = (await env.DB.prepare(
    `SELECT t.meeting_action_idx AS idx, t.id, t.code, t.status, t.owner_email, p.key AS pkey FROM hub_tasks t LEFT JOIN hub_projects p ON p.id = t.project_id
      WHERE t.meeting_id = ? AND t.meeting_action_idx IS NOT NULL AND t.status <> 'dropped'`
  ).bind(meetingId).all<{ idx: number; id: string; code: string | null; status: string; owner_email: string | null; pkey: string | null }>().catch(() => ({ results: [] as never[] }))).results || [];
  const dir = await dirMap(env);
  const out: Record<number, { id: string; code: string | null; status: string; url: string; owner: string }> = {};
  for (const r of rows) out[r.idx] = { id: r.id, code: r.code, status: r.status, owner: nameOf(dir, r.owner_email), url: r.pkey && r.code ? `/projects/p/?p=${r.pkey}&t=${r.code}` : `/projects/?t=${r.id}` };
  return out;
}

/** A tick on the meeting's item ticks its task. Called from the Meetings tick route; never throws. */
export async function actionTicked(env: Env, actor: Actor, meetingId: string, idx: number, done: boolean): Promise<void> {
  try {
    const t = await env.DB.prepare(`SELECT id, status FROM hub_tasks WHERE meeting_id = ? AND meeting_action_idx = ? AND status <> 'dropped' LIMIT 1`).bind(meetingId, idx).first<{ id: string; status: string }>();
    if (!t || (done ? t.status === 'done' : t.status !== 'done')) return;
    const r = await patchTask(env, { ...actor, admin: true }, t.id, { done });
    if (r.changed.length) await fire(env, { kind: done ? 'task.done' : 'task.reopened', actor: actor.email, actorName: actor.name, task: r.task, project: r.project, detail: { fields: r.changed, from: 'meeting' }, told: r.told });
  } catch (err) {
    console.warn('[projects] tick task', err);
  }
}

/** A task made from a meeting item is done or reopened: the item follows. */
export async function taskTicked(env: Env, t: TaskRow): Promise<void> {
  if (!t.meeting_id || t.meeting_action_idx === null || t.meeting_action_idx === undefined) return;
  const done = t.status === 'done';
  await env.DB.prepare('UPDATE hub_meeting_actions SET done = ?, done_at = ? WHERE meeting_id = ? AND idx = ?').bind(done ? 1 : 0, done ? new Date().toISOString() : null, t.meeting_id, t.meeting_action_idx).run().catch(() => undefined);
}

/** The meeting and transcript moment a task came from, for the task panel. */
export async function meetingOfTask(env: Env, t: Pick<TaskRow, 'meeting_id' | 'meeting_action_idx'>): Promise<{ id: string; title: string; at: number; stamp: string; url: string } | null> {
  if (!t.meeting_id) return null;
  const m = await env.DB.prepare('SELECT title FROM hub_meetings WHERE id = ?').bind(t.meeting_id).first<{ title: string }>().catch(() => null);
  if (!m) return null;
  const a = t.meeting_action_idx === null || t.meeting_action_idx === undefined ? null : await env.DB.prepare('SELECT t FROM hub_meeting_actions WHERE meeting_id = ? AND idx = ?').bind(t.meeting_id, t.meeting_action_idx).first<{ t: number }>().catch(() => null);
  const at = Number(a?.t) || 0;
  return { id: t.meeting_id, title: m.title || 'Meeting', at, stamp: at ? stamp(at) : '', url: `/meet/notes/?m=${t.meeting_id}${at ? `&t=${at}` : ''}` };
}
