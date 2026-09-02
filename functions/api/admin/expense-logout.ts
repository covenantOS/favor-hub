import { clearExpenseSession, clearExpenseSessionCookie } from '../../_lib/expenses/auth';
import { json, type Env } from '../../_lib/http';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await clearExpenseSession(env, request);
  } catch (err) {
    console.error('[expenses] logout', err);
  }
  // The cookie clear alone is enough to lock the browser; the DB row cleanup
  // is best effort and expires on its own.
  return json({ ok: true, admin: false }, 200, { 'Set-Cookie': clearExpenseSessionCookie() });
};
