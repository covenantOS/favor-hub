import { HttpError, errorJson, newId, nowIso, timingSafeEqualStr, type Env } from './http';

const COOKIE = 'favor_hub_admin';
const SESSION_DAYS = 7;

export async function createSession(env: Env): Promise<string> {
  const token = newId('ses').slice(4); // drop prefix, keep hex
  const now = Date.now();
  const expires = new Date(now + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)').bind(token, nowIso(), expires).run();
  return token;
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readCookie(request: Request, name = COOKIE): string {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return '';
}

export async function isAdmin(env: Env, request: Request): Promise<boolean> {
  const token = readCookie(request);
  if (!token) return false;
  const row = await env.DB.prepare(
    'SELECT token FROM sessions WHERE token = ? AND expires_at > ? LIMIT 1'
  )
    .bind(token, nowIso())
    .first<{ token: string }>();
  return Boolean(row);
}

export async function requireAdmin(env: Env, request: Request): Promise<void> {
  if (!(await isAdmin(env, request))) {
    throw new HttpError(401, 'unauthorized', 'Unlock the board to do that.');
  }
}

export function requireAgent(env: Env, request: Request): Response | null {
  const configured = env.AGENT_API_KEY || '';
  if (!configured) return errorJson('agent_unconfigured', 'AGENT_API_KEY is not set', 503);
  const header = request.headers.get('Authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const alt = request.headers.get('X-Agent-Key') || '';
  const supplied = bearer || alt;
  if (!supplied || !timingSafeEqualStr(supplied, configured)) {
    return errorJson('forbidden', 'Invalid or missing agent key', 403);
  }
  return null;
}

export async function checkPassword(env: Env, password: string): Promise<boolean> {
  const configured = env.ADMIN_PASSWORD || '';
  if (!configured) return false;
  return timingSafeEqualStr(password, configured);
}

export async function hitRateLimit(env: Env, key: string, max: number, windowSeconds: number): Promise<boolean> {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?')
    .bind(key)
    .first<{ count: number; window_start: string }>();
  if (!row) {
    await env.DB.prepare('INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)').bind(key, new Date(now).toISOString()).run();
    return false;
  }
  const start = Date.parse(row.window_start);
  if (!Number.isFinite(start) || now - start > windowSeconds * 1000) {
    await env.DB.prepare('UPDATE rate_limits SET count = 1, window_start = ? WHERE key = ?').bind(new Date(now).toISOString(), key).run();
    return false;
  }
  if (row.count >= max) return true;
  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
  return false;
}
