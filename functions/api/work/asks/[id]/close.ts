import { work, body, param } from '../../../../_lib/work/route';
import { setClose } from '../../../../_lib/work/asks';

// Set or clear the close date on an ask. The date lives in the hub database only. Body: { date: 'YYYY-MM-DD' } or { date: null } to clear.
export const onRequestPut = work(async ({ ctx, request, params }) => setClose(ctx, param(params, 'id'), (await body(request)).date) as any);
