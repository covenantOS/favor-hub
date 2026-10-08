import { hitRateLimit } from '../../_lib/auth';
import { HttpError, asTrimmed, clientIp, errorJson, handleError, json, type Env } from '../../_lib/http';
import {
  checkNonce,
  clearNonceCookie,
  createHubSession,
  favorEmailOf,
  hubSessionCookie,
  logAuth,
  recordSignIn,
  verifyGoogleIdToken,
} from '../../_lib/session';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let email = '';
  try {
    if (await hitRateLimit(env, `signin:${clientIp(request)}`, 30, 600)) {
      return errorJson('slow_down', 'Too many sign-in attempts. Wait ten minutes and try again.', 429);
    }
    const body = (await request.json().catch(() => ({}))) as { credential?: unknown };
    const credential = asTrimmed(body.credential, 'credential', 8192);
    const claims = await verifyGoogleIdToken(env, credential);
    email = String(claims.email || '').toLowerCase();
    checkNonce(request, claims);
    email = favorEmailOf(env, claims);
    const user = await recordSignIn(env, claims, email);
    const token = await createHubSession(env, request, email);
    await logAuth(env, request, email, 'signed_in');
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', hubSessionCookie(token));
    headers.append('Set-Cookie', clearNonceCookie());
    return new Response(JSON.stringify({ ok: true, user }), { status: 200, headers });
  } catch (err) {
    if (err instanceof HttpError) await logAuth(env, request, email, 'refused', `${err.code}: ${err.message}`);
    return handleError(err);
  }
};
