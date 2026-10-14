// Connect Asana, per person. A person who connects has their FavorOS edits on synced projects reach Asana under their own Asana
// account; everyone else's go with Will's token, comments marked "From FavorOS, <name>". Tokens are sealed (AES-GCM, GOOGLE_TOKEN_KEY)
// in hub_asana_oauth and never returned by any route. The state that carries the person through Asana's consent screen is signed with
// the client secret and lasts 15 minutes, so the callback trusts it without a session.
import { HttpError, nowIso, type Env } from '../http';
import { open, seal } from '../hub/google';

const AUTH = 'https://app.asana.com/-/oauth_authorize';
const TOKEN = 'https://app.asana.com/-/oauth_token';
const REDIRECT = 'https://dash.favorintl.org/api/asana/oauth/callback';
const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();

function creds(env: Env): { id: string; secret: string } {
  const id = env.ASANA_CLIENT_ID;
  const secret = env.ASANA_CLIENT_SECRET;
  if (!id || !secret) throw new HttpError(503, 'no_asana_app', 'This copy of FavorOS has no Asana app set up.');
  return { id, secret };
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(secret: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text))));
}

/** The address of Asana's consent screen for this person. back is a FavorOS path to return to. */
export async function connectUrl(env: Env, email: string, back: string): Promise<string> {
  const { id, secret } = creds(env);
  const safeBack = /^\/[A-Za-z0-9/_\-?=&.%]*$/.test(back) && !back.startsWith('//') ? back : '/projects/';
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ e: lower(email), t: Date.now(), b: safeBack })));
  const state = `${payload}.${await sign(secret, payload)}`;
  const q = new URLSearchParams({ client_id: id, redirect_uri: REDIRECT, response_type: 'code', state });
  return `${AUTH}?${q}`;
}

async function readState(env: Env, state: string): Promise<{ e: string; b: string }> {
  const { secret } = creds(env);
  const [payload, sig] = String(state || '').split('.');
  if (!payload || !sig || (await sign(secret, payload)) !== sig) throw new HttpError(400, 'bad_state', 'That Asana sign-in link is not valid. Start again from Projects.');
  const j = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  if (!j.e || Date.now() - Number(j.t) > 15 * 60000) throw new HttpError(400, 'old_state', 'That Asana sign-in link has expired. Start again from Projects.');
  return { e: lower(j.e), b: String(j.b || '/projects/') };
}

async function tokenCall(env: Env, body: Record<string, string>, f: typeof fetch = fetch): Promise<any> {
  const res = await f(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const j: any = await res.json().catch(() => null);
  if (!res.ok || !j?.access_token) throw new HttpError(502, 'asana_token', `Asana did not give a token (${res.status}${j?.error ? `: ${j.error}` : ''}).`);
  return j;
}

/** The callback: trades the code for tokens and keeps them sealed. Returns where to send the person. */
export async function finishConnect(env: Env, code: string, state: string): Promise<string> {
  const { id, secret } = creds(env);
  const st = await readState(env, state);
  const j = await tokenCall(env, { grant_type: 'authorization_code', client_id: id, client_secret: secret, redirect_uri: REDIRECT, code });
  if (!j.refresh_token) throw new HttpError(502, 'asana_token', 'Asana gave no refresh token.');
  const who = j.data || {};
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO hub_asana_oauth (email, asana_gid, asana_name, asana_email, refresh_token, access_token, expires_at, connected_at, refreshed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET asana_gid = excluded.asana_gid, asana_name = excluded.asana_name, asana_email = excluded.asana_email, refresh_token = excluded.refresh_token,
       access_token = excluded.access_token, expires_at = excluded.expires_at, connected_at = excluded.connected_at, refreshed_at = excluded.refreshed_at`
  ).bind(st.e, String(who.gid || who.id || ''), String(who.name || ''), lower(who.email), await seal(env, j.refresh_token), await seal(env, j.access_token),
    new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000).toISOString(), now, now).run();
  return st.b + (st.b.includes('?') ? '&' : '?') + 'asana=connected';
}

/** A working access token for this person, refreshed when it is within two minutes of expiring; null when they have not connected. */
export async function tokenFor(env: Env, email: string, force = false): Promise<string | null> {
  const row = await env.DB.prepare('SELECT * FROM hub_asana_oauth WHERE email = ?').bind(lower(email)).first<{ refresh_token: string; access_token: string; expires_at: string }>().catch(() => null);
  if (!row) return null;
  if (!force && row.access_token && row.expires_at > new Date(Date.now() + 120000).toISOString()) return open(env, row.access_token);
  const { id, secret } = creds(env);
  let j: any;
  try {
    j = await tokenCall(env, { grant_type: 'refresh_token', client_id: id, client_secret: secret, refresh_token: await open(env, row.refresh_token) });
  } catch (err) {
    // A revoked connection: forget it, so this person's edits go with Will's token instead of failing.
    if (err instanceof HttpError && /\(40[01]/.test(err.message)) await env.DB.prepare('DELETE FROM hub_asana_oauth WHERE email = ?').bind(lower(email)).run();
    throw err;
  }
  await env.DB.prepare('UPDATE hub_asana_oauth SET access_token = ?, expires_at = ?, refreshed_at = ? WHERE email = ?')
    .bind(await seal(env, j.access_token), new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000).toISOString(), nowIso(), lower(email)).run();
  return j.access_token as string;
}

export async function connection(env: Env, email: string) {
  const r = await env.DB.prepare('SELECT asana_name, asana_email, connected_at, refreshed_at FROM hub_asana_oauth WHERE email = ?').bind(lower(email)).first().catch(() => null);
  return r ? { connected: true, ...r } : { connected: false };
}

export async function disconnect(env: Env, email: string): Promise<void> {
  const row = await env.DB.prepare('SELECT refresh_token FROM hub_asana_oauth WHERE email = ?').bind(lower(email)).first<{ refresh_token: string }>().catch(() => null);
  if (!row) return;
  try {
    const { id, secret } = creds(env);
    await fetch('https://app.asana.com/-/oauth_revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: id, client_secret: secret, token: await open(env, row.refresh_token) }).toString() });
  } catch {
    // forgetting it here is what matters
  }
  await env.DB.prepare('DELETE FROM hub_asana_oauth WHERE email = ?').bind(lower(email)).run();
}
