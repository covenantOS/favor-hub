import { HttpError } from '../../../../_lib/http';
import { SYSTEM_ID } from '../../../../_lib/work/partner';
import { codesView, passThrough } from '../../../../_lib/work/records';
import { recordRights } from '../../../../_lib/work/records-rights';
import { param, work } from '../../../../_lib/work/route';

// The Codes tab: constituent codes (ended ones too) and solicit codes, read live from Blackbaud (two calls, plus the code tables read
// once a week). ?passthrough=1 answers the check that runs before a Partner code goes on a record.
export const onRequestGet = work(async ({ ctx, env, params, url }) => {
  const id = param(params, 'id');
  if (!SYSTEM_ID.test(id)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  if (url.searchParams.get('passthrough') === '1') return { passThrough: await passThrough(env, id) };
  return { ...(await codesView(ctx, id)), can: await recordRights(ctx, id) };
});
