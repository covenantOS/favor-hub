import { errorJson, handleError, type Env } from '../_lib/http';
import { hubUserOf } from '../_lib/session';

// The click-to-explain panels (public/js/drill.js): the gifts behind a Favor number and its definition. The Favor
// Brain computes both with the rules it uses for its own answers (mcp.favorintl.org/hub/drill); this only checks
// who is asking and passes the request on. Definitions open to any signed-in staff; numbers need the KPI access.
const BRAIN_URL = 'https://mcp.favorintl.org';
const MAX_BODY = 2000;

type DrillEnv = Env & { BRAIN_HUB_KEY?: string; BRAIN_URL?: string };

export const onRequestPost: PagesFunction<DrillEnv> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const raw = await request.text();
    if (raw.length > MAX_BODY) return errorJson('too_big', 'That request is too long.', 413);
    let body: { kind?: string } = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return errorJson('bad_body', 'Send the request as JSON.', 400);
    }
    if (body.kind !== 'definition' && !user.kpi) return errorJson('not_allowed', 'The KPI numbers are open to leadership.', 403);
    if (!env.BRAIN_HUB_KEY) return errorJson('not_set_up', 'The Favor Brain is not connected to the hub yet.', 503);
    const base = (env.BRAIN_URL || BRAIN_URL).replace(/\/$/, '');
    const res = await fetch(`${base}/hub/drill`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.BRAIN_HUB_KEY}`,
        'X-Acting-Email': user.email,
        'X-Acting-Name': encodeURIComponent(user.name || user.email).replace(/%20/g, ' '),
        'Content-Type': 'application/json',
        'User-Agent': 'favor-hub',
      },
      body: raw,
    });
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleError(err);
  }
};
