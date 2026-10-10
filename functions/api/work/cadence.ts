import { work } from '../../_lib/work/route';
import { cadenceResponse } from '../../_lib/work/cadence-svc';

// Cadence: the Partner Care contact rules applied to the D1 copy of Blackbaud. No Blackbaud calls.
export const onRequestGet = work(async ({ ctx, url }) => cadenceResponse(ctx, (url.searchParams.get('owner') || '').slice(0, 20)) as any);
