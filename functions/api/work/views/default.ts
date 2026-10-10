import { work, body } from '../../../_lib/work/route';
import { getStart, putStart } from '../../../_lib/work/start';

// Where the Work Center opens for this person: the tab and the Open actions scope.
export const onRequestGet = work(async ({ ctx }) => ({ start: await getStart(ctx.env, ctx.email, ctx.scope) }));
export const onRequestPut = work(async ({ ctx, request }) => ({ start: await putStart(ctx.env, ctx.email, ctx.scope, await body(request)) }));
