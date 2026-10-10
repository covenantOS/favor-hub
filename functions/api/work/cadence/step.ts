import { work, body } from '../../../_lib/work/route';
import { stepCadence, type StepInput } from '../../../_lib/work/cadence-svc';

// Press one cadence step. Saved as an ordinary batch (Recent and Undo apply); the page then sends it with .../batches/:id/run.
export const onRequestPost = work(async ({ request, ctx }) => (await stepCadence(ctx, (await body(request)) as StepInput)) as any);
