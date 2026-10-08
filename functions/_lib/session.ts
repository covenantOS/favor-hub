// Google sign-in for the whole hub.
//
// The sign-in page gets an ID token from Google (the same "Sign in with Google" client the KPI
// dashboard uses) and posts it here. We check Google's signature, the client id, the nonce this
// browser was given, and that the account is a verified @favorintl.org Google Workspace account,
// then hand the browser a session cookie. The middleware turns that cookie (or the admin password
// session the scripts use, or the agent key) into a user, and passes the user to every function as
// X-Hub-* request headers it sets itself.
import { HttpError, clientIp, nowIso, timingSafeEqualStr, type Env } from './http';
import { readCookie } from './auth';

export const SESSION_COOKIE = 'favor_hub_session';
const NONCE_COOKIE = 'favor_hub_nonce';
const SESSION_DAYS = 30;
const NONCE_MINUTES = 15;
const TOUCH_MS = 60 * 60 * 1000;
const DEFAULT_CLIENT_ID = '538890082341-5ka1icfropum9nl9csq8adaiusbuesea.apps.googleusercontent.com';
const DEFAULT_DOMAIN = 'favorintl.org';
const DEFAULT_ADMINS = 'will@favorintl.org';
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const HUB_HEADERS = ['X-Hub-Email', 'X-Hub-Name', 'X-Hub-Role', 'X-Hub-Via', 'X-Hub-Picture', 'X-Hub-Kpi'];

export type HubRole = 'staff' | 'admin';
export type HubVia = 'google' | 'password' | 'agent';

export interface HubUser {
  email: string;
  name: string;
  picture: string;
  role: HubRole;
  via: HubVia;
  /** Sees the KPI dashboard and the year's numbers in the hub (hub_users.kpi, or an admin). */
  kpi: boolean;
}

export interface GoogleClaims {
  iss: string;
  aud: string;
  sub: string;
  email?: string;
  email_verified?: boolean;
  hd?: string;
  name?: string;
  picture?: string;
  nonce?: string;
  exp: number;
  iat?: number;
}

export function googleClientId(env: Env): string {
  return env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;
}

/** On unless HUB_SIGNIN is "off". Off keeps the old per-app codes working while sign-in is tested. */
export function signinEnforced(env: Env): boolean {
  return (env.HUB_SIGNIN || 'on').trim().toLowerCase() !== 'off';
}

function hubDomain(env: Env): string {
  return (env.HUB_GOOGLE_DOMAIN || DEFAULT_DOMAIN).trim().toLowerCase();
}

export function isAdminEmail(env: Env, email: string): boolean {
  const admins = (env.HUB_ADMINS || DEFAULT_ADMINS).split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase());
}

/* ------------------------------------------------------------------ bytes */

function b64urlBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(s))) as T;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ----------------------------------------------------------- Google keys */

// Google rotates its signing keys every few days; keep them for as long as Google's Cache-Control
// says (capped at six hours) and fetch again when a token names a key we have not seen.
let jwks: { at: number; ttl: number; keys: Record<string, JsonWebKey> } | null = null;
const imported = new Map<string, CryptoKey>();

async function loadKeys(env: Env, force = false): Promise<Record<string, JsonWebKey>> {
  if (!force && jwks && Date.now() - jwks.at < jwks.ttl) return jwks.keys;
  const res = await fetch(env.GOOGLE_JWKS_URL || GOOGLE_JWKS);
  if (!res.ok) throw new HttpError(503, 'google_keys', 'Could not reach Google to check the sign-in. Try again in a minute.');
  const body = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  const keys: Record<string, JsonWebKey> = {};
  for (const k of body.keys || []) if (k.kid) keys[k.kid] = k;
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') || '')?.[1] || 3600);
  jwks = { at: Date.now(), ttl: Math.min(Math.max(maxAge, 60), 6 * 3600) * 1000, keys };
  imported.clear();
  return keys;
}

async function googleKey(env: Env, kid: string): Promise<CryptoKey> {
  let keys = await loadKeys(env);
  if (!keys[kid]) keys = await loadKeys(env, true);
  const jwk = keys[kid];
  if (!jwk) throw new HttpError(401, 'bad_token', 'Google signed that sign-in with a key it no longer uses. Try again.');
  let key = imported.get(kid);
  if (!key) {
    key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    imported.set(kid, key);
  }
  return key;
}

/** Checks Google's signature, issuer, audience and expiry. Account rules are checked by the caller. */
export async function verifyGoogleIdToken(env: Env, token: string): Promise<GoogleClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'bad_token', 'Google sent a sign-in this page cannot read. Try again.');
  let header: { alg?: string; kid?: string };
  let claims: GoogleClaims;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    throw new HttpError(401, 'bad_token', 'Google sent a sign-in this page cannot read. Try again.');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new HttpError(401, 'bad_token', 'That sign-in was not signed by Google.');
  const key = await googleKey(env, header.kid);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), signed);
  if (!valid) throw new HttpError(401, 'bad_token', 'That sign-in was not signed by Google.');
  const now = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new HttpError(401, 'bad_token', 'That sign-in did not come from Google.');
  if (claims.aud !== googleClientId(env)) throw new HttpError(401, 'bad_token', 'That sign-in was meant for a different app.');
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw new HttpError(401, 'expired', 'That sign-in expired. Try again.');
  if (typeof claims.iat === 'number' && claims.iat > now + 300) throw new HttpError(401, 'bad_token', 'That sign-in is dated in the future. Check the computer clock.');
  return claims;
}

/** The account rules: a verified address on Favor's Google Workspace domain. */
export function favorEmailOf(env: Env, claims: GoogleClaims): string {
  const email = String(claims.email || '').trim().toLowerCase();
  const domain = hubDomain(env);
  if (!email || claims.email_verified !== true) {
    throw new HttpError(403, 'unverified', 'Google has not verified that email address.');
  }
  if (!email.endsWith('@' + domain) || String(claims.hd || '').toLowerCase() !== domain) {
    throw new HttpError(403, 'wrong_domain', `Use your @${domain} Google account. You signed in as ${email}.`);
  }
  return email;
}

/* ----------------------------------------------------------------- nonce */

export function newNonce(): string {
  return randomHex(16);
}

export function nonceCookie(nonce: string): string {
  return `${NONCE_COOKIE}=${nonce}; Path=/api/auth/; HttpOnly; Secure; SameSite=Lax; Max-Age=${NONCE_MINUTES * 60}`;
}

export function clearNonceCookie(): string {
  return `${NONCE_COOKIE}=; Path=/api/auth/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function checkNonce(request: Request, claims: GoogleClaims): void {
  const expected = readCookie(request, NONCE_COOKIE);
  if (!expected || !claims.nonce || !timingSafeEqualStr(expected, claims.nonce)) {
    throw new HttpError(401, 'stale_signin', 'That sign-in started in another tab or took too long. Try again.');
  }
}

/* -------------------------------------------------------------- sessions */

export async function createHubSession(env: Env, request: Request, email: string): Promise<string> {
  const token = randomHex(32);
  const now = nowIso();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare(
    'INSERT INTO hub_sessions (token_hash, email, created_at, expires_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(await sha256Hex(token), email, now, expires, now, clientIp(request), (request.headers.get('User-Agent') || '').slice(0, 200))
    .run();
  return token;
}

export function hubSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearHubSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function endHubSession(env: Env, request: Request): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare('DELETE FROM hub_sessions WHERE token_hash = ? OR expires_at < ?').bind(await sha256Hex(token), nowIso()).run();
}

/** Records the sign-in and returns the user, or refuses an account an admin has blocked. */
export async function recordSignIn(env: Env, claims: GoogleClaims, email: string): Promise<HubUser> {
  const now = nowIso();
  const name = String(claims.name || '').slice(0, 120);
  const picture = String(claims.picture || '').slice(0, 500);
  await env.DB.prepare(
    `INSERT INTO hub_users (email, name, picture, role, blocked, note, sign_ins, first_seen, last_seen, created_at, updated_at)
     VALUES (?, ?, ?, 'staff', 0, '', 0, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE hub_users.name END,
       picture = excluded.picture,
       updated_at = excluded.updated_at`
  )
    .bind(email, name, picture, now, now, now, now)
    .run();
  const row = await env.DB.prepare('SELECT email, name, picture, role, blocked, kpi FROM hub_users WHERE email = ?')
    .bind(email)
    .first<{ email: string; name: string; picture: string; role: string; blocked: number; kpi: number }>();
  if (!row || row.blocked) {
    throw new HttpError(403, 'blocked', 'This account no longer has access to the Favor hub.');
  }
  await env.DB.prepare(
    'UPDATE hub_users SET sign_ins = sign_ins + 1, first_seen = COALESCE(first_seen, ?), last_seen = ? WHERE email = ?'
  )
    .bind(now, now, email)
    .run();
  const admin = row.role === 'admin' || isAdminEmail(env, row.email);
  return { email: row.email, name: row.name || email, picture: row.picture, role: admin ? 'admin' : 'staff', via: 'google', kpi: admin || row.kpi === 1 };
}

export async function logAuth(env: Env, request: Request, email: string, event: string, detail = ''): Promise<void> {
  try {
    await env.DB.prepare('INSERT INTO hub_auth_log (at, email, event, detail, ip) VALUES (?, ?, ?, ?, ?)')
      .bind(nowIso(), email, event, detail.slice(0, 300), clientIp(request))
      .run();
  } catch (err) {
    console.error('[signin] log', err);
  }
}

/* ------------------------------------------------------------ resolving */

/**
 * Who is making this request: a Google session, the admin password session (scripts and tests),
 * or an agent with the agent key. Anything else is nobody.
 */
export async function resolveUser(env: Env, request: Request): Promise<HubUser | null> {
  const auth = request.headers.get('Authorization') || '';
  const supplied = (auth.startsWith('Bearer ') ? auth.slice(7).trim() : '') || request.headers.get('X-Agent-Key') || '';
  if (supplied && env.AGENT_API_KEY && timingSafeEqualStr(supplied, env.AGENT_API_KEY)) {
    return { email: 'agent', name: 'Agent', picture: '', role: 'admin', via: 'agent', kpi: true };
  }

  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    const hash = await sha256Hex(token);
    const row = await env.DB.prepare(
      `SELECT s.last_seen, u.email, u.name, u.picture, u.role, u.blocked, u.kpi
         FROM hub_sessions s JOIN hub_users u ON u.email = s.email
        WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`
    )
      .bind(hash, nowIso())
      .first<{ last_seen: string; email: string; name: string; picture: string; role: string; blocked: number; kpi: number }>();
    if (row && !row.blocked) {
      if (Date.now() - Date.parse(row.last_seen) > TOUCH_MS) {
        await env.DB.prepare('UPDATE hub_sessions SET last_seen = ? WHERE token_hash = ?').bind(nowIso(), hash).run().catch(() => undefined);
      }
      const admin = row.role === 'admin' || isAdminEmail(env, row.email);
      return { email: row.email, name: row.name || row.email, picture: row.picture, role: admin ? 'admin' : 'staff', via: 'google', kpi: admin || row.kpi === 1 };
    }
  }

  const adminToken = readCookie(request);
  if (adminToken) {
    const row = await env.DB.prepare('SELECT token FROM sessions WHERE token = ? AND expires_at > ? LIMIT 1')
      .bind(adminToken, nowIso())
      .first<{ token: string }>();
    if (row) return { email: 'will@favorintl.org', name: 'Will Hamilton', picture: '', role: 'admin', via: 'password', kpi: true };
  }
  return null;
}

/** Copies the user onto the request for the functions behind the middleware, dropping any forged copy. */
export function withUserHeaders(request: Request, user: HubUser | null): Request {
  const headers = new Headers(request.headers);
  for (const h of HUB_HEADERS) headers.delete(h);
  if (user) {
    headers.set('X-Hub-Email', user.email);
    headers.set('X-Hub-Name', encodeURIComponent(user.name));
    headers.set('X-Hub-Role', user.role);
    headers.set('X-Hub-Via', user.via);
    if (user.kpi) headers.set('X-Hub-Kpi', '1');
    if (user.picture) headers.set('X-Hub-Picture', encodeURIComponent(user.picture));
    if (user.via === 'google') {
      // Receipts and foundations record who did each thing. A signed-in person is who they are.
      headers.set('X-Rcp-Actor', encodeURIComponent(user.name));
      headers.set('X-Fnd-Actor', encodeURIComponent(user.name));
    }
  }
  return new Request(request, { headers });
}

function decoded(value: string | null): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The user the middleware found, or null. Only trust this behind the middleware. */
export function hubUserOf(request: Request): HubUser | null {
  const email = request.headers.get('X-Hub-Email');
  if (!email) return null;
  const via = request.headers.get('X-Hub-Via');
  return {
    email,
    name: decoded(request.headers.get('X-Hub-Name')) || email,
    picture: decoded(request.headers.get('X-Hub-Picture')),
    role: request.headers.get('X-Hub-Role') === 'admin' ? 'admin' : 'staff',
    via: via === 'agent' || via === 'password' ? via : 'google',
    kpi: request.headers.get('X-Hub-Kpi') === '1',
  };
}
