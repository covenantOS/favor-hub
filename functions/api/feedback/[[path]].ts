// Feedback on the hub, Favor Brain and the help docs. Everyone can send a note and see their
// own notes and replies; the hub admin sees every note and marks each one seen, fixed or not now, with
// a reply the sender reads. The give_feedback tool writes to the same table (brain_feedback).
//
//   POST /api/feedback              { source, rating, comment, ref?, page?, question? }
//   GET  /api/feedback/mine         the signed-in person's notes
//   GET  /api/feedback/all?status=  every note (admin)
//   POST /api/feedback/<id>         { status, reply } (admin)
//   POST /api/feedback/<id>/shot    a JPEG of the page, by the sender only (private R2, no caching)
//   GET  /api/feedback/<id>/shot    that picture, to the sender and the hub admin
//   DELETE /api/feedback/<id>/shot  remove the picture, by the sender only
import { errorJson, handleError, json, nowIso, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const MAX_SHOT_BYTES = 1_500_000;

const SOURCES = new Set(['hub', 'brain', 'hub-brain', 'help', 'tour', 'video']);
const RATINGS = new Set(['right', 'wrong', 'confusing', 'missing', 'idea', 'praise', 'problem', 'helpful', 'not-helpful']);
const STATUSES = new Set(['new', 'seen', 'fixed', 'not-now']);

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const path = ([] as string[]).concat((params.path as string[] | string) || []).join('/');
    const admin = user.role === 'admin';

    if (request.method === 'POST' && path === '') {
      const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const source = SOURCES.has(String(b.source)) ? String(b.source) : 'hub';
      const rating = RATINGS.has(String(b.rating)) ? String(b.rating) : null;
      const comment = String(b.comment || '').trim().slice(0, 2000);
      if (!rating && comment.length < 2) return errorJson('empty', 'Pick how it went or write a few words.', 400);
      const ref = String(b.ref || '').trim().toLowerCase().slice(0, 12) || null;
      let question = String(b.question || '').trim().slice(0, 600) || null;
      let reading: string | null = null;
      // A Favor Brain answer reference ties the note to the exact question and how it was read.
      if (ref) {
        const row = await env.DB.prepare('SELECT args, reading FROM mcp_audit WHERE ref = ? AND email = ? ORDER BY id DESC LIMIT 1')
          .bind(ref, user.email)
          .first<{ args: string; reading: string }>()
          .catch(() => null);
        if (row) {
          try {
            question = question || JSON.parse(row.args || '{}').question || null;
          } catch {
            /* the call's arguments were not JSON */
          }
          reading = row.reading || null;
        }
      }
      const page = String(b.page || '').slice(0, 300) || null;
      const res = await env.DB.prepare(
        `INSERT INTO brain_feedback (at, email, name, source, rating, comment, ref, question, reading, page, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`
      )
        .bind(nowIso(), user.email, user.name || user.email, source, rating, comment || null, ref, question, reading, page)
        .run();
      return json({ ok: true, id: res.meta?.last_row_id || null });
    }

    // A screenshot attached to a note. Only the sender attaches or removes one; the sender and the hub admin view it.
    const shotPath = path.match(/^(\d+)\/shot$/);
    if (shotPath) {
      const id = Number(shotPath[1]);
      const row = await env.DB.prepare('SELECT id, email, shot_key FROM brain_feedback WHERE id = ?')
        .bind(id)
        .first<{ id: number; email: string; shot_key: string | null }>();
      if (!row) return errorJson('not_found', 'That note is gone.', 404);
      const mineNote = row.email.toLowerCase() === user.email.toLowerCase();
      if (request.method === 'GET') {
        if (!mineNote && !admin) return errorJson('admin_only', 'Only the hub admin sees every note.', 403);
        const obj = row.shot_key ? await env.UPLOADS.get(row.shot_key) : null;
        if (!obj) return new Response('Not found', { status: 404, headers: PRIVATE_HEADERS });
        return new Response(obj.body, { headers: { ...PRIVATE_HEADERS, 'Content-Type': 'image/jpeg' } });
      }
      if (!mineNote) return errorJson('not_yours', 'Only the person who sent the note can change its picture.', 403);
      if (request.method === 'POST') {
        const bytes = await request.arrayBuffer();
        if (!bytes.byteLength) return errorJson('empty', 'The picture did not arrive. Try again.', 400);
        if (bytes.byteLength > MAX_SHOT_BYTES) return errorJson('too_big', 'That picture is too large. Try again with a smaller area.', 413);
        if (request.headers.get('Content-Type') !== 'image/jpeg') return errorJson('type', 'The picture must be a JPEG.', 415);
        const key = `feedback/${id}.jpg`;
        await env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
        await env.DB.prepare('UPDATE brain_feedback SET shot_key = ? WHERE id = ?').bind(key, id).run();
        return json({ ok: true });
      }
      if (request.method === 'DELETE') {
        if (row.shot_key) await env.UPLOADS.delete(row.shot_key);
        await env.DB.prepare('UPDATE brain_feedback SET shot_key = NULL WHERE id = ?').bind(id).run();
        return json({ ok: true });
      }
      return errorJson('not_found', 'No such feedback route.', 404);
    }

    if (request.method === 'GET' && path === 'mine') {
      const r = await env.DB.prepare(
        `SELECT id, at, source, rating, comment, ref, question, page, status, reply, handled_at,
                CASE WHEN reply IS NOT NULL AND reply_seen_at IS NULL THEN 1 ELSE 0 END AS unread,
                CASE WHEN shot_key IS NOT NULL THEN 1 ELSE 0 END AS has_shot
           FROM brain_feedback WHERE email = ? ORDER BY id DESC LIMIT 50`
      )
        .bind(user.email)
        .all();
      // Opening the list counts as reading the answers in it.
      await env.DB.prepare('UPDATE brain_feedback SET reply_seen_at = ? WHERE email = ? AND reply IS NOT NULL AND reply_seen_at IS NULL')
        .bind(nowIso(), user.email)
        .run();
      return json({ ok: true, items: r.results || [] });
    }

    if (request.method === 'GET' && path === 'all') {
      if (!admin) return errorJson('admin_only', 'Only the hub admin sees every note.', 403);
      const status = new URL(request.url).searchParams.get('status') || '';
      const where = STATUSES.has(status) ? 'WHERE status = ?' : '';
      const r = await env.DB.prepare(
        `SELECT id, at, email, name, source, rating, comment, ref, question, reading, page, status, reply, handled_by, handled_at,
                CASE WHEN shot_key IS NOT NULL THEN 1 ELSE 0 END AS has_shot
           FROM brain_feedback ${where} ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'seen' THEN 1 ELSE 2 END, id DESC LIMIT 300`
      )
        .bind(...(where ? [status] : []))
        .all();
      const counts = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM brain_feedback GROUP BY status').all<{ status: string; n: number }>();
      return json({ ok: true, items: r.results || [], counts: Object.fromEntries((counts.results || []).map((c) => [c.status, c.n])) });
    }

    const id = Number(path);
    if (request.method === 'POST' && Number.isInteger(id) && id > 0) {
      if (!admin) return errorJson('admin_only', 'Only the hub admin answers notes.', 403);
      const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const status = STATUSES.has(String(b.status)) ? String(b.status) : null;
      const reply = b.reply === undefined ? undefined : String(b.reply || '').trim().slice(0, 2000);
      const row = await env.DB.prepare('SELECT id FROM brain_feedback WHERE id = ?').bind(id).first();
      if (!row) return errorJson('not_found', 'That note is gone.', 404);
      await env.DB.prepare(
        `UPDATE brain_feedback SET status = COALESCE(?, status),
                reply = CASE WHEN ? THEN NULLIF(?, '') ELSE reply END,
                reply_seen_at = CASE WHEN ? AND COALESCE(reply, '') <> COALESCE(?, '') THEN NULL ELSE reply_seen_at END,
                handled_by = ?, handled_at = ? WHERE id = ?`
      )
        .bind(status, reply === undefined ? 0 : 1, reply ?? '', reply === undefined ? 0 : 1, reply ?? '', user.email, nowIso(), id)
        .run();
      return json({ ok: true });
    }

    return errorJson('not_found', 'No such feedback route.', 404);
  } catch (err) {
    return handleError(err);
  }
};
