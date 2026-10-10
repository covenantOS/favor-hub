// Native sign-in: the checks behind POST /api/auth/native. The iPhone app signs in with Google's iOS SDK and posts the ID token. The hub
// checks Google's signature, issuer, audience (the web client and the iOS client), expiry, that the token is fresh, that the account is a
// verified favorintl.org account, and that an admin has not blocked it. The app then holds a device token, never the Google token.
import { HttpError, type Env } from '../http';
import { checkGoogleClaims, googleClientId, verifyGoogleIdToken, type GoogleClaims } from '../session';

/** The iOS client id is a Pages variable (GOOGLE_IOS_CLIENT_ID) set after the client exists in Google Cloud. */
export interface MobileEnv extends Env {
  GOOGLE_IOS_CLIENT_ID?: string;
  /** Local tests only. "on" together with a localhost address accepts an unsigned "test.<claims>" token. Never set on the live site. */
  MOBILE_AUTH_TEST?: string;
  MOBILE_MIN_VERSION?: string;
  /** Private bucket for check photos. A stand-in until gift entry's own bucket (favor-gift-captures) is bound. */
  MOBILE_CAPTURES?: R2Bucket;
}

/** How old an ID token may be at sign-in. The app posts it the moment Google hands it over. */
export const FRESH_SECONDS = 10 * 60;

export function audiencesOf(env: MobileEnv): string[] {
  return [googleClientId(env), (env.GOOGLE_IOS_CLIENT_ID || '').trim()].filter(Boolean);
}

/** Test mode needs the variable and a local address, so setting the variable on the live site does nothing. */
export function testModeAllowed(env: MobileEnv, request: Request): boolean {
  if ((env.MOBILE_AUTH_TEST || '').trim().toLowerCase() !== 'on') return false;
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function b64urlJson<T>(s: string): T {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0)))) as T;
}

export async function verifyNativeToken(env: MobileEnv, request: Request, token: string): Promise<GoogleClaims> {
  let claims: GoogleClaims;
  if (token.startsWith('test.')) {
    if (!testModeAllowed(env, request)) throw new HttpError(401, 'bad_token', 'That sign-in is not valid here.');
    try {
      claims = b64urlJson<GoogleClaims>(token.slice(5));
    } catch {
      throw new HttpError(401, 'bad_token', 'That sign-in cannot be read.');
    }
    checkGoogleClaims(claims, audiencesOf(env));
  } else {
    claims = await verifyGoogleIdToken(env, token, audiencesOf(env));
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.iat !== 'number' || now - claims.iat > FRESH_SECONDS) {
    throw new HttpError(401, 'stale_signin', 'That sign-in is too old. Sign in with Google again.');
  }
  return claims;
}
