// Timestamped comments. Any signed-in staff member may comment on a clip they can watch; the author or an admin may remove one.
import { errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { ID_RE, isWatchable, mayWatch, rowId, staffOrError, type Clip, type ClipsEnv } from '../../../_lib/clips';
import type { HubUser } from '../../../_lib/session';

async function loadClip(env: ClipsEnv, id: string, user: HubUser): Promise<Clip | null> {
  if (!ID_RE.test(id)) return null;
  const c = await env.DB.prepare('SELECT * FROM hub_clips WHERE id = ?').bind(id).first<Clip>();
  return c && isWatchable(c) && (await mayWatch(env, user, c)) ? c : null;
}

export const onRequestPost: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params, waitUntil }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const clip = await loadClip(env, String(params.id), who.user);
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    const b = (await request.json().catch(() => ({}))) as { at?: number; text?: string };
    const text = String(b.text ?? '').trim().slice(0, 2000);
    if (!text) return errorJson('empty', 'Write something first.', 400);
    const at = Math.max(0, Math.min(Number(b.at) || 0, clip.duration_ms / 1000 || 86_400));
    const id = rowId('cm');
    const createdAt = nowIso();
    await env.DB.prepare('INSERT INTO hub_clip_comments (id, clip_id, at_seconds, author_email, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, clip.id, at, who.user.email, who.user.name, text, createdAt).run();
    const comment = { id, at_seconds: at, author_email: who.user.email, author_name: who.user.name, body: text, created_at: createdAt };
    // The comment also lands in the Chat thread and on the task the clip was sent to (functions/_lib/integrations/cliplinks.ts).
    const later = typeof waitUntil === 'function' ? waitUntil : (p: Promise<unknown>) => void p;
    later(import('../../../_lib/integrations/cliplinks').then((m) => m.fromClipComment(env, clip.id, comment, who.user)).catch((err) => console.warn('[clips] mirror', err)));
    return json({ ok: true, comment });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestDelete: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const cid = new URL(request.url).searchParams.get('cid') || '';
    const row = await env.DB.prepare('SELECT id, author_email FROM hub_clip_comments WHERE id = ? AND clip_id = ?').bind(cid, String(params.id)).first<{ id: string; author_email: string }>();
    if (!row) return json({ ok: true });
    if (row.author_email !== who.user.email && who.user.role !== 'admin') return errorJson('forbidden', 'Only the author or an admin can remove a comment.', 403);
    await env.DB.prepare('DELETE FROM hub_clip_comments WHERE id = ?').bind(row.id).run();
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};
