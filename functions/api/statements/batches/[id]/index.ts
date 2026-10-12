import { HttpError } from '../../../../_lib/http';
import { readBody } from '../../../../_lib/admin/route';
import { route } from '../../../../_lib/statements/route';
import { emailStatements, mirrorSql } from '../../../../_lib/statements/service';
import { discard, getBatch, markPrinted, summary, type PartnerEntry } from '../../../../_lib/statements/store';

export const onRequestGet = route(async ({ env, params }) => {
  const b = await getBatch(env, params.id);
  const partners = (JSON.parse(b.partners) as PartnerEntry[]).map((p) => ({
    lookup: p.lookup,
    name: p.name,
    amount: p.cents / 100,
    basis: p.basis / 100,
    hasEmail: Boolean(p.email),
    skipped: p.skipped || '',
  }));
  return { batch: summary(b), partners };
});

// printed: the file came off the printer. discard: throw it away and put its partners back on the list.
// email: send the statements in a file to the partners who have an email address (only while Admin has it switched on).
export const onRequestPost = route(async ({ env, params, request, user }) => {
  const b = await readBody(request);
  const action = String(b.action || '');
  if (action === 'printed') return { batch: summary(await markPrinted(env, params.id, user.name)) };
  if (action === 'discard') return { batch: summary(await discard(env, params.id, user.name)) };
  if (action === 'email') {
    return { result: await emailStatements(env, mirrorSql(env), user.name, params.id, Array.isArray(b.only) ? b.only.map(String) : []) };
  }
  throw new HttpError(400, 'bad_action', 'Say printed, discard or email.');
});
