import { highlights, paces, reportData, teamsOf, TEAMS } from '../../../_lib/hub/reporting';
import { errorJson, handleError, json, type Env } from '../../../_lib/http';
import { hubUserOf } from '../../../_lib/session';

// Goal pacing and the weekly highlights. The year's numbers are open to every KPI user; a team's section opens for
// the people the KPI dashboard lets into that team's tab (its own /auth/verify answer).
export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (!user.kpi) return errorJson('not_allowed', 'The KPI numbers are open to leadership.', 403);
    const [data, allowed] = await Promise.all([reportData(env, waitUntil), teamsOf(env, user)]);
    const all = paces(data);
    const mine = TEAMS.filter((t) => allowed.includes(t.access));
    const pace: Record<string, unknown> = { year: all.year };
    for (const t of mine) pace[t.key] = all[t.key];
    return json({
      ok: true,
      asOf: data.asOf,
      lastUpdated: data.lastUpdated,
      giftsAvailable: data.giftsAvailable,
      teams: mine.map((t) => ({ key: t.key, name: t.name, measure: t.measure })),
      pace,
      highlights: highlights(data, allowed),
    });
  } catch (err) {
    return handleError(err);
  }
};
