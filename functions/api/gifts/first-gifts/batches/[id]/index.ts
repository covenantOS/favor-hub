import { work, param } from '../../../../../_lib/work/route';
import { requireFgl } from '../../../../../_lib/fgl/gate';
import { batchSummary, getBatch, logEvent } from '../../../../../_lib/fgl/store';
import { HttpError, nowIso } from '../../../../../_lib/http';

export const onRequestGet = work(async ({ ctx, params }) => {
  requireFgl(ctx);
  const batch = await getBatch(ctx.env, param(params, 'id'));
  const failed = await ctx.env.DB.prepare("SELECT gift_id, detail FROM fgl_batch_gifts WHERE batch_id = ? AND state = 'failed'").bind(batch.id).all<{ gift_id: string; detail: string }>();
  return { batch: batchSummary(batch), letters: JSON.parse(batch.letters), failed: failed.results };
});

// Throw away a print file that was never marked. Nothing in Blackbaud changes and the gifts go back on the list.
export const onRequestDelete = work(async ({ ctx, params }) => {
  requireFgl(ctx);
  const batch = await getBatch(ctx.env, param(params, 'id'));
  if (batch.marked > 0) throw new HttpError(409, 'marked', 'Some of these gifts are already marked acknowledged, so this print file stays on the list.');
  await ctx.env.DB.prepare("UPDATE fgl_batches SET status = 'cancelled', marked_at = ? WHERE id = ?").bind(nowIso(), batch.id).run();
  await logEvent(ctx.env, ctx.actor, 'fgl_cancel', batch.id, `${batch.count} letters, never marked`);
  return {};
});
