import { work, body } from '../../../_lib/work/route';
import { saveMonthText } from '../../../_lib/work/hqty';

// Save the letter text for one month ({amount}, {fund} and {date} are the merge fields).
export const onRequestPost = work(async ({ request, ctx }) => {
  const b = await body(request);
  return { saved: await saveMonthText(ctx, String(b.month || ''), b.body) };
});
