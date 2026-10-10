import { work, body } from '../../../_lib/work/route';
import { createBatch, type BatchInput } from '../../../_lib/work/service';
import { entryPost } from '../../../_lib/work/entry';
import { HttpError } from '../../../_lib/http';

// Save a batch of changes (complete, thank, close as thanked, reassign, reschedule, or entry rows) and its outbox, before anything goes to Blackbaud.
// The page then calls .../:id/run until nothing is left. Whitelists everywhere; ids must be open actions.
const OPS = ['complete', 'thank', 'close_thanked', 'reassign', 'reschedule', 'create'];

export const onRequestPost = work(async ({ request, ctx }) => {
  const b = (await body(request)) as BatchInput & Record<string, unknown>;
  if (!OPS.includes(String(b.op))) throw new HttpError(400, 'bad_op', 'That is not something the Work Center does.');
  if (b.op === 'create') {
    const ids = Array.isArray(b.submission_ids) ? b.submission_ids.map(String) : [];
    return entryPost(ctx, ids) as any;
  }
  const ids = Array.isArray(b.ids) ? b.ids.map(String).filter((x) => /^\d{1,12}$/.test(x)) : [];
  const out = await createBatch(ctx, { ...b, ids } as BatchInput);
  return out as any;
});
