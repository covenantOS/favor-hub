import { copyTime } from '../../_lib/hub/copy-time';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// When the Blackbaud copy last completed a sync, for the "As of" stamps. An empty value means the
// copy has no complete sync on record, and the stamp stays hidden.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    return json({ ok: true, synced: await copyTime(env) });
  } catch (err) {
    return handleError(err);
  }
};
