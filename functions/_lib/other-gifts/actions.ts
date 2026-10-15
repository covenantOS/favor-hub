// Other gifts: what a person's press does, with the rules that keep the two-person check honest. Routes call these; tests call them too.
import { HttpError, nowIso, type Env } from '../http';
import type { Q } from '../work/partner';
import { approveBatch, attachLetter, runBatch, type PostCtx } from './post';
import { findDuplicate } from './read';
import { blockers, cleanEdit, entererEmails, isKind, LETTER_MAX_BYTES, LETTER_TYPES, parseJson, type Dup, type OgBatch, type OgGift } from './rules';
import { guardTestPartners } from '../testuser';
import { addGift, getBatch, getGift, giftsOf, logEvent, openBatchFor, updateGift } from './store';

export interface Who {
  name: string;
  email: string;
  admin: boolean;
  canApprove: boolean;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function batchOfGift(env: Env, g: OgGift): Promise<OgBatch> {
  const b = await getBatch(env, g.batch_id);
  if (!b || b.status === 'removed') throw new HttpError(404, 'not_found', 'That batch is not here.');
  return b;
}

/** A gift may be changed while its batch is open (by the person who entered it), or after a failed post (by the enterer or the approver). */
function editable(b: OgBatch, g: OgGift, me: Who): void {
  if (g.status === 'posted') throw new HttpError(409, 'locked', 'This gift is in Blackbaud. A change there is made in Blackbaud.');
  if (b.status === 'open') {
    if (!same(g.created_by_email, me.email) && !same(b.created_by_email, me.email)) throw new HttpError(403, 'not_yours', 'Only the person who entered this gift can change it.');
    return;
  }
  if (b.status === 'needs_person' && g.status === 'failed') {
    if (same(g.created_by_email, me.email) || (b.approved_by_email && same(b.approved_by_email, me.email))) return;
    throw new HttpError(403, 'not_yours', 'Only the person who entered it or the person who approved the batch can fix this gift.');
  }
  throw new HttpError(409, 'locked', b.status === 'waiting' ? 'This batch is waiting for approval. Take it back to change a gift.' : 'This batch was approved. Rows are locked.');
}

async function recheckDup(env: Env, q: Q, id: string): Promise<void> {
  const g = (await getGift(env, id))!;
  const msg = await findDuplicate(env, q, g);
  const cur = parseJson<Dup | null>(g.dup_json, null);
  if (!msg) {
    if (cur) await updateGift(env, id, { dup_json: null });
    return;
  }
  // The same message keeps its decision; a new one asks again.
  if (cur && cur.message === msg) return;
  await updateGift(env, id, { dup_json: JSON.stringify({ message: msg, decision: null } satisfies Dup) });
}

export async function createGift(env: Env, q: Q, me: Who, today: string, input: Record<string, unknown>): Promise<OgGift> {
  if (!isKind(input.kind)) throw new HttpError(400, 'bad_kind', 'Pick DAF, Foundation, Wire, Stock or Phone.');
  const batch = await openBatchFor(env, { name: me.name, email: me.email }, today);
  const set = cleanEdit({ ...input, gift_date: input.gift_date || today }, today);
  guardTestPartners(me.email, set);
  set.kind = input.kind;
  const g = await addGift(env, batch, { name: me.name, email: me.email }, set);
  await recheckDup(env, q, g.id);
  return (await getGift(env, g.id))!;
}

export async function editGift(env: Env, q: Q, me: Who, today: string, id: string, patch: Record<string, unknown>): Promise<OgGift> {
  const g = await getGift(env, id);
  if (!g || g.status === 'removed') throw new HttpError(404, 'not_found', 'That gift is not here.');
  const b = await batchOfGift(env, g);
  editable(b, g, me);
  if (typeof patch.dupDecision === 'string') {
    const cur = parseJson<Dup | null>(g.dup_json, null);
    if (cur) await updateGift(env, id, { dup_json: JSON.stringify({ ...cur, decision: patch.dupDecision === 'keep' ? 'keep' : null } satisfies Dup) });
    await logEvent(env, { batch_id: b.id, gift_id: id, kind: 'dup_decided', actor: me.name, detail: { decision: patch.dupDecision } });
    return (await getGift(env, id))!;
  }
  const set = cleanEdit(patch, today);
  guardTestPartners(me.email, set);
  if (!Object.keys(set).length) return g;
  // Choosing a different partner or soft credit name drops the other name's text so the pair never disagree.
  if ('partner_id' in set && !('partner_name' in set)) set.partner_name = null;
  if ('soft_partner_id' in set && !('soft_partner_name' in set)) set.soft_partner_name = null;
  if (g.status === 'failed') {
    set.status = 'failed';
    set.next_try_at = null;
  }
  await updateGift(env, id, set);
  await logEvent(env, { batch_id: b.id, gift_id: id, kind: 'gift_edited', actor: me.name, detail: Object.keys(set) });
  if ('partner_id' in set || 'amount_cents' in set || 'gift_date' in set) await recheckDup(env, q, id);
  return (await getGift(env, id))!;
}

export async function removeGift(env: Env, me: Who, id: string): Promise<void> {
  const g = await getGift(env, id);
  if (!g || g.status === 'removed') throw new HttpError(404, 'not_found', 'That gift is not here.');
  const b = await batchOfGift(env, g);
  if (b.status !== 'open') throw new HttpError(409, 'locked', 'Take the batch back before you remove a gift.');
  editable(b, g, me);
  await updateGift(env, id, { status: 'removed' });
  await logEvent(env, { batch_id: b.id, gift_id: id, kind: 'gift_removed', actor: me.name });
}

export async function submitBatch(env: Env, me: Who, id: string): Promise<void> {
  const b = await getBatch(env, id);
  if (!b || b.status === 'removed') throw new HttpError(404, 'not_found', 'That batch is not here.');
  if (!same(b.created_by_email, me.email)) throw new HttpError(403, 'not_yours', 'Only the person who entered this batch sends it for approval.');
  if (b.status !== 'open') throw new HttpError(409, 'not_open', 'This batch was already sent.');
  const gifts = await giftsOf(env, id);
  if (!gifts.length) throw new HttpError(409, 'empty', 'Add a gift before you send the batch.');
  const open = gifts.filter((g) => blockers(g).length);
  if (open.length) throw new HttpError(409, 'not_ready', `${open.length} ${open.length === 1 ? 'gift needs' : 'gifts need'} a fix before the batch can go for approval.`);
  const r = await env.DB.prepare("UPDATE og_batch SET status = 'waiting', submitted_at = ?, submitted_by = ? WHERE id = ? AND status = 'open'").bind(nowIso(), me.name, id).run();
  if (!Number(r.meta?.changes)) throw new HttpError(409, 'not_open', 'This batch was already sent.');
  await logEvent(env, { batch_id: id, kind: 'batch_submitted', actor: me.name, detail: { gifts: gifts.length } });
}

export async function withdrawBatch(env: Env, me: Who, id: string): Promise<void> {
  const b = await getBatch(env, id);
  if (!b || b.status === 'removed') throw new HttpError(404, 'not_found', 'That batch is not here.');
  if (!same(b.created_by_email, me.email)) throw new HttpError(403, 'not_yours', 'Only the person who entered this batch can take it back.');
  const r = await env.DB.prepare("UPDATE og_batch SET status = 'open', submitted_at = NULL, submitted_by = NULL WHERE id = ? AND status = 'waiting'").bind(id).run();
  if (!Number(r.meta?.changes)) throw new HttpError(409, 'not_waiting', 'This batch is not waiting for approval any more.');
  await logEvent(env, { batch_id: id, kind: 'batch_withdrawn', actor: me.name });
}

export async function removeBatch(env: Env, me: Who, id: string): Promise<void> {
  const b = await getBatch(env, id);
  if (!b || b.status === 'removed') throw new HttpError(404, 'not_found', 'That batch is not here.');
  if (!same(b.created_by_email, me.email)) throw new HttpError(403, 'not_yours', 'Only the person who entered this batch can remove it.');
  const r = await env.DB.prepare("UPDATE og_batch SET status = 'removed' WHERE id = ? AND status = 'open'").bind(id).run();
  if (!Number(r.meta?.changes)) throw new HttpError(409, 'locked', 'Only a batch that was not sent can be removed.');
  await logEvent(env, { batch_id: id, kind: 'batch_removed', actor: me.name });
}

/**
 * The second person's approval. Checked here, not only on the page: the batch must be waiting, every gift ready, and the approver must
 * be nobody who entered a gift in it. Then one UPDATE claims the batch and the gifts post.
 */
export async function approve(c: PostCtx, me: Who, id: string, waitUntil?: (p: Promise<unknown>) => void): Promise<{ started: boolean }> {
  const b = await getBatch(c.env, id);
  if (!b || b.status === 'removed') throw new HttpError(404, 'not_found', 'That batch is not here.');
  const gifts = await giftsOf(c.env, id);
  if (b.status !== 'waiting') throw new HttpError(409, b.status === 'open' ? 'not_sent' : 'already', b.status === 'open' ? 'The enterer has not sent this batch for approval yet.' : 'This batch is already approved.');
  if (entererEmails(b, gifts).has(me.email.toLowerCase())) throw new HttpError(403, 'second_person', 'A second person approves this batch. The person who entered it cannot.');
  if (!me.admin && !me.canApprove) throw new HttpError(403, 'approve_off', 'Approving is not switched on for you. Ask an admin.');
  const open = gifts.filter((g) => blockers(g).length).length;
  if (open) throw new HttpError(409, 'not_ready', `${open} ${open === 1 ? 'gift needs' : 'gifts need'} a fix before this batch can be approved.`);
  const r = await approveBatch(c, id, { name: me.name, email: me.email });
  if (!r.started) throw new HttpError(409, 'already', 'This batch was just approved by someone else.');
  const run = runBatch(c, id).catch(() => undefined);
  if (waitUntil) waitUntil(run);
  else await run;
  return { started: true };
}

/** Try the gifts that did not post again. Anyone who entered or approved the batch, or an approver, may press it. */
export async function retry(c: PostCtx, me: Who, id: string, waitUntil?: (p: Promise<unknown>) => void): Promise<void> {
  const b = await getBatch(c.env, id);
  if (!b || !['posting', 'needs_person'].includes(b.status)) throw new HttpError(409, 'nothing', 'There is nothing to try again in this batch.');
  const gifts = await giftsOf(c.env, id);
  if (!entererEmails(b, gifts).has(me.email.toLowerCase()) && !me.canApprove && !me.admin) throw new HttpError(403, 'not_yours', 'Only the people on this batch can try it again.');
  await logEvent(c.env, { batch_id: id, kind: 'retry', actor: me.name });
  const run = runBatch(c, id, { force: true }).catch(() => undefined);
  if (waitUntil) waitUntil(run);
  else await run;
}

export async function saveLetter(
  c: PostCtx,
  bucket: R2Bucket,
  me: Who,
  id: string,
  file: { bytes: Uint8Array; mime: string; name: string },
  waitUntil?: (p: Promise<unknown>) => void
): Promise<OgGift> {
  const g = await getGift(c.env, id);
  if (!g || g.status === 'removed') throw new HttpError(404, 'not_found', 'That gift is not here.');
  const b = await batchOfGift(c.env, g);
  if (g.status !== 'posted') editable(b, g, me);
  else if (!same(g.created_by_email, me.email) && !same(b.created_by_email, me.email) && !me.admin && !me.canApprove) throw new HttpError(403, 'not_yours', 'Only the people on this batch can add a letter.');
  if (!LETTER_TYPES[file.mime]) throw new HttpError(400, 'bad_type', 'Attach a PDF, a PNG or a JPG.');
  if (!file.bytes.length) throw new HttpError(400, 'empty_file', 'That file is empty.');
  if (file.bytes.length > LETTER_MAX_BYTES) throw new HttpError(400, 'too_big', 'The file is over 10 MB.');
  const safe = file.name.replace(/[^\w.\- ]+/g, '').slice(0, 80) || 'notice';
  const key = `og/${id}/${Date.now().toString(36)}-${safe}`;
  await bucket.put(key, file.bytes, { httpMetadata: { contentType: file.mime }, customMetadata: { gift: id } });
  if (g.letter_key) await bucket.delete(g.letter_key).catch(() => undefined);
  await updateGift(c.env, id, { letter_key: key, letter_name: safe, letter_mime: file.mime, letter_bytes: file.bytes.length, letter_status: g.status === 'posted' ? 'pending' : null, letter_error: null });
  await logEvent(c.env, { batch_id: b.id, gift_id: id, kind: 'letter_saved', actor: me.name, detail: { bytes: file.bytes.length } });
  const fresh = (await getGift(c.env, id))!;
  if (g.status === 'posted') {
    const run = attachLetter(c, b, fresh).catch(() => undefined);
    if (waitUntil) waitUntil(run);
    else await run;
  }
  return (await getGift(c.env, id))!;
}

export async function dropLetter(c: PostCtx, bucket: R2Bucket, me: Who, id: string): Promise<void> {
  const g = await getGift(c.env, id);
  if (!g || g.status === 'removed') throw new HttpError(404, 'not_found', 'That gift is not here.');
  const b = await batchOfGift(c.env, g);
  editable(b, g, me);
  if (g.letter_key) await bucket.delete(g.letter_key).catch(() => undefined);
  await updateGift(c.env, id, { letter_key: null, letter_name: null, letter_mime: null, letter_bytes: null, letter_status: null, letter_error: null });
  await logEvent(c.env, { batch_id: b.id, gift_id: id, kind: 'letter_removed', actor: me.name });
}
