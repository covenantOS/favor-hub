import { HttpError } from '../../_lib/http';
import { readBody } from '../../_lib/admin/route';
import { route } from '../../_lib/statements/route';
import { LISTS, makeYearEnd, mirrorSql, yearEndPlan, type ListKey } from '../../_lib/statements/service';
import { summary } from '../../_lib/statements/store';

const yearOf = (v: unknown): number => {
  const y = Number(v);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new HttpError(400, 'bad_year', 'Pick a year.');
  return y;
};

// The year-end run for one gift year: each list, who has a statement in a print file, and the tie-outs.
export const onRequestGet = route(async ({ env, user, url }) => {
  return { plan: await yearEndPlan(env, mirrorSql(env), { email: user.email, name: user.name }, yearOf(url.searchParams.get('year'))) };
});

// Makes the next print file for one list.
export const onRequestPost = route(async ({ env, user, request }) => {
  const b = await readBody(request);
  const list = String(b.list || '') as ListKey;
  if (!LISTS.includes(list)) throw new HttpError(400, 'bad_list', 'Pick mail, email or other.');
  const out = await makeYearEnd(env, mirrorSql(env), { email: user.email, name: user.name }, { year: yearOf(b.year), list, includeSoft: b.includeSoft === true });
  return { batch: summary(out.batch), mismatches: out.mismatches };
});
