import { work, body, param } from '../../../../../_lib/work/route';
import { requireFgl } from '../../../../../_lib/fgl/gate';
import { batchSummary, getBatch, markNext } from '../../../../../_lib/fgl/store';
import { dropMarkLock, takeMarkLock } from '../../../../../_lib/receipts/store';
import { HttpError } from '../../../../../_lib/http';

// Mark the next gifts in a print file acknowledged in Blackbaud (through the receipts route), dated the day on the letters. The page calls
// this until nothing is left. { retry: true } sends the ones that failed again.
export const onRequestPost = work(async ({ ctx, request, params }) => {
  requireFgl(ctx);
  const batch = await getBatch(ctx.env, param(params, 'id'));
  if (batch.status === 'cancelled') throw new HttpError(400, 'cancelled', 'This print file was thrown away.');
  const b = await body(request);
  if (!(await takeMarkLock(ctx.env, batch.id, ctx.actor))) throw new HttpError(409, 'marking', 'This file is already being marked in another window. It finishes on its own; reload in a minute.');
  try {
    const out = await markNext(ctx.env, batch, ctx.actor, b.retry === true);
    return { batch: batchSummary(await getBatch(ctx.env, batch.id)), ...out };
  } finally {
    await dropMarkLock(ctx.env, batch.id);
  }
});
