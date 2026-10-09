import { kpiSummary } from '../../_lib/hub/kpi';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// The year against goal and each team against its goal, from the KPI dashboard itself.
// Every signed-in staff member sees these top-line numbers.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (!user.kpi) return errorJson('not_allowed', 'The KPI numbers are open to leadership.', 403);
    return json({ ok: true, summary: await kpiSummary(env) });
  } catch (err) {
    return handleError(err);
  }
};
