// The Favor brain page's calls, passed to the brain (mcp.favorintl.org/hub/...) with the hub's key and
// the signed-in person's email. The brain keeps the access rules; the hub only says who is asking.
import { errorJson, handleError, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

const BRAIN_URL = 'https://mcp.favorintl.org';
const ROUTES = new Set(['GET me', 'POST request', 'GET admin/overview', 'POST admin/decide', 'POST admin/grant', 'POST admin/reset']);

export const onRequest: PagesFunction<Env & { BRAIN_HUB_KEY?: string; BRAIN_URL?: string }> = async ({ request, env, params }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const path = ([] as string[]).concat((params.path as string[] | string) || []).join('/');
    if (!ROUTES.has(`${request.method} ${path}`)) return errorJson('not_found', 'No such brain route.', 404);
    if (!env.BRAIN_HUB_KEY) return errorJson('not_set_up', 'The brain is not connected to the hub yet.', 503);
    const res = await fetch(`${(env.BRAIN_URL || BRAIN_URL).replace(/\/$/, '')}/hub/${path}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${env.BRAIN_HUB_KEY}`,
        'X-Acting-Email': user.email,
        'X-Acting-Name': encodeURIComponent(user.name || user.email).replace(/%20/g, ' '),
        'Content-Type': 'application/json',
        'User-Agent': 'favor-hub',
      },
      body: request.method === 'POST' ? await request.text() : undefined,
    });
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleError(err);
  }
};
