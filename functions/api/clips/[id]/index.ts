// Rename, turn sharing on or off, or delete a clip. Delete removes the video and poster from R2.
import { asTrimmed, errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { adminOrError, ownClip, posterKey, videoKey, type ClipsEnv } from '../../../_lib/clips';

export const onRequestPatch: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const clip = await ownClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    const body = (await request.json().catch(() => ({}))) as { title?: string; share?: boolean };
    let title = clip.title;
    let share = clip.share;
    if (body.title !== undefined) title = asTrimmed(body.title, 'title', 120);
    if (body.share !== undefined) share = body.share === true ? 1 : 0;
    await env.DB.prepare('UPDATE hub_clips SET title = ?, share = ?, updated_at = ? WHERE id = ?').bind(title, share, nowIso(), clip.id).run();
    return json({ ok: true, title, share });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestDelete: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const clip = await ownClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    if (clip.status === 'uploading' && clip.upload_id) {
      await env.CLIPS.resumeMultipartUpload(videoKey(clip.id), clip.upload_id).abort().catch(() => undefined);
    }
    await env.CLIPS.delete([videoKey(clip.id), posterKey(clip.id)]);
    await env.DB.prepare('DELETE FROM hub_clips WHERE id = ?').bind(clip.id).run();
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};
