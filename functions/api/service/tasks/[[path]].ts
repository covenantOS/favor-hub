// The Favor Brain's door into Projects: /api/service/tasks/brain. It checks the shared key itself (see _lib/projects/links/brain.ts).
import { serviceDoor } from '../../../_lib/projects/links/brain';
import { errorJson, type Env } from '../../../_lib/http';

export const onRequest: PagesFunction<Env, 'path'> = (ctx) => {
  const rest = ([] as string[]).concat((ctx.params.path as string[] | string) || []).filter(Boolean);
  if (rest[0] !== 'brain') return errorJson('not_found', 'No such route.', 404);
  return serviceDoor(ctx.env, ctx.request);
};
