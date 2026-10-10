import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { workAccessFor } from '../../_lib/work/gate';

// Whether this person may open the Work Center, and why not. The page asks first so it can show the right gate screen.
// Admins may add ?as=<email> to see another person's answer.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const as = new URL(request.url).searchParams.get('as');
    const admin = user.role === 'admin' && !as;
    const email = as && user.role === 'admin' ? as.trim().toLowerCase() : user.email;
    const a = await workAccessFor(env, email, admin);
    return json({ ok: true, open: a.ok, admin: a.admin, reason: a.reason, release: a.release, name: user.name });
  } catch (err) {
    return handleError(err);
  }
};
