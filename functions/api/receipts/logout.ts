import { clearReceiptsSession, clearReceiptsSessionCookie } from '../../_lib/receipts/auth';
import { json, type Env } from '../../_lib/http';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await clearReceiptsSession(env, request);
  } catch (err) {
    console.error('[receipts] logout', err);
  }
  return json({ ok: true, unlocked: false }, 200, { 'Set-Cookie': clearReceiptsSessionCookie() });
};
