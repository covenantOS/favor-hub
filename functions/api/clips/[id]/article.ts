// "Draft a help article from this clip": a Markdown article in the shape the hub's help docs use. Nothing is published;
// the draft is kept on the clip so it is there when the editor comes back.
import { errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { staffOrError, manageClip, type ClipsEnv } from '../../../_lib/clips';
import { helpArticle } from '../../../_lib/clipai';

export const onRequestPost: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const clip = await manageClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    if (!clip.transcript || clip.transcript === '[]') return errorJson('no_words', 'There is no transcript to write from yet.', 409);
    let draft = null;
    try {
      draft = await helpArticle(env, clip);
    } catch (err) {
      console.warn('[clips] article', err);
    }
    if (!draft) return errorJson('no_draft', 'The article could not be written right now. Try again in a minute.', 502);
    await env.DB.prepare('UPDATE hub_clips SET help_draft = ?, updated_at = ? WHERE id = ?').bind(draft.markdown, nowIso(), clip.id).run();
    return json({ ok: true, markdown: draft.markdown, title: draft.title }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};

// Save the editor's changes to the draft.
export const onRequestPut: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const clip = await manageClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    const b = (await request.json().catch(() => ({}))) as { markdown?: string };
    await env.DB.prepare('UPDATE hub_clips SET help_draft = ?, updated_at = ? WHERE id = ?').bind(String(b.markdown ?? '').slice(0, 60000), nowIso(), clip.id).run();
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};
