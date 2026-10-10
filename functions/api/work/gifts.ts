import { work } from '../../_lib/work/route';
import { giftsResponse } from '../../_lib/work/gifts-svc';

// Gifts to thank: every gift on the partners a director holds that has no thank-you yet, read from the D1 copy of Blackbaud. No Blackbaud calls.
export const onRequestGet = work(async ({ ctx, url }) => giftsResponse(ctx, (url.searchParams.get('owner') || '').slice(0, 20)) as any);
