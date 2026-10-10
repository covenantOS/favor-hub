import { work } from '../../_lib/work/route';
import { asksResponse } from '../../_lib/work/asks';

// The ask pipeline: every action tagged Amount of Ask in the last year, in its column. Read from the D1 copy of Blackbaud. No Blackbaud calls.
export const onRequestGet = work(async ({ ctx, url }) => asksResponse(ctx, (url.searchParams.get('owner') || '').slice(0, 20)) as any);
