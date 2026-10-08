import { isFoundationsUser } from '../../_lib/foundations/auth';
import { json, type Env } from '../../_lib/http';
import { hubUserOf, signinEnforced } from '../../_lib/session';

// name is set when the person signed in with Google; the page then skips "Entered by".
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = hubUserOf(request);
  return json({
    ok: true,
    unlocked: await isFoundationsUser(env, request),
    name: user && user.via === 'google' ? user.name : '',
    signin: signinEnforced(env),
  });
};
