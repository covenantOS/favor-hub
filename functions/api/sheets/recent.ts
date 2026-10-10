import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// The last sheets the hub made for this person, newest first, for "Your sheets" on the Brain page.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const r = await env.DB.prepare("SELECT title, url, at, rows FROM hub_sheets WHERE email = ? AND state = 'ready' ORDER BY at DESC LIMIT 5").bind(user.email.toLowerCase()).all().catch(() => ({ results: [] }));
    return json({ ok: true, sheets: r.results || [] });
  } catch (err) {
    return handleError(err);
  }
};
