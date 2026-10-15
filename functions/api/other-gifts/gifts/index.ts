import { og, jsonBody } from '../../../_lib/other-gifts/route';
import { createGift } from '../../../_lib/other-gifts/actions';
import { getBatch } from '../../../_lib/other-gifts/store';
import { batchView, giftView } from '../../../_lib/other-gifts/view';

// Save a gift into this person's open batch for the day (the batch is made on the first save).
export const onRequestPost = og(async ({ env, q, request, user, actor, today, canApprove }) => {
  const b = await jsonBody(request);
  const me = { name: actor, email: user.email, admin: user.role === 'admin', canApprove };
  const set = b.set && typeof b.set === 'object' ? (b.set as Record<string, unknown>) : {};
  const g = await createGift(env, q, me, today, { ...set, kind: b.kind ?? set.kind });
  const batch = (await getBatch(env, g.batch_id))!;
  return { gift: giftView(g, user.email), ...(await batchView(env, batch, me)) } as unknown as Record<string, unknown>;
});
