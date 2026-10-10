import { work, param } from '../../../../_lib/work/route';
import { partnerNotes } from '../../../../_lib/work/edit';

// Notes on the partner record, read live from Blackbaud (one call, kept ten minutes).
export const onRequestGet = work(async ({ ctx, params, url }) => ({ rows: await partnerNotes(ctx, param(params, 'id'), url.searchParams.get('fresh') === '1') }));
