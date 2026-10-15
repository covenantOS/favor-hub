import { work, body } from '../../../../_lib/work/route';
import { requireFgl, sampleFor } from '../../../../_lib/fgl/gate';
import { batchSummary, FGL_DAYS, lettersFor, listBatches, logEvent, makeBatch, openFile } from '../../../../_lib/fgl/store';
import { SIGNER_KEYS, type SignerKey } from '../../../../_lib/fgl/wording';
import { dropPrintLock, takePrintLock, todayEastern } from '../../../../_lib/receipts/store';
import { HttpError } from '../../../../_lib/http';
import { receiptsDays } from '../../../../_lib/admin/settings';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// The print files, newest first.
export const onRequestGet = work(async ({ ctx }) => {
  requireFgl(ctx);
  return { batches: (await listBatches(ctx.env)).map(batchSummary) };
});

// Make a print file: { ids: [gift ids], letterDate, signer }. The gifts are read fresh from Blackbaud, so a gift that changed is left out.
export const onRequestPost = work(async ({ ctx, request }) => {
  requireFgl(ctx);
  const b = await body(request);
  const letterDate = typeof b.letterDate === 'string' && ISO.test(b.letterDate) ? b.letterDate : todayEastern();
  const ids = (Array.isArray(b.ids) ? b.ids.map(String) : []).filter((s) => /^(\d+|sample\d+)$/.test(s)).slice(0, 3000);
  if (!ids.length) throw new HttpError(400, 'empty', 'Pick at least one gift.');
  const signer = (SIGNER_KEYS as readonly string[]).includes(String(b.signer)) ? (b.signer as SignerKey) : 'carole';
  const days = Math.min(Math.max(Number(b.days) || (await receiptsDays(ctx.env).catch(() => FGL_DAYS)), 7), 365);
  const sample = sampleFor(ctx);
  // One print file at a time, here and on Receipts, so a gift can never sit in two files and be mailed twice.
  if (!(await takePrintLock(ctx.env, ctx.actor))) throw new HttpError(409, 'busy', 'Someone else is making a print file right now. Wait a minute, then load the page again.');
  try {
    if (await openFile(ctx.env)) throw new HttpError(409, 'open_file', 'A print file is already open. Print it and mark it, or throw it away, before you make another.');
    const { letters, skipped, appeals } = await lettersFor(ctx.env, ids, days, sample);
    const batch = await makeBatch(ctx.env, { letters, letterDate, signer, appeals, actor: ctx.actor, simulated: sample });
    await logEvent(ctx.env, ctx.actor, 'fgl_print_file', batch.id, `${batch.count} letters for ${batch.gifts} gifts, signer ${signer}; ${skipped.length} skipped${sample ? ' (test user)' : ''}`);
    return { batch: batchSummary(batch), skipped };
  } finally {
    await dropPrintLock(ctx.env);
  }
});
