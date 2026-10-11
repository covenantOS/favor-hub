import { HttpError } from '../../../../_lib/http';
import { SYSTEM_ID } from '../../../../_lib/work/partner';
import { recordView } from '../../../../_lib/work/records';
import { recordRights } from '../../../../_lib/work/records-rights';
import { param, work } from '../../../../_lib/work/route';

// The Record tab: the deceased and inactive marks and the three flags, live from Blackbaud (one call), with the open actions and
// current assignments from the hub's copy.
export const onRequestGet = work(async ({ ctx, params }) => {
  const id = param(params, 'id');
  if (!SYSTEM_ID.test(id)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  return { ...(await recordView(ctx, id)), can: await recordRights(ctx, id) };
});
