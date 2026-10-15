import { og, pid, bucketOf } from '../../../../_lib/other-gifts/route';
import { dropLetter, saveLetter } from '../../../../_lib/other-gifts/actions';
import { getBatch, getGift, logEvent } from '../../../../_lib/other-gifts/store';
import { batchView, giftView } from '../../../../_lib/other-gifts/view';
import { HttpError, type Env } from '../../../../_lib/http';
import { isTester } from '../../../../_lib/testuser';

async function mine(env: Env, id: string, isTest: boolean) {
  const g = await getGift(env, id);
  if (!g || g.status === 'removed' || isTester(g.created_by_email) !== isTest) throw new HttpError(404, 'not_found', 'That gift is not here.');
  return g;
}

// The notice or letter that belongs on the gift. The bytes stay in the private bucket as the master and copy to Blackbaud when the gift posts.
// The upload is the raw file: Content-Type is the type and X-File-Name the name.
export const onRequestPut = og(async ({ env, request, params, user, actor, canApprove, isTest, post, waitUntil }) => {
  const id = pid(params);
  await mine(env, id, isTest);
  const me = { name: actor, email: user.email, admin: user.role === 'admin', canApprove };
  const mime = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const name = decodeURIComponent(request.headers.get('X-File-Name') || 'notice');
  const bytes = new Uint8Array(await request.arrayBuffer());
  const g = await saveLetter(post, bucketOf(env), me, id, { bytes, mime, name }, waitUntil);
  const batch = (await getBatch(env, g.batch_id))!;
  return { gift: giftView(g, user.email), ...(await batchView(env, batch, me)) } as unknown as Record<string, unknown>;
});

export const onRequestDelete = og(async ({ env, params, user, actor, canApprove, isTest, post }) => {
  const id = pid(params);
  const g = await mine(env, id, isTest);
  const me = { name: actor, email: user.email, admin: user.role === 'admin', canApprove };
  await dropLetter(post, bucketOf(env), me, id);
  const batch = (await getBatch(env, g.batch_id))!;
  return (await batchView(env, batch, me)) as unknown as Record<string, unknown>;
});

// A letter is never public. It streams only to a signed-in person who may use Other gifts, never cached, and each look is logged.
export const onRequestGet = og(async ({ env, params, actor, isTest }) => {
  const g = await mine(env, pid(params), isTest);
  if (!g.letter_key) throw new HttpError(404, 'not_found', 'This gift has no letter.');
  const obj = await bucketOf(env).get(g.letter_key);
  if (!obj) throw new HttpError(404, 'not_found', 'That letter is not in storage.');
  await logEvent(env, { batch_id: g.batch_id, gift_id: g.id, kind: 'letter_viewed', actor });
  return new Response(obj.body, {
    headers: { 'Content-Type': g.letter_mime || 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' },
  });
});
