// The guest door for meetings: the same room routes, reached with a guest token instead of a hub sign-in. It answers only when
// MEET_GUESTS is "on", and only for the few routes a guest needs (the invitation, join, sync, event, tracks, leave, sfu).
import { route } from '../../_lib/meetroute';
import type { MeetEnv } from '../../_lib/meet';

export const onRequest: PagesFunction<MeetEnv> = (ctx) => route({ request: ctx.request, env: ctx.env, params: ctx.params, waitUntil: (p) => ctx.waitUntil(p) } as never, true);
