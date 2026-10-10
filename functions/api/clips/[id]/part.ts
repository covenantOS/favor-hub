// One part of a clip's multipart upload. Every part except the last must be the same size (8 MiB from the browser).
// The part list is kept in D1 as parts arrive, so a recording whose tab closed can still be finished.
import { errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { J, MAX_PARTS, PART_BYTES, staffOrError, ownClip, videoKey, type ClipsEnv, type PartRec } from '../../../_lib/clips';

export const onRequestPut: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const clip = await ownClip(env, who.user, String(params.id));
    if (!clip || clip.status !== 'uploading' || !clip.upload_id) return errorJson('not_found', 'That upload is not open.', 404);
    const u = new URL(request.url);
    const n = Number(u.searchParams.get('n'));
    if (!Number.isInteger(n) || n < 1 || n > MAX_PARTS) return errorJson('bad_part', 'That recording is too long.', 413);
    const data = await request.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > PART_BYTES + 1024) return errorJson('bad_part', 'Part is empty or too large.', 413);
    const part = await env.CLIPS.resumeMultipartUpload(videoKey(clip.id), clip.upload_id).uploadPart(n, data);
    // Parts arrive one at a time from the browser, so a read, merge and write is safe.
    const fresh = await env.DB.prepare('SELECT parts, duration_ms FROM hub_clips WHERE id = ?').bind(clip.id).first<{ parts: string; duration_ms: number }>();
    const parts = J<PartRec[]>(fresh?.parts, []).filter((p) => p.n !== n);
    parts.push({ n, etag: part.etag, size: data.byteLength });
    parts.sort((a, b) => a.n - b.n);
    const elapsed = Math.round(Number(request.headers.get('x-elapsed')) * 1000);
    const dur = Number.isFinite(elapsed) && elapsed > (fresh?.duration_ms ?? 0) ? elapsed : (fresh?.duration_ms ?? 0);
    await env.DB.prepare('UPDATE hub_clips SET parts = ?, duration_ms = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(parts), dur, nowIso(), clip.id).run();
    return json({ ok: true, partNumber: part.partNumber, etag: part.etag }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
