// One part of a clip's multipart upload. Every part except the last must be the same size (8 MiB from the browser).
import { errorJson, handleError, json } from '../../../_lib/http';
import { PART_BYTES, adminOrError, ownClip, videoKey, type ClipsEnv } from '../../../_lib/clips';

export const onRequestPut: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const clip = await ownClip(env, who.user, String(params.id));
    if (!clip || clip.status !== 'uploading' || !clip.upload_id) return errorJson('not_found', 'That upload is not open.', 404);
    const n = Number(new URL(request.url).searchParams.get('n'));
    if (!Number.isInteger(n) || n < 1 || n > 10000) return errorJson('bad_part', 'Part number must be 1 to 10000.', 400);
    const data = await request.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > PART_BYTES + 1024) return errorJson('bad_part', 'Part is empty or too large.', 413);
    const part = await env.CLIPS.resumeMultipartUpload(videoKey(clip.id), clip.upload_id).uploadPart(n, data);
    return json({ ok: true, partNumber: part.partNumber, etag: part.etag }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
