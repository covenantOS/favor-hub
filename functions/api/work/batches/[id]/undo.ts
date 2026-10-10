import { work, param } from '../../../../_lib/work/route';
import { undoBatch } from '../../../../_lib/work/service';

// Put a batch back the way it was. Open for 24 hours. Returns the new batch of inverse changes, which the page runs the same way.
export const onRequestPost = work(async ({ ctx, params }) => undoBatch(ctx, param(params, 'id')) as any);
