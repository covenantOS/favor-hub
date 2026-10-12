import { errorJson } from '../../_lib/http';
import { PERIODS, REPORTS, reportOf, runReport } from '../../_lib/lists/reports.ts';
import { hubQ, scopeOf, todayET } from '../../_lib/lists/service.ts';
import { mirror } from '../../_lib/foundations/blackbaud';
import { kpiFigures } from '../../_lib/reports/tieout';
import { work } from '../../_lib/work/route';

// The standard reports. Each one covers every partner, so a person whose Work Center access is limited to their own partners sees the
// list but cannot open them; they build the same view in Lists, where the scope applies.
export const onRequestGet = work(async ({ env, wu, url }) => {
  const scope = scopeOf(wu);
  const list = REPORTS.map((r) => ({ id: r.id, name: r.name, group: r.group, about: r.about, params: r.params, open: scope.all }));
  const id = url.searchParams.get('id');
  if (!id) return { reports: list, periods: PERIODS };
  const def = reportOf(id);
  if (!def) return errorJson('no_report', 'There is no report by that name.', 404);
  if (!scope.all) return errorJson('not_allowed', 'This report covers every partner. Build the same view in Lists, which shows the partners you hold.', 403);
  const asked: Record<string, string> = {};
  for (const [k, v] of url.searchParams) if (k !== 'id') asked[k] = v;
  const k = await kpiFigures(env).catch(() => null);
  const kpi = k ? { monthlyGiving: k.monthlyGiving, ytdRevenue: k.ytdRevenue, status: k.status ? { active: k.status.active, lybunt: k.status.lybunt, lapsed: k.status.lapsed } : null } : null;
  const res = await runReport(def, hubQ(env), todayET(), asked, kpi, (sql, p) => mirror(env, sql, p) as Promise<any[]>);
  return { id, name: def.name, about: def.about, params: def.params, ...res };
});
