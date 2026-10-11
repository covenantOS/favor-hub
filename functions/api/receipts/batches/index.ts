import { receiptsDays } from '../../../_lib/admin/settings';
import { requireActor, requireReceiptsUser } from '../../../_lib/receipts/auth';
import {
  batchSummary,
  DEFAULT_DAYS,
  dropPrintLock,
  lettersFor,
  lettersThankedOn,
  logEvent,
  makeBatch,
  openPrintFile,
  syncPrintFile,
  takePrintLock,
  todayEastern,
  type BatchRow,
} from '../../../_lib/receipts/store';
import { HttpError, handleError, json, type Env } from '../../../_lib/http';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    await requireReceiptsUser(env, request);
    // Each load of the page tells the sync worker which file is open, so its record corrects itself.
    waitUntil(syncPrintFile(env));
    const rows = await env.DB.prepare(
      `SELECT id, kind, letter_date, appeal_code, count, gifts, amount, regular, major, recurring, first_gift, last_gift, source_date, pdf_key,
        '' AS letters, '' AS copy, marked, mark_failed, status, created_by, created_at, marked_by, marked_at, downloaded_at
       FROM rcp_batches WHERE status <> 'cancelled' ORDER BY created_at DESC LIMIT 60`
    ).all<BatchRow>();
    return json({ ok: true, batches: rows.results.map(batchSummary) });
  } catch (err) {
    return handleError(err);
  }
};

/**
 * Make a print file.
 *   { ids: [...], added: [...], letterDate }  gifts waiting now, read fresh from Blackbaud
 *   { reprintOf: "2026-08-25", letterDate }    gifts marked thanked that day, printed again
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    await requireReceiptsUser(env, request);
    const actor = requireActor(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const letterDate = typeof body.letterDate === 'string' && ISO.test(body.letterDate) ? body.letterDate : todayEastern();
    const ids = (v: unknown) => (Array.isArray(v) ? v.map(String).filter((s) => /^\d+$/.test(s)).slice(0, 3000) : []);

    if (typeof body.reprintOf === 'string') {
      if (!ISO.test(body.reprintOf)) throw new HttpError(400, 'bad_date', 'Pick the day the gifts were marked thanked.');
      const { letters, held } = await lettersThankedOn(env, body.reprintOf);
      if (letters.length === 0) throw new HttpError(404, 'none', 'No gifts were marked thanked that day, or none of them get a letter.');
      const batch = await makeBatch(env, { letters, letterDate, kind: 'reprint', sourceDate: body.reprintOf, actor });
      await logEvent(env, actor, 'reprint', batch.id, `${letters.length} letters for gifts marked ${body.reprintOf}; ${held} held back`);
      return json({ ok: true, batch: batchSummary(batch), held });
    }

    const picked = ids(body.ids);
    const added = ids(body.added);
    if (picked.length + added.length === 0) throw new HttpError(400, 'empty', 'Pick at least one gift.');
    const days = Math.min(Math.max(Number(body.days) || (await receiptsDays(env).catch(() => DEFAULT_DAYS)), 7), 365);
    // One print file at a time, so a gift can never sit in two files and be mailed twice.
    if (!(await takePrintLock(env, actor))) {
      throw new HttpError(409, 'busy', 'Someone else is making a print file right now. Wait a minute, then load the page again.');
    }
    try {
      const open = await openPrintFile(env);
      if (open) {
        throw new HttpError(409, 'open_file', 'A print file is already open. Print it and mark it thanked, or throw it away, before you make another.');
      }
      const { letters, skipped } = await lettersFor(env, picked, added, days);
      const batch = await makeBatch(env, { letters, letterDate, kind: 'new', actor });
      await logEvent(env, actor, 'print_file', batch.id, `${batch.count} letters for ${batch.gifts} gifts; ${skipped.length} skipped`);
      waitUntil(syncPrintFile(env, batch.id));
      return json({ ok: true, batch: batchSummary(batch), skipped });
    } finally {
      await dropPrintLock(env);
    }
  } catch (err) {
    return handleError(err);
  }
};
