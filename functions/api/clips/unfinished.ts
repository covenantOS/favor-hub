// My recordings that never completed (a closed tab). The browser finishes them as partial clips on the next page load.
import { staffOrError, J, tailPrefix, type ClipsEnv, type PartRec } from '../../_lib/clips';
import { handleError, json } from '../../_lib/http';

export const onRequestGet: PagesFunction<ClipsEnv> = async ({ request, env }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const rows = await env.DB.prepare("SELECT id, updated_at, duration_ms, parts FROM hub_clips WHERE owner_email = ? AND status = 'uploading' ORDER BY created_at DESC LIMIT 20").bind(who.user.email).all<{ id: string; updated_at: string; duration_ms: number; parts: string }>();
    const clips = [];
    for (const r of rows.results || []) {
      const parts = J<PartRec[]>(r.parts, []).length;
      // A clip with no whole part yet may still hold tail pieces, which is enough to save the first seconds.
      const tail = parts ? 1 : (await env.CLIPS.list({ prefix: tailPrefix(r.id), limit: 1 })).objects.length;
      clips.push({ id: r.id, updatedAt: r.updated_at, durationMs: r.duration_ms, parts, tail: tail ? 1 : 0 });
    }
    return json({ ok: true, clips }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
