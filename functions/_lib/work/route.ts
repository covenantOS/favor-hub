// The wrapper every Work Center route uses: the gate, the staff-worded errors and the context the service functions take.
import { handleError, json, type Env } from '../http';
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

/** Wrap a handler. It returns an object (answered as { ok: true, ...object } unless it has its own ok) or a Response. */
export function work(handler: (a: RouteArgs) => Promise<Response | Record<string, unknown>>, opts: { adminOnly?: boolean } = {}): PagesFunction<Env> {
  return async ({ request, env, params, waitUntil }) => {
    try {
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
