import { gift, jsonBody, pid } from '../../../../_lib/gifts/route';
import { addCash } from '../../../../_lib/gifts/capture';
import { HttpError } from '../../../../_lib/http';

export const onRequestPost = gift(async ({ request, env, params, user, actor }) => {
  const b = await jsonBody(request);
  const cents = Math.round(Number(b.amountCents));
  if (!Number.isFinite(cents) || cents < 1 || cents > 100_000_000) throw new HttpError(400, 'bad_amount', 'Enter the cash amount in dollars.');
  try {
    const g = await addCash(env, pid(params), { name: actor, email: user.email }, cents);
    return { giftId: g.id };
  } catch (e: any) {
    throw new HttpError(409, 'not_open', String(e && e.message ? e.message : e));
  }
});
