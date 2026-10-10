import { work, body, param } from '../../../_lib/work/route';
import { hqtyStep } from '../../../_lib/work/hqty';

// One gift's step: printed, signed, cannot (with a reason), reset, or mailed (saves the HQTY Letter action as a batch).
export const onRequestPost = work(async ({ request, ctx, params }) => {
  const b = await body(request);
  return (await hqtyStep(ctx, { ids: [param(params, 'id')], to: b.to, why: b.why, req: b.req })) as any;
});
