import { HttpError } from '../../../../_lib/http';
import { og, pid } from '../../../../_lib/other-gifts/route';
import { approve, removeBatch, retry, submitBatch, withdrawBatch } from '../../../../_lib/other-gifts/actions';
import { getBatch } from '../../../../_lib/other-gifts/store';
import { batchView } from '../../../../_lib/other-gifts/view';
import { isTester } from '../../../../_lib/testuser';

// submit (the enterer sends the batch for a second look), withdraw (takes it back), approve (the second person; posts every gift), retry, remove.
export const onRequestPost = og(async ({ env, params, user, actor, canApprove, isTest, post, waitUntil }) => {
  const id = pid(params);
  const action = pid(params, 'action');
  const me = { name: actor, email: user.email, admin: user.role === 'admin', canApprove };
  const b0 = await getBatch(env, id);
  if (!b0 || isTester(b0.created_by_email) !== isTest) throw new HttpError(404, 'not_found', 'That batch is not here.');
  if (action === 'submit') await submitBatch(env, me, id);
  else if (action === 'withdraw') await withdrawBatch(env, me, id);
  else if (action === 'remove') await removeBatch(env, me, id);
  else if (action === 'approve') await approve(post, me, id, waitUntil);
  else if (action === 'retry') await retry(post, me, id, waitUntil);
  else throw new HttpError(404, 'bad_action', 'Unknown step.');
  const b = await getBatch(env, id);
  return b && b.status !== 'removed' ? ((await batchView(env, b, { email: user.email, admin: me.admin, canApprove })) as unknown as Record<string, unknown>) : { removed: true };
});
