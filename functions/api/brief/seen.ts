import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { dismissAway } from '../../_lib/brief/away';

// Closes the "Since you were away" card for this visit.   POST /api/brief/seen   { dismiss: true }
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    await dismissAway(env, user.email);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};
