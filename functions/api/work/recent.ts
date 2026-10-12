import { work } from '../../_lib/work/route';
import { recentBatches, resumeStuck, settleWaitingUndos } from '../../_lib/work/service';

// What was done in the Work Center in the last day and a half, with Undo and Try again.
export const onRequestGet = work(async ({ ctx, waitUntil }) => {
  await settleWaitingUndos(ctx).catch(() => 0);
  waitUntil(resumeStuck(ctx).catch(() => undefined));
  return { batches: await recentBatches(ctx.env, 36, ctx.scope && !ctx.scope.all ? ctx.email : undefined) };
});
