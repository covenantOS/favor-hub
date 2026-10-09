import { revoke } from '../../_lib/hub/google';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// Disconnect: revokes the token at Google and deletes it here.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user || user.via !== 'google') return errorJson('signin', 'Sign in first.', 401);
    await revoke(env, user.email);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};
