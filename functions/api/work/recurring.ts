import { work } from '../../_lib/work/route';
import { recurringResponse } from '../../_lib/recurring/service';

// Recurring gifts: every schedule from the D1 copy of Blackbaud with the hub's own finished changes laid over it. No Blackbaud calls.
export const onRequestGet = work(async ({ ctx }) => (await recurringResponse(ctx)) as any);
