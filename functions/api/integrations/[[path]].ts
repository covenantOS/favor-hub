// Cross-app integrations. The routes live in functions/_lib/integrations/route.ts.
import { handle } from '../../_lib/integrations/route';
import '../../_lib/integrations/register';
import type { Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

export const onRequest: PagesFunction<Env, 'path'> = (ctx) => {
  const path = ([] as string[]).concat((ctx.params.path as string[] | string) || []).filter(Boolean);
  return handle({ request: ctx.request, env: ctx.env, user: hubUserOf(ctx.request), path, waitUntil: (p) => ctx.waitUntil(p) });
};
