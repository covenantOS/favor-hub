// The wrapper every /api/statements/* route uses: a signed-in hub person who works on giving statements today
// (a hub admin, the admin desk, operations or leadership), and the same-site rule on a change.
import { HttpError, handleError, json, type Env } from '../http';
import { hubUserOf, type HubUser } from '../session';
import { audiencesOf } from '../reports/audience';
import { sameSite } from '../work/route';

export interface StmArgs {
  request: Request;
  env: Env;
  user: HubUser;
  url: URL;
  params: Record<string, string>;
}

const ALLOWED = ['admin_desk', 'operations', 'leadership'] as const;

export async function mayUseStatements(env: Env, user: HubUser): Promise<boolean> {
  if (user.role === 'admin') return true;
  const { mine } = await audiencesOf(env, user);
  return ALLOWED.some((a) => mine.has(a));
}

export function route(handler: (a: StmArgs) => Promise<Response | Record<string, unknown>>, opts: { adminOnly?: boolean } = {}): PagesFunction<Env> {
  return async ({ request, env, params }) => {
    try {
      const user = hubUserOf(request);
      if (!user) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
      if (!sameSite(request)) throw new HttpError(403, 'cross_site', 'That change did not come from the Statements page. Reload the page and try again.');
      if (opts.adminOnly && user.role !== 'admin') throw new HttpError(403, 'admin_only', 'That is for FavorOS admins.');
      if (!(await mayUseStatements(env, user))) {
        throw new HttpError(403, 'not_allowed', 'Giving statements are for the admin desk, operations and leadership. Ask the technology team if yours should open them.');
      }
      const out = await handler({ request, env, user, url: new URL(request.url), params: Object.fromEntries(Object.entries(params || {}).map(([k, v]) => [k, String(v)])) });
      if (out instanceof Response) return out;
      return json(out.ok === undefined ? { ok: true, ...out } : out);
    } catch (err) {
      return handleError(err);
    }
  };
}
