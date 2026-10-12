import { APP2_SETTING_AUDIENCE, APP2_SETTING_ROUTES, MIGRATED_ROUTES, parseRoutes } from '../../../shared/app2';
import { app2Response } from '../../../shared/schemas/app2';
import { hubDel, hubPut } from '../../_lib/admin/settings';
import { hasOptInCookie, inAudience, optInCookie, readApp2Settings } from '../../_lib/app2';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// The switch for the React front end.
//   GET   who may use it and which routes it serves for them (the classic pages read this to decide whether a link loads whole).
//   POST  { on: true | false } opts this browser in or out (the hub_app2 cookie). Only someone in the audience can opt in.
//   PUT   admin only: { routes: "/" | "*" | "" , audience: "admin" | "all" } saves the two hub settings. Empty routes turns it off for everyone.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const s = await readApp2Settings(env);
    const eligible = inAudience(user, s) && s.routes.length > 0;
    return json(app2Response.parse({ ok: true, eligible, optedIn: eligible && hasOptInCookie(request), routes: eligible ? s.routes : [], audience: s.audience }));
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const b = (await request.json().catch(() => ({}))) as { on?: unknown };
    const s = await readApp2Settings(env);
    const on = b.on === true && inAudience(user, s) && s.routes.length > 0;
    const res = json({ ok: true, optedIn: on, routes: on ? s.routes : [] });
    res.headers.append('Set-Cookie', optInCookie(s.routes, on));
    return res;
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (user.role !== 'admin') return errorJson('forbidden', 'Only an admin can change this.', 403);
    const b = (await request.json().catch(() => ({}))) as { routes?: unknown; audience?: unknown };
    if (typeof b.routes === 'string') {
      const routes = parseRoutes(b.routes);
      if (b.routes.trim() && !routes.length) return errorJson('bad_routes', `Routes the app serves: ${MIGRATED_ROUTES.join(', ')}.`, 400);
      if (routes.length) await hubPut(env, APP2_SETTING_ROUTES, b.routes.trim() === '*' ? '*' : routes.join(','), user.email);
      else await hubDel(env, APP2_SETTING_ROUTES);
    }
    if (b.audience === 'admin' || b.audience === 'all') await hubPut(env, APP2_SETTING_AUDIENCE, b.audience, user.email);
    const s = await readApp2Settings(env);
    return json({ ok: true, routes: s.routes, audience: s.audience });
  } catch (err) {
    return handleError(err);
  }
};
