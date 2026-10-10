// Finishes the multipart upload and marks the clip ready.
import { asTrimmed, errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { MAX_MS, adminOrError, ownClip, videoKey, type ClipsEnv } from '../../../_lib/clips';

export const onRequestPost: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const clip = await ownClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    if (clip.status === 'ready') return json({ ok: true, id: clip.id });
    if (!clip.upload_id) return errorJson('not_open', 'That upload is not open.', 409);
    const body = (await request.json().catch(() => ({}))) as { parts?: Array<{ partNumber: number; etag: string }>; durationMs?: number; title?: string };
    const parts = (body.parts || []).filter((p) => Number.isInteger(p.partNumber) && typeof p.etag === 'string');
    if (!parts.length) return errorJson('no_parts', 'No parts were uploaded.', 400);
    parts.sort((a, b) => a.partNumber - b.partNumber);
    const obj = await env.CLIPS.resumeMultipartUpload(videoKey(clip.id), clip.upload_id).complete(parts);
    const duration = Math.max(0, Math.min(MAX_MS + 5000, Math.round(Number(body.durationMs) || 0)));
    const title = asTrimmed(body.title, 'title', 120, false) || clip.title;
    await env.DB.prepare("UPDATE hub_clips SET status = 'ready', upload_id = NULL, size_bytes = ?, duration_ms = ?, title = ?, updated_at = ? WHERE id = ?")
      .bind(obj.size, duration, title, nowIso(), clip.id).run();
    return json({ ok: true, id: clip.id, size: obj.size }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
