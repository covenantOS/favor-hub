// Meetings API for signed-in staff. The routes live in _lib/meetroute.ts so the guest door (api/meet-guest) shares them.
import { route } from '../../_lib/meetroute';
import type { MeetEnv } from '../../_lib/meet';

export const onRequest: PagesFunction<MeetEnv> = (ctx) => route({ request: ctx.request, env: ctx.env, params: ctx.params, waitUntil: (p) => ctx.waitUntil(p) } as never, false);
