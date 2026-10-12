import { work, body } from '../../../_lib/work/route';
import { logFollowUp, type FollowInput } from '../../../_lib/work/declines-svc';

// Log one follow-up on a decline. Saved as an ordinary batch (Recent and Undo apply); the page then sends it with .../batches/:id/run.
export const onRequestPost = work(async ({ request, ctx }) => (await logFollowUp(ctx, (await body(request)) as FollowInput)) as any);
