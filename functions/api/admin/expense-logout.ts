import { clearExpenseSession, clearExpenseSessionCookie } from '../../_lib/expenses/auth';
import { json, type Env } from '../../_lib/http';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  await clearExpenseSession(env, request);
  return json({ ok: true, admin: false }, 200, { 'Set-Cookie': clearExpenseSessionCookie() });
};
