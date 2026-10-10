// Sending a deposit to Blackbaud as an UNAPPROVED batch, and watching it until Jennifer commits it (Option B, Will 2026-10-10).
//
// The hub never approves. The steps, each one row in ge_outbox so a retry never repeats a finished step:
//   batch      create the batch (Blackbaud numbers it; the deposit name, the enterer and the hub id go in the description)
//   gifts:<n>  check each partner is still live, then post up to 20 gifts to the batch and read every gift's own errors
//   attach:<image id>  after commit only, for the rule gifts (see attach.ts)
// Safety rules proven in P0 (2026-10-10):
//   - a 400 stores nothing, so it is final for that step; a business-rule error returns 200 with the message on the gift and
//     marks the batch has_exceptions, so every gift's errors array is read after every post;
//   - after a lost answer the hub reads the batch list and compares its gift count before it sends again, so a slow answer
//     never makes a second gift;
//   - the Reference carries the hub gift id, so a person can find any gift from either side;
//   - an approved batch cannot be deleted, so the hub never approves and never deletes a batch it did not just make.
import { newId, nowIso, type Env } from '../http';
import { sayWhy, type BbAnswer, type BbCall, type BbSend } from './bb';
import { blockers, getDeposit, giftBody, giftsOf, logEvent, tapeOf, updateGift, type DepositRow, type GiftRow } from './store';

export const CHUNK = 20;
/** Minutes to wait after the first, second, third and fourth failure. The fifth stops and asks a person. */
export const BACKOFF_MIN = [1, 5, 15, 60];
export const MAX_ATTEMPTS = 5;

export interface Ctx {
  env: Env;
  send: BbSend;
  actor: string;
  now?: () => Date;
}

const clock = (c: Ctx) => (c.now ? c.now() : new Date());
const iso = (c: Ctx) => clock(c).toISOString();

export async function recordLane(env: Env, a: BbAnswer): Promise<void> {
  if (a.callsToday == null) return;
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO ge_lane (day, calls, cap, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET calls = MAX(calls, excluded.calls), cap = excluded.cap, updated_at = excluded.updated_at`
  )
    .bind(day, a.callsToday, a.cap || 400, nowIso())
    .run();
}

export function describeBatch(d: Pick<DepositRow, 'id' | 'name' | 'created_by'>): string {
  return `${d.name}, entered by ${d.created_by}, hub ${d.id}`.slice(0, 120);
}

// ---------------------------------------------------------------- queueing

export interface SendCheck {
  ok: boolean;
  why: string[];
}

export function canSend(d: DepositRow, gifts: GiftRow[]): SendCheck {
  const why: string[] = [];
  if (d.status !== 'open') why.push('This deposit was already sent.');
  const live = gifts.filter((g) => g.status !== 'removed');
  if (!live.length) why.push('Photograph at least one gift.');
  const t = tapeOf(d, live);
  if (t.diffCount !== 0) why.push(`The count is ${t.count} and the tape says ${t.tapeCount}.`);
  if (t.diffCents !== 0) why.push(`The total is off the tape by $${(Math.abs(t.diffCents) / 100).toFixed(2)}.`);
  const open = live.filter((g) => blockers(g).length > 0).length;
  if (open) why.push(`${open} ${open === 1 ? 'row still needs' : 'rows still need'} a look.`);
  if (!live.some((g) => g.status !== 'by_hand')) why.push('Every row is marked for hand entry. Nothing to send.');
  return { ok: why.length === 0, why };
}

export async function queueSend(c: Ctx, depositId: string): Promise<{ queued: number }> {
  const d = await getDeposit(c.env, depositId);
  if (!d) throw new Error('deposit not found');
  const gifts = await giftsOf(c.env, depositId);
  const chk = canSend(d, gifts);
  if (!chk.ok) throw new Error(chk.why.join(' '));
  const toSend = gifts.filter((g) => g.status !== 'by_hand');
  const stamp = iso(c);
  await c.env.DB.prepare("UPDATE ge_deposit SET status = 'sending', sent_by = ?, sent_at = ? WHERE id = ? AND status = 'open'").bind(c.actor, stamp, depositId).run();
  await c.env.DB.prepare("UPDATE ge_gift SET status = 'ready', updated_at = ? WHERE deposit_id = ? AND status IN ('review', 'ready', 'failed')").bind(stamp, depositId).run();
  const ops = ['batch'];
  for (let i = 0; i * CHUNK < toSend.length; i++) ops.push(`gifts:${i + 1}`);
  for (const op of ops) {
    await c.env.DB.prepare('INSERT OR IGNORE INTO ge_outbox (id, deposit_id, op, status, created_at) VALUES (?,?,?,?,?)').bind(newId('go'), depositId, op, 'queued', stamp).run();
  }
  await logEvent(c.env, { deposit_id: depositId, kind: 'sent_to_outbox', actor: c.actor, detail: { gifts: toSend.length, steps: ops.length } });
  return { queued: ops.length };
}

// ---------------------------------------------------------------- the outbox

interface OutboxRow {
  id: string;
  deposit_id: string;
  op: string;
  status: string;
  attempts: number;
  next_try_at: string | null;
  result_json: string | null;
  last_error_class: string | null;
  last_error: string | null;
}

export const listOutbox = async (env: Env, depositId: string) =>
  (await env.DB.prepare('SELECT * FROM ge_outbox WHERE deposit_id = ? ORDER BY created_at, op').bind(depositId).all<OutboxRow>()).results;

type StepResult = { done: true; detail?: unknown } | { done: false; cls: 'wait' | 'retry' | 'final'; error: string; waitUntil?: string };

const nextUtcDay = (c: Ctx) => {
  const t = clock(c);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1, 0, 10, 0)).toISOString();
};

/** Look for a batch this hub already made for the deposit (after a lost answer). One call. */
async function findBatch(c: Ctx, d: DepositRow): Promise<{ id: string; number: string; gifts: number; amount: number; approved: boolean; exceptions: boolean } | null> {
  const a = await c.send([{ method: 'GET', path: '/gift-batch/v1/giftbatches?limit=25' }]);
  await recordLane(c.env, a);
  const r = a.results[0];
  if (!r || !r.ok) return null;
  const list: any[] = (r.body && r.body.giftbatches) || [];
  const mine = list.find((b) => String(b.batch_description || '').includes(`hub ${d.id}`));
  if (!mine) return null;
  return {
    id: String(mine.id),
    number: String(mine.batch_number || ''),
    gifts: Number(mine.number_of_gifts) || 0,
    amount: Number(mine.actual_amount) || 0,
    approved: Boolean(mine.approved || mine.is_approved),
    exceptions: Boolean(mine.has_exceptions),
  };
}

async function stepBatch(c: Ctx, d: DepositRow, row: OutboxRow, gifts: GiftRow[]): Promise<StepResult> {
  if (d.bb_batch_id) return { done: true, detail: { batch_id: d.bb_batch_id } };
  if (row.attempts > 0) {
    const found = await findBatch(c, d);
    if (found) {
      await c.env.DB.prepare('UPDATE ge_deposit SET bb_batch_id = ?, bb_batch_number = ? WHERE id = ?').bind(found.id, found.number, d.id).run();
      return { done: true, detail: { batch_id: found.id, found: true } };
    }
  }
  const sending = gifts.filter((g) => g.status !== 'by_hand');
  const total = sending.reduce((s, g) => s + (g.amount_cents || 0), 0) / 100;
  const a = await c.send([{ method: 'POST', path: '/gift-batch/v1/giftbatches', body: { batch_description: describeBatch(d), expected_batch_total: total, expected_number: sending.length } }]);
  await recordLane(c.env, a);
  if (a.capped) return { done: false, cls: 'wait', error: a.wait || 'At the daily limit.', waitUntil: nextUtcDay(c) };
  const r = a.results[0];
  if (!r) return { done: false, cls: 'retry', error: a.wait || 'Blackbaud did not answer.' };
  if (r.status === 0) return { done: false, cls: 'final', error: r.refused || 'The Blackbaud connection refused the call.' };
  if (!r.ok) return { done: false, cls: r.status >= 500 || r.status === 429 ? 'retry' : 'final', error: sayWhy(r.body) };
  const id = String((r.body && r.body.batch_id) || '');
  if (!/^\d+$/.test(id)) return { done: false, cls: 'retry', error: 'Blackbaud answered without a batch id.' };
  await c.env.DB.prepare('UPDATE ge_deposit SET bb_batch_id = ? WHERE id = ?').bind(id, d.id).run();
  await logEvent(c.env, { deposit_id: d.id, kind: 'batch_created', actor: c.actor, detail: { batch_id: id } });
  return { done: true, detail: { batch_id: id } };
}

async function stepGifts(c: Ctx, d: DepositRow, row: OutboxRow, gifts: GiftRow[]): Promise<StepResult> {
  if (!d.bb_batch_id) return { done: false, cls: 'retry', error: 'The batch is not made yet.' };
  const n = Number(row.op.split(':')[1]) || 1;
  const sending = gifts.filter((g) => g.status !== 'by_hand');
  const chunk = sending.slice((n - 1) * CHUNK, n * CHUNK);
  const todo = chunk.filter((g) => g.status === 'ready');
  if (!todo.length) return { done: true, detail: { already: chunk.length } };

  // After a lost answer, ask the batch how many gifts it holds before sending any again.
  if (row.attempts > 0) {
    const found = await findBatch(c, d);
    const before = sending.slice(0, (n - 1) * CHUNK).length;
    if (found && found.gifts >= before + chunk.length) {
      await c.env.DB.prepare("UPDATE ge_gift SET status = 'sent', error = NULL, updated_at = ? WHERE id IN (" + todo.map(() => '?').join(',') + ')').bind(iso(c), ...todo.map((g) => g.id)).run();
      await logEvent(c.env, { deposit_id: d.id, kind: 'gifts_found_after_lost_answer', actor: c.actor, detail: { step: row.op, count: todo.length } });
      return { done: true, detail: { found: true } };
    }
  }

  // One live read per partner: the mirror is up to 12 hours old and keeps merged and deleted records.
  const ids = [...new Set(todo.map((g) => String(g.partner_id)))];
  const gone = new Set<string>();
  for (let i = 0; i < ids.length; i += 5) {
    const calls: BbCall[] = ids.slice(i, i + 5).map((id) => ({ method: 'GET', path: `/constituent/v1/constituents/${id}` }));
    const a = await c.send(calls);
    await recordLane(c.env, a);
    if (a.capped) return { done: false, cls: 'wait', error: a.wait || 'At the daily limit.', waitUntil: nextUtcDay(c) };
    if (a.results.length < calls.length) return { done: false, cls: 'retry', error: a.wait || 'Blackbaud did not answer.' };
    a.results.forEach((r, j) => {
      if (r.status === 404 || (r.ok && r.body && r.body.inactive === true) || (r.ok && r.body && r.body.deceased === true)) gone.add(ids[i + j]);
    });
  }
  const goodGifts = todo.filter((g) => !gone.has(String(g.partner_id)));
  for (const g of todo.filter((x) => gone.has(String(x.partner_id)))) {
    await updateGift(c.env, g.id, { status: 'failed', error: 'Blackbaud no longer has this partner as an active record. It may have been merged. Pick the partner again.' });
  }
  if (!goodGifts.length) return { done: true, detail: { skipped: todo.length } };

  const a = await c.send([{ method: 'POST', path: `/gift/v1/giftbatches/${d.bb_batch_id}/gifts`, body: { gifts: goodGifts.map((g) => giftBody(g, d)) } }]);
  await recordLane(c.env, a);
  if (a.capped) return { done: false, cls: 'wait', error: a.wait || 'At the daily limit.', waitUntil: nextUtcDay(c) };
  const r = a.results[0];
  if (!r) return { done: false, cls: 'retry', error: a.wait || 'Blackbaud did not answer.' };
  if (r.status === 0) return { done: false, cls: 'final', error: r.refused || 'The Blackbaud connection refused the call.' };
  if (!r.ok) {
    if (r.status >= 500 || r.status === 429) return { done: false, cls: 'retry', error: sayWhy(r.body) };
    // A 400 stores nothing, so every gift in this post is untouched and a person fixes the reason.
    const why = sayWhy(r.body);
    for (const g of goodGifts) await updateGift(c.env, g.id, { status: 'failed', error: why });
    return { done: true, detail: { rejected: why } };
  }
  const out: any[] = (r.body && r.body.gifts) || [];
  let exceptions = 0;
  for (let i = 0; i < goodGifts.length; i++) {
    const posted = out[i];
    const errs: any[] = (posted && posted.errors) || [];
    if (!posted) {
      await updateGift(c.env, goodGifts[i].id, { status: 'failed', error: 'Blackbaud did not return this gift.' });
      exceptions++;
    } else if (errs.length) {
      exceptions++;
      await updateGift(c.env, goodGifts[i].id, { status: 'failed', bb_batch_gift_id: String(posted.id || ''), error: errs.map((e) => e.message || e.raw_message || JSON.stringify(e)).join(' ').slice(0, 300) });
    } else {
      await updateGift(c.env, goodGifts[i].id, { status: 'sent', bb_batch_gift_id: String(posted.id || ''), error: null });
    }
  }
  await logEvent(c.env, { deposit_id: d.id, kind: 'gifts_posted', actor: c.actor, detail: { step: row.op, sent: goodGifts.length, exceptions } });
  return { done: true, detail: { sent: goodGifts.length, exceptions } };
}

async function runStep(c: Ctx, d: DepositRow, row: OutboxRow, gifts: GiftRow[]): Promise<StepResult> {
  if (row.op === 'batch') return stepBatch(c, d, row, gifts);
  if (row.op.startsWith('gifts:')) return stepGifts(c, d, row, gifts);
  return { done: true, detail: { skipped: row.op } };
}

export interface Progress {
  status: string;
  steps: { op: string; status: string; attempts: number; next_try_at: string | null; error: string | null }[];
  waiting: string | null;
}

/**
 * Run every step that is due, in order, until one has to wait. Safe to call from a page, a timer or a retry: a done step is never run
 * again, and a step that fails goes back with a longer wait (1, 5, 15, 60 minutes) until its fifth try stops and asks a person.
 */
export async function advance(c: Ctx, depositId: string): Promise<Progress> {
  let d = await getDeposit(c.env, depositId);
  if (!d) throw new Error('deposit not found');
  if (d.status === 'sending') {
    const rows = await listOutbox(c.env, depositId);
    for (const row of rows) {
      if (row.status === 'done') continue;
      if (row.status === 'failed') break;
      if (row.next_try_at && row.next_try_at > iso(c)) break;
      const gifts = await giftsOf(c.env, depositId);
      d = (await getDeposit(c.env, depositId))!;
      const res = await runStep(c, d, row, gifts);
      if (res.done) {
        await c.env.DB.prepare("UPDATE ge_outbox SET status = 'done', result_json = ?, done_at = ?, last_error = NULL, last_error_class = NULL, next_try_at = NULL WHERE id = ?")
          .bind(JSON.stringify(res.detail || {}), iso(c), row.id)
          .run();
        continue;
      }
      const attempts = row.attempts + 1;
      if (res.cls === 'wait') {
        await c.env.DB.prepare("UPDATE ge_outbox SET status = 'waiting', next_try_at = ?, last_error_class = 'wait', last_error = ? WHERE id = ?").bind(res.waitUntil || null, res.error.slice(0, 300), row.id).run();
      } else if (res.cls === 'final' || attempts >= MAX_ATTEMPTS) {
        await c.env.DB.prepare("UPDATE ge_outbox SET status = 'failed', attempts = ?, last_error_class = ?, last_error = ? WHERE id = ?").bind(attempts, res.cls, res.error.slice(0, 300), row.id).run();
        await c.env.DB.prepare("UPDATE ge_deposit SET status = 'needs_person', note = ? WHERE id = ?").bind(`${row.op}: ${res.error}`.slice(0, 300), depositId).run();
        await logEvent(c.env, { deposit_id: depositId, kind: 'step_failed', actor: c.actor, detail: { step: row.op, error: res.error } });
      } else {
        const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
        await c.env.DB.prepare("UPDATE ge_outbox SET status = 'queued', attempts = ?, next_try_at = ?, last_error_class = 'retry', last_error = ? WHERE id = ?")
          .bind(attempts, new Date(clock(c).getTime() + wait * 60000).toISOString(), res.error.slice(0, 300), row.id)
          .run();
      }
      break;
    }
    const after = await listOutbox(c.env, depositId);
    if (after.length && after.every((r) => r.status === 'done')) {
      const gifts = await giftsOf(c.env, depositId);
      const bad = gifts.filter((g) => g.status === 'failed').length;
      if (bad) {
        await c.env.DB.prepare("UPDATE ge_deposit SET status = 'needs_person', note = ? WHERE id = ?").bind(`${bad} ${bad === 1 ? 'gift needs' : 'gifts need'} a person.`, depositId).run();
      } else {
        await c.env.DB.prepare("UPDATE ge_deposit SET status = 'created', note = NULL WHERE id = ?").bind(depositId).run();
        await logEvent(c.env, { deposit_id: depositId, kind: 'batch_ready_for_approval', actor: c.actor, detail: { batch_id: d.bb_batch_id } });
      }
    }
  }
  return progress(c.env, depositId);
}

export async function progress(env: Env, depositId: string): Promise<Progress> {
  const d = await getDeposit(env, depositId);
  const rows = await listOutbox(env, depositId);
  const waiting = rows.find((r) => r.status === 'waiting' || (r.status === 'queued' && r.next_try_at));
  return {
    status: d ? d.status : 'unknown',
    steps: rows.map((r) => ({ op: r.op, status: r.status, attempts: r.attempts, next_try_at: r.next_try_at, error: r.last_error })),
    waiting: waiting && waiting.next_try_at ? waiting.next_try_at : null,
  };
}

// ---------------------------------------------------------------- watching for the commit

export interface Watch {
  status: string;
  approved: boolean;
  batchNumber: string | null;
  gifts: number | null;
  amount: number | null;
  exceptions: boolean;
  polledAt: string;
  mismatch: string | null;
}

/**
 * One call: the batch list. Blackbaud has no route that approves a batch and none that reports who did, so the hub detects a commit
 * by polling the batch's approved flag. It also checks the batch holds the gifts and the dollars the hub sent.
 */
export async function pollBatch(c: Ctx, depositId: string): Promise<Watch | null> {
  const d = await getDeposit(c.env, depositId);
  if (!d || !d.bb_batch_id || !['created', 'committed', 'needs_person'].includes(d.status)) return null;
  const a = await c.send([{ method: 'GET', path: '/gift-batch/v1/giftbatches?limit=25' }]);
  await recordLane(c.env, a);
  const r = a.results[0];
  if (!r || !r.ok) return null;
  const list: any[] = (r.body && r.body.giftbatches) || [];
  const b = list.find((x) => String(x.id) === String(d.bb_batch_id));
  const stamp = iso(c);
  if (!b) {
    await c.env.DB.prepare('UPDATE ge_deposit SET last_polled_at = ? WHERE id = ?').bind(stamp, depositId).run();
    return { status: d.status, approved: d.status === 'committed', batchNumber: d.bb_batch_number, gifts: null, amount: null, exceptions: false, polledAt: stamp, mismatch: 'Blackbaud no longer lists this batch among the newest 25.' };
  }
  const gifts = (await giftsOf(c.env, depositId)).filter((g) => g.status === 'sent');
  const wantCents = gifts.reduce((s, g) => s + (g.amount_cents || 0), 0);
  const gotCents = Math.round((Number(b.actual_amount) || 0) * 100);
  let mismatch: string | null = null;
  if (!b.approved && !b.is_approved && (Number(b.number_of_gifts) !== gifts.length || gotCents !== wantCents)) {
    mismatch = `Blackbaud shows ${b.number_of_gifts} gifts and $${(gotCents / 100).toFixed(2)}. The hub sent ${gifts.length} and $${(wantCents / 100).toFixed(2)}.`;
  }
  const approved = Boolean(b.approved || b.is_approved);
  const number = String(b.batch_number || d.bb_batch_number || '') || null;
  if (approved && d.status !== 'committed') {
    await c.env.DB.prepare("UPDATE ge_deposit SET status = 'committed', committed_at = ?, bb_batch_number = ?, last_polled_at = ? WHERE id = ?").bind(stamp, number, stamp, depositId).run();
    await logEvent(c.env, { deposit_id: depositId, kind: 'committed_in_blackbaud', actor: c.actor, detail: { batch: number } });
  } else {
    await c.env.DB.prepare('UPDATE ge_deposit SET last_polled_at = ?, bb_batch_number = COALESCE(?, bb_batch_number) WHERE id = ?').bind(stamp, number, depositId).run();
  }
  return { status: approved ? 'committed' : d.status, approved, batchNumber: number, gifts: Number(b.number_of_gifts) || 0, amount: Number(b.actual_amount) || 0, exceptions: Boolean(b.has_exceptions), polledAt: stamp, mismatch };
}

/**
 * Try the failed steps again. A gift Blackbaud rejected whole (a 400 stores nothing) goes back to ready. A gift Blackbaud stored with an
 * error on it is already in the batch, so it never posts twice: a person fixes it in Blackbaud or marks it entered by hand.
 */
export async function retryDeposit(c: Ctx, depositId: string): Promise<void> {
  const stamp = iso(c);
  await c.env.DB.prepare("UPDATE ge_gift SET status = 'ready', error = NULL, updated_at = ? WHERE deposit_id = ? AND status = 'failed' AND bb_batch_gift_id IS NULL").bind(stamp, depositId).run();
  await c.env.DB.prepare("UPDATE ge_outbox SET status = 'queued', attempts = 0, next_try_at = NULL, last_error = NULL, last_error_class = NULL, done_at = NULL WHERE deposit_id = ? AND (status IN ('failed', 'waiting') OR (op LIKE 'gifts:%' AND status = 'done'))").bind(depositId).run();
  await c.env.DB.prepare("UPDATE ge_deposit SET status = 'sending', note = NULL WHERE id = ? AND status IN ('needs_person', 'sending')").bind(depositId).run();
  await logEvent(c.env, { deposit_id: depositId, kind: 'retry', actor: c.actor });
}

/** After a person clears the last gift that needed them, the deposit goes back to waiting for Jennifer. */
export async function settleDeposit(env: Env, depositId: string): Promise<void> {
  const d = await getDeposit(env, depositId);
  if (!d || d.status !== 'needs_person') return;
  const rows = await listOutbox(env, depositId);
  const gifts = await giftsOf(env, depositId);
  if (rows.length && rows.every((r) => r.status === 'done') && !gifts.some((g) => g.status === 'failed')) {
    await env.DB.prepare("UPDATE ge_deposit SET status = 'created', note = NULL WHERE id = ?").bind(depositId).run();
  }
}
