// The transcript in another language (Spanish or English), kept beside the original. The original is never changed.
import { errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { J, staffOrError, manageClip, type ClipsEnv } from '../../../_lib/clips';
import { LANGS, translateLines } from '../../../_lib/clipai';
import type { ClipSegment } from '../../../_lib/clipChapters';

export const onRequestPost: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const clip = await manageClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    const b = (await request.json().catch(() => ({}))) as { lang?: string };
    const lang = String(b.lang || '');
    if (!LANGS[lang]) return errorJson('bad_lang', 'Pick Spanish or English.', 400);
    const lines = J<ClipSegment[]>(clip.transcript, []);
    if (!lines.length) return errorJson('no_words', 'There is no transcript to translate yet.', 409);
    let out: string[] | null = null;
    try {
      out = await translateLines(env, lines, lang);
    } catch (err) {
      console.warn('[clips] translate', err);
    }
    if (!out) return errorJson('no_translation', 'The translation could not be written right now. Try again in a minute.', 502);
    const all = J<Record<string, string[]>>(clip.translations, {});
    all[lang] = out;
    await env.DB.prepare('UPDATE hub_clips SET translations = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(all), nowIso(), clip.id).run();
    return json({ ok: true, lang, lines: out }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
