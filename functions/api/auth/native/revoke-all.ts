import { HttpError, handleError, json, type Env } from '../../../_lib/http';
import { hubUserOf, logAuth } from '../../../_lib/session';
import { revokeAll } from '../../../_lib/mobile/device';

// Remote sign-out. A person (from a phone or the web hub) signs out all of their own phones. An admin names an email in the body to sign
// out a lost phone or a departed person's phones. Blocking the person in hub_users also stops every phone on its next call.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user || user.via === 'agent') throw new HttpError(401, 'signin', 'Sign in first.');
    const body = (await request.json().catch(() => ({}))) as { email?: unknown };
    const named = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (named && named !== user.email.toLowerCase() && user.role !== 'admin') throw new HttpError(403, 'admin_only', 'Only an admin can sign out another person.');
    const target = named || user.email;
    const n = await revokeAll(env, target, user.email);
    await logAuth(env, request, target, 'native_revoke_all', `by ${user.email}, ${n} phone(s)`);
    return json({ ok: true, revoked: n });
  } catch (err) {
    return handleError(err);
  }
};
