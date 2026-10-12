import { readBody } from '../../_lib/admin/route';
import { route } from '../../_lib/statements/route';
import { mirrorSql, statementFor, statementJson } from '../../_lib/statements/service';

// Every gift that belongs on one partner's statement for a year or a range of dates, and what was left off.
export const onRequestPost = route(async ({ env, request }) => {
  const b = await readBody(request);
  const st = await statementFor(mirrorSql(env), {
    cid: String(b.cid || ''),
    year: String(b.year || ''),
    from: String(b.from || ''),
    to: String(b.to || ''),
    includeSoft: b.includeSoft === true,
  });
  return { statement: statementJson(st) };
});
