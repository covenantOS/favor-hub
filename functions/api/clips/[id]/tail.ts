// The tail of a recording: the bytes since the last whole 8 MiB part, sent every few seconds while a clip records. If the
// recorder window closes, the computer sleeps or the connection drops, complete() joins these bytes to the parts already
// stored, so everything up to the last few seconds survives. An empty body only says "still recording" (pause, quiet stretch).
import { errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { adminOrError, ownClip, tailKey, type ClipsEnv } from '../../../_lib/clips';

const MAX_TAIL_PIECE = 4 * 1024 * 1024;

export const onRequestPut: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const clip = await ownClip(env, who.user, String(params.id));
    if (!clip || clip.status !== 'uploading' || !clip.upload_id) return errorJson('not_found', 'That upload is not open.', 404);
    const u = new URL(request.url);
    const off = Number(u.searchParams.get('off'));
    if (!Number.isInteger(off) || off < 0 || off > 4 * 1024 * 1024 * 1024) return errorJson('bad_tail', 'Bad position.', 400);
    const data = await request.arrayBuffer();
    if (data.byteLength > MAX_TAIL_PIECE) return errorJson('bad_tail', 'That piece is too large.', 413);
    if (data.byteLength) await env.CLIPS.put(tailKey(clip.id, off), data);
    const elapsed = Math.round(Number(request.headers.get('x-elapsed')) * 1000);
    if (Number.isFinite(elapsed) && elapsed > clip.duration_ms) {
      await env.DB.prepare('UPDATE hub_clips SET duration_ms = ?, updated_at = ? WHERE id = ?').bind(elapsed, nowIso(), clip.id).run();
    } else {
      await env.DB.prepare('UPDATE hub_clips SET updated_at = ? WHERE id = ?').bind(nowIso(), clip.id).run();
    }
    return json({ ok: true }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
