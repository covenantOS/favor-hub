import { explainKey, paces, reportData, teamsOf, TEAMS } from '../../../_lib/hub/reporting';
import { paceMethod, paceSentence } from '../../../_lib/hub/reporting-math';
import { errorJson, handleError, json, type Env } from '../../../_lib/http';
import { hubUserOf } from '../../../_lib/session';

// What is in a number and why it changed since last month: the year or one team, from the KPI dashboard's own figures
// and the month's gifts. A team's number opens for the people the KPI dashboard lets into that team's tab.
export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (!user.kpi) return errorJson('not_allowed', 'The KPI numbers are open to leadership.', 403);
    const key = new URL(request.url).searchParams.get('key') || '';
    const team = TEAMS.find((t) => t.key === key);
    if (key !== 'year' && !team) return errorJson('bad_key', 'That number has no explanation to open.', 400);
    if (team && !(await teamsOf(env, user)).includes(team.access)) return errorJson('not_allowed', "That team's numbers are not open to your account.", 403);
    const data = await reportData(env, waitUntil);
    const p = paces(data)[key];
    return json({ ok: true, change: explainKey(data, key), pace: p || null, paceSentence: p ? paceSentence(p) : '', paceMethod: p ? paceMethod(p) : '' });
  } catch (err) {
    return handleError(err);
  }
};
