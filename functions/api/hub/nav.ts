import { accessOf, navCounts } from '../../_lib/hub/today';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// The sidebar: who is signed in, which sections they may open, and the counts beside each.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const access = await accessOf(env, request, user);
    const counts = await navCounts(env, user, access);
    return json({ ok: true, user, access, counts });
  } catch (err) {
    return handleError(err);
  }
};
