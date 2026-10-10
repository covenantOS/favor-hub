import { work, param } from '../../../../_lib/work/route';
import { retryBatch } from '../../../../_lib/work/service';

// Queue the changes that did not go through again. A create is checked against the partner's actions first, so it is never sent twice.
export const onRequestPost = work(async ({ ctx, params }) => retryBatch(ctx, param(params, 'id')) as any);
