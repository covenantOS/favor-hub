import { recordLearn, syncProgress, toursReady, progressFor } from '../../_lib/hub/tours';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// A person's progress through the guided tour and the New in FavorOS walkthroughs. GET reads it; POST takes the browser's
// copy, merges it with what is stored and answers with the result. Before db/tours.sql is applied both answer ready: false
// and the browser keeps the progress itself. A script signed in with the agent key has no progress of its own.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (user.via === 'agent' || !(await toursReady(env))) return json({ ok: true, ready: false, items: {} });
    return json({ ok: true, ready: true, items: await progressFor(env, user.email) });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (user.via === 'agent') return json({ ok: true, ready: false, items: {} });
    const b = (await request.json().catch(() => ({}))) as { items?: unknown };
    const out = await syncProgress(env, user.email, b.items);
    if (out.coreJustDone) waitUntil(recordLearn(env, user.email));
    return json({ ok: true, ready: out.ready, items: out.items });
  } catch (err) {
    return handleError(err);
  }
};
