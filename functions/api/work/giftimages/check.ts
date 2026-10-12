import { work, body } from '../../../_lib/work/route';
import { checkGifts, depsFor } from '../../../_lib/work/giftimages-svc';

// Ask Blackbaud whether up to 20 gifts have an attachment: 1 call each, on the gift entry lane.
export const onRequestPost = work(async ({ request, ctx, env }) => (await checkGifts(ctx, (await body(request)).giftIds, depsFor(env))) as any);
