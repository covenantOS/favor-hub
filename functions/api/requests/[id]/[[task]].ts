// A request's task routes: send, comments, due date and Waiting on, done, follow, read. Routes live in _lib/requests/route.ts.
// Pages hands /api/requests/<id> itself to this catch-all too, so the request's own GET and PATCH go back to index.ts.
import { handle } from '../../../_lib/requests/route';
import type { Env } from '../../../_lib/http';
import { hubUserOf } from '../../../_lib/session';
import { onRequestGet as getOne, onRequestPatch as patchOne } from './index';

export const onRequest: PagesFunction<Env, 'id' | 'task'> = (ctx) => {
  const rest = ([] as string[]).concat((ctx.params.task as string[] | string) || []).filter(Boolean);
  const id = String(ctx.params.id || '');
  // /api/requests/people, notices, search and prefs can land here as well; they belong to the router.
  if (!rest.length && (id === 'people' || id === 'notices' || id === 'search' || id === 'prefs')) {
    return handle({ request: ctx.request, env: ctx.env, user: hubUserOf(ctx.request), path: [id], waitUntil: (p) => ctx.waitUntil(p) });
  }
  if (!rest.length) {
    const method = ctx.request.method.toUpperCase();
    if (method === 'GET') return getOne(ctx as unknown as Parameters<typeof getOne>[0]);
    if (method === 'PATCH') return patchOne(ctx as unknown as Parameters<typeof patchOne>[0]);
    return Response.json({ ok: false, error: 'method', message: 'Not allowed.' }, { status: 405 });
  }
  return handle({
    request: ctx.request,
    env: ctx.env,
    user: hubUserOf(ctx.request),
    path: [id, ...rest],
    waitUntil: (p) => ctx.waitUntil(p),
  });
};
