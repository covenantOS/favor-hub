// The wrapper every /api/admin/* route uses: a signed-in hub admin on the hub's own pages, and the same-site rule on a change.
import { HttpError, handleError, json, type Env } from '../http';
import { hubUserOf, type HubUser } from '../session';
import { sameSite } from '../work/route';

export interface AdminArgs {
  request: Request;
  env: Env;
  user: HubUser;
  url: URL;
  waitUntil: (p: Promise<unknown>) => void;
}

export function adminRoute(handler: (a: AdminArgs) => Promise<Response | Record<string, unknown>>): PagesFunction<Env> {
  return async ({ request, env, waitUntil }) => {
    try {
      const user = hubUserOf(request);
      if (!user) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
      if (user.role !== 'admin') throw new HttpError(403, 'admin_only', 'Settings are for hub admins.');
      if (!sameSite(request)) throw new HttpError(403, 'cross_site', 'That change did not come from the Admin page. Reload the page and try again.');
      const out = await handler({ request, env, user, url: new URL(request.url), waitUntil });
      if (out instanceof Response) return out;
      return json(out.ok === undefined ? { ok: true, ...out } : out);
    } catch (err) {
      return handleError(err);
    }
  };
}

export async function readBody(request: Request): Promise<Record<string, any>> {
  const b = (await request.json().catch(() => ({}))) as unknown;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, any>) : {};
}
