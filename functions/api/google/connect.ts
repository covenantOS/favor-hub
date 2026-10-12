import { ALL_SCOPES, GMAIL_MODIFY, clientId, redirectUri } from '../../_lib/hub/google';
import type { Env } from '../../_lib/http';
import { safeNextPath } from '../../_lib/next';
import { hubUserOf } from '../../_lib/session';

// Starts Connect my Google: sends the signed-in person to Google's consent screen, with a one-time state
// cookie that the callback checks. Every visit asks for everything FavorOS uses (ALL_SCOPES) on one screen, so a person
// allows once at first sign-in and no tool asks again. A person who connected before that rule sees the screen once more,
// the first time a tool needs more than they gave ("?add=mail", "mailsend", "meetings" or "sheets" names the tool for the
// note on the way back). "&force=1" shows the consent screen again for a grant Google holds but FavorOS has no token for.
// Each asks for the sign-in identity (openid, email) so the callback can always check the account.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = hubUserOf(request);
  const params = new URL(request.url).searchParams;
  const next = safeNextPath(params.get('next'));
  if (!user || user.via !== 'google') return Response.redirect(new URL('/login/?next=' + encodeURIComponent(next), request.url).toString(), 302);
  const addKind = (['meetings', 'sheets', 'mail', 'mailsend', 'mailbox'] as const).find((k) => k === params.get('add')) || '';
  const add = !!addKind;
  const force = params.get('force') === '1';
  const state = crypto.randomUUID() + '|' + encodeURIComponent(next) + (add ? '|' + addKind + (force ? '+force' : '') : '');
  // Add a mailbox: another Favor Google account, Gmail only (read, change, send), never mixed with this person's own grant.
  const box = addKind === 'mailbox';
  const q = new URLSearchParams({
    client_id: clientId(env),
    redirect_uri: redirectUri(request),
    response_type: 'code',
    scope: box ? [GMAIL_MODIFY, 'openid', 'email', 'profile'].join(' ') : [...ALL_SCOPES, 'openid', 'email'].join(' '),
    access_type: 'offline',
    hd: 'favorintl.org',
    state,
  });
  if (!box) {
    q.set('include_granted_scopes', 'true');
    q.set('login_hint', user.email);
  }
  if (box) q.set('prompt', 'select_account consent');
  else if (!add || force) q.set('prompt', 'consent');
  return new Response(null, {
    status: 302,
    headers: {
      Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString(),
      'Set-Cookie': `hub_gstate=${encodeURIComponent(state)}; Path=/api/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      'Cache-Control': 'no-store',
    },
  });
};

