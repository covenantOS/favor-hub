// Finishes the multipart upload and starts the transcript, title, summary and chapters. The clip is watchable at once
// ("processing"); the words and the name arrive a few seconds later.
import { asTrimmed, errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { J, MAX_MS, purgeClip, staffOrError, ownClip, videoKey, type ClipsEnv, type PartRec } from '../../../_lib/clips';
import { runProcess } from '../../../_lib/clipjob';
import { clearTail, contiguous, foldTail } from '../../../_lib/clipTail';

export const onRequestPost: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params, waitUntil }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const clip = await ownClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    if (clip.status !== 'uploading') return json({ ok: true, id: clip.id, status: clip.status });
    if (!clip.upload_id) return errorJson('not_open', 'That upload is not open.', 409);
    const body = (await request.json().catch(() => ({}))) as { parts?: Array<{ partNumber: number; etag: string }>; durationMs?: number; title?: string; titleHint?: string; recover?: boolean };
    // A page that thinks the recorder is gone may only finish a clip that really went quiet. A live recorder reports every few seconds.
    if (body.recover && Date.now() - Date.parse(clip.updated_at) < 25000) return json({ ok: false, live: true, message: 'That recording is still running.' }, 409, { 'Cache-Control': 'private, no-store' });
    // The part list the server kept while the recording went on is the source of truth; a list from the browser fills in for older callers.
    // Bytes the recorder sent as tail pieces and never got into a whole part are joined on here (a closed window, a lost connection).
    const storedParts = J<PartRec[]>(clip.parts, []);
    let whole = contiguous(storedParts);
    try {
      whole = await foldTail(env, clip.id, clip.upload_id, storedParts);
    } catch (err) {
      console.warn('[clips] tail', clip.id, err);
    }
    const kept = whole.map((p) => ({ partNumber: p.n, etag: p.etag }));
    const sent = (body.parts || []).filter((p) => Number.isInteger(p.partNumber) && typeof p.etag === 'string');
    const parts = kept.length >= sent.length ? kept : sent;
    if (!parts.length) {
      await env.DB.batch([env.DB.prepare('DELETE FROM hub_clip_frames WHERE clip_id = ?').bind(clip.id), env.DB.prepare('DELETE FROM hub_clips WHERE id = ?').bind(clip.id)]);
      await purgeClip(env, clip.id).catch(() => undefined);
      return errorJson('no_parts', 'Nothing was recorded.', 400);
    }
    parts.sort((a, b) => a.partNumber - b.partNumber);
    let size = 0;
    try {
      const obj = await env.CLIPS.resumeMultipartUpload(videoKey(clip.id), clip.upload_id).complete(parts);
      size = obj.size;
      await clearTail(env, clip.id).catch(() => undefined);
    } catch (err) {
      // A retry after the object already exists is fine; anything else fails the recording.
      const head = await env.CLIPS.head(videoKey(clip.id));
      if (!head) {
        console.warn('[clips] complete', clip.id, err);
        await env.DB.prepare("UPDATE hub_clips SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind('The upload could not be finished.', nowIso(), clip.id).run();
        return errorJson('complete_failed', 'The upload could not be finished.', 502);
      }
      size = head.size;
    }
    const duration = Math.max(0, Math.min(MAX_MS + 5000, Math.round(Number(body.durationMs) || clip.duration_ms || 0)));
    const given = asTrimmed(body.title, 'title', 120, false);
    // A title the person typed is theirs. A hint (a file name) stands in until the transcript names the clip.
    const hint = asTrimmed(body.titleHint, 'titleHint', 120, false);
    const title = given || clip.title || hint;
    await env.DB.prepare("UPDATE hub_clips SET status = 'processing', upload_id = NULL, parts = '[]', size_bytes = ?, duration_ms = ?, title = ?, title_auto = ?, updated_at = ? WHERE id = ?")
      .bind(size, duration, title, given || (clip.title && clip.title_auto === 0) ? 0 : 1, nowIso(), clip.id).run();
    // The browser also asks for processing and waits on it; this one is the backup if the tab closes.
    waitUntil(runProcess(env, clip.id).then(() => undefined).catch((err) => console.warn('[clips] job', err)));
    return json({ ok: true, id: clip.id, size, status: 'processing' }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
