import { work, param } from '../../../../_lib/work/route';
import { assertOwnBatch, undoBatch } from '../../../../_lib/work/service';

// Put a batch back the way it was. Open for 24 hours. Returns the new batch of inverse changes, which the page runs the same way.
export const onRequestPost = work(async ({ ctx, params }) => {
  await assertOwnBatch(ctx, param(params, 'id'));
  return undoBatch(ctx, param(params, 'id')) as any;
});
