import { HttpError } from '../../../_lib/http';
import { loadPartner, mirrorQ, SYSTEM_ID } from '../../../_lib/work/partner';
import { param, work } from '../../../_lib/work/route';

// One partner, read only from the D1 mirror. The Work Center's partner page, its side panel and the iPhone route (mobile-v1.yaml,
// /api/mobile/partners/{id}) all read this one answer; `card` is the iPhone contract's Partner object.
export const onRequestGet = work(async ({ env, params }) => {
  const id = param(params, 'id');
  if (!SYSTEM_ID.test(id)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  const partner = await loadPartner(mirrorQ(env), id);
  if (!partner) throw new HttpError(404, 'no_partner', 'No partner has that number. The copy of Blackbaud refreshes at 5 AM and 5 PM, so a record added since then is not in it yet.');
  return { partner };
});
