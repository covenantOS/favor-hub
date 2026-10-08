import { json, type Env } from '../../_lib/http';
import { googleClientId, newNonce, nonceCookie, signinEnforced } from '../../_lib/session';

// The sign-in page asks for a nonce before it shows Google's button. Google writes it into the ID
// token, and google.ts only accepts a token whose nonce matches this browser's cookie.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const nonce = newNonce();
  return json({ ok: true, nonce, clientId: googleClientId(env), enforce: signinEnforced(env) }, 200, {
    'Set-Cookie': nonceCookie(nonce),
  });
};
