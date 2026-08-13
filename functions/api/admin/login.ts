import { checkPassword, createSession, isAdmin, sessionCookie } from '../../_lib/auth';
import { asTrimmed, errorJson, handleError, json, type Env } from '../../_lib/http';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json()) as { password?: unknown };
    const password = asTrimmed(body.password, 'password', 200);
    if (!(await checkPassword(env, password))) {
      return errorJson('bad_password', 'That password is not right.', 401);
    }
    const token = await createSession(env);
    return json({ ok: true, admin: true }, 200, { 'Set-Cookie': sessionCookie(token) });
  } catch (err) {
    return handleError(err);
  }
};
