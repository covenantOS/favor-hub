import { HttpError } from '../../../../_lib/http';
import { og, pid } from '../../../../_lib/other-gifts/route';
import { getBatch } from '../../../../_lib/other-gifts/store';
import { batchView } from '../../../../_lib/other-gifts/view';
import { isTester } from '../../../../_lib/testuser';
import { runBatch } from '../../../../_lib/other-gifts/post';

export const onRequestGet = og(async ({ env, params, user, canApprove, isTest, post, waitUntil }) => {
  const b = await getBatch(env, pid(params));
  // A batch a test account made is invisible to real staff, and the other way round.
  if (!b || b.status === 'removed' || isTester(b.created_by_email) !== isTest) throw new HttpError(404, 'not_found', 'That batch is not here.');
  // A person looking at a batch that still has gifts to post nudges it along, so nothing waits on a person remembering.
  if (b.status === 'posting' || b.status === 'needs_person') waitUntil(runBatch(post, b.id).catch(() => undefined));
  return (await batchView(env, b, { email: user.email, admin: user.role === 'admin', canApprove })) as unknown as Record<string, unknown>;
});
