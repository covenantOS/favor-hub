// The wrapper every Work Center route uses: the gate, the staff-worded errors and the context the service functions take.
import { HttpError, handleError, json, type Env } from '../http';
import { blackbaudRepo } from './repo';
import { requireWork, type WorkUser } from './gate';
import type { Ctx } from './service';

export interface RouteArgs {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  waitUntil: (p: Promise<unknown>) => void;
  ctx: Ctx;
  wu: WorkUser;
  url: URL;
}

/**
 * A change must come from this site's own page. A browser sends Origin on every cross-site post, so a page on another favorintl.org
 * address (which SameSite cookies do not stop) is turned away. A call with no Origin must carry the X-Hub-Request header the page
 * adds, or the agent key.
 */
export function sameSite(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return true;
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get('x-hub-request') === '1' || /^bearer /i.test(request.headers.get('authorization') || '') || !!request.headers.get('x-agent-key');
}

/** Wrap a handler. It returns an object (answered as { ok: true, ...object } unless it has its own ok) or a Response. */
export function work(handler: (a: RouteArgs) => Promise<Response | Record<string, unknown>>, opts: { adminOnly?: boolean } = {}): PagesFunction<Env> {
  return async ({ request, env, params, waitUntil }) => {
    try {
      if (!sameSite(request)) throw new HttpError(403, 'cross_site', 'That change did not come from the Work Center page. Reload the page and try again.');
      const wu = await requireWork(env, request, opts);
      const ctx: Ctx = { env, repo: blackbaudRepo(env), actor: wu.actor, email: wu.user.email };
      const out = await handler({ request, env, params: params as Record<string, string | string[]>, waitUntil, ctx, wu, url: new URL(request.url) });
      if (out instanceof Response) return out;
      return json(out.ok === undefined ? { ok: true, ...out } : out);
    } catch (err) {
      return handleError(err);
    }
  };
}

export async function body(request: Request): Promise<Record<string, any>> {
  const b = (await request.json().catch(() => ({}))) as unknown;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, any>) : {};
}

export const param = (p: Record<string, string | string[]>, k: string): string => String(Array.isArray(p[k]) ? p[k][0] : p[k] || '');
