import { getSettings, sha256Hex, splitEmails, todayEt } from './db';
import { HttpError, newId, nowIso, timingSafeEqualStr, type Env } from '../http';
import { hubUserOf, signinEnforced } from '../session';

const COOKIE = 'favor_hub_expense_admin';
const SESSION_DAYS = 7;
const DEFAULT_CODE = '1234';

function readCookie(request: Request): string {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE) return rest.join('=');
  }
  return '';
}

export async function createExpenseSession(env: Env): Promise<string> {
  const token = newId('ses').slice(4); // drop prefix, keep hex
  const now = Date.now();
  const expires = new Date(now + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO expense_admin_sessions (token, created_at, expires_at) VALUES (?, ?, ?)')
    .bind(token, nowIso(), expires)
    .run();
  return token;
}

export function expenseSessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearExpenseSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/**
 * Who may open the expense log when signed in with Google: the hub admins, the approvers in the
 * settings, a substitute whose dates cover today, and the people listed under "Who else can open
 * this log".
 */
export async function expenseLogEmails(env: Env): Promise<Set<string>> {
  const settings = await getSettings(env);
  const today = todayEt();
  const { results } = await env.DB.prepare(
    'SELECT email FROM expense_approver_overrides WHERE start_date <= ? AND end_date >= ?'
  )
    .bind(today, today)
    .all<{ email: string }>();
  const all = [...splitEmails(settings.approver_email), ...settings.viewers, ...results.map((r) => r.email)];
  return new Set(all.map((e) => e.trim().toLowerCase()).filter(Boolean));
}

/**
 * Who may sign a request from the log: the approvers named on the request, the approvers in the
 * settings now, and a substitute whose dates cover today. Viewers and Will do not sign.
 */
export async function approverEmails(env: Env, rowApprovers = ''): Promise<Set<string>> {
  const settings = await getSettings(env);
  const today = todayEt();
  const { results } = await env.DB.prepare(
    'SELECT email FROM expense_approver_overrides WHERE start_date <= ? AND end_date >= ?'
  )
    .bind(today, today)
    .all<{ email: string }>();
  const all = [...splitEmails(rowApprovers), ...splitEmails(settings.approver_email), ...results.map((r) => r.email)];
  return new Set(all.map((e) => e.trim().toLowerCase()).filter(Boolean));
}

export async function isExpenseAdmin(env: Env, request: Request): Promise<boolean> {
  const user = hubUserOf(request);
  if (user) {
    if (user.role === 'admin') return true;
    if ((await expenseLogEmails(env)).has(user.email.toLowerCase())) return true;
  }
  // The codes only count while Google sign-in is switched off.
  if (signinEnforced(env)) return false;
  const token = readCookie(request);
  if (!token) return false;
  const row = await env.DB.prepare(
    'SELECT token FROM expense_admin_sessions WHERE token = ? AND expires_at > ? LIMIT 1'
  )
    .bind(token, nowIso())
    .first<{ token: string }>();
  return Boolean(row);
}

export async function requireExpenseAdmin(env: Env, request: Request): Promise<void> {
  if (await isExpenseAdmin(env, request)) return;
  if (hubUserOf(request) && signinEnforced(env)) {
    throw new HttpError(403, 'not_on_list', 'The expense log is open to the approvers and the people they add. Ask Michael Hinton or Rachel Cox to add you.');
  }
  throw new HttpError(401, 'unauthorized', 'Unlock the expense log to do that.');
}

export async function getExpenseCodeHash(env: Env): Promise<string> {
  try {
    const row = await env.DB.prepare('SELECT code_hash FROM expense_admin_settings WHERE id = 1 LIMIT 1')
      .first<{ code_hash: string }>();
    if (row?.code_hash) return row.code_hash;
  } catch {
    // Table not migrated yet: fall through to the default code.
  }
  return sha256Hex(DEFAULT_CODE);
}

export async function setExpenseCode(env: Env, code: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO expense_admin_settings (id, code_hash, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET code_hash = excluded.code_hash, updated_at = excluded.updated_at`
  )
    .bind(await sha256Hex(code), nowIso())
    .run();
}

export async function checkExpensePassword(env: Env, password: string): Promise<boolean> {
  // Will's code, only when EXPENSE_MASTER_PASSWORD is set. The old built-in 4000 is also the
  // foundations staff code, so it no longer opens this log (2026-10-08).
  const master = env.EXPENSE_MASTER_PASSWORD || '';
  if (master && timingSafeEqualStr(password, master)) return true;
  // The log's own code: stored in D1, changeable from the log UI.
  const supplied = await sha256Hex(password);
  if (timingSafeEqualStr(supplied, await getExpenseCodeHash(env))) return true;
  // Legacy env password, kept in case it was set before the code system.
  const configured = env.EXPENSE_ADMIN_PASSWORD || '';
  if (configured) return timingSafeEqualStr(password, configured);
  return false;
}

export async function clearExpenseSession(env: Env, request: Request): Promise<void> {
  const token = readCookie(request);
  if (token) {
    await env.DB.prepare('DELETE FROM expense_admin_sessions WHERE token = ? OR expires_at < ?')
      .bind(token, nowIso())
      .run();
  }
}
