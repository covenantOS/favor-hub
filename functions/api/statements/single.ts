import { readBody } from '../../_lib/admin/route';
import { route } from '../../_lib/statements/route';
import { makeSingle, mirrorSql, statementJson } from '../../_lib/statements/service';
import { summary } from '../../_lib/statements/store';

// Makes the print-ready PDF for one partner and keeps a record of it.
export const onRequestPost = route(async ({ env, request, user }) => {
  const b = await readBody(request);
  const { batch, statement } = await makeSingle(env, mirrorSql(env), user.name, {
    cid: String(b.cid || ''),
    year: String(b.year || ''),
    from: String(b.from || ''),
    to: String(b.to || ''),
    includeSoft: b.includeSoft === true,
  });
  return { batch: summary(batch), statement: statementJson(statement) };
});
