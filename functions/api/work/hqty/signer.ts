import { work, body } from '../../../_lib/work/route';
import { setSigner } from '../../../_lib/work/hqty';

// Who signs the HQTY letter for one gift or many (ids, 100 or fewer): terry, carole, rachel, michael, or rdd (the partner's RDD).
// Writes only the hub's own table and the last-chosen default. No Blackbaud calls.
export const onRequestPost = work(async ({ request, ctx }) => {
  const b = await body(request);
  return (await setSigner(ctx, { ids: b.ids, signer: b.signer })) as any;
});
