// /api/integrations/*: the pieces that tie FavorOS apps together. One router so tests call it with a stand-in database.
//   GET  context?kind=&ref=&thread=      who a meeting from this place is with, and a title (findtime.ts)
//   POST origin { meeting_id, kind, ref, thread_id? }   the meeting booked from a place: its card goes back there
import { HttpError, errorJson, handleError, json, type Env } from '../http';
import type { HubUser } from '../session';
import { contextFor, linkOrigin } from './findtime';

export interface Ctx {
  request: Request;
  env: Env;
  user: HubUser | null;
  path: string[];
  waitUntil: (p: Promise<unknown>) => void;
}

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const b = await request.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
};

export type Extra = (ctx: Ctx, method: string, url: URL) => Promise<Response | null>;
const extras: Extra[] = [];
/** Another integration adds its routes here (clips, prep, follow-up) without touching this file's own. */
export function addRoutes(h: Extra): void {
  extras.push(h);
}

export async function handle(ctx: Ctx): Promise<Response> {
  try {
    const { request, env, user, path } = ctx;
    if (!user || user.via === 'agent') throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
    const method = request.method.toUpperCase();
    const url = new URL(request.url);
    const [a] = path;
    if (a === 'context' && method === 'GET') {
      return json(await contextFor(env, user, url.searchParams.get('kind'), url.searchParams.get('ref'), url.searchParams.get('thread')));
    }
    if (a === 'origin' && method === 'POST') return json(await linkOrigin(env, user, await body(request)));
    for (const h of extras) {
      const r = await h(ctx, method, url);
      if (r) return r;
    }
    return errorJson('not_found', 'No such route.', 404);
  } catch (err) {
    return handleError(err);
  }
}
