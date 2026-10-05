import { clearFoundationsSession, clearFoundationsSessionCookie } from '../../_lib/foundations/auth';
import { json, type Env } from '../../_lib/http';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await clearFoundationsSession(env, request);
  } catch (err) {
    console.error('[foundations] logout', err);
  }
  return json({ ok: true, unlocked: false }, 200, { 'Set-Cookie': clearFoundationsSessionCookie() });
};
