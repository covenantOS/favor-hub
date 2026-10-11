import { checkRateAndCreate } from '../_lib/create';
import { attachmentsFor, listRequests, publicShape } from '../_lib/db';
import { handleError, json, type Env } from '../_lib/http';
import { hubUserOf } from '../_lib/session';
import { isAdmin } from '../_lib/auth';
import { actorOf, tasksFor, tasksReady } from '../_lib/requests/tasks';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const actor = actorOf(request, hubUserOf(request));
    // The agent key acting as a staff member sees the board as that person does.
    const admin = actor ? actor.admin : await isAdmin(env, request);
    const rows = await listRequests(env, admin);
    const ids = rows.map((r) => r.id);
    const [atts, tasks] = await Promise.all([attachmentsFor(env, ids), tasksFor(env, ids, actor?.email || '').catch(() => new Map())]);
    return json({
      ok: true,
      admin,
      me: actor ? { email: actor.email, name: actor.name } : null,
      tasks: tasks.size > 0 || (await tasksReady(env)),
      requests: rows.map((r) => ({ ...publicShape(r, atts.get(r.id) || [], [], admin), task: tasks.get(r.id) || null })),
    });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  return checkRateAndCreate(ctx);
};
