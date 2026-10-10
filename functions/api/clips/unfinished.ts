// My recordings that never completed (a closed tab). The browser finishes them as partial clips on the next page load.
import { adminOrError, J, type ClipsEnv, type PartRec } from '../../_lib/clips';
import { handleError, json } from '../../_lib/http';

export const onRequestGet: PagesFunction<ClipsEnv> = async ({ request, env }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const rows = await env.DB.prepare("SELECT id, updated_at, duration_ms, parts FROM hub_clips WHERE owner_email = ? AND status = 'uploading' ORDER BY created_at DESC LIMIT 20").bind(who.user.email).all<{ id: string; updated_at: string; duration_ms: number; parts: string }>();
    return json({ ok: true, clips: (rows.results || []).map((r) => ({ id: r.id, updatedAt: r.updated_at, durationMs: r.duration_ms, parts: J<PartRec[]>(r.parts, []).length })) }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
