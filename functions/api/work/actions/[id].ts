import { work, param } from '../../../_lib/work/route';
import { actionDetail } from '../../../_lib/work/edit';

// One action with every field, the hub's unsent changes laid over it, and the partner beside it (last gift, giving this year,
// last contact, open actions, iWave, holders, opportunities). Mirror only: no Blackbaud call.
export const onRequestGet = work(async ({ ctx, params }) => actionDetail(ctx, param(params, 'id')));
