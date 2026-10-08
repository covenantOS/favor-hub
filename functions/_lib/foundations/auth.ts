import { HttpError, newId, nowIso, timingSafeEqualStr, type Env } from '../http';
import { hubUserOf, signinEnforced } from '../session';

const COOKIE = 'favor_hub_foundations';
const SESSION_DAYS = 14;
const DEFAULT_CODE = '4000';

function readCookie(request: Request): string {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE) return rest.join('=');
  }
  return '';
}

export function checkFoundationsCode(env: Env, code: string): boolean {
  return timingSafeEqualStr(code, env.FOUNDATIONS_CODE || DEFAULT_CODE);
}

export async function createFoundationsSession(env: Env): Promise<string> {
  const token = newId('ses').slice(4);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO fnd_sessions (token, created_at, expires_at) VALUES (?, ?, ?)')
    .bind(token, nowIso(), expires)
    .run();
  return token;
}

export function foundationsSessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearFoundationsSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function isFoundationsUser(env: Env, request: Request): Promise<boolean> {
  // Anyone signed in to the hub. The shared code only counts while Google sign-in is switched off.
  if (hubUserOf(request)) return true;
  if (signinEnforced(env)) return false;
  const token = readCookie(request);
  if (!token) return false;
  const row = await env.DB.prepare('SELECT token FROM fnd_sessions WHERE token = ? AND expires_at > ? LIMIT 1')
    .bind(token, nowIso())
    .first<{ token: string }>();
  return Boolean(row);
}

export async function requireFoundationsUser(env: Env, request: Request): Promise<void> {
  if (!(await isFoundationsUser(env, request))) {
    throw new HttpError(401, 'unauthorized', 'Enter the code to open the foundation list.');
  }
}

export async function clearFoundationsSession(env: Env, request: Request): Promise<void> {
  const token = readCookie(request);
  if (token) {
    await env.DB.prepare('DELETE FROM fnd_sessions WHERE token = ? OR expires_at < ?').bind(token, nowIso()).run();
  }
}

/** Who is at the keyboard. The code is shared, so the page asks once and sends the name with each change. */
export function actorOf(request: Request): string {
  const raw = (request.headers.get('X-Fnd-Actor') || '').trim();
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // keep the raw header
  }
  return name.replace(/[^\p{L}\p{N} .'-]/gu, '').slice(0, 60);
}
