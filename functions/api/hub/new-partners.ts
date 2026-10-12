import { mirror } from '../../_lib/foundations/blackbaud';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { readOnly } from '../../_lib/work/repo';
import { GIVEN } from '../../_lib/work/gifts';

// Which of these partners gave for the first time on or after a date: the "new partners" count on the year number's "This week"
// panel (public/js/drill.js). The page sends the record ids of this week's givers from the drill rows it already holds; this answers
// with the ones whose first gift ever falls in the span. KPI access, read only, the D1 mirror only.
const FIRST_SQL = readOnly(`SELECT constituent_record_id AS cid, MIN(substr(gift_date, 1, 10)) AS d FROM gifts
  WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND gift_amount > 0 AND gift_type IN ${GIVEN} GROUP BY 1`);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (!user.kpi) return errorJson('not_allowed', 'The KPI numbers are open to leadership.', 403);
    const b = (await request.json().catch(() => ({}))) as { ids?: unknown; since?: unknown };
    const since = typeof b.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.since) ? b.since : '';
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter((x) => /^\d{1,12}$/.test(x)).slice(0, 2000);
    if (!since || !ids.length) return json({ ok: true, first: {} });
    const first: Record<string, string> = {};
    for (let i = 0; i < ids.length; i += 400) {
      const rows = await mirror<{ cid: string; d: string }>(env, FIRST_SQL, [JSON.stringify(ids.slice(i, i + 400))]);
      for (const r of rows) if (String(r.d) >= since) first[String(r.cid)] = String(r.d);
    }
    return json({ ok: true, first });
  } catch (err) {
    return handleError(err);
  }
};
