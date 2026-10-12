// The QA test user. A hub account with no Google account behind it, for agents and scripts that need to be a signed-in
// admin without being a real person. Documented in docs/TEST-USER.md.
//
//   POST /api/admin/test-session   Authorization: Bearer <agent key>   ->  a normal session cookie for the tester
//
// The tester is an admin and HR, sees every fundraiser in the Work Center, and gets the sample mailbox in Mail (no Gmail).
// Real staff never see it: it is left out of the people lists, pickers and counts. Writes that reach Blackbaud, send email or
// notify a person are refused with the "test user" message.
import { timingSafeEqualStr, nowIso, type Env } from './http';

export const TESTER_EMAIL = 'tester@favorintl.org';
export const TESTER_NAME = 'FavorOS Tester';
export const TESTER_COOKIE = 'hub_tester';
export const TESTER_REFUSAL = 'This is the FavorOS test user. It cannot write to Blackbaud, send email or notify staff.';

export function isTester(email: string | null | undefined): boolean {
  return String(email || '').trim().toLowerCase() === TESTER_EMAIL;
}

/** SQL for a query over hub_users (or any table with an email column) that leaves the tester out. */
export function notTesterSql(column = 'email'): string {
  return `lower(${column}) <> '${TESTER_EMAIL}'`;
}

export function withoutTester<T extends { email?: string; id?: string }>(rows: T[]): T[] {
  return rows.filter((r) => !isTester(r.email ?? r.id));
}

/** Paths whose writes reach Blackbaud, send email or notify a person. */
const WRITE_FAMILIES = [/^\/api\/work\//, /^\/api\/gift-entry/, /^\/api\/foundations/, /^\/api\/statements/, /^\/api\/receipts\//, /^\/api\/expenses/, /^\/api\/requests/, /^\/api\/mail\//, /^\/api\/meet\/(meetings\/([^/]+\/(invite|guestlink|partners)|remind|calendar\/switch))/, /^\/api\/push/, /^\/api\/onboarding/, /^\/api\/mobile\//];
/** Steps that only read, compute or draft, so the tester may run them to reach a review screen. */
const READ_STEPS = /\/(preview|plan|check|validate|dry|review|prep|trip|suggest|autofill|fill|draft|explain|search|ask|brief|call-mode|script|rank|find-time|freebusy)(\/|$)/;

/** True when this request is the tester writing somewhere a real person or Blackbaud would feel it. */
export function testerWriteBlocked(email: string, method: string, path: string): boolean {
  if (!isTester(email)) return false;
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  if (!WRITE_FAMILIES.some((re) => re.test(path))) return false;
  if (READ_STEPS.test(path)) return false;
  return true;
}

export async function ensureTester(env: Env): Promise<void> {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO hub_users (email, name, picture, role, blocked, note, kpi, sign_ins, first_seen, last_seen, created_at, updated_at)
     VALUES (?, ?, '', 'admin', 0, 'Test user. No Google account. Left out of lists and counts.', 1, 0, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET role = 'admin', blocked = 0, kpi = 1, name = excluded.name, updated_at = excluded.updated_at`
  ).bind(TESTER_EMAIL, TESTER_NAME, now, now, now, now).run();
  await env.DB.prepare('INSERT OR IGNORE INTO hub_hr (email, set_by, set_at) VALUES (?, ?, ?)').bind(TESTER_EMAIL, 'test-session', now).run().catch(() => undefined);
}

export function agentKeyOk(env: Env, request: Request): boolean {
  const auth = request.headers.get('Authorization') || '';
  const supplied = (auth.startsWith('Bearer ') ? auth.slice(7).trim() : '') || request.headers.get('X-Agent-Key') || '';
  return Boolean(supplied && env.AGENT_API_KEY && timingSafeEqualStr(supplied, env.AGENT_API_KEY));
}
