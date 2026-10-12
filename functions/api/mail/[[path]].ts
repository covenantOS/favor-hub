// Mail in FavorOS. The routes live in _lib/mail/route.ts so tests can call them with a stand-in for Gmail.
import { handle } from '../../_lib/mail/route';
import type { Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

export const onRequest: PagesFunction<Env> = (ctx) =>
  handle({
    request: ctx.request,
    env: ctx.env,
    user: hubUserOf(ctx.request),
    path: ([] as string[]).concat((ctx.params.path as string[] | string) || []),
  });
