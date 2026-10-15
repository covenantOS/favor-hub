import { og, jsonBody, pid } from '../../../../_lib/other-gifts/route';
import { editGift, removeGift } from '../../../../_lib/other-gifts/actions';
import { getBatch, getGift } from '../../../../_lib/other-gifts/store';
import { batchView, giftView } from '../../../../_lib/other-gifts/view';
import { HttpError, type Env } from '../../../../_lib/http';
import { isTester } from '../../../../_lib/testuser';

async function guard(env: Env, id: string, isTest: boolean) {
  const g = await getGift(env, id);
  if (!g || g.status === 'removed' || isTester(g.created_by_email) !== isTest) throw new HttpError(404, 'not_found', 'That gift is not here.');
  return g;
}

export const onRequestPatch = og(async ({ env, q, request, params, user, actor, today, canApprove, isTest }) => {
  const id = pid(params);
  await guard(env, id, isTest);
  const me = { name: actor, email: user.email, admin: user.role === 'admin', canApprove };
  const b = await jsonBody(request);
  const patch = { ...(b.set && typeof b.set === 'object' ? (b.set as Record<string, unknown>) : {}), ...(typeof b.dupDecision === 'string' ? { dupDecision: b.dupDecision } : {}) };
  const g = await editGift(env, q, me, today, id, patch);
  const batch = (await getBatch(env, g.batch_id))!;
  return { gift: giftView(g, user.email), ...(await batchView(env, batch, me)) } as unknown as Record<string, unknown>;
});

export const onRequestDelete = og(async ({ env, params, user, actor, canApprove, isTest }) => {
  const id = pid(params);
  const g = await guard(env, id, isTest);
  const me = { name: actor, email: user.email, admin: user.role === 'admin', canApprove };
  await removeGift(env, me, id);
  const batch = (await getBatch(env, g.batch_id))!;
  return (await batchView(env, batch, me)) as unknown as Record<string, unknown>;
});
