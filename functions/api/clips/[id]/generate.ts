// Write the title, the summary or the chapters again from the transcript.
import { errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { J, adminOrError, manageClip, type ClipsEnv } from '../../../_lib/clips';
import { chaptersFor, nameIt } from '../../../_lib/clipai';
import type { ClipSegment, ClipWord } from '../../../_lib/clipChapters';

export const onRequestPost: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const clip = await manageClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    const b = (await request.json().catch(() => ({}))) as { what?: string };
    const lines = J<ClipSegment[]>(clip.transcript, []);
    if (!lines.length) return errorJson('no_words', 'There is no transcript to read yet.', 409);
    const duration = clip.duration_ms / 1000;
    if (b.what === 'chapters') {
      const chapters = await chaptersFor(env, lines, duration, J<ClipWord[]>(clip.words, []));
      if (!chapters.length) return errorJson('no_chapters', 'Chapters could not be written right now.', 502);
      await env.DB.prepare('UPDATE hub_clips SET chapters = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(chapters), nowIso(), clip.id).run();
      return json({ ok: true, chapters });
    }
    const named = await nameIt(env, lines.map((l) => l.t).join(' '));
    if (!named) return errorJson('no_title', 'A title could not be written right now.', 502);
    if (b.what === 'title') {
      await env.DB.prepare('UPDATE hub_clips SET title = ?, title_auto = 1, updated_at = ? WHERE id = ?').bind(named.title, nowIso(), clip.id).run();
      return json({ ok: true, title: named.title });
    }
    await env.DB.prepare('UPDATE hub_clips SET summary = ?, updated_at = ? WHERE id = ?').bind(named.summary, nowIso(), clip.id).run();
    return json({ ok: true, summary: named.summary });
  } catch (err) {
    return handleError(err);
  }
};
