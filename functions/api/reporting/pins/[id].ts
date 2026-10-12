import { movePin, removePin, renamePin } from '../../../_lib/hub/pins';
import { errorJson, handleError, json, type Env } from '../../../_lib/http';
import { hubUserOf } from '../../../_lib/session';

const ID = /^p_[a-z0-9]{6,12}$/;

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const id = String(params.id || '');
    if (!ID.test(id)) return errorJson('bad_id', 'That pin does not exist.', 400);
    const body = (await request.json().catch(() => ({}))) as { title?: unknown; move?: unknown };
    let done = false;
    if (typeof body.title === 'string') done = await renamePin(env, user.email, id, body.title);
    else if (body.move === 'up' || body.move === 'down') done = await movePin(env, user.email, id, body.move);
    else return errorJson('bad_body', 'Send a new title or a direction to move.', 400);
    return done ? json({ ok: true }) : errorJson('not_found', 'That pin is not on your dashboard.', 404);
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const id = String(params.id || '');
    if (!ID.test(id)) return errorJson('bad_id', 'That pin does not exist.', 400);
    return (await removePin(env, user.email, id)) ? json({ ok: true }) : errorJson('not_found', 'That pin is not on your dashboard.', 404);
  } catch (err) {
    return handleError(err);
  }
};
