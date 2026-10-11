import { HttpError } from '../../../../_lib/http';
import { SYSTEM_ID } from '../../../../_lib/work/partner';
import { contactView } from '../../../../_lib/work/records';
import { recordRights } from '../../../../_lib/work/records-rights';
import { param, work } from '../../../../_lib/work/route';

// The Contact tab: a partner's addresses (with start and end dates and seasonal windows), phones and emails, read live from Blackbaud
// (three calls, counted in the day's meter). Ended and inactive rows come too.
export const onRequestGet = work(async ({ ctx, params }) => {
  const id = param(params, 'id');
  if (!SYSTEM_ID.test(id)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  return { ...(await contactView(ctx, id)), can: await recordRights(ctx, id) };
});
