import { work, param } from '../../../../_lib/work/route';
import { runBatch } from '../../../../_lib/work/service';

// Send the next chunk of a batch (up to three requests of 15 calls, about 20 seconds). The page calls this until `left` is 0.
export const onRequestPost = work(async ({ ctx, params }) => runBatch(ctx, param(params, 'id')) as any);
