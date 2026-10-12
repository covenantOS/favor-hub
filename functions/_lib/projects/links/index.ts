// Lane LINKS: everything that ties projects and tasks into the rest of the hub.
//   registerLinks()  hangs the Chat, Calendar, email and Meetings follow-ups on the project events (hooks.ts calls it once)
//   linksRoute()     the routes under /api/tasks/links/*: search, bell, prefs, a project's channel and folder, a task's links panel,
//                    making tasks from Chat and from meeting action items, pickers for Drive, clips and expense requests
// Each module is documented in its own file. Nothing here notifies anyone the notice gate does not allow.
import { HttpError, errorJson, handleError, json, type Env } from '../../http';
import { accessToken, hasScopes } from '../../hub/google';
import { driveSearch, type ChatRouteEnv } from '../../chat/route';
import { projectsActor, projectStanding, type Actor } from '../access';
import { lower, projectOf, type ProjectRow, type TaskRow } from '../db';
import type { ProjectEvent, RouteCtx } from '../hooks';
import { addFile, addComment, taskAccess } from '../tasks';
import * as chat from './chat';
import { dailyPass, getPrefs, mailFresh, setPrefs } from './email';
import { expenseOfTask, linkExpense, myExpenses } from './expense';
import { calendarStatus, syncTask, CALENDAR_SCOPE } from './gcal';
import { actionTasks, actionTicked, makeActionTask, meetingOfTask, taskTicked } from './meet';
import { ensureProjectFolder, folderFiles, myClips } from './drive';
import { bellFor, searchFor } from './today';
import { agentDoor } from './brain';
import { FAVOR, taskUrl } from './shared';

type Waiter = (p: Promise<unknown>) => void;

/* ------------------------------------------------------------------------------------------------ hooks */

/** What each project event sets going. A step that fails is logged and never undoes the change. */
export async function onProjectEvent(env: Env, ev: ProjectEvent): Promise<void> {
  const steps: Array<Promise<unknown>> = [];
  const t = ev.task as TaskRow | null | undefined;
  const run = (name: string, p: Promise<unknown>) => p.catch((err) => console.error(`[projects] ${name}`, ev.kind, err));
  steps.push(run('chat', chat.onEvent(env, ev)));
  if (t && ['task.created', 'task.updated', 'task.done', 'task.reopened', 'task.assigned', 'task.deleted'].includes(ev.kind)) {
    const prev = ev.kind === 'task.assigned' ? ((ev.detail?.from as string | null) ?? null) : ((ev.detail?.before as TaskRow | undefined)?.owner_email ?? null);
    steps.push(run('calendar', syncTask(env, t.id, prev)));
  }
  if (t && (ev.kind === 'task.done' || ev.kind === 'task.reopened') && ev.detail?.from !== 'meeting') steps.push(run('meeting', taskTicked(env, t)));
  if (ev.project?.chat_channel_id && ev.kind === 'project.updated' && ev.detail?.members) steps.push(run('channel', chat.ensureProjectChannel(env, ev.project, ev.actor)));
  await Promise.all(steps);
  if (ev.told?.length) await run('mail', mailFresh(env));
}

export function registerLinks(register: (h: (env: Env, ev: ProjectEvent) => Promise<void> | void) => void): void {
  register(onProjectEvent);
}

/* ------------------------------------------------------------------------------------------------ routes */

const bodyOf = async (request: Request): Promise<Record<string, unknown>> => {
  const b = await request.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
};

async function visibleProjectOf(env: Env, actor: Actor, ref: string): Promise<ProjectRow> {
  const p = await projectOf(env, ref);
  if (!(await projectStanding(env, actor, p)).see) throw new HttpError(404, 'not_found', 'Project not found.');
  return p;
}

/** Everything the task panel shows about the task's links, in one read. */
async function linksOf(env: Env, actor: Actor, ref: string) {
  const { task, project, st } = await taskAccess(env, actor, ref);
  const cards = (await env.DB.prepare(`SELECT l.channel_id, MAX(l.message_id) AS message_id, c.kind, c.name FROM hub_task_chat_links l JOIN chat_channels c ON c.id = l.channel_id WHERE l.task_id = ? AND l.kind = 'card' GROUP BY l.channel_id`).bind(task.id).all<{ channel_id: string; message_id: number; kind: string; name: string }>().catch(() => ({ results: [] as never[] }))).results || [];
  const files = (await env.DB.prepare(`SELECT id, kind, name, url, ref_id FROM hub_task_files WHERE task_id = ? AND kind = 'clip'`).bind(task.id).all<{ id: string; kind: string; name: string; url: string; ref_id: string | null }>().catch(() => ({ results: [] as never[] }))).results || [];
  return {
    ok: true,
    task: { id: task.id, code: task.code, url: taskUrl(task, project) },
    can: { edit: st.edit },
    project: project ? { id: project.id, key: project.key, name: project.name, chat_channel_id: project.chat_channel_id, drive_folder_id: project.drive_folder_id, drive_url: project.drive_folder_id ? `https://drive.google.com/drive/folders/${project.drive_folder_id}` : null } : null,
    chat: { shared_in: cards.map((c) => ({ channel_id: c.channel_id, name: c.kind === 'public' || c.kind === 'private' ? '#' + c.name : 'Direct message', kind: c.kind, url: `/chat/?c=${encodeURIComponent(c.channel_id)}&m=${c.message_id}` })) },
    meeting: await meetingOfTask(env, task),
    expense: await expenseOfTask(env, task.expense_id),
    calendar: await calendarStatus(env, task.id),
    clips: files.map((f) => ({ file_id: f.id, clip_id: f.ref_id, name: f.name, url: f.ref_id ? `/c/${f.ref_id}` : f.url })),
  };
}

export async function linksRoute(ctx: RouteCtx): Promise<Response> {
  const { request, env } = ctx;
  try {
    const actor = await projectsActor(env, request, ctx.user);
    const method = request.method.toUpperCase();
    const url = new URL(request.url);
    const [, a, b, c] = ctx.path;
    const wait: Waiter = ctx.waitUntil;
    const fireEv = async (kind: string, actorX: Actor, task: TaskRow, project: ProjectRow | null, detail: Record<string, unknown> = {}, told: string[] = []) => {
      const { fire } = await import('../hooks');
      await fire(env, { kind, actor: actorX.email, actorName: actorX.name, task, project, detail, told }, wait);
    };

    if (a === 'search' && method === 'GET') return json({ ok: true, hits: await searchFor(env, request, ctx.user, url.searchParams.get('q') || '') });
    if (a === 'bell' && method === 'GET') return json({ ok: true, ...(await bellFor(env, ctx.user!)) });

    if (a === 'prefs') {
      if (method === 'PUT' || method === 'POST') {
        const d = await bodyOf(request);
        try {
          await setPrefs(env, actor.email, d);
        } catch {
          throw new HttpError(400, 'bad_mode', 'Choose now, daily or off.');
        }
      }
      const p = await getPrefs(env, actor.email);
      const g = await accessToken(env, actor.email).catch(() => null);
      return json({ ok: true, ...p, google: { connected: !!g, calendar: !!g && hasScopes(g.scopes, [CALENDAR_SCOPE]) }, connect_url: '/api/google/connect?add=meet&next=' + encodeURIComponent('/projects/') });
    }

    if (a === 'project' && b) {
      const p = await visibleProjectOf(env, actor, b);
      const st = await projectStanding(env, actor, p);
      if (c === 'channel' && method === 'POST') {
        if (!st.edit) throw new HttpError(403, 'forbidden', 'Only people on the project open its channel.');
        const ch = await chat.ensureProjectChannel(env as never, p, actor.email);
        return json({ ok: true, channel: { id: ch.id, name: ch.name }, created: ch.created, url: `/chat/?c=${encodeURIComponent(ch.id)}` });
      }
      if (c === 'folder' && method === 'POST') {
        if (!st.edit) throw new HttpError(403, 'forbidden', 'Only people on the project open its folder.');
        return json({ ok: true, folder: await ensureProjectFolder(env, p) });
      }
      if (c === 'files' && method === 'GET') return json({ ok: true, files: await folderFiles(env, p, url.searchParams.get('q') || ''), folder_url: p.drive_folder_id ? `https://drive.google.com/drive/folders/${p.drive_folder_id}` : null });
    }

    if (a === 'task' && b) {
      if (!c && method === 'GET') return json(await linksOf(env, actor, b));
      if (c === 'links' && method === 'GET') return json(await linksOf(env, actor, b));
      if (c === 'chat' && method === 'POST') {
        const d = await bodyOf(request);
        let channel = String(d.channel_id || '');
        if (!channel) {
          const { project } = await taskAccess(env, actor, b);
          if (!project) throw new HttpError(400, 'no_channel', 'Pick a conversation to share it in.');
          channel = (await chat.ensureProjectChannel(env as never, project, actor.email)).id;
        }
        const id = await chat.shareTask(env as never, actor, b, channel);
        return json({ ok: true, message_id: id, url: `/chat/?c=${encodeURIComponent(channel)}&m=${id}` }, 201);
      }
      if (c === 'expense' && (method === 'PUT' || method === 'POST')) {
        const d = await bodyOf(request);
        const exp = await linkExpense(env, actor, b, d.expense_id ? String(d.expense_id) : null);
        return json({ ok: true, expense: exp });
      }
      if (c === 'clip' && method === 'POST') {
        const d = await bodyOf(request);
        const clipId = String(d.clip_id || '');
        if (!/^[0-9a-f]{32}$/.test(clipId)) throw new HttpError(400, 'bad_clip', 'Pick a clip.');
        const as = d.as === 'proof' ? 'proof' : 'brief';
        const mine = await env.DB.prepare('SELECT title FROM hub_clips WHERE id = ? AND lower(owner_email) = ?').bind(clipId, actor.email).first<{ title: string }>().catch(() => null);
        if (!mine && !actor.admin) throw new HttpError(403, 'forbidden', 'You can attach your own clips.');
        const label = as === 'proof' ? 'Proof' : 'Brief';
        const dupe = await env.DB.prepare(`SELECT id FROM hub_task_files WHERE task_id = (SELECT id FROM hub_tasks WHERE id = ? OR code = ?) AND kind = 'clip' AND ref_id = ?`).bind(b, b.toUpperCase(), clipId).first().catch(() => null);
        if (dupe) return json({ ok: true, existing: true });
        const r = await addFile(env, actor, b, { kind: 'clip', name: `${label}: ${mine?.title || 'Clip'}`.slice(0, 200), url: `/c/${clipId}`, ref_id: clipId });
        await fireEv('task.file', actor, r.task, null, { file: r.file });
        if (as === 'proof') {
          const cm = await addComment(env, actor, b, { body: `Proof: ${mine?.title || 'a clip'}\n/c/${clipId}` });
          await fireEv('task.comment', actor, cm.task, cm.project, { comment: cm.comment }, cm.told);
        }
        return json({ ok: true, file: r.file }, 201);
      }
    }

    if (a === 'chat' && b === 'make-task' && method === 'POST') {
      const d = await bodyOf(request);
      const r = await chat.taskFromMessage(env as never, actor, { message_id: Number(d.message_id), title: d.title ? String(d.title) : undefined, project: d.project ? String(d.project) : null, owner: d.owner ? lower(d.owner) : null, due: d.due ? String(d.due) : null });
      return json({ ok: true, existing: r.existing, task: { id: r.task.id, code: r.task.code, title: r.task.title, url: taskUrl(r.task, r.project) } }, r.existing ? 200 : 201);
    }

    if (a === 'meet') {
      if (b === 'action-task' && method === 'POST') {
        const d = await bodyOf(request);
        const r = await makeActionTask(env, actor, { meeting_id: String(d.meeting_id || ''), idx: Number(d.idx), owner: d.owner ? String(d.owner) : null, project: d.project ? String(d.project) : null });
        return json({ ok: true, existing: r.existing, task: { id: r.task.id, code: r.task.code, title: r.task.title, url: taskUrl(r.task, r.project) } }, r.existing ? 200 : 201);
      }
      if (b === 'actions' && method === 'GET') return json({ ok: true, tasks: await actionTasks(env, url.searchParams.get('meeting_id') || '') });
    }

    if (a === 'drive' && method === 'GET') {
      const user = ctx.user!;
      return json({ ok: true, files: await driveSearch(env as unknown as ChatRouteEnv, user, url.searchParams.get('q') || '') });
    }
    if (a === 'clips' && method === 'GET') return json({ ok: true, clips: await myClips(env, actor.email) });
    if (a === 'expense' && b === 'mine' && method === 'GET') return json({ ok: true, expenses: await myExpenses(env, actor.email) });

    return errorJson('not_found', 'No such route.', 404);
  } catch (err) {
    return handleError(err);
  }
}

export { agentDoor, dailyPass, actionTicked, FAVOR };
