import { gift, pid } from '../../../../_lib/gifts/route';
import { depositRevenue } from '../../../../_lib/gifts/revenue';
import { HttpError } from '../../../../_lib/http';

// The Daily Revenue Report built from this deposit's own gifts (functions/_lib/gifts/revenue.ts), for the deposit page once its batch
// is in Blackbaud. Read only.
export const onRequestGet = gift(async ({ env, params }) => {
  const r = await depositRevenue(env, pid(params));
  if (!r) throw new HttpError(404, 'not_found', 'That deposit is not here.');
  return { revenue: r };
});
