// Clips: list my clips, start a new upload.
import { asTrimmed, handleError, json, nowIso } from '../../_lib/http';
import { adminOrError, cleanMime, clipId, extFor, videoKey, type Clip, type ClipsEnv } from '../../_lib/clips';

export const onRequestGet: PagesFunction<ClipsEnv> = async ({ request, env }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const rows = await env.DB.prepare(
      "SELECT id, title, status, share, size_bytes, duration_ms, has_poster, views, created_at FROM hub_clips WHERE owner_email = ? AND status = 'ready' ORDER BY created_at DESC LIMIT 200"
    ).bind(who.user.email).all<Clip>();
    return json({ ok: true, clips: rows.results || [] }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};

// Starts a multipart upload. The browser then PUTs parts and posts complete.
export const onRequestPost: PagesFunction<ClipsEnv> = async ({ request, env }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const body = (await request.json().catch(() => ({}))) as { title?: string; mime?: string };
    const title = asTrimmed(body.title, 'title', 120, false) || 'Untitled clip';
    const mime = cleanMime(body.mime);
    const id = clipId();
    const upload = await env.CLIPS.createMultipartUpload(videoKey(id), { httpMetadata: { contentType: mime } });
    const now = nowIso();
    await env.DB.prepare(
      'INSERT INTO hub_clips (id, owner_email, owner_name, title, status, share, mime, upload_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)'
    ).bind(id, who.user.email, who.user.name, title, 'uploading', mime, upload.uploadId, now, now).run();
    return json({ ok: true, id, ext: extFor(mime) }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
