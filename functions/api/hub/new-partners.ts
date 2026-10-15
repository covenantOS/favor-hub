import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { givingForMany, todayEt, type MirrorQ } from '../../_lib/gifts/partner-giving';
import { mirrorQ } from '../../_lib/work/partner';

// Which of these partners gave for the first time on or after a date: the "new partners" count on the year number's "This week"
// panel (public/js/drill.js). The page sends the record ids of this week's givers from the drill rows it already holds; this answers
// with the ones whose first credited gift ever falls in the span. "First credited gift" is the household's under the shared rule
// (shared/giving.ts): a gift sent through a DAF, foundation or business counts for the partner it names, and a spouse's earlier gift
// is the household's earlier gift, so a partner whose spouse gave before is not new. KPI access, read only, the D1 mirror only.

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
    const q = mirrorQ(env) as unknown as MirrorQ;
    const today = todayEt();
    for (let i = 0; i < ids.length; i += 400) {
      for (const [id, g] of await givingForMany(q, ids.slice(i, i + 400), today)) if (g.first && g.first >= since) first[id] = g.first;
    }
    return json({ ok: true, first });
  } catch (err) {
    return handleError(err);
  }
};
