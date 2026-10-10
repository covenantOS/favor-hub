import { work, body } from '../../../_lib/work/route';
import { thankGifts, type ThankInput } from '../../../_lib/work/gifts-svc';

// Thank one gift or many. Saved as ordinary batches (Recent and Undo apply); the page then sends each one with .../batches/:id/run.
export const onRequestPost = work(async ({ request, ctx }) => (await thankGifts(ctx, (await body(request)) as ThankInput)) as any);
