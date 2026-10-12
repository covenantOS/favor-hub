import { normalizeSpec, PAGE } from '../../_lib/lists/criteria.ts';
import { pageOf } from '../../_lib/lists/run.ts';
import { hubQ, scopeOf, todayET } from '../../_lib/lists/service.ts';
import { body, work } from '../../_lib/work/route';

// One page of a list's rows.
export const onRequestPost = work(async ({ request, env, wu }) => {
  const b = await body(request);
  const spec = normalizeSpec(b.spec);
  const page = Math.max(1, Math.min(500, Math.floor(Number(b.page) || 1)));
  return { ...(await pageOf(hubQ(env), spec, todayET(), scopeOf(wu), page, PAGE)) };
});
