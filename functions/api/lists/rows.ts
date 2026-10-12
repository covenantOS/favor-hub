import { normalizeSpec, PAGE } from '../../_lib/lists/criteria.ts';
import { pageOf } from '../../_lib/lists/run.ts';
import { contactAccess, hubQ, scopeOf, todayET } from '../../_lib/lists/service.ts';
import { mirror } from '../../_lib/foundations/blackbaud';
import { body, work } from '../../_lib/work/route';

// One page of a list's rows. Mailing and contact columns are read from Blackbaud for these rows only.
export const onRequestPost = work(async ({ request, env, wu }) => {
  const b = await body(request);
  const spec = normalizeSpec(b.spec);
  const page = Math.max(1, Math.min(500, Math.floor(Number(b.page) || 1)));
  const contacts = await contactAccess(env, wu.email, wu.scope.all);
  const live = { contacts, mirror: (sql: string, p: unknown[]) => mirror(env, sql, p) as Promise<any[]> };
  return { ...(await pageOf(hubQ(env), spec, todayET(), scopeOf(wu), page, PAGE, live)), contacts };
});
