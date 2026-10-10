import { exchangeCode, seal } from '../../_lib/hub/google';
import type { Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// Google sends the person back here. The code is traded for a refresh token, which is stored encrypted
// against the signed-in person's email. Back to the page they came from either way, with a note.
//
// The account Google returned must be the one signed in to the hub. That check needs the id_token, which
// Google sends only when openid was asked for (connect.ts always asks). With no id_token nothing is stored.
// The Google Sheets step ("sheets" in the state) stores the new refresh token and the union of everything
// granted so far. When Google already holds that grant and sends no refresh token, the person goes round
// once more with the consent screen (force) so the hub receives one.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const parts = state.split('|');
  const nextPath = decodeURIComponent(parts[1] || '%2F');
  const safeNext = /^\/(?![\/])/.test(nextPath) ? nextPath : '/';
  const flow = parts[2] || '';
  const sheets = flow.startsWith('sheets');
  const back = (note: string) => {
    const h = new Headers({ 'Cache-Control': 'no-store' });
    h.append('Set-Cookie', 'hub_gstate=; Path=/api/google; Max-Age=0');
    if (note === 'connected' || note === 'sheets') {
      h.append('Set-Cookie', 'hub_gc=1; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax');
      h.set('Location', safeNext + (safeNext.includes('?') ? '&' : '?') + 'google=' + note);
    } else h.set('Location', '/connect/?google=' + note);
    return new Response(null, { status: 302, headers: h });
  };
  const user = hubUserOf(request);
  if (!user || user.via !== 'google') return back('signin');
  if (url.searchParams.get('error')) return back('declined');
  const cookie = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)hub_gstate=([^;]+)/)?.[1];
  if (!cookie || decodeURIComponent(cookie) !== state) return back('expired');
  try {
    const t = await exchangeCode(env, request, url.searchParams.get('code') || '');
    const claims = t.id_token ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(t.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))) : null;
    if (!claims?.email) return back('failed');
    if (String(claims.email).toLowerCase() !== user.email.toLowerCase()) return back('wrong-account');
    if (!t.refresh_token) {
      // Google already holds this grant, so it showed no screen and sent no refresh token: ask once more with the screen.
      if (sheets && !flow.includes('force')) {
        const again = new URL('/api/google/connect', url);
        again.searchParams.set('add', 'sheets');
        again.searchParams.set('force', '1');
        again.searchParams.set('next', safeNext);
        return new Response(null, { status: 302, headers: { Location: again.toString(), 'Cache-Control': 'no-store' } });
      }
      return back('no-token');
    }
    await env.DB.prepare(
      `INSERT INTO hub_google (email, refresh_enc, scopes, connected_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET refresh_enc = excluded.refresh_enc, scopes = excluded.scopes, connected_at = excluded.connected_at`
    )
      .bind(user.email, await seal(env, t.refresh_token), t.scope || '', new Date().toISOString())
      .run();
    return back(sheets ? 'sheets' : 'connected');
  } catch {
    return back('failed');
  }
};
