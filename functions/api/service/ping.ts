import { errorJson, json, timingSafeEqualStr, type Env } from '../../_lib/http';

// A check the Favor Brain can run to see that it reaches the hub (and gets JSON, not a page).
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const key = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.BRAIN_HUB_KEY || !key || !timingSafeEqualStr(key, env.BRAIN_HUB_KEY)) return errorJson('signin', 'Not allowed.', 401);
  return json({ ok: true, at: new Date().toISOString() });
};
