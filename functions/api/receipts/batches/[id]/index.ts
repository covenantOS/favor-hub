import { requireActor, requireReceiptsUser } from '../../../../_lib/receipts/auth';
import { batchSummary, getBatch, logEvent } from '../../../../_lib/receipts/store';
import { HttpError, handleError, json, nowIso, type Env } from '../../../../_lib/http';

export const onRequestGet: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    await requireReceiptsUser(env, request);
    const batch = await getBatch(env, String(params.id));
    const failed = await env.DB.prepare("SELECT gift_id, detail FROM rcp_batch_gifts WHERE batch_id = ? AND state = 'failed'")
      .bind(batch.id)
      .all<{ gift_id: string; detail: string }>();
    return json({ ok: true, batch: batchSummary(batch), letters: JSON.parse(batch.letters), failed: failed.results });
  } catch (err) {
    return handleError(err);
  }
};

/** Throw away a print file that was never marked. Nothing in Blackbaud changes. */
export const onRequestDelete: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    await requireReceiptsUser(env, request);
    const actor = requireActor(request);
    const batch = await getBatch(env, String(params.id));
    if (batch.marked > 0) throw new HttpError(409, 'marked', 'Some of these gifts are already marked thanked, so this printing stays on the list.');
    await env.DB.prepare("UPDATE rcp_batches SET status = 'cancelled', marked_at = ? WHERE id = ?").bind(nowIso(), batch.id).run();
    await logEvent(env, actor, 'cancel', batch.id, `${batch.count} letters, never marked`);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};
