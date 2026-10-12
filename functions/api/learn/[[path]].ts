// Learn's API. The routes live in _lib/learn/route.ts so tests can call them with a stand-in database.
import { handle } from '../../_lib/learn/route';
import type { Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

export const onRequest: PagesFunction<Env> = (ctx) =>
  handle({
    request: ctx.request,
    env: ctx.env,
    user: hubUserOf(ctx.request),
    path: ([] as string[]).concat((ctx.params.path as string[] | string) || []).filter(Boolean),
    waitUntil: (p) => ctx.waitUntil(p),
  });
