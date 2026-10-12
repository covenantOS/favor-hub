import { work } from '../../_lib/work/route';
import { grantsResponse } from '../../_lib/work/grants-svc';

// Grants: the RESERVED (Grant ...) actions on foundations from the D1 copy of Blackbaud. No Blackbaud calls.
export const onRequestGet = work(async ({ ctx }) => grantsResponse(ctx) as any);
