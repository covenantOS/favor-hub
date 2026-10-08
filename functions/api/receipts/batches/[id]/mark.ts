import { requireActor, requireReceiptsUser } from '../../../../_lib/receipts/auth';
import { batchSummary, dropMarkLock, getBatch, logEvent, syncPrintFile, takeMarkLock } from '../../../../_lib/receipts/store';
import { acknowledge } from '../../../../_lib/receipts/worker';
import { HttpError, handleError, json, nowIso, type Env } from '../../../../_lib/http';

const CHUNK = 40;
// One request keeps marking for about this long (each 40 gifts take about six seconds), so most
// files finish in one or two requests and a tab closed early leaves little behind.
const BUDGET_MS = 20_000;

/**
 * Mark the next gifts in a printing as thanked in Blackbaud, dated the day on the letters.
 * The page calls this until nothing is left, and picks a stopped run back up the next time
 * anyone opens it. { retry: true } sends the ones that failed again.
 */
export const onRequestPost: PagesFunction<Env, 'id'> = async ({ request, env, params, waitUntil }) => {
  try {
    await requireReceiptsUser(env, request);
    const actor = requireActor(request);
    const batch = await getBatch(env, String(params.id));
    if (batch.kind !== 'new') throw new HttpError(400, 'reprint', 'The gifts in a printing made again are already marked thanked.');
    if (batch.status === 'cancelled') throw new HttpError(400, 'cancelled', 'This print file was thrown away.');
    const body = (await request.json().catch(() => ({}))) as { retry?: unknown };
    if (!(await takeMarkLock(env, batch.id, actor))) {
      throw new HttpError(409, 'marking', 'This file is already being marked in another window. It finishes on its own; reload in a minute.');
    }

    let stopped = '';
    let sent = 0;
    try {
      const started = Date.now();
      let retry = body.retry === true;
      for (let round = 0; round < 12; round++) {
        const pending = await env.DB.prepare(
          `SELECT gift_id FROM rcp_batch_gifts WHERE batch_id = ? AND (state = 'waiting' OR (state = 'failed' AND ? = 1)) ORDER BY gift_id LIMIT ${CHUNK}`
        )
          .bind(batch.id, retry ? 1 : 0)
          .all<{ gift_id: string }>();
        // Failed gifts are sent again once per press, never in a loop.
        retry = false;
        const ids = pending.results.map((r) => r.gift_id);
        if (!ids.length) break;
        const out = await acknowledge(env, batch.id, batch.letter_date, ids);
        sent += ids.length;
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
        if (stopped || Date.now() - started > BUDGET_MS) break;
      }
    } finally {
      await dropMarkLock(env, batch.id);
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
    if (done && sent > 0) await logEvent(env, actor, 'marked', batch.id, `${marked} gifts marked thanked, dated ${batch.letter_date}`);
    waitUntil(syncPrintFile(env, batch.id));
    return json({ ok: true, batch: batchSummary(await getBatch(env, batch.id)), marked, failed, waiting, stopped });
  } catch (err) {
    return handleError(err);
  }
};
