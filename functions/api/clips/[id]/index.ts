// Rename, change the summary, turn sharing on or off (anyone with the link, anyone at Favor with the link, people by name), save edits or chapters or corrected transcript lines, or delete a
// clip. The person who made a clip manages it; a hub admin may also delete any clip. Delete removes the video, poster, sound and every note from R2 and D1.
import { asTrimmed, errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { J, clipPeople, staffOrError, manageClip, purgeClip, videoKey, type ClipsEnv } from '../../../_lib/clips';
import { cleanEdits, respread } from '../../../_lib/clipEdits';
import { cleanChapters, type ClipSegment, type ClipWord } from '../../../_lib/clipChapters';
import { fastKey, muxInfo } from '../../../_lib/clipmuxjob';

export const onRequestPatch: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = staffOrError(request);
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
    if (body.staffLink !== undefined) put('staff_link', body.staffLink === true ? 1 : 0);
    // People the clip is shared with by name: Favor staff in the directory or signed in to FavorOS, never a blocked account.
    const addPeople = Array.isArray(body.addPeople) ? (body.addPeople as unknown[]).map((x) => String(x || '').trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+$/.test(x)).slice(0, 50) : [];
    const removePeople = Array.isArray(body.removePeople) ? (body.removePeople as unknown[]).map((x) => String(x || '').trim().toLowerCase()).slice(0, 50) : [];
    if (addPeople.length) {
      const known = await env.DB.prepare(
        `SELECT e.value AS email FROM json_each(?) e
          WHERE (EXISTS (SELECT 1 FROM hub_users u WHERE lower(u.email) = e.value AND u.blocked = 0 AND u.role <> 'field')
             OR EXISTS (SELECT 1 FROM meet_directory d WHERE lower(d.email) = e.value AND d.active = 1))
            AND NOT EXISTS (SELECT 1 FROM hub_users b WHERE lower(b.email) = e.value AND b.blocked = 1)`
      ).bind(JSON.stringify(addPeople)).all<{ email: string }>();
      const ok = (known.results || []).map((r) => r.email);
      const missing = addPeople.filter((e) => !ok.includes(e));
      if (missing.length) return errorJson('unknown_person', `${missing.join(', ')} is not a Favor staff member in FavorOS.`, 400);
      const at = nowIso();
      await env.DB.batch(ok.map((e) => env.DB.prepare('INSERT OR IGNORE INTO hub_clip_people (clip_id, email, added_by, created_at) VALUES (?, ?, ?, ?)').bind(clip.id, e, who.user.email, at)));
    }
    if (removePeople.length) await env.DB.batch(removePeople.map((e) => env.DB.prepare('DELETE FROM hub_clip_people WHERE clip_id = ? AND email = ?').bind(clip.id, e)));
    if (!sets.length && (addPeople.length || removePeople.length)) return json({ ok: true, people: await clipPeople(env, clip.id) });
    if (body.edits !== undefined) put('edits', JSON.stringify(cleanEdits(body.edits, duration)));
    if (body.chapters !== undefined) put('chapters', JSON.stringify(cleanChapters(body.chapters, duration, 1)));
    if (Array.isArray(body.lines)) {
      // Correct the transcript text line by line. Times stay; the words of a changed line are spread over the same span.
      const old = J<ClipSegment[]>(clip.transcript, []);
      if (body.lines.length !== old.length) return errorJson('changed', 'The transcript changed. Reload and try again.', 409);
      const next = old.map((seg, i) => ({ s: seg.s, e: seg.e, t: String(body.lines && (body.lines as unknown[])[i] != null ? (body.lines as unknown[])[i] : seg.t).replace(/\s+/g, ' ').trim().slice(0, 2000) || seg.t }));
      put('transcript', JSON.stringify(next));
      put('words', JSON.stringify(respread(old, next, J<ClipWord[]>(clip.words, []))));
      put('translations', '{}');
    }
    if (!sets.length) return json({ ok: true });
    sets.push('updated_at = ?');
    args.push(nowIso());
    await env.DB.prepare(`UPDATE hub_clips SET ${sets.join(', ')} WHERE id = ?`).bind(...args, clip.id).run();
    const fresh = await env.DB.prepare('SELECT title, summary, share, staff_link, edits, chapters, transcript, words FROM hub_clips WHERE id = ?').bind(clip.id).first<Record<string, unknown>>();
    return json({
      ok: true,
      title: fresh?.title,
      summary: fresh?.summary,
      share: fresh?.share,
      staffLink: Number(fresh?.staff_link) === 1,
      people: addPeople.length || removePeople.length ? await clipPeople(env, clip.id) : undefined,
      edits: J(fresh?.edits, {}),
      chapters: J(fresh?.chapters, []),
      transcript: body.lines ? J(fresh?.transcript, []) : undefined,
      words: body.lines ? J(fresh?.words, []) : undefined,
    });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestDelete: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params, waitUntil }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const clip = await manageClip(env, who.user, String(params.id), { allowAdmin: true });
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    if (clip.status === 'uploading' && clip.upload_id) {
      await env.CLIPS.resumeMultipartUpload(videoKey(clip.id), clip.upload_id).abort().catch(() => undefined);
    }
    // A fast-start file still being written is an open upload of its own.
    const writing = muxInfo(clip).upload;
    if (writing) await env.CLIPS.resumeMultipartUpload(fastKey(clip.id), writing.id).abort().catch(() => undefined);
    // Rows first, so a transcript or processing run still in flight finds no clip and stops writing. Then the files, twice:
    // the second pass catches anything a run in flight wrote while the first was listing.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM hub_clip_comments WHERE clip_id = ?').bind(clip.id),
      env.DB.prepare('DELETE FROM hub_clip_reactions WHERE clip_id = ?').bind(clip.id),
      env.DB.prepare('DELETE FROM hub_clip_views WHERE clip_id = ?').bind(clip.id),
      env.DB.prepare('DELETE FROM hub_clip_frames WHERE clip_id = ?').bind(clip.id),
      env.DB.prepare('DELETE FROM hub_clips WHERE id = ?').bind(clip.id),
    ]);
    await purgeClip(env, clip.id);
    waitUntil(new Promise<void>((done) => setTimeout(done, 20000)).then(() => purgeClip(env, clip.id)).then(() => undefined).catch(() => undefined));
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};
