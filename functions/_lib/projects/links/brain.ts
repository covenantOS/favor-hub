// Favor Brain's doors into Projects. The Brain is a separate worker (repo favor-mcp); it calls these with the shared key
// (BRAIN_HUB_KEY, header X-Acting-Email names the person), the way it already calls the Sheets door. Everything runs as that person:
// what they may see, and what they may make. The agent key (a script) can also call GET /api/tasks/brain?email=.
//   GET  view=waiting   what is waiting on the person: their open tasks by urgency, tasks waiting on them, unread notices
//   GET  view=shipped   what a team, project or person finished lately (days, team, project, person)
//   GET  view=projects  the projects the person can open, with open and late counts
//   POST action=create  "make a task for Megan to reorder Partner Care cards": title, owner (email or name), project, due, note
import { HttpError, errorJson, handleError, json, timingSafeEqualStr, type Env } from '../../http';
import { actorOf, modeAllows, projectsMode, visibleProject, visibleTask, type Actor } from '../access';
import { lower, projectOf } from '../db';
import { fire } from '../hooks';
import { createTask } from '../tasks';
import { staffDirectory, type Person } from '../../people';
import { hubUserOf } from '../../session';
import { parseWhen } from './chat';
import { FAVOR, ORIGIN, STATUS_WORD, addDays, dueLabel, nameOf, dirMap, taskUrl, todayEt } from './shared';

export interface BrainTask {
  code: string | null;
  title: string;
  status: string;
  owner: string;
  owner_email: string | null;
  project: string;
  project_key: string | null;
  due: string | null;
  late: boolean;
  done_at: string | null;
  done_by: string;
  url: string;
}

/** The person the Brain speaks for: a Favor address that is not blocked. Admin rights come from the hub, never from the Brain. */
async function actingActor(env: Env, emailRaw: string): Promise<Actor> {
  const email = lower(emailRaw);
  if (!FAVOR.test(email)) throw new HttpError(403, 'forbidden', 'Only Favor staff can use tasks.');
  const row = await env.DB.prepare('SELECT name, role, blocked FROM hub_users WHERE lower(email) = ?').bind(email).first<{ name: string; role: string; blocked: number }>().catch(() => null);
  if (row?.blocked) throw new HttpError(403, 'forbidden', 'That person is blocked in FavorOS.');
  const dir = await dirMap(env);
  const admin = row?.role === 'admin';
  const actor: Actor = { email, name: row?.name || nameOf(dir, email), admin };
  if (!modeAllows(await projectsMode(env), { admin })) throw new HttpError(403, 'forbidden', 'Projects is not open to this person yet.');
  return actor;
}

const line = (dir: Map<string, Person>, r: Record<string, any>, today: string): BrainTask => ({
  code: r.code, title: r.title, status: STATUS_WORD[r.status] || r.status, owner: r.owner_email ? nameOf(dir, r.owner_email) : '', owner_email: r.owner_email,
  project: r.pname || '', project_key: r.pkey, due: r.due_date ? dueLabel(r.due_date, r.due_time) : null, late: !!r.due_date && r.due_date < today && r.status !== 'done',
  done_at: r.done_at, done_by: r.done_by ? nameOf(dir, r.done_by) : '', url: ORIGIN + taskUrl(r, r.pkey ? { key: r.pkey } : null),
});

const SEL = `SELECT t.id, t.code, t.title, t.status, t.owner_email, t.due_date, t.due_time, t.done_at, t.done_by, p.key AS pkey, p.name AS pname, p.team AS pteam
  FROM hub_tasks t LEFT JOIN hub_projects p ON p.id = t.project_id`;

export async function brainRead(env: Env, actor: Actor, q: URLSearchParams): Promise<Record<string, unknown>> {
  const view = q.get('view') || 'waiting';
  const dir = await dirMap(env);
  const today = todayEt();
  const vt = visibleTask(actor, 't');
  if (view === 'projects') {
    const vp = visibleProject(actor, 'p');
    const rows = (await env.DB.prepare(
      `SELECT p.key, p.name, p.team, p.status, p.lead_email,
         (SELECT COUNT(*) FROM hub_tasks t WHERE t.project_id = p.id AND t.status NOT IN ('done','dropped')) AS open,
         (SELECT COUNT(*) FROM hub_tasks t WHERE t.project_id = p.id AND t.status NOT IN ('done','dropped') AND t.due_date < ?) AS late
         FROM hub_projects p WHERE p.status <> 'archived' AND ${vp.sql} ORDER BY p.name LIMIT 100`
    ).bind(today, ...vp.args).all<Record<string, any>>()).results || [];
    return { ok: true, view, today, projects: rows.map((r) => ({ key: r.key, name: r.name, team: r.team, status: r.status, lead: nameOf(dir, r.lead_email), open: r.open, late: r.late, url: `${ORIGIN}/projects/p/?p=${r.key}` })) };
  }
  if (view === 'shipped') {
    const days = Math.max(1, Math.min(90, Number(q.get('days')) || 7));
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const team = lower(q.get('team'));
    const projectKey = String(q.get('project') || '').toUpperCase();
    const person = lower(q.get('person'));
    const rows = (await env.DB.prepare(`${SEL} WHERE t.status = 'done' AND t.done_at >= ? AND ${vt.sql} ORDER BY t.done_at DESC LIMIT 400`).bind(since, ...vt.args).all<Record<string, any>>()).results || [];
    const keep = rows.filter((r) => {
      if (projectKey && r.pkey !== projectKey) return false;
      if (team && !(lower(r.pteam) === team || lower(dir.get(lower(r.owner_email))?.team || '').includes(team) || lower(r.pteam).includes(team))) return false;
      if (person && !(lower(r.owner_email) === person || lower(nameOf(dir, r.owner_email)).includes(person))) return false;
      return true;
    });
    const by: Record<string, number> = {};
    for (const r of keep) by[nameOf(dir, r.owner_email) || 'Nobody'] = (by[nameOf(dir, r.owner_email) || 'Nobody'] || 0) + 1;
    return { ok: true, view, today, days, total: keep.length, by_owner: by, tasks: keep.slice(0, 60).map((r) => line(dir, r, today)) };
  }
  // waiting: everything the person owes or is owed an answer on.
  const me = actor.email;
  const mine = (await env.DB.prepare(`${SEL} WHERE t.owner_email = ? AND t.status NOT IN ('done','dropped') ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date, t.id LIMIT 80`).bind(me).all<Record<string, any>>()).results || [];
  const waitingOnMe = (await env.DB.prepare(`${SEL} WHERE t.waiting_on_email = ? AND t.status NOT IN ('done','dropped') ORDER BY t.updated_at DESC LIMIT 40`).bind(me).all<Record<string, any>>()).results || [];
  const unread = Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_task_notices WHERE email = ? AND read_at IS NULL').bind(me).first<{ n: number }>())?.n) || 0;
  return {
    ok: true, view, today,
    summary: { open: mine.length, late: mine.filter((r) => r.due_date && r.due_date < today).length, due_today: mine.filter((r) => r.due_date === today).length, due_this_week: mine.filter((r) => r.due_date && r.due_date > today && r.due_date <= addDays(today, 7)).length, waiting_on_you: waitingOnMe.length, unread_notices: unread },
    mine: mine.map((r) => line(dir, r, today)),
    waiting_on_you: waitingOnMe.map((r) => line(dir, r, today)),
  };
}

/** A person named in words: an email, a full name, or a first name that matches one person. */
export async function resolvePerson(env: Env, who: string): Promise<{ email: string } | { candidates: Array<{ email: string; name: string }> }> {
  const w = String(who || '').trim().toLowerCase();
  if (FAVOR.test(w)) return { email: w };
  const people = await staffDirectory(env);
  const full = people.filter((p) => p.name.toLowerCase() === w);
  if (full.length === 1) return { email: full[0].email };
  const first = people.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === w.split(/\s+/)[0] && (w.split(/\s+/).length === 1 || p.name.toLowerCase().includes(w)));
  if (first.length === 1) return { email: first[0].email };
  const near = (first.length ? first : people.filter((p) => p.name.toLowerCase().includes(w))).slice(0, 6);
  return { candidates: near.map((p) => ({ email: p.email, name: p.name })) };
}

export async function brainCreate(env: Env, actor: Actor, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  const title = String(b.title || '').trim();
  if (!title) throw new HttpError(400, 'missing_field', 'Say what the task is.');
  let owner = actor.email;
  if (b.owner) {
    const r = await resolvePerson(env, String(b.owner));
    if ('candidates' in r) {
      return { ok: false, error: r.candidates.length ? 'ambiguous_person' : 'unknown_person', message: r.candidates.length ? `More than one person fits "${b.owner}". Ask which one.` : `No one on the staff list is named "${b.owner}".`, candidates: r.candidates };
    }
    owner = r.email;
  }
  const project = b.project ? await projectOf(env, String(b.project)).catch(() => null) : null;
  if (b.project && !project) return { ok: false, error: 'unknown_project', message: `No project has the key or id "${b.project}".` };
  const due = b.due ? (parseWhen(String(b.due)) || null) : null;
  if (b.due && !due) return { ok: false, error: 'bad_date', message: `Could not read "${b.due}" as a date. Use a day name or YYYY-MM-DD.` };
  const made = await createTask(env, actor, {
    title: title.slice(0, 300), owner_email: owner, project_id: project?.id, due_date: due || undefined,
    description: `${b.note ? String(b.note).slice(0, 2000) + '\n\n' : ''}Made by ${actor.name} through Favor Brain.`,
  });
  if (!made.existing) await fire(env, { kind: 'task.created', actor: actor.email, actorName: actor.name, task: made.task, project: made.project, detail: { from: 'brain' }, told: made.told });
  const dir = await dirMap(env);
  return {
    ok: true,
    task: { code: made.task.code, title: made.task.title, owner: nameOf(dir, made.task.owner_email), owner_email: made.task.owner_email, project: made.project?.name || '', due: made.task.due_date ? dueLabel(made.task.due_date, made.task.due_time) : null, url: ORIGIN + taskUrl(made.task, made.project) },
    told: made.told.length > 0,
  };
}

/** One handler for both doors. `acting` is who the call speaks for. */
async function answer(env: Env, request: Request, acting: string): Promise<Response> {
  const actor = await actingActor(env, acting);
  const url = new URL(request.url);
  if (request.method === 'GET') return json(await brainRead(env, actor, url.searchParams));
  if (request.method === 'POST') {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (b.action && b.action !== 'create') throw new HttpError(400, 'bad_action', 'The only action is create.');
    const out = await brainCreate(env, actor, b);
    return json(out, out.ok === false ? 409 : 201);
  }
  return errorJson('method', 'Not allowed.', 405);
}

/** /api/service/tasks/brain: the Brain's shared key, acting as the person in X-Acting-Email. */
export async function serviceDoor(env: Env, request: Request): Promise<Response> {
  try {
    const key = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.BRAIN_HUB_KEY || !key || !timingSafeEqualStr(key, env.BRAIN_HUB_KEY)) return errorJson('signin', 'Not allowed.', 401);
    return await answer(env, request, request.headers.get('X-Acting-Email') || '');
  } catch (err) {
    return handleError(err);
  }
}

/** /api/tasks/brain: a signed-in person for themselves, or the agent key for ?email=. */
export async function agentDoor(env: Env, request: Request): Promise<Response> {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const asked = lower(new URL(request.url).searchParams.get('email'));
    const acting = user.via === 'agent' ? asked || lower(request.headers.get('X-Act-As')) : user.email;
    void actorOf;
    return await answer(env, request, acting);
  } catch (err) {
    return handleError(err);
  }
}
