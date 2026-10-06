import { requireActor, requireReceiptsUser } from '../../../../_lib/receipts/auth';
import { batchSummary, getBatch, logEvent } from '../../../../_lib/receipts/store';
import { acknowledge } from '../../../../_lib/receipts/worker';
import { HttpError, handleError, json, nowIso, type Env } from '../../../../_lib/http';

const CHUNK = 40;

/**
 * Mark the next gifts in a printing as thanked in Blackbaud, dated the day on the letters.
 * The page calls this until nothing is left, so a closed tab or a limit picks up where it stopped.
 * { retry: true } sends the ones that failed again.
 */
export const onRequestPost: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    await requireReceiptsUser(env, request);
    const actor = requireActor(request);
    const batch = await getBatch(env, String(params.id));
    if (batch.kind !== 'new') throw new HttpError(400, 'reprint', 'The gifts in a printing made again are already marked thanked.');
    if (batch.status === 'cancelled') throw new HttpError(400, 'cancelled', 'This print file was thrown away.');
    const body = (await request.json().catch(() => ({}))) as { retry?: unknown };
    const pending = await env.DB.prepare(
      `SELECT gift_id FROM rcp_batch_gifts WHERE batch_id = ? AND (state = 'waiting' OR (state = 'failed' AND ? = 1)) ORDER BY gift_id LIMIT ${CHUNK}`
    )
      .bind(batch.id, body.retry === true ? 1 : 0)
      .all<{ gift_id: string }>();
    const ids = pending.results.map((r) => r.gift_id);
    let stopped = '';
    if (ids.length > 0) {
      const out = await acknowledge(env, batch.id, batch.letter_date, ids);
      stopped = out.stopped;
      const at = nowIso();
      const stmts = out.results.map((r) =>
        env.DB.prepare('UPDATE rcp_batch_gifts SET state = ?, detail = ?, updated_at = ? WHERE batch_id = ? AND gift_id = ?').bind(
          r.ok ? 'marked' : stopped && r.status === 0 ? 'waiting' : 'failed',
          r.ok ? '' : `${r.status || ''} ${r.detail || ''}`.trim().slice(0, 300),
          at,
          batch.id,
          r.id
        )
      );
      if (stmts.length) await env.DB.batch(stmts);
    }
    const counts = await env.DB.prepare(
      "SELECT SUM(state = 'marked') AS marked, SUM(state = 'failed') AS failed, SUM(state = 'waiting') AS waiting FROM rcp_batch_gifts WHERE batch_id = ?"
    )
      .bind(batch.id)
      .first<{ marked: number; failed: number; waiting: number }>();
    const marked = Number(counts?.marked) || 0;
    const failed = Number(counts?.failed) || 0;
    const waiting = Number(counts?.waiting) || 0;
    const done = waiting === 0 && failed === 0;
    await env.DB.prepare('UPDATE rcp_batches SET marked = ?, mark_failed = ?, status = ?, marked_by = ?, marked_at = ? WHERE id = ?')
      .bind(marked, failed, done ? 'done' : 'marking', actor, done ? nowIso() : null, batch.id)
      .run();
    if (done && ids.length > 0) await logEvent(env, actor, 'marked', batch.id, `${marked} gifts marked thanked, dated ${batch.letter_date}`);
    return json({ ok: true, batch: batchSummary(await getBatch(env, batch.id)), marked, failed, waiting, stopped });
  } catch (err) {
    return handleError(err);
  }
};
