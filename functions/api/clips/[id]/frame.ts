// A sampled picture of the screen, sent by the recorder every few seconds while it records (and when the screen changes).
// It is read in the background by a vision model (functions/_lib/clipVision.ts), the words are kept on the clip's private
// record and the picture is deleted at once. Only the person who made the clip can send one.
import { errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { frameKey, staffOrError, ownClip, type ClipsEnv } from '../../../_lib/clips';
import { MAX_FRAMES, MAX_FRAME_BYTES, readFrame } from '../../../_lib/clipVision';

export const onRequestPut: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params, waitUntil }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const clip = await ownClip(env, who.user, String(params.id));
    if (!clip || (clip.status !== 'uploading' && clip.status !== 'processing')) return errorJson('not_found', 'That clip is not open.', 404);
    if (clip.kind === 'camera') return json({ ok: true, skipped: 'camera' });
    const t = Number(new URL(request.url).searchParams.get('t'));
    if (!Number.isInteger(t) || t < 0 || t > 3 * 3600 * 1000) return errorJson('bad_frame', 'Bad position.', 400);
    const data = await request.arrayBuffer();
    if (data.byteLength < 200 || data.byteLength > MAX_FRAME_BYTES) return errorJson('bad_frame', 'That picture is the wrong size.', 413);
    const head = new Uint8Array(data, 0, 3);
    if (head[0] !== 0xff || head[1] !== 0xd8) return errorJson('bad_frame', 'Pictures are JPEG.', 415);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_clip_frames WHERE clip_id = ?').bind(clip.id).first<{ n: number }>();
    if ((n?.n || 0) >= MAX_FRAMES) return json({ ok: true, skipped: 'enough' });
    await env.CLIPS.put(frameKey(clip.id, t), data, { httpMetadata: { contentType: 'image/jpeg' } });
    await env.DB.prepare("INSERT OR REPLACE INTO hub_clip_frames (clip_id, t_ms, status, app, page, text, step, created_at) VALUES (?, ?, 'pending', '', '', '', '', ?)").bind(clip.id, t, nowIso()).run();
    // Read it now, while the recording goes on, so stopping never waits on the screen.
    waitUntil(readFrame(env, clip.id, t).then(() => undefined).catch(() => undefined));
    return json({ ok: true }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
