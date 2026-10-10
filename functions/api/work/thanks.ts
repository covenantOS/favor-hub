import { work } from '../../_lib/work/route';
import { thanksResponse } from '../../_lib/work/service';

// One row per gift owed, in three lanes: thanked already, probably done, owed.
export const onRequestGet = work(async ({ ctx, url }) => thanksResponse(ctx, (url.searchParams.get('owner') || '').slice(0, 20)));
