// The review thread on one gift entry row. The gift() wrapper answers 401 without a sign-in and 403 for anyone who is not an admin.
import { gift, jsonBody, pid } from '../../../../_lib/gifts/route';
import { addComment, commentsOf, reviewState } from '../../../../_lib/gifts/comments';
import { getGift } from '../../../../_lib/gifts/store';
import { HttpError, type Env } from '../../../../_lib/http';

async function liveGift(env: Env, id: string) {
  const g = await getGift(env, id);
  if (!g || g.status === 'removed') throw new HttpError(404, 'not_found', 'That row is not here.');
  return g;
}

export const onRequestGet = gift(async ({ env, params }) => {
  const id = pid(params);
  await liveGift(env, id);
  const thread = await commentsOf(env, id);
  return { giftId: id, thread, review: reviewState(thread) };
});

// Comment, mark needs a fix (text required), or mark resolved. Nothing here changes the row's money fields or the Blackbaud batch.
export const onRequestPost = gift(async ({ request, env, params, user }) => {
  const id = pid(params);
  const g = await liveGift(env, id);
  const comment = await addComment(env, g, { email: user.email, name: user.name || user.email }, await jsonBody(request));
  const thread = await commentsOf(env, id);
  return { comment, thread, review: reviewState(thread) };
});
