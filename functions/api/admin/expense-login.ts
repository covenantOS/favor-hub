import { checkExpensePassword, createExpenseSession, expenseSessionCookie } from '../../_lib/expenses/auth';
import { signinEnforced } from '../../_lib/session';
import { asTrimmed, errorJson, handleError, json, type Env } from '../../_lib/http';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (signinEnforced(env)) return errorJson('signin', 'Codes no longer open the expense log. Sign in with your Favor Google account.', 410);
    const body = (await request.json()) as { password?: unknown };
    const password = asTrimmed(body.password, 'password', 200);
    if (!(await checkExpensePassword(env, password))) {
      return errorJson('bad_password', 'That password is not right.', 401);
    }
    const token = await createExpenseSession(env);
    return json({ ok: true, admin: true }, 200, { 'Set-Cookie': expenseSessionCookie(token) });
  } catch (err) {
    return handleError(err);
  }
};
