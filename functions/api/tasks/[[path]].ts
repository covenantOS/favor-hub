// Projects: /api/tasks/*. Routes live in _lib/projects/route.ts.
import { handle } from '../../_lib/projects/route';
import type { Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

export const onRequest: PagesFunction<Env, 'path'> = (ctx) => {
  const rest = ([] as string[]).concat((ctx.params.path as string[] | string) || []).filter(Boolean);
  return handle({ request: ctx.request, env: ctx.env, user: hubUserOf(ctx.request), path: ['tasks', ...rest], waitUntil: (p) => ctx.waitUntil(p) });
};