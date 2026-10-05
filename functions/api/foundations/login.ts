import { hitRateLimit } from '../../_lib/auth';
import { checkFoundationsCode, createFoundationsSession, foundationsSessionCookie } from '../../_lib/foundations/auth';
import { asTrimmed, clientIp, errorJson, handleError, json, type Env } from '../../_lib/http';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (await hitRateLimit(env, `fnd-login:${clientIp(request)}`, 12, 600)) {
      return errorJson('slow_down', 'Too many tries. Wait ten minutes and try again.', 429);
    }
    const body = (await request.json()) as { code?: unknown };
    const code = asTrimmed(body.code, 'code', 64);
    if (!checkFoundationsCode(env, code)) return errorJson('bad_code', 'That code is not right.', 401);
    const token = await createFoundationsSession(env);
    return json({ ok: true, unlocked: true }, 200, { 'Set-Cookie': foundationsSessionCookie(token) });
  } catch (err) {
    return handleError(err);
  }
};
