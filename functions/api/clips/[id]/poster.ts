// The poster frame the browser captured while recording (a small JPEG).
import { errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { adminOrError, ownClip, posterKey, type ClipsEnv } from '../../../_lib/clips';

export const onRequestPut: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const clip = await ownClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    const data = await request.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > 2 * 1024 * 1024) return errorJson('bad_poster', 'Poster must be under 2 MB.', 413);
    const head = new Uint8Array(data.slice(0, 3));
    if (!(head[0] === 0xff && head[1] === 0xd8)) return errorJson('bad_poster', 'Poster must be a JPEG.', 415);
    await env.CLIPS.put(posterKey(clip.id), data, { httpMetadata: { contentType: 'image/jpeg' } });
    await env.DB.prepare('UPDATE hub_clips SET has_poster = 1, updated_at = ? WHERE id = ?').bind(nowIso(), clip.id).run();
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};
