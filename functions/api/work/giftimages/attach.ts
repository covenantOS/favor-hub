import { work } from '../../../_lib/work/route';
import { attachToGift, depsFor } from '../../../_lib/work/giftimages-svc';
import { HttpError } from '../../../_lib/http';

// Attach a check or letter image to a gift in Blackbaud (a form post): 3 calls on the gift entry lane, the bytes straight to Blackbaud's file service.
export const onRequestPost = work(async ({ request, ctx, env }) => {
  const form = await request.formData().catch(() => null);
  if (!form) throw new HttpError(400, 'bad_form', 'The form did not arrive. Try again.');
  const f = form.get('file') as unknown as File | null;
  return (await attachToGift(ctx, { giftId: String(form.get('giftId') ?? ''), kind: String(form.get('kind') ?? 'check'), file: f && typeof (f as any).arrayBuffer === 'function' ? f : null }, depsFor(env))) as any;
});
