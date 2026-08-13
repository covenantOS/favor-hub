import { isAdmin, requireAdmin } from '../../../_lib/auth';
import { attachmentsFor, eventsFor, getRequest, publicShape, setStatus } from '../../../_lib/db';
import { HttpError, asStatus, asTrimmed, handleError, json, nowIso, type Env } from '../../../_lib/http';

export const onRequestGet: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    const id = String(params.id || '');
    const row = await getRequest(env, id);
    if (!row) throw new HttpError(404, 'not_found', 'Request not found');
    const admin = await isAdmin(env, request);
    if (row.status === 'declined' && !admin) throw new HttpError(404, 'not_found', 'Request not found');
    const [atts, events] = await Promise.all([attachmentsFor(env, [id]), eventsFor(env, id)]);
    return json({ ok: true, admin, request: publicShape(row, atts.get(id) || [], events, admin) });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPatch: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    await requireAdmin(env, request);
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
      const row = await setStatus(env, id, status, 'Will', { declined_reason: reason || undefined });
      const [atts, events] = await Promise.all([attachmentsFor(env, [id]), eventsFor(env, id)]);
      return json({ ok: true, request: publicShape(row, atts.get(id) || [], events, true) });
    }
    if (body.title || body.body) {
      const row = await getRequest(env, id);
      if (!row) throw new HttpError(404, 'not_found', 'Request not found');
      const title = asTrimmed(body.title, 'title', 160, false) || row.title;
      const text = asTrimmed(body.body, 'body', 8000, false) || row.body;
      await env.DB.prepare('UPDATE requests SET title = ?, body = ?, updated_at = ? WHERE id = ?')
        .bind(title, text, nowIso(), id)
        .run();
      const next = await getRequest(env, id);
      const [atts, events] = await Promise.all([attachmentsFor(env, [id]), eventsFor(env, id)]);
      return json({ ok: true, request: publicShape(next!, atts.get(id) || [], events, true) });
    }
    throw new HttpError(400, 'empty_patch', 'Nothing to update');
  } catch (err) {
    return handleError(err);
  }
};
