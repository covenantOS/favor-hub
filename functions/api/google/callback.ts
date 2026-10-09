import { exchangeCode, seal } from '../../_lib/hub/google';
import type { Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// Google sends the person back here. The code is traded for a refresh token, which is stored
// encrypted against the signed-in person's email. Back to Today either way, with a note.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const nextPath = decodeURIComponent(state.split('|')[1] || '%2F');
  const safeNext = /^\/(?![\/])/.test(nextPath) ? nextPath : '/';
  const back = (note: string) => {
    const h = new Headers({ 'Cache-Control': 'no-store' });
    h.append('Set-Cookie', 'hub_gstate=; Path=/api/google; Max-Age=0');
    if (note === 'connected') {
      h.append('Set-Cookie', 'hub_gc=1; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax');
      h.set('Location', safeNext + (safeNext.includes('?') ? '&' : '?') + 'google=connected');
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
    // The account Google returned must be the one signed in to the hub.
    const claims = t.id_token ? JSON.parse(atob(t.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) : null;
    if (claims?.email && String(claims.email).toLowerCase() !== user.email.toLowerCase()) return back('wrong-account');
    if (!t.refresh_token) return back('no-token');
    await env.DB.prepare(
      `INSERT INTO hub_google (email, refresh_enc, scopes, connected_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET refresh_enc = excluded.refresh_enc, scopes = excluded.scopes, connected_at = excluded.connected_at`
    )
      .bind(user.email, await seal(env, t.refresh_token), t.scope || '', new Date().toISOString())
      .run();
    return back('connected');
  } catch {
    return back('failed');
  }
};
