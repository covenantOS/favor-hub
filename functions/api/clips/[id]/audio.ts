// The sound of a clip, kept as small standalone slices (about two minutes each) so the transcript can be read while the
// recording goes on and the editor can draw a waveform without downloading the video.
//   PUT  /audio?n=0&start=0.0   the owner uploads a slice
//   GET  /audio                 the list of slices
//   GET  /audio?n=0             one slice's bytes (an admin, for the editor's waveform)
import { errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { J, MAX_AUDIO_BYTES, PRIVATE, staffOrError, audioPrefix, manageClip, ownClip, type AudioSeg, type ClipsEnv } from '../../../_lib/clips';

export const onRequestPut: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const clip = await ownClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    if (clip.status === 'failed') return errorJson('failed', 'This recording failed.', 409);
    const u = new URL(request.url);
    const n = Number(u.searchParams.get('n'));
    const start = Math.max(0, Number(u.searchParams.get('start')) || 0);
    const type = request.headers.get('content-type') || '';
    const ext = /wav/.test(type) ? 'wav' : /mp4|aac|m4a/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
    if (!Number.isInteger(n) || n < 0 || n > 200) return errorJson('bad_slice', 'Bad slice.', 400);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return errorJson('bad_slice', 'Empty audio.', 400);
    if (bytes.byteLength > MAX_AUDIO_BYTES) return errorJson('too_big', 'Audio slice too large.', 413);
    await env.CLIPS.put(`${audioPrefix(clip.id)}${n}.${ext}`, bytes, { httpMetadata: { contentType: type || 'audio/webm' } });
    const fresh = await env.DB.prepare('SELECT audio_segments FROM hub_clips WHERE id = ?').bind(clip.id).first<{ audio_segments: string }>();
    const segs = J<AudioSeg[]>(fresh?.audio_segments, []).filter((s) => s.n !== n);
    segs.push({ n, start, size: bytes.byteLength, ext });
    segs.sort((a, b) => a.n - b.n);
    await env.DB.prepare('UPDATE hub_clips SET audio_segments = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(segs), nowIso(), clip.id).run();
    return json({ ok: true, n }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestGet: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const clip = await manageClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    const segs = J<AudioSeg[]>(clip.audio_segments, []);
    const nParam = new URL(request.url).searchParams.get('n');
    if (nParam === null) return json({ ok: true, slices: segs.map((s) => ({ n: s.n, start: s.start, ext: s.ext })) }, 200, { 'Cache-Control': 'private, no-store' });
    const seg = segs.find((s) => s.n === Number(nParam));
    if (!seg) return new Response('Not found', { status: 404, headers: PRIVATE });
    const obj = await env.CLIPS.get(`${audioPrefix(clip.id)}${seg.n}.${seg.ext}`);
    if (!obj) return new Response('Not found', { status: 404, headers: PRIVATE });
    const type = seg.ext === 'm4a' ? 'audio/mp4' : seg.ext === 'ogg' ? 'audio/ogg' : seg.ext === 'wav' ? 'audio/wav' : 'audio/webm';
    return new Response(obj.body, { headers: { ...PRIVATE, 'Content-Type': type, 'Content-Length': String(obj.size) } });
  } catch (err) {
    return handleError(err);
  }
};
