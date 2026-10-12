// Your requests with where each one is: GET /api/requests/mine. Read only; the person who asked sees the board's own status.
import { handleError, json, errorJson, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { myRequests } from '../../_lib/requests/progress';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user || user.via !== 'google') return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    return json({ ok: true, requests: await myRequests(env, user.email) }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
