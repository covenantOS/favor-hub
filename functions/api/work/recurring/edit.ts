import { work, body } from '../../../_lib/work/route';
import { editSchedule, type EditInput } from '../../../_lib/recurring/service';

// Change one schedule's amount, frequency or status. Goes to Blackbaud through SKY API and is read back before it answers.
// The page then sends the record note it saved with .../batches/:id/run.
export const onRequestPost = work(async ({ request, ctx }) => (await editSchedule(ctx, (await body(request)) as EditInput)) as any);
