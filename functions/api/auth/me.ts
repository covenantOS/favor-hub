import { json, type Env } from '../../_lib/http';
import { hubUserOf, signinEnforced } from '../../_lib/session';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = hubUserOf(request);
  return json({ ok: true, signedIn: Boolean(user), enforce: signinEnforced(env), user });
};
