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
import { resolveDevice } from './mobile/device';
import { hubValue } from './admin/hubcache';

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

/** field: Favor field staff on an allowed partner domain. Chat, Meetings and Favor Brain only (functions/_lib/field.ts). */
export type HubRole = 'staff' | 'admin' | 'field';
export type HubVia = 'google' | 'password' | 'agent' | 'device';

export interface HubUser {
  email: string;
  name: string;
  picture: string;
  role: HubRole;
  via: HubVia;
  /** Opens the KPI dashboard in the hub. Every staff account does; the dashboard itself limits each team's tab. */
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

/** Where a device token is accepted. */
export function isDevicePath(path: string): boolean {
  return path.startsWith('/api/mobile/') || path.startsWith('/api/auth/native/');
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

/** Issuer, audience and time checks on claims already known to be Google's (or, in test mode, trusted). */
export function checkGoogleClaims(claims: GoogleClaims, audiences: string[]): void {
  const now = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new HttpError(401, 'bad_token', 'That sign-in did not come from Google.');
  if (!audiences.includes(claims.aud)) throw new HttpError(401, 'bad_token', 'That sign-in was meant for a different app.');
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw new HttpError(401, 'expired', 'That sign-in expired. Try again.');
  if (typeof claims.iat === 'number' && claims.iat > now + 300) throw new HttpError(401, 'bad_token', 'That sign-in is dated in the future. Check the computer clock.');
}

/** Checks Google's signature, issuer, audience and expiry. Account rules are checked by the caller. The web page passes no audience list and gets the web client only. */
export async function verifyGoogleIdToken(env: Env, token: string, audiences?: string[]): Promise<GoogleClaims> {
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
  checkGoogleClaims(claims, audiences && audiences.length ? audiences : [googleClientId(env)]);
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

export const DEFAULT_EXTRA_DOMAINS = 'favourafrica.org';
const CONSUMER = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com']);
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

/** Reads a saved list of extra sign-in domains: lowercase host names, no duplicates, never the main domain or a consumer mail service. */
export function parseDomains(raw: string, main = DEFAULT_DOMAIN): string[] {
  const out: string[] = [];
  for (const d of String(raw || '').toLowerCase().split(/[\s,;]+/)) {
    if (!DOMAIN_RE.test(d) || d === main || CONSUMER.has(d) || out.includes(d)) continue;
    out.push(d);
  }
  return out;
}

/** The extra domains an admin allows (Admin, People, sign-in domains). A read that fails allows none. */
export async function allowedDomains(env: Env): Promise<string[]> {
  try {
    const v = await hubValue(env, 'signin.domains');
    return parseDomains(v ?? DEFAULT_EXTRA_DOMAINS, hubDomain(env));
  } catch {
    return [];
  }
}

export interface Account {
  email: string;
  domain: string;
  /** On Favor's own Workspace domain. Anyone else is on an allowed partner domain and needs an admin's approval. */
  primary: boolean;
}

/**
 * Who Google says this is, and whether the address may ask for access: Favor's own domain, or a domain an admin listed. Both need
 * a verified address and a Google Workspace account (hd) on that same domain, so a personal account that merely uses the address
 * is refused.
 */
export async function accountOf(env: Env, claims: GoogleClaims): Promise<Account> {
  const email = String(claims.email || '').trim().toLowerCase();
  if (!email || claims.email_verified !== true) throw new HttpError(403, 'unverified', 'Google has not verified that email address.');
  const main = hubDomain(env);
  const parts = email.split('@');
  const domain = parts.length === 2 && parts[0] ? parts[1] : '';
  const hd = String(claims.hd || '').toLowerCase();
  if (domain === main) {
    favorEmailOf(env, claims);
    return { email, domain, primary: true };
  }
  const allowed = domain ? await allowedDomains(env) : [];
  if (!domain || !allowed.includes(domain) || hd !== domain) {
    throw new HttpError(403, 'wrong_domain', `Use your @${main} Google account, or the Google account your administrator gave you. You signed in as ${email}.`);
  }
  return { email, domain, primary: false };
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

/**
 * hub_who labels the kept copy of Today that the service worker holds (public/sw.js). The worker cannot read the session cookie (it is
 * HttpOnly), so this second cookie says which sign-in a kept page belongs to. Its value is an HMAC-SHA256 of the session token under a
 * server secret (the agent key), cut to 128 bits: it carries nothing the token could be rebuilt from, opens nothing on its own, differs for
 * every sign-in, and a different person or a new sign-in in the same browser gets a different value, so the old copy is not served. It also
 * covers the role and KPI access (whoScope): when either changes, the next response of any kind sets a new value and the copy drawn under the
 * old role is not served again. With no
 * secret configured the cookie is not set and nothing is kept. It lives exactly as long as the session cookie it is set beside, is cleared at
 * sign-out, and is never extended after sign-in except for a session that predates it (one day).
 */
export const WHO_COOKIE = 'hub_who';
const WHO_LAZY_SECONDS = 86400;

/** What a kept page depends on besides the sign-in: the role and KPI access the server drew it for. A change in either gives a new hub_who. */
export const whoScope = (user: Pick<HubUser, 'role' | 'kpi'>): string => `${user.role}:${user.kpi ? 1 : 0}`;

export async function hubWho(env: Pick<Env, 'AGENT_API_KEY'>, token: string, scope: string): Promise<string> {
  const secret = env.AGENT_API_KEY;
  if (!secret || !token) return '';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('hub_who:v2:' + scope + ':' + token));
  return Array.from(new Uint8Array(mac).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The Set-Cookie for a new sign-in (same lifetime as the session cookie), or null when no secret is set. */
export async function hubWhoCookie(env: Pick<Env, 'AGENT_API_KEY'>, token: string, scope: string, seconds = SESSION_DAYS * 86400): Promise<string | null> {
  const who = await hubWho(env, token, scope);
  return who ? `${WHO_COOKIE}=${who}; Path=/; Secure; SameSite=Lax; Max-Age=${seconds}` : null;
}

export function clearHubWhoCookie(): string {
  return `${WHO_COOKIE}=; Path=/; Secure; SameSite=Lax; Max-Age=0`;
}

/** The Set-Cookie that makes hub_who name this request's session and scope when it does not (an older session, or a role that changed), else null. */
export async function whoCookieFor(env: Pick<Env, 'AGENT_API_KEY'>, request: Request, scope: string): Promise<string | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const want = await hubWho(env, token, scope);
  if (!want || readCookie(request, WHO_COOKIE) === want) return null;
  return await hubWhoCookie(env, token, scope, WHO_LAZY_SECONDS);
}

/**
 * Keeps hub_who naming the signed-in session and its role on every answer the server gives that person (public/sw.js keeps Today's last page
 * under it). A role change, or a session from before the cookie, gets the new value on the next response of any kind, so the copy drawn under the
 * old role stops being served. It costs one HMAC; the response is copied only when the cookie has to change.
 */
export async function nameSession(env: Pick<Env, 'AGENT_API_KEY'>, request: Request, scope: string, res: Response): Promise<Response> {
  if (!scope || res.status === 101 || (res as Response & { webSocket?: unknown }).webSocket) return res;
  // A response that sets or clears hub_who itself (sign-in, sign-out) is left alone, so sign-out is never undone.
  if (res.headers.getSetCookie().some((c) => c.startsWith('hub_who='))) return res;
  const cookie = await whoCookieFor(env, request, scope).catch(() => null);
  if (!cookie) return res;
  const out = new Response(res.body, res);
  out.headers.append('Set-Cookie', cookie);
  return out;
}

export async function endHubSession(env: Env, request: Request): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare('DELETE FROM hub_sessions WHERE token_hash = ? OR expires_at < ?').bind(await sha256Hex(token), nowIso()).run();
}

/** Records the sign-in and returns the user, or refuses an account an admin has blocked or has not approved yet. */
export async function recordSignIn(env: Env, claims: GoogleClaims, email: string, primary = true): Promise<HubUser> {
  const now = nowIso();
  const name = String(claims.name || '').slice(0, 120);
  const picture = String(claims.picture || '').slice(0, 500);
  if (!primary) {
    // A partner-domain person is held until an admin approves them. Nothing about them opens before that.
    const known = await env.DB.prepare('SELECT blocked FROM hub_users WHERE email = ?').bind(email).first<{ blocked: number }>();
    const waiting = 'Your request is waiting for a FavorOS admin to approve it. You can sign in once they do.';
    if (!known) {
      await env.DB.prepare(
        `INSERT INTO hub_users (email, name, picture, role, blocked, pending, note, sign_ins, first_seen, last_seen, created_at, updated_at)
         VALUES (?, ?, ?, 'field', 1, 1, 'Waiting for approval', 0, ?, ?, ?, ?)`
      ).bind(email, name, picture, now, now, now, now).run();
      throw new HttpError(403, 'pending', waiting);
    }
    const p = await env.DB.prepare('SELECT pending FROM hub_users WHERE email = ?').bind(email).first<{ pending: number }>();
    if (p && p.pending) {
      await env.DB.prepare(`UPDATE hub_users SET last_seen = ?, name = CASE WHEN ? <> '' THEN ? ELSE name END WHERE email = ?`).bind(now, name, name, email).run();
      throw new HttpError(403, 'pending', waiting);
    }
  }
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
    throw new HttpError(403, 'blocked', 'This account no longer has access to FavorOS.');
  }
  await env.DB.prepare(
    'UPDATE hub_users SET sign_ins = sign_ins + 1, first_seen = COALESCE(first_seen, ?), last_seen = ? WHERE email = ?'
  )
    .bind(now, now, email)
    .run();
  const role = roleOf(env, row.email, row.role);
  return { email: row.email, name: row.name || email, picture: row.picture, role, via: 'google', kpi: role !== 'field' };
}

/** The role a stored row gives: admin, field staff or staff. The HUB_ADMINS variable keeps an address admin whatever is stored. */
export function roleOf(env: Env, email: string, stored: string): HubRole {
  if (stored === 'admin' || isAdminEmail(env, email)) return 'admin';
  return stored === 'field' ? 'field' : 'staff';
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

  // A phone's device token. It works only on the iPhone routes and the device sign-out routes, never on the rest of the hub.
  if (supplied.startsWith('fdv_') && isDevicePath(new URL(request.url).pathname)) {
    const d = await resolveDevice(env, supplied);
    if (!d) return null;
    const admin = d.role === 'admin' || isAdminEmail(env, d.email);
    return { email: d.email, name: d.name || d.email, picture: d.picture, role: admin ? 'admin' : 'staff', via: 'device', kpi: true };
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
      const role = roleOf(env, row.email, row.role);
      // Field staff keep access only while their domain is still on the allowed list.
      if (role === 'field' && !(await allowedDomains(env)).includes(row.email.split('@')[1] || '')) return null;
      return { email: row.email, name: row.name || row.email, picture: row.picture, role, via: 'google', kpi: role !== 'field' };
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
    role: request.headers.get('X-Hub-Role') === 'admin' ? 'admin' : request.headers.get('X-Hub-Role') === 'field' ? 'field' : 'staff',
    via: via === 'agent' || via === 'password' || via === 'device' ? via : 'google',
    kpi: request.headers.get('X-Hub-Kpi') === '1',
  };
}

/** A cookie-signed-in write whose Origin is another site. A request with no Origin header (scripts, older clients) passes. */
export function crossSiteWrite(request: Request, url: URL, via: string): boolean {
  const m = request.method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  if (via !== 'google' && via !== 'password') return false;
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return origin !== url.origin;
}
