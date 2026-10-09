import { clientId, redirectUri, SCOPES } from '../../_lib/hub/google';
import type { Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// Starts Connect my Google: sends the signed-in person to Google's consent screen for the three
// read-only scopes, with a one-time state cookie that the callback checks.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = hubUserOf(request);
  if (!user || user.via !== 'google') return Response.redirect(new URL('/login/?next=%2F', request.url).toString(), 302);
  const state = crypto.randomUUID();
  const q = new URLSearchParams({
    client_id: clientId(env),
    redirect_uri: redirectUri(request),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    login_hint: user.email,
    hd: 'favorintl.org',
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString(),
      'Set-Cookie': `hub_gstate=${state}; Path=/api/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      'Cache-Control': 'no-store',
    },
  });
};
