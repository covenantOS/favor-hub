import { HttpError, newId, nowIso, timingSafeEqualStr, type Env } from '../http';

const COOKIE = 'favor_hub_receipts';
const SESSION_DAYS = 14;
const DEFAULT_CODE = 'thankyou';

function readCookie(request: Request): string {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE) return rest.join('=');
  }
  return '';
}

/** A phone capitalises the first letter and may add a space; "Thank you" opens the page as well as "thankyou". */
function plain(code: string): string {
  return code.toLowerCase().replace(/[\s-]+/g, '');
}

export function checkReceiptsCode(env: Env, code: string): boolean {
  return timingSafeEqualStr(plain(code), plain(env.RECEIPTS_CODE || DEFAULT_CODE));
}

export async function createReceiptsSession(env: Env): Promise<string> {
  const token = newId('ses').slice(4);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO rcp_sessions (token, created_at, expires_at) VALUES (?, ?, ?)').bind(token, nowIso(), expires).run();
  return token;
}

export function receiptsSessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearReceiptsSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function isReceiptsUser(env: Env, request: Request): Promise<boolean> {
  const token = readCookie(request);
  if (!token) return false;
  const row = await env.DB.prepare('SELECT token FROM rcp_sessions WHERE token = ? AND expires_at > ? LIMIT 1')
    .bind(token, nowIso())
    .first<{ token: string }>();
  return Boolean(row);
}

export async function requireReceiptsUser(env: Env, request: Request): Promise<void> {
  if (!(await isReceiptsUser(env, request))) {
    throw new HttpError(401, 'unauthorized', 'Enter the code to open thank-you receipts.');
  }
}

export async function clearReceiptsSession(env: Env, request: Request): Promise<void> {
  const token = readCookie(request);
  if (token) await env.DB.prepare('DELETE FROM rcp_sessions WHERE token = ? OR expires_at < ?').bind(token, nowIso()).run();
}

/** Who is at the keyboard. The code is shared, so the page asks once and sends the name with each change. */
export function actorOf(request: Request): string {
  const raw = (request.headers.get('X-Rcp-Actor') || '').trim();
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // keep the raw header
  }
  return name.replace(/[^\p{L}\p{N} .'-]/gu, '').slice(0, 60);
}

export function requireActor(request: Request): string {
  const who = actorOf(request);
  if (!who) throw new HttpError(400, 'no_name', 'Put your name in "Your name" first.');
  return who;
}
