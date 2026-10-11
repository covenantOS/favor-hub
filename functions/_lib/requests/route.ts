// The request board's task routes. One router so tests can call it with a stand-in database, like Favor Chat's.
//   GET    people                     the staff list for the pickers (name, team, title, picture)
//   GET    notices                    my unread notices (Today and the bell)
//   POST   notices                    { id } or { request_id } or {}: mark read
//   POST   :id/send                   { to, note }            hand the request to someone
//   POST   :id/comments               { body }                a comment; <@email> mentions
//   DELETE :id/comments/:cid                                  my own comment
//   PATCH  :id/task                   { due_date?, waiting_on? }
//   POST   :id/done | :id/reopen                              for people on the request who are not admins
//   POST   :id/follow                 { on }
//   POST   :id/read                                           my notices on this request are read
import { HttpError, errorJson, handleError, json, type Env } from '../http';
import type { HubUser } from '../session';
import { attachmentsFor, eventsFor, getRequest, publicShape } from '../db';
import { notifyRequestDone } from '../notify';
import { staffDirectory } from '../people';
import {
  actorOf,
  addComment,
  deleteComment,
  detailFor,
  noticesFor,
  participantStatus,
  readNotices,
  readable,
  sendTo,
  setFields,
  setFollowing,
  tasksReady,
  type Actor,
} from './tasks';

export interface Ctx {
  request: Request;
  env: Env;
  user: HubUser | null;
  path: string[];
  waitUntil: (p: Promise<unknown>) => void;
}

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const b = await request.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
};

export async function handle(ctx: Ctx): Promise<Response> {
  try {
    return await route(ctx);
  } catch (err) {
    return handleError(err);
  }
}

/** The request as the drawer shows it, with its task fields, comments and what this person may do. */
export async function fullRequest(env: Env, id: string, actor: Actor | null) {
  const row = await getRequest(env, id);
  if (!row) throw new HttpError(404, 'not_found', 'Request not found');
  const admin = !!actor?.admin;
  const [atts, events, detail] = await Promise.all([attachmentsFor(env, [id]), eventsFor(env, id), detailFor(env, row, actor)]);
  return { ...publicShape(row, atts.get(id) || [], events, admin), ...(detail || {}) };
}

async function route(ctx: Ctx): Promise<Response> {
  const { request, env, path } = ctx;
  const method = request.method.toUpperCase();
  const actor = actorOf(request, ctx.user);
  if (!actor) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
  const [a, b, c] = path;

  if (a === 'people' && !b && method === 'GET') {
    const people = await staffDirectory(env);
    return json({ ok: true, me: actor.email, people });
  }

  if (!(await tasksReady(env))) return errorJson('not_ready', 'Tasks on the board are not switched on yet.', 503);

  if (a === 'notices' && !b) {
    if (method === 'GET') return json({ ok: true, ...(await noticesFor(env, actor.email)) });
    if (method === 'POST') {
      const input = await body(request);
      await readNotices(env, actor.email, { id: Number(input.id) || null, request_id: typeof input.request_id === 'string' ? input.request_id : null });
      return json({ ok: true, ...(await noticesFor(env, actor.email)) });
    }
  }

  if (!a) return errorJson('not_found', 'No such route.', 404);
  const row = await readable(env, a, actor);
  const done = async () => json({ ok: true, request: await fullRequest(env, row.id, actor) });

  if (b === 'send' && method === 'POST') {
    const input = await body(request);
    await sendTo(env, row, actor, input.to, input.note);
    return done();
  }
  if (b === 'comments' && !c && method === 'POST') {
    await addComment(env, row, actor, (await body(request)).body, { source: 'board' });
    return done();
  }
  if (b === 'comments' && c && method === 'DELETE') {
    await deleteComment(env, row, actor, c);
    return done();
  }
  if (b === 'task' && method === 'PATCH') {
    const input = await body(request);
    await setFields(env, row, actor, { due_date: input.due_date, waiting_on: input.waiting_on });
    return done();
  }
  if ((b === 'done' || b === 'reopen') && method === 'POST') {
    const prev = row.status;
    const next = await participantStatus(env, row, actor, b === 'done' ? 'done' : 'in_progress');
    // Completing a request emails the person who asked, as the board always has.
    if (b === 'done' && prev !== 'done') ctx.waitUntil(notifyRequestDone(env, next, { pageUrl: next.page_url }).catch((err) => console.error('[requests] done notify', err)));
    return done();
  }
  if (b === 'follow' && method === 'POST') {
    await setFollowing(env, row.id, actor, (await body(request)).on !== false);
    return done();
  }
  if (b === 'read' && method === 'POST') {
    await readNotices(env, actor.email, { request_id: row.id });
    return json({ ok: true, ...(await noticesFor(env, actor.email)) });
  }
  return errorJson('not_found', 'No such route.', 404);
}
