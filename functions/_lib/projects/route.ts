// The Projects router. One function answers /api/projects/* and /api/tasks/* so tests can call it with a stand-in database.
//   GET  projects                         my projects and my task counts          POST projects              make one
//   GET  projects/:id (id or key)         the project, sections, members, counts  PATCH projects/:id         change it or archive it
//   POST projects/:id/sections            PATCH/DELETE projects/:id/sections/:sid
//   PUT  projects/:id/members             { add, remove, role }
//   plan, workload and the Friday update: projects/plan/*, projects/workload, projects/:id/status (see plan/route.ts)
//   GET  tasks                            ?project= &owner=me|email &status=open|done|all &from= &to= &q= &parent= &limit= &offset=
//   POST tasks                            make one                                 GET tasks/codes ?kind= &q=
//   GET  tasks/notices                    POST tasks/notices/read { ids | all }
//   GET/PATCH/DELETE tasks/:id            (id or code)   DELETE ?hard=1 for an admin
//   POST tasks/:id/comments               PATCH/DELETE tasks/:id/comments/:cid
//   POST tasks/:id/files                  POST tasks/:id/upload                    DELETE tasks/:id/files/:fid   GET tasks/:id/files/:fid/download
//   PUT  tasks/:id/people                 PUT tasks/:id/deps
import { HttpError, errorJson, handleError, json, type Env } from '../http';
import type { HubUser } from '../session';
import { staffDirectory } from '../people';
import { projectsActor } from './access';
import { KINDS, codesFor, type CodeKind } from './codes';
import { directory, projectOf, projectsReady, type ProjectRow, type TaskRow } from './db';
import { fire, taskRoute } from './hooks';
import { isPlanPath, planRoutes } from './plan/route';
import { noticesFor, readNotices } from './notices';
import { addSection, changeMembers, createProject, deleteSection, listProjects, patchProject, patchSection, projectDetail, shapeProject, countsFor } from './projects';
import {
  addComment,
  addFile,
  changeDeps,
  changePeople,
  createTask,
  decorate,
  deleteComment,
  deleteFile,
  deleteTask,
  depsOf,
  downloadFile,
  editComment,
  listTasks,
  mineCounts,
  patchTask,
  taskAccess,
  taskDetail,
  uploadFile,
} from './tasks';

export interface Ctx {
  request: Request;
  env: Env;
  user: HubUser | null;
  /** ['projects', ...] or ['tasks', ...] */
  path: string[];
  waitUntil: (p: Promise<unknown>) => void;
}

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const b = await request.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
};

export async function handle(ctx: Ctx): Promise<Response> {
  try {
    const [scope, ...rest] = ctx.path;
    if (scope === 'tasks' && rest[0]) {
      const extra = taskRoute(rest[0]);
      if (extra) return await extra({ request: ctx.request, env: ctx.env, user: ctx.user, path: rest, waitUntil: ctx.waitUntil });
    }
    const actor = await projectsActor(ctx.env, ctx.request, ctx.user);
    if (!(await projectsReady(ctx.env))) return errorJson('not_ready', 'Projects are not switched on yet.', 503);
    if (scope === 'projects') return await projectRoutes(ctx, rest, actor);
    if (scope === 'tasks') return await taskRoutes(ctx, rest, actor);
    return errorJson('not_found', 'No such route.', 404);
  } catch (err) {
    return handleError(err);
  }
}

type Actor = Awaited<ReturnType<typeof projectsActor>>;

const notAllowed = () => errorJson('method', 'Not allowed.', 405);

async function projectRoutes(ctx: Ctx, path: string[], actor: Actor): Promise<Response> {
  const { request, env } = ctx;
  const method = request.method.toUpperCase();
  const [id, a, sid] = path;
  if (isPlanPath(path)) return planRoutes({ request, env, user: ctx.user, waitUntil: ctx.waitUntil }, path, actor);
  const ev = (kind: string, project: ProjectRow, detail?: Record<string, unknown>) =>
    fire(env, { kind, actor: actor.email, actorName: actor.name, project, detail }, ctx.waitUntil);

  if (!id) {
    if (method === 'GET') {
      const [projects, mine] = await Promise.all([listProjects(env, actor), mineCounts(env, actor.email)]);
      return json({ ok: true, projects, mine });
    }
    if (method === 'POST') {
      const p = await createProject(env, actor, await body(request));
      await ev('project.created', p);
      const dir = await directory(env);
      return json({ ok: true, project: shapeProject(p, undefined, dir) }, 201);
    }
    return notAllowed();
  }

  if (!a) {
    if (method === 'GET') {
      const d = await projectDetail(env, actor, id);
      return json({ ok: true, project: d.project, sections: d.sections, members: d.members, counts: d.counts, can: { manage: d.standing.manage, edit: d.standing.edit } });
    }
    if (method === 'PATCH') {
      const r = await patchProject(env, actor, id, await body(request));
      if (r.changed.length) await ev('project.updated', r.project, { fields: r.changed });
      const dir = await directory(env);
      const counts = await countsFor(env, [r.project.id]);
      return json({ ok: true, project: shapeProject(r.project, counts.get(r.project.id), dir) });
    }
    return notAllowed();
  }

  if (a === 'sections') {
    if (!sid && method === 'POST') {
      const b = await body(request);
      const section = await addSection(env, actor, id, b.name);
      return json({ ok: true, section }, 201);
    }
    if (sid && method === 'PATCH') return json({ ok: true, section: await patchSection(env, actor, id, sid, await body(request)) });
    if (sid && method === 'DELETE') {
      await deleteSection(env, actor, id, sid);
      return json({ ok: true });
    }
    return notAllowed();
  }

  if (a === 'members' && (method === 'PUT' || method === 'POST' || method === 'PATCH')) {
    const r = await changeMembers(env, actor, id, await body(request));
    if (r.added.length || r.removed.length) await ev('project.updated', r.project, { members: { add: r.added, remove: r.removed } });
    return json({ ok: true, members: r.members });
  }
  if (a === 'members' && method === 'GET') {
    const d = await projectDetail(env, actor, id);
    return json({ ok: true, members: d.members });
  }
  return errorJson('not_found', 'No such route.', 404);
}

/** The task as the lists show it. */
async function shaped(env: Env, row: TaskRow) {
  const [t] = await decorate(env, [row], await directory(env), null);
  return t;
}

async function taskRoutes(ctx: Ctx, path: string[], actor: Actor): Promise<Response> {
  const { request, env } = ctx;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const [id, a, sub, tail] = path;
  const ev = (kind: string, task: TaskRow, project: ProjectRow | null, extra: Record<string, unknown> = {}, told?: string[]) =>
    fire(env, { kind, actor: actor.email, actorName: actor.name, task, project, detail: extra, told }, ctx.waitUntil);

  if (!id) {
    if (method === 'GET') {
      const q = Object.fromEntries(url.searchParams.entries());
      const r = await listTasks(env, actor, q);
      return json({ ok: true, ...r });
    }
    if (method === 'POST') {
      const made = await createTask(env, actor, await body(request));
      if (!made.existing) await ev('task.created', made.task, made.project, {}, made.told);
      return json({ ok: true, task: await shaped(env, made.task), existing: made.existing }, made.existing ? 200 : 201);
    }
    return notAllowed();
  }

  if (id === 'people' && method === 'GET') return json({ ok: true, me: actor.email, people: await staffDirectory(env) });

  if (id === 'codes') {
    if (method !== 'GET') return notAllowed();
    const kind = String(url.searchParams.get('kind') || '').toLowerCase();
    if (!(KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'bad_kind', 'kind must be appeal, source, fund or campaign.');
    const r = await codesFor(env, kind as CodeKind, String(url.searchParams.get('q') || ''), Number(url.searchParams.get('limit')) || 50);
    return json({ ok: true, ...r });
  }

  if (id === 'notices') {
    if (!a && method === 'GET') return json({ ok: true, ...(await noticesFor(env, actor.email)) });
    if (a === 'read' && method === 'POST') {
      const b = await body(request);
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
      if (!b.all && !ids.length && !b.task_id) throw new HttpError(400, 'missing_field', 'Name the notices to mark read, or send all: true.');
      await readNotices(env, actor.email, { ids, all: b.all === true, task_id: b.task_id ? String(b.task_id) : undefined });
      return json({ ok: true, ...(await noticesFor(env, actor.email)) });
    }
    return notAllowed();
  }

  if (!a) {
    if (method === 'GET') return json({ ok: true, ...(await taskDetail(env, actor, id)) });
    if (method === 'PATCH') {
      const r = await patchTask(env, actor, id, await body(request));
      if (r.changed.length) {
        const kind = r.kinds.includes('done') ? 'task.done' : r.kinds.includes('reopened') ? 'task.reopened' : r.kinds.includes('moved') ? 'task.moved' : 'task.updated';
        await ev(kind, r.task, r.project, { fields: r.changed, before: r.before }, r.told);
        if (r.changed.includes('owner_email')) await ev('task.assigned', r.task, r.project, { from: r.before.owner_email, to: r.task.owner_email }, r.told);
        if (r.changed.includes('waiting_on_email') || r.changed.includes('waiting_on_task')) await ev('task.waiting', r.task, r.project, {}, r.told);
      }
      return json({ ok: true, task: await shaped(env, r.task) });
    }
    if (method === 'DELETE') {
      const r = await deleteTask(env, actor, id, url.searchParams.get('hard') === '1');
      await ev('task.deleted', r.task, r.project, { hard: r.hard });
      return json({ ok: true, hard: r.hard });
    }
    return notAllowed();
  }

  if (a === 'comments') {
    if (!sub && method === 'POST') {
      const b = await body(request);
      const r = await addComment(env, actor, id, b);
      await ev('task.comment', r.task, r.project, { comment: r.comment }, r.told);
      return json({ ok: true, comment: r.comment, told: r.told }, 201);
    }
    if (sub && method === 'PATCH') return json({ ok: true, comment: await editComment(env, actor, id, sub, await body(request)) });
    if (sub && method === 'DELETE') {
      await deleteComment(env, actor, id, sub);
      return json({ ok: true });
    }
    return notAllowed();
  }

  if (a === 'files') {
    if (!sub && method === 'POST') {
      const r = await addFile(env, actor, id, await body(request));
      await ev('task.file', r.task, null, { file: r.file });
      return json({ ok: true, file: r.file }, 201);
    }
    if (sub && method === 'GET') return downloadFile(env, actor, id, sub);
    if (sub && method === 'DELETE') {
      await deleteFile(env, actor, id, sub);
      return json({ ok: true });
    }
    return notAllowed();
  }
  if (a === 'upload' && method === 'POST') {
    const r = await uploadFile(env, actor, id, request);
    await ev('task.file', r.task, null, { file: r.file });
    return json({ ok: true, file: r.file }, 201);
  }

  if (a === 'people' && (method === 'PUT' || method === 'POST')) {
    const r = await changePeople(env, actor, id, await body(request));
    await ev('task.people', r.task, null, { add: r.added, remove: r.removed }, r.told);
    return json({ ok: true, people: r.people });
  }
  if (a === 'deps') {
    if (method === 'GET') {
      const { task } = await taskAccess(env, actor, id);
      return json({ ok: true, deps: await depsOf(env, task.id) });
    }
    if (method === 'PUT' || method === 'POST') {
      const r = await changeDeps(env, actor, id, await body(request));
      await ev('task.deps', r.task, null, {});
      return json({ ok: true, deps: r.deps });
    }
  }
  void tail;
  void projectOf;
  return errorJson('not_found', 'No such route.', 404);
}
