import { work } from '../../_lib/work/route';
import { declinesResponse } from '../../_lib/work/declines-svc';

// Declines: declined recurring payments and zeroed gifts from the D1 copy of Blackbaud, with the hub's follow-ups laid over them. No Blackbaud calls.
export const onRequestGet = work(async ({ ctx }) => declinesResponse(ctx) as any);
