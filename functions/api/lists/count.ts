import { normalizeSpec } from '../../_lib/lists/criteria.ts';
import { countList, mailLeftOut, tieOut } from '../../_lib/lists/run.ts';
import { hubQ, scopeOf, todayET } from '../../_lib/lists/service.ts';
import { kpiFigures } from '../../_lib/reports/tieout';
import { body, work } from '../../_lib/work/route';

// The live count while a list is being built, the KPI tie-out when the list is only a status, and how many the mail-ready rule left out.
export const onRequestPost = work(async ({ request, env, wu }) => {
  const b = await body(request);
  const spec = normalizeSpec(b.spec);
  const q = hubQ(env);
  const today = todayET();
  const scope = scopeOf(wu);
  const started = Date.now();
  const [count, leftOut] = await Promise.all([countList(q, spec, today, scope), mailLeftOut(q, spec, today, scope)]);
  const kpi = scope.all && b.tie !== false ? await kpiFigures(env).catch(() => null) : null;
  const tie = scope.all ? await tieOut(q, spec, today, kpi?.status ?? null) : null;
  return { count, tie, leftOut, ms: Date.now() - started };
});
