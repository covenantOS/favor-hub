import { isAdmin, requireAdmin } from '../../../_lib/auth';
import { getRequest, setStatus } from '../../../_lib/db';
import { HttpError, asStatus, asTrimmed, handleError, json, nowIso, type Env } from '../../../_lib/http';
import { notifyRequestDone } from '../../../_lib/notify';
import { hubUserOf } from '../../../_lib/session';
import { actorOf, readable, toldDone } from '../../../_lib/requests/tasks';
import { fullRequest } from '../../../_lib/requests/route';

export const onRequestGet: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    const id = String(params.id || '');
    const actor = actorOf(request, hubUserOf(request));
    const admin = actor ? actor.admin : await isAdmin(env, request);
    // A declined request is for admins and the people on it.
    await readable(env, id, actor || (admin ? { email: '', name: '', admin: true } : null));
    return json({ ok: true, admin, request: await fullRequest(env, id, actor || (admin ? { email: '', name: 'Will', admin: true } : null)) });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPatch: PagesFunction<Env, 'id'> = async ({ request, env, params, waitUntil }) => {
  try {
    await requireAdmin(env, request);
    const actor = actorOf(request, hubUserOf(request));
    // Triage stays with hub admins; the agent key acting as a staff member is that staff member.
    if (actor && !actor.admin) throw new HttpError(401, 'unauthorized', 'Unlock the board to do that.');
    const me = actor || { email: '', name: 'Will', admin: true };
    const id = String(params.id || '');
    const body = (await request.json()) as {
      status?: unknown;
      title?: unknown;
      body?: unknown;
      declined_reason?: unknown;
    };
    if (body.status) {
      const status = asStatus(body.status);
      const reason = asTrimmed(body.declined_reason, 'declined_reason', 400, false);
      const prev = await getRequest(env, id);
      const row = await setStatus(env, id, status, me.name.split(' ')[0] || 'Will', { declined_reason: reason || undefined });
      if (status === 'done' && prev && prev.status !== 'done') {
        waitUntil(
          notifyRequestDone(env, row, { pageUrl: row.page_url }).catch((err) =>
            console.error('[requests] done notify', err)
          )
        );
        waitUntil(toldDone(env, id, me).catch((err) => console.error('[requests] done notices', err)));
      }
      return json({ ok: true, request: await fullRequest(env, id, me) });
    }
    if (body.title || body.body) {
      const row = await getRequest(env, id);
      if (!row) throw new HttpError(404, 'not_found', 'Request not found');
      const title = asTrimmed(body.title, 'title', 160, false) || row.title;
      const text = asTrimmed(body.body, 'body', 8000, false) || row.body;
      await env.DB.prepare('UPDATE requests SET title = ?, body = ?, updated_at = ? WHERE id = ?')
        .bind(title, text, nowIso(), id)
        .run();
      return json({ ok: true, request: await fullRequest(env, id, me) });
    }
    throw new HttpError(400, 'empty_patch', 'Nothing to update');
  } catch (err) {
    return handleError(err);
  }
};
