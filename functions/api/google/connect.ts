import { clientId, DRIVE_FILE, redirectUri, SCOPES } from '../../_lib/hub/google';
import type { Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// Starts Connect my Google: sends the signed-in person to Google's consent screen, with a one-time state
// cookie that the callback checks. The first connection asks for the three read scopes (calendar event
// details, Drive file names, mail headers). "?add=sheets" asks only for the one extra permission Google
// Sheets export needs (create and open the sheets the hub makes, drive.file), with the grant the person
// already gave kept (include_granted_scopes) and no forced second screen. "&force=1" asks again with the
// consent screen, for a person whose Google grant exists but whose hub row did not receive a token.
// Both ask for the sign-in identity (openid, email) so the callback can always check the account.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = hubUserOf(request);
  if (!user || user.via !== 'google') return Response.redirect(new URL('/login/?next=%2F', request.url).toString(), 302);
  const params = new URL(request.url).searchParams;
  const asked = params.get('next') || '/';
  const next = /^\/(?![\/])/.test(asked) ? asked : '/';
  const add = params.get('add') === 'sheets';
  const force = params.get('force') === '1';
  const state = crypto.randomUUID() + '|' + encodeURIComponent(next) + (add ? '|sheets' + (force ? '+force' : '') : '');
  const q = new URLSearchParams({
    client_id: clientId(env),
    redirect_uri: redirectUri(request),
    response_type: 'code',
    scope: (add ? [DRIVE_FILE, 'openid', 'email'] : [...SCOPES, 'openid', 'email']).join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    login_hint: user.email,
    hd: 'favorintl.org',
    state,
  });
  if (!add || force) q.set('prompt', 'consent');
  return new Response(null, {
    status: 302,
    headers: {
      Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString(),
      'Set-Cookie': `hub_gstate=${encodeURIComponent(state)}; Path=/api/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      'Cache-Control': 'no-store',
    },
  });
};
