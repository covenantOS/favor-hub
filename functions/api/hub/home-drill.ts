import { errorJson, handleError, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { blackbaudRepo } from '../../_lib/work/repo';
import { requireWork } from '../../_lib/work/gate';
import { HOME_DRILLS, homeDrill, type HomeDrill } from '../../_lib/work/home';
import type { Ctx } from '../../_lib/work/service';

// The rows behind one Work Overview count (public/js/drill.js). Same pool and tests as the card on /api/hub/home, scoped to the same person.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!hubUserOf(request)) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const key = new URL(request.url).searchParams.get('key') || '';
    if (!(HOME_DRILLS as readonly string[]).includes(key)) return errorJson('bad_key', 'That count has no rows to open.', 400);
    const wu = await requireWork(env, request);
    const ctx: Ctx = { env, repo: blackbaudRepo(env), actor: wu.actor, email: wu.email, scope: wu.scope, testCid: wu.testCid };
    const out = await homeDrill(ctx, key as HomeDrill);
    if (!out) return errorJson('not_yours', 'Those rows are not open to your role.', 403);
    return new Response(JSON.stringify({ ok: true, ...out }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleError(err);
  }
};
