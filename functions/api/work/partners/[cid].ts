import { work, param } from '../../../_lib/work/route';
import { partnerContext } from '../../../_lib/work/edit';

// The partner beside every edit: contact details with do-not flags, giving, last contact, recent actions, holders, iWave, opportunities.
export const onRequestGet = work(async ({ ctx, params }) => ({ partner: await partnerContext(ctx, param(params, 'cid')) }));
