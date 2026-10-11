// Favor Chat's API. The routes live in _lib/chat/route.ts so tests can call them with a stand-in database.
import { handle, type ChatRouteEnv } from '../../_lib/chat/route';
import { hubUserOf } from '../../_lib/session';

export const onRequest: PagesFunction<ChatRouteEnv> = (ctx) =>
  handle({
    request: ctx.request,
    env: ctx.env,
    user: hubUserOf(ctx.request),
    path: ([] as string[]).concat((ctx.params.path as string[] | string) || []),
    waitUntil: (p) => ctx.waitUntil(p),
  });
