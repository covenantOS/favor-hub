import { work, body } from '../../../_lib/work/route';
import { hqtyStep } from '../../../_lib/work/hqty';

// The same steps for many gifts at once (100 or fewer).
export const onRequestPost = work(async ({ request, ctx }) => {
  const b = await body(request);
  return (await hqtyStep(ctx, { ids: b.ids, to: b.to, why: b.why, req: b.req })) as any;
});
