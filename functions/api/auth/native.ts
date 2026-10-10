import { hitRateLimit } from '../../_lib/auth';
import { HttpError, asTrimmed, clientIp, errorJson, handleError, json, type Env } from '../../_lib/http';
import { favorEmailOf, logAuth, recordSignIn } from '../../_lib/session';
import { verifyNativeToken, type MobileEnv } from '../../_lib/mobile/auth';
import { createDevice } from '../../_lib/mobile/device';

// Exchange a Google ID token from the iPhone app for a device token (mobile-v1.yaml, deviceSignIn). The token is shown once.
// Checks: Google's signature, issuer, audience (web and iOS client), expiry, a fresh iat, a verified favorintl.org account,
// and hub_users.blocked. The device row stores only the SHA-256 of the token.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let email = '';
  try {
    if (await hitRateLimit(env, `native:${clientIp(request)}`, 30, 600)) {
      return errorJson('slow_down', 'Too many sign-in attempts. Wait ten minutes and try again.', 429);
    }
    const body = (await request.json().catch(() => ({}))) as { id_token?: unknown; device_name?: unknown };
    const idToken = asTrimmed(body.id_token, 'id_token', 8192);
    const deviceName = asTrimmed(body.device_name, 'device_name', 80, false) || 'iPhone';
    const claims = await verifyNativeToken(env as MobileEnv, request, idToken);
    email = String(claims.email || '').toLowerCase();
    email = favorEmailOf(env, claims);
    await recordSignIn(env, claims, email);
    const device = await createDevice(env, email, deviceName, clientIp(request), request.headers.get('User-Agent') || '');
    await logAuth(env, request, email, 'native_signed_in', `${deviceName} ${device.id}`);
    return json({ token: device.token, email, expires_at: device.expires_at });
  } catch (err) {
    if (err instanceof HttpError) await logAuth(env, request, email, 'native_refused', `${err.code}: ${err.message}`);
    // The app signs out on a 401 and shows the reason on a 403.
    return handleError(err);
  }
};
