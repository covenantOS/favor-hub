// The staff list for the request board's pickers. Routes live in _lib/requests/route.ts.
import { handle } from '../../_lib/requests/route';
import type { Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

export const onRequest: PagesFunction<Env> = (ctx) =>
  handle({ request: ctx.request, env: ctx.env, user: hubUserOf(ctx.request), path: ['people'], waitUntil: (p) => ctx.waitUntil(p) });
