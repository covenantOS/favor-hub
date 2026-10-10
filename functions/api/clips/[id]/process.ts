// (Re)run the transcript, title, summary and chapters. The browser calls it right after Stop and waits for the answer.
// With { again: true } the sound is read afresh (verbatim, so "um" and "uh" stay) and the summary and chapters are rewritten.
import { errorJson, handleError, json } from '../../../_lib/http';
import { staffOrError, clipView, manageClip, type ClipsEnv } from '../../../_lib/clips';
import { runProcess } from '../../../_lib/clipjob';

export const onRequestPost: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const clip = await manageClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    if (clip.status === 'uploading') return errorJson('uploading', 'Still uploading.', 409);
    const body = (await request.json().catch(() => ({}))) as { again?: boolean; vision?: boolean };
    const again = body.again === true;
    // A clip that is ready and not asked to start over has nothing to do.
    if (clip.status === 'ready' && !again && clip.summary) return json({ ok: true, clip: clipView(clip) });
    if (again) await env.DB.prepare("UPDATE hub_clips SET status = 'processing' WHERE id = ?").bind(clip.id).run();
    // vision: false writes the title and summary from the words alone (used to compare with what the screen adds).
    const done = await runProcess(env, clip.id, again, true, body.vision !== false);
    return json({ ok: true, clip: done ? clipView(done) : null }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
