import { kpiGet } from '../../_lib/hub/kpi';
import { accessOf, navCounts } from '../../_lib/hub/today';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// The sidebar: who is signed in, which sections they may open, and the counts beside each.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const access = await accessOf(env, request, user);
    // The KPI dashboard's own team map (kpi-dashboard backend/access.js) decides which of its tabs
    // show in the sidebar. A slow or failed answer leaves just the Executive page and Definitions.
    const [counts, kpiTeams] = await Promise.all([
      navCounts(env, user, access),
      user.via === 'google'
        ? kpiGet<{ teams?: string[] }>(env, '/auth/verify', { email: user.email, name: user.name })
            .then((v) => (Array.isArray(v.teams) ? v.teams : []))
            .catch(() => [] as string[])
        : Promise.resolve(['rdd', 'ce', 'pc', 'grants', 'marketing']),
    ]);
    return json({ ok: true, user, access, counts, kpiTeams });
  } catch (err) {
    return handleError(err);
  }
};
