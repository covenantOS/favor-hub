// Approving a batch of other gifts posts each gift to Blackbaud through SKY API: POST /gift/v1/gifts, with the soft credit in the same
// body, then the letter as an attachment on the saved gift. The route is favorintl.org's /api/blackbaud/gift-entry (its own lane of 400
// calls a day), reached through bbSender. SKY has a route for every step here, so the NXT web view gift service is not needed; if
// Blackbaud turns a soft credit down (constituency rules), the gift row says so and a person finishes it through the web view tools.
//
// Rules that keep a retry from making a second gift:
//   - each gift is claimed with one UPDATE guarded by its status before anything is sent, so two runs never send the same gift;
//   - after a lost answer (or a claim that went stale) the gift is 'check': the next run reads the partner's gifts on that day and
//     adopts the one whose Reference carries "hub <id>" before it sends again;
//   - a 4xx from Blackbaud is final for that gift until a person edits it or presses Try again; a wait, a cap or a 5xx retries on a
//     backoff, five attempts at most.
import { saveEntryTribute } from '../tributes/store';
import { nowIso, type Env } from '../http';
import { isTester, notTesterSql } from '../testuser';
import { BACKOFF_MIN, MAX_ATTEMPTS, recordLane } from '../gifts/flow';
import { sayWhy, type BbAnswer, type BbCall, type BbSend } from '../gifts/bb';
import { getBatch, giftsOf, logEvent, updateGift } from './store';
import { blockers, giftBody, letterFileName, type OgBatch, type OgGift } from './rules';

export interface PostCtx {
  env: Env;
  send: BbSend;
  /** Test accounts never reach Blackbaud: the sender is a stand-in and attachments are skipped. */
  simulated?: boolean;
  now?: () => Date;
  /** The letter's bytes from the private bucket, and the PUT to Blackbaud's file service. Tests pass stand-ins. */
  letterBytes?: (key: string) => Promise<Uint8Array | null>;
  put?: (url: string, init: RequestInit) => Promise<Response>;
}

const clock = (c: PostCtx) => (c.now ? c.now() : new Date());
const iso = (c: PostCtx) => clock(c).toISOString();

/** A stand-in for Blackbaud: the test accounts approve batches without a call leaving FavorOS. */
export function simulatedSender(): BbSend {
  let n = 0;
  return async (calls: BbCall[]): Promise<BbAnswer> => ({
    results: calls.map((c) => {
      if (c.method === 'POST' && c.path === '/gift/v1/gifts') return { ok: true, status: 200, body: { id: `TEST-${Date.now().toString(36)}-${++n}` } };
      return { ok: true, status: 200, body: { value: [] } };
    }),
  });
}

type Class = 'wait' | 'retry' | 'final';

async function lookup(c: PostCtx, g: OgGift): Promise<{ id: string } | 'none' | { err: Class; msg: string }> {
  const a = await c.send([{ method: 'GET', path: `/gift/v1/gifts?constituent_id=${g.partner_id}&start_gift_date=${g.gift_date}&end_gift_date=${g.gift_date}&limit=50` }]);
  await recordLane(c.env, a);
  if (a.capped) return { err: 'wait', msg: a.wait || 'At the daily limit.' };
  const r = a.results[0];
  if (!r) return { err: 'retry', msg: a.wait || 'Blackbaud did not answer.' };
  if (!r.ok) return { err: r.status >= 500 || r.status === 429 ? 'retry' : 'final', msg: sayWhy(r.body) };
  const list: any[] = (r.body && (r.body.value || r.body.gifts)) || [];
  const hit = list.find((x) => String(x.reference || '').includes(`hub ${g.id}`));
  return hit ? { id: String(hit.id) } : 'none';
}

async function fail(c: PostCtx, g: OgGift, cls: Class, msg: string, lost = false): Promise<'failed' | 'retry'> {
  const attempts = g.attempts + 1;
  const stop = cls === 'final' || attempts >= MAX_ATTEMPTS;
  const wait = cls === 'wait' ? 12 * 60 : BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
  await updateGift(c.env, g.id, {
    status: lost ? 'check' : 'failed',
    attempts,
    error: msg.slice(0, 300),
    next_try_at: stop ? null : new Date(clock(c).getTime() + wait * 60000).toISOString(),
  });
  return stop ? 'failed' : 'retry';
}

/** Post one gift. Returns what happened so the batch run can tally it. */
export async function postGift(c: PostCtx, batch: OgBatch, gift: OgGift, force = false): Promise<'posted' | 'failed' | 'retry' | 'skipped'> {
  if (gift.status === 'posted' || gift.status === 'removed') return 'skipped';
  if (!force && gift.status === 'failed' && !gift.next_try_at) return 'skipped';
  if (!force && gift.next_try_at && gift.next_try_at > iso(c)) return 'skipped';
  if (blockers(gift).length) {
    await updateGift(c.env, gift.id, { status: 'failed', error: blockers(gift)[0], next_try_at: null });
    return 'failed';
  }
  const wasCheck = gift.status === 'check';
  const claim = await c.env.DB.prepare("UPDATE og_gift SET status = 'posting', updated_at = ? WHERE id = ? AND status IN ('draft', 'failed', 'check')").bind(nowIso(), gift.id).run();
  if (!Number(claim.meta?.changes)) return 'skipped';
  const g: OgGift = { ...gift, status: 'posting' };

  // A gift that may already be in Blackbaud is looked up by its hub id before anything is sent.
  if (wasCheck || g.attempts > 0) {
    const found = await lookup(c, g);
    if (typeof found === 'object' && 'err' in found) return fail(c, g, found.err, found.msg, true);
    if (typeof found === 'object' && 'id' in found) {
      await markPosted(c, batch, g, found.id, true);
      return 'posted';
    }
  }

  const body = giftBody(g, { batchName: batch.name, enteredBy: g.created_by, approvedBy: batch.approved_by || 'a second person' });
  const a = await c.send([{ method: 'POST', path: '/gift/v1/gifts', body }]);
  await recordLane(c.env, a);
  if (a.capped) return fail(c, g, 'wait', a.wait || "Blackbaud's daily limit is reached. It sends after the reset.");
  const r = a.results[0];
  if (!r) return fail(c, g, 'retry', a.wait || 'Blackbaud did not answer. It will try again.', Boolean(a.lost));
  if (r.refused) return fail(c, g, 'final', `FavorOS held this call back: ${r.refused}`);
  if (!r.ok) {
    // 4xx stores nothing. A 5xx or a 429 may or may not have landed, so the next run looks first.
    const soft = r.status >= 500 || r.status === 429 || r.status === 408;
    return fail(c, g, soft ? 'retry' : 'final', sayWhy(r.body), soft);
  }
  const id = String(r.body && (r.body.id || r.body.gift_id || ''));
  if (!id) return fail(c, g, 'retry', 'Blackbaud answered without a gift id.', true);
  await markPosted(c, batch, g, id, false);
  return 'posted';
}

async function markPosted(c: PostCtx, batch: OgBatch, g: OgGift, bbId: string, adopted: boolean): Promise<void> {
  await updateGift(c.env, g.id, { status: 'posted', bb_gift_id: bbId, error: null, next_try_at: null, posted_at: iso(c), letter_status: g.letter_key ? 'pending' : null });
  await logEvent(c.env, { batch_id: batch.id, gift_id: g.id, kind: adopted ? 'gift_found_in_blackbaud' : 'gift_posted', actor: batch.approved_by || 'system', detail: { bb_gift: bbId, simulated: Boolean(c.simulated) } });
  await saveEntryTribute(c.env, { ...g, bb_gift_id: bbId }, batch.approved_by || 'system').catch((e) => console.error('tribute save failed', e));
  if (g.letter_key) await attachLetter(c, batch, { ...g, bb_gift_id: bbId });
}

/** The letter goes on the saved gift: an upload address, the bytes to Blackbaud's file service, then the attachment. Never fails the gift. */
export async function attachLetter(c: PostCtx, batch: OgBatch, g: OgGift): Promise<'done' | 'failed' | 'waiting'> {
  if (!g.letter_key || !g.bb_gift_id || g.letter_status === 'done') return 'done';
  const stop = async (msg: string, final: boolean) => {
    await updateGift(c.env, g.id, { letter_status: final ? 'failed' : 'pending', letter_error: msg.slice(0, 300) });
    return final ? ('failed' as const) : ('waiting' as const);
  };
  if (c.simulated) {
    await updateGift(c.env, g.id, { letter_status: 'done', letter_error: null, bb_file_id: 'TEST-FILE', bb_attachment_id: 'TEST-ATTACH' });
    return 'done';
  }
  const name = letterFileName(g);
  const doc = await c.send([{ method: 'POST', path: '/gift/v1/documents', body: { file_name: name, upload_thumbnail: false } }]);
  await recordLane(c.env, doc);
  const dr = doc.results[0];
  if (!dr) return stop(doc.wait || 'Blackbaud did not answer.', false);
  if (!dr.ok) return stop(sayWhy(dr.body), !(dr.status >= 500 || dr.status === 429));
  const fileId = String(dr.body && dr.body.file_id);
  const up = dr.body && dr.body.file_upload_request;
  if (!fileId || !up || !up.url) return stop('Blackbaud gave no upload address.', false);
  const bytes = c.letterBytes ? await c.letterBytes(g.letter_key) : null;
  if (!bytes) return stop('The letter is not in storage.', true);
  const headers: Record<string, string> = { 'Content-Type': g.letter_mime || 'application/pdf' };
  for (const h of up.headers || []) headers[String(h.name)] = String(h.value);
  const put = await (c.put || ((u, i) => fetch(u, i)))(String(up.url), { method: String(up.method || 'PUT'), headers, body: bytes });
  if (!put.ok) return stop(`The upload answered ${put.status}.`, false);
  const att = await c.send([
    { method: 'POST', path: '/gift/v1/gifts/attachments', body: { parent_id: g.bb_gift_id, type: 'Physical', file_id: fileId, file_name: name, name: `${g.letter_name || 'Notice'} (hub)`.slice(0, 100), date: `${g.gift_date}T00:00:00` } },
  ]);
  await recordLane(c.env, att);
  const ar = att.results[0];
  if (!ar) return stop(att.wait || 'Blackbaud did not answer.', false);
  if (!ar.ok) return stop(sayWhy(ar.body), !(ar.status >= 500 || ar.status === 429));
  await updateGift(c.env, g.id, { letter_status: 'done', letter_error: null, bb_file_id: fileId, bb_attachment_id: String(ar.body && ar.body.id) });
  await logEvent(c.env, { batch_id: batch.id, gift_id: g.id, kind: 'letter_attached', actor: batch.approved_by || 'system', detail: { gift: g.bb_gift_id } });
  return 'done';
}

export interface Tally {
  posted: number;
  failed: number;
  retry: number;
  left: number;
}

/** One pass over a batch that was approved: post every gift that is due, attach waiting letters, and settle the batch's status. */
export async function runBatch(c: PostCtx, batchId: string, opts: { force?: boolean } = {}): Promise<Tally> {
  const out: Tally = { posted: 0, failed: 0, retry: 0, left: 0 };
  let batch = await getBatch(c.env, batchId);
  if (!batch || !['posting', 'needs_person'].includes(batch.status)) return out;
  // A batch a test account made posts only through the stand-in. No path sends it to Blackbaud.
  if ((isTester(batch.created_by_email) || isTester(batch.approved_by_email)) && !c.simulated) return out;
  if (c.simulated && !isTester(batch.created_by_email)) return out;
  // A claim that never finished (the Worker stopped mid-call) may or may not have landed: it goes back to be looked up.
  const stale = new Date(clock(c).getTime() - 3 * 60000).toISOString();
  await c.env.DB.prepare("UPDATE og_gift SET status = 'check' WHERE batch_id = ? AND status = 'posting' AND updated_at < ?").bind(batchId, stale).run();
  for (const g of await giftsOf(c.env, batchId)) {
    if (g.status === 'posted') {
      if (g.letter_key && g.letter_status !== 'done' && g.letter_status !== 'failed') await attachLetter(c, batch, g);
      continue;
    }
    const r = await postGift(c, batch, g, Boolean(opts.force));
    if (r === 'posted') out.posted++;
    else if (r === 'failed') out.failed++;
    else if (r === 'retry') out.retry++;
  }
  const gifts = await giftsOf(c.env, batchId);
  const open = gifts.filter((g) => g.status !== 'posted');
  out.left = open.length;
  batch = (await getBatch(c.env, batchId))!;
  if (!open.length) {
    await c.env.DB.prepare("UPDATE og_batch SET status = 'posted', posted_at = ? WHERE id = ? AND status IN ('posting', 'needs_person')").bind(iso(c), batchId).run();
    await logEvent(c.env, { batch_id: batchId, kind: 'batch_posted', actor: batch.approved_by || 'system', detail: { gifts: gifts.length } });
  } else {
    const stuck = open.every((g) => g.status === 'failed' && !g.next_try_at);
    await c.env.DB.prepare('UPDATE og_batch SET status = ? WHERE id = ? AND status IN (\'posting\', \'needs_person\')').bind(stuck ? 'needs_person' : 'posting', batchId).run();
  }
  return out;
}

/** The second person's press. One UPDATE moves the batch from waiting to posting, so two presses at the same instant approve once. */
export async function approveBatch(c: PostCtx, batchId: string, approver: { name: string; email: string }): Promise<{ started: boolean }> {
  const r = await c.env.DB.prepare("UPDATE og_batch SET status = 'posting', approved_by = ?, approved_by_email = ?, approved_at = ? WHERE id = ? AND status = 'waiting'")
    .bind(approver.name, approver.email.toLowerCase(), iso(c), batchId)
    .run();
  if (!Number(r.meta?.changes)) return { started: false };
  await logEvent(c.env, { batch_id: batchId, kind: 'batch_approved', actor: approver.name });
  return { started: true };
}

/** Batches that still have gifts to post or letters to attach: the morning drain and the page call this so nothing waits for a person to remember. */
export async function resumeBatches(c: PostCtx): Promise<{ batch: string; tally: Tally }[]> {
  const since = new Date(clock(c).getTime() - 10 * 86400000).toISOString();
  const rows = (await c.env.DB.prepare(`SELECT id FROM og_batch WHERE status IN ('posting', 'needs_person') AND approved_at >= ? AND ${notTesterSql('created_by_email')} ORDER BY approved_at LIMIT 10`).bind(since).all<{ id: string }>()).results;
  const out: { batch: string; tally: Tally }[] = [];
  for (const r of rows) out.push({ batch: r.id, tally: await runBatch(c, r.id) });
  return out;
}
