// View tracking. The player posts once when someone presses play, then updates how far they got. The owner's own plays are
// not counted. Someone watching through the share link without signing in is counted as "link".
import { errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { ID_RE, isWatchable, canWatch, rowId, type Clip, type ClipsEnv } from '../../../_lib/clips';
import { hubUserOf } from '../../../_lib/session';

export const onRequestPost: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const id = String(params.id);
    const clip = ID_RE.test(id) ? await env.DB.prepare('SELECT * FROM hub_clips WHERE id = ?').bind(id).first<Clip>() : null;
    if (!clip || !isWatchable(clip) || !(await canWatch(env, request, clip))) return errorJson('not_found', 'That clip does not exist.', 404);
    const user = hubUserOf(request);
    if (user && user.email === clip.owner_email) return json({ ok: true, viewId: null });
    const b = (await request.json().catch(() => ({}))) as { viewId?: string; seconds?: number };
    const seconds = Math.max(0, Math.min(Number(b.seconds) || 0, 86_400));
    const email = user ? user.email : 'link';
    if (b.viewId && /^vw[0-9a-f]{18}$/.test(b.viewId)) {
      await env.DB.prepare('UPDATE hub_clip_views SET seconds = MAX(seconds, ?) WHERE id = ? AND clip_id = ? AND person_email = ?').bind(seconds, b.viewId, id, email).run();
      return json({ ok: true, viewId: b.viewId });
    }
    const viewId = rowId('vw');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO hub_clip_views (id, clip_id, person_email, person_name, at, seconds) VALUES (?, ?, ?, ?, ?, ?)').bind(viewId, id, email, user ? user.name : 'Someone with the link', nowIso(), seconds),
      env.DB.prepare('UPDATE hub_clips SET views = views + 1 WHERE id = ?').bind(id),
    ]);
    return json({ ok: true, viewId });
  } catch (err) {
    return handleError(err);
  }
};
