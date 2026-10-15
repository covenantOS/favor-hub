import { requireExpenseAdmin } from '../../_lib/expenses/auth';
import { getSignature } from '../../_lib/expenses/db';
import { HttpError, handleError, json, type Env } from '../../_lib/http';

/** One signature picture for the expense log (GET ?id=...&who=requester|approver), under the same guard as the log itself. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireExpenseAdmin(env, request);
    const q = new URL(request.url).searchParams;
    const id = String(q.get('id') || '');
    const who = q.get('who') === 'approver' ? 'approver' : 'requester';
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) throw new HttpError(400, 'bad_id', 'Name a request.');
    const signature = await getSignature(env, id, who);
    if (!signature) throw new HttpError(404, 'no_signature', 'No signature on file.');
    return json({ ok: true, signature });
  } catch (err) {
    return handleError(err);
  }
};
