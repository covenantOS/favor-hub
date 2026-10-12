// "Make a Learn lesson from this clip": a draft course in Learn with the clip and a written page of its steps.
import { errorJson, handleError, json } from '../../../_lib/http';
import { manageClip, staffOrError, type ClipsEnv } from '../../../_lib/clips';
import { makeLesson } from '../../../_lib/clipMake';

export const onRequestPost: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const clip = await manageClip(env, who.user, String(params.id));
    if (!clip) return errorJson('not_found', 'That clip does not exist.', 404);
    const made = await makeLesson(env, who.user, clip);
    return json({ ok: true, ...made, url: `/learn/admin/course/?c=${encodeURIComponent(made.course.id)}` }, 201, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
