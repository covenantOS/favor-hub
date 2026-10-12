import { refreshPin } from '../../../../_lib/hub/pins';
import { errorJson, handleError, json, type Env } from '../../../../_lib/http';
import { hubUserOf } from '../../../../_lib/session';

// Asks the Brain the pinned question again, as the person, and keeps the new answer. No chat is left behind.
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const id = String(params.id || '');
    if (!/^p_[a-z0-9]{6,12}$/.test(id)) return errorJson('bad_id', 'That pin does not exist.', 400);
    return json({ ok: true, pin: await refreshPin(env, user, id) });
  } catch (err) {
    return handleError(err);
  }
};
