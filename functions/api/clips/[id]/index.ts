// Rename, change the summary, turn sharing on or off, save edits or chapters or corrected transcript lines, or delete a
// clip. Any hub admin may manage a saved clip. Delete removes the video, poster, sound and every note from R2 and D1.
import { asTrimmed, errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { J, adminOrError, manageClip, videoKey, type ClipsEnv } from '../../../_lib/clips';
import { cleanEdits, respread } from '../../../_lib/clipEdits';
import { cleanChapters, type ClipSegment, type ClipWord } from '../../../_lib/clipChapters';

export const onRequestPatch: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const clip = await manageClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sets: string[] = [];
    const args: unknown[] = [];
    const put = (col: string, v: unknown) => {
      sets.push(`${col} = ?`);
      args.push(v);
    };
    const duration = clip.duration_ms / 1000;
    if (body.title !== undefined) {
      put('title', asTrimmed(body.title, 'title', 120));
      put('title_auto', 0);
    }
    if (typeof body.summary === 'string') put('summary', body.summary.replace(/\s+/g, ' ').trim().slice(0, 1500));
    if (body.share !== undefined) put('share', body.share === true ? 1 : 0);
    if (body.edits !== undefined) put('edits', JSON.stringify(cleanEdits(body.edits, duration)));
    if (body.chapters !== undefined) put('chapters', JSON.stringify(cleanChapters(body.chapters, duration, 1)));
    if (Array.isArray(body.lines)) {
      // Correct the transcript text line by line. Times stay; the words of a changed line are spread over the same span.
      const old = J<ClipSegment[]>(clip.transcript, []);
      if (body.lines.length !== old.length) return errorJson('changed', 'The transcript changed. Reload and try again.', 409);
      const next = old.map((seg, i) => ({ s: seg.s, e: seg.e, t: String(body.lines && (body.lines as unknown[])[i] != null ? (body.lines as unknown[])[i] : seg.t).replace(/\s+/g, ' ').trim().slice(0, 2000) || seg.t }));
      put('transcript', JSON.stringify(next));
      put('words', JSON.stringify(respread(old, next, J<ClipWord[]>(clip.words, []))));
    }
    if (!sets.length) return json({ ok: true });
    sets.push('updated_at = ?');
    args.push(nowIso());
    await env.DB.prepare(`UPDATE hub_clips SET ${sets.join(', ')} WHERE id = ?`).bind(...args, clip.id).run();
    const fresh = await env.DB.prepare('SELECT title, summary, share, edits, chapters, transcript, words FROM hub_clips WHERE id = ?').bind(clip.id).first<Record<string, unknown>>();
    return json({
      ok: true,
      title: fresh?.title,
      summary: fresh?.summary,
      share: fresh?.share,
      edits: J(fresh?.edits, {}),
      chapters: J(fresh?.chapters, []),
      transcript: body.lines ? J(fresh?.transcript, []) : undefined,
      words: body.lines ? J(fresh?.words, []) : undefined,
    });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestDelete: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const clip = await manageClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    if (clip.status === 'uploading' && clip.upload_id) {
      await env.CLIPS.resumeMultipartUpload(videoKey(clip.id), clip.upload_id).abort().catch(() => undefined);
    }
    for (let cursor: string | undefined; ; ) {
      const page = await env.CLIPS.list({ prefix: `clips/${clip.id}/`, cursor, limit: 500 });
      if (page.objects.length) await env.CLIPS.delete(page.objects.map((o) => o.key));
      if (!page.truncated) break;
      cursor = page.cursor;
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM hub_clip_comments WHERE clip_id = ?').bind(clip.id),
      env.DB.prepare('DELETE FROM hub_clip_reactions WHERE clip_id = ?').bind(clip.id),
      env.DB.prepare('DELETE FROM hub_clip_views WHERE clip_id = ?').bind(clip.id),
      env.DB.prepare('DELETE FROM hub_clips WHERE id = ?').bind(clip.id),
    ]);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};
