import { work } from '../../../_lib/work/route';
import { hqtyResponse } from '../../../_lib/work/hqty';

// HQTY letters desk: every gift of $5,000 and up with where its letter stands, read from the D1 copy of Blackbaud. No Blackbaud calls.
export const onRequestGet = work(async ({ ctx }) => (await hqtyResponse(ctx)) as any);
