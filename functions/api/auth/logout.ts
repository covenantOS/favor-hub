import { json, type Env } from '../../_lib/http';
import { clearHubSessionCookie, endHubSession, hubUserOf, logAuth } from '../../_lib/session';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = hubUserOf(request);
  try {
    await endHubSession(env, request);
    if (user && user.via === 'google') await logAuth(env, request, user.email, 'signed_out');
  } catch (err) {
    console.error('[signin] logout', err);
  }
  return json({ ok: true, signedIn: false }, 200, { 'Set-Cookie': clearHubSessionCookie() });
};
