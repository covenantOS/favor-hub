// One photo in, one review row out: store the image privately, read it with two readers, find the partner, fill the likely fund and
// appeal, run the duplicate guard, and leave the row waiting for a human glance. Nothing here talks to Blackbaud.
import { newId, nowIso, type Env } from '../http';
import type { Q } from '../work/partner';
import type { ActionsRepo } from '../work/repo';
import { candidatesFor, findDuplicate, lastGiftCoding, loadCatalog } from './match';
import { mergeReads, readPhoto, toDataUrl, type Merged, type ReaderResult } from './read';
import { triagePhoto, type PhotoKind, type Triage } from './triage';
import { dedupeKeyOf, getDeposit, getGift, logEvent, parseJson, prayerIn, ruleFor, sha256Hex, updateGift, WHERE_NEEDED_MOST, type GiftRow } from './store';

export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

export interface CaptureDeps {
  repo: ActionsRepo;
  q: Q;
  /** Tests pass a stand-in for the two readers. */
  read?: (dataUrl: string) => Promise<ReaderResult[]>;
  /** Tests pass a stand-in for the Clef triage call. */
  triage?: (dataUrl: string) => Promise<Triage>;
  bucket?: R2Bucket;
}

const bucketOf = (env: Env, deps: CaptureDeps): R2Bucket => (deps.bucket || ((env as any).GIFT_CAPTURES as R2Bucket));

/** What the photo became. An envelope is skipped and an unreadable photo asks for a retake: neither keeps an image or a row. */
export interface PhotoOutcome {
  gift: GiftRow | null;
  duplicatePhoto: boolean;
  photoKind: PhotoKind;
  status: string;
}

export async function addPhoto(
  env: Env,
  deps: CaptureDeps,
  depositId: string,
  who: { name: string; email: string },
  input: { bytes: Uint8Array; mime: string; kind?: 'check_front' | 'slip' | 'letter'; giftId?: string }
): Promise<PhotoOutcome> {
  const dep = await getDeposit(env, depositId);
  if (!dep || dep.status !== 'open') throw new Error('This deposit is not open for photos.');
  const mime = input.mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const sha = await sha256Hex(input.bytes);
  const stamp = nowIso();

  // Clef sorts the photo before any reader runs. A failed call reads as 'other', so the photo still goes on to the readers.
  const dataUrl = toDataUrl(input.bytes, mime);
  const tri = await (deps.triage ? deps.triage(dataUrl) : triagePhoto(env, dataUrl));
  if (tri.kind === 'envelope' || tri.kind === 'unreadable') {
    const skipped = tri.kind === 'envelope';
    await logEvent(env, { deposit_id: depositId, gift_id: input.giftId || null, kind: skipped ? 'photo_skipped' : 'photo_retake', actor: who.name, detail: { p: tri.p, secs: tri.secs } });
    return { gift: null, duplicatePhoto: false, photoKind: tri.kind, status: skipped ? 'skipped' : 'retake' };
  }

  let giftId = input.giftId || '';
  if (!giftId) {
    giftId = newId('gg');
    const seq = ((await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM ge_gift WHERE deposit_id = ?').bind(depositId).first<{ n: number }>())?.n || 0) + 1;
    await env.DB.prepare(
      `INSERT INTO ge_gift (id, deposit_id, seq, status, kind, gift_date, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`
    )
      .bind(giftId, depositId, seq, 'reading', 'check', dep.deposit_date, who.name, stamp, stamp)
      .run();
  }
  const imageId = newId('gi');
  const key = `deposits/${depositId}/${giftId}/${imageId}.${mime === 'image/png' ? 'png' : 'jpg'}`;
  await bucketOf(env, deps).put(key, input.bytes, { httpMetadata: { contentType: mime }, customMetadata: { sha256: sha, deposit: depositId, gift: giftId } });
  await env.DB.prepare('INSERT INTO ge_image (id, gift_id, deposit_id, kind, r2_key, sha256, bytes, mime, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(imageId, giftId, depositId, input.kind || 'check_front', key, sha, input.bytes.length, mime, who.email, stamp)
    .run();
  await logEvent(env, { deposit_id: depositId, gift_id: giftId, kind: 'photo_added', actor: who.name, detail: { bytes: input.bytes.length, photo: tri.kind, p: tri.p, triage_error: tri.error } });

  try {
    // A slip or second photo for a row already read adds the appeal and memo. It never rewrites the check's own fields.
    const slipOnly = !!input.giftId && (input.kind === 'slip' || input.kind === 'letter');
    await readAndMatch(env, deps, depositId, giftId, imageId, input.bytes, mime, sha, who.name, slipOnly, tri.kind);
  } catch (e: any) {
    // The photo is kept and the row waits for a person to type it. A failed read never blocks the deposit.
    await updateGift(env, giftId, { status: 'review', error: 'The photo could not be read. Type the gift in.' });
    await logEvent(env, { deposit_id: depositId, gift_id: giftId, kind: 'read_failed', actor: who.name, detail: String(e && e.message ? e.message : e) });
  }
  const gift = (await getGift(env, giftId))!;
  const dup = parseJson<{ kind?: string } | null>(gift.dup_json, null);
  return { gift, duplicatePhoto: !!dup && dup.kind === 'photo', photoKind: tri.kind, status: gift.status };
}

export async function readAndMatch(env: Env, deps: CaptureDeps, depositId: string, giftId: string, imageId: string, bytes: Uint8Array, mime: string, sha: string, actor: string, slipOnly = false, photoKind: PhotoKind = 'other'): Promise<void> {
  const dep = (await getDeposit(env, depositId))!;
  const dataUrl = toDataUrl(bytes, mime);
  const results = await (deps.read ? deps.read(dataUrl) : readPhoto(env, dataUrl));
  const merged: Merged = mergeReads(results, dep.deposit_date);
  const stamp = nowIso();

  for (const r of results) {
    await env.DB.prepare('INSERT INTO ge_read (id, image_id, model, fields_json, secs, error, read_at) VALUES (?,?,?,?,?,?,?)')
      .bind(newId('gr'), imageId, r.model, JSON.stringify(r.fields || {}), r.secs, r.error, stamp)
      .run();
  }

  // A card number in the photo: the image is not kept, the row says so, and the keyer uses Phone gift.
  if (merged.card) {
    const img = await env.DB.prepare('SELECT r2_key FROM ge_image WHERE id = ?').bind(imageId).first<{ r2_key: string }>();
    if (img) await bucketOf(env, deps).delete(img.r2_key);
    await env.DB.prepare('DELETE FROM ge_image WHERE id = ?').bind(imageId).run();
    await env.DB.prepare('DELETE FROM ge_read WHERE image_id = ?').bind(imageId).run();
    await updateGift(env, giftId, { status: 'review', fields_json: JSON.stringify({ card: true, flags: [], why: {}, readers: [] }), error: 'A card number showed in the photo. The photo was not kept.' });
    await logEvent(env, { deposit_id: depositId, gift_id: giftId, kind: 'card_number_discarded', actor });
    return;
  }

  if (slipOnly) {
    const g0 = (await getGift(env, giftId))!;
    const add: Record<string, string | number | null> = {};
    const cat0 = await loadCatalog(deps.q).catch(() => null);
    const code = (merged.slipAppeal || '').trim().toLowerCase();
    const hit = code && cat0 ? cat0.appeals.find((a) => a.code.toLowerCase() === code) : null;
    const f0 = parseJson<any>(g0.fields_json, {});
    if (hit) {
      Object.assign(add, { appeal_id: hit.id, appeal_name: hit.name });
      f0.defaults = { ...(f0.defaults || {}), slip: true };
      add.fields_json = JSON.stringify(f0);
      if (g0.appeal_id !== hit.id) Object.assign(add, { confirmed_by: null, confirmed_at: null });
    }
    if (!g0.memo && merged.memo) Object.assign(add, { memo: merged.memo, prayer: prayerIn(merged.memo) ? 1 : g0.prayer });
    await updateGift(env, giftId, add);
    await env.DB.prepare('UPDATE ge_image SET copy_to_bb = ? WHERE gift_id = ?').bind(g0.rule ? 1 : 0, giftId).run();
    return;
  }

  const set: Record<string, string | number | null> = {
    status: 'review',
    payer: merged.payer,
    memo: merged.memo,
    check_number: merged.checkNumber,
    check_date: merged.checkDate,
    amount_cents: merged.amountCents,
    prayer: prayerIn(merged.memo) ? 1 : 0,
  };

  // The partner: only a clear single match is proposed. Anything else waits for a person, with the candidates listed.
  let cands: Awaited<ReturnType<typeof candidatesFor>> = [];
  if (merged.payer) cands = await candidatesFor(deps.repo, deps.q, merged.payer);
  const pick = cands.length === 1 ? cands[0] : cands.filter((c) => c.exact).length === 1 ? cands.find((c) => c.exact)! : null;
  const defaults: Record<string, boolean> = {};
  if (pick) {
    Object.assign(set, { partner_id: pick.cid, partner_lookup: pick.lookup, partner_name: pick.name, partner_place: pick.place });
  }
  set.candidates_json = JSON.stringify(cands);

  // Fund and appeal: Where Needed Most, and the appeal on the partner's last gift (the Admin Desk SOP's fallback).
  const cat = await loadCatalog(deps.q).catch(() => null);
  set.fund_id = WHERE_NEEDED_MOST;
  set.fund_name = cat?.funds.find((f) => f.id === WHERE_NEEDED_MOST)?.name || 'Where Needed Most';
  let appealId: string | null = null;
  if (merged.slipAppeal && cat) {
    const code = merged.slipAppeal.trim().toLowerCase();
    appealId = cat.appeals.find((a) => a.code.toLowerCase() === code)?.id || null;
    if (appealId) defaults.slip = true;
  }
  if (!appealId && pick) {
    const last = await lastGiftCoding(deps.q, pick.cid).catch(() => null);
    if (last) {
      appealId = last.appealId;
      defaults.lastGift = true;
    }
  }
  if (appealId) {
    set.appeal_id = appealId;
    set.appeal_name = cat?.appeals.find((a) => a.id === appealId)?.name || null;
  }
  set.fields_json = JSON.stringify({ photo: photoKind, flags: merged.flags, why: merged.why, readers: merged.readers, unreadable: merged.unreadable, defaults });
  await updateGift(env, giftId, set);

  const g = (await getGift(env, giftId))!;
  const key = await dedupeKeyOf(g);
  const dup = await findDuplicate(env, deps.q, { ...g, dedupe_key: key }, sha);
  const rule = ruleFor(g);
  await updateGift(env, giftId, { dedupe_key: key, rule, dup_json: dup ? JSON.stringify(dup) : null });
  await env.DB.prepare('UPDATE ge_image SET copy_to_bb = ? WHERE gift_id = ?').bind(rule ? 1 : 0, giftId).run();
}

/** After a person edits a row, the things that follow from its fields are worked out again. */
export async function recompute(env: Env, deps: CaptureDeps, giftId: string): Promise<GiftRow> {
  let g = (await getGift(env, giftId))!;
  const key = await dedupeKeyOf(g);
  const img = await env.DB.prepare('SELECT sha256 FROM ge_image WHERE gift_id = ? ORDER BY uploaded_at LIMIT 1').bind(giftId).first<{ sha256: string }>();
  const prev = parseJson<any>(g.dup_json, null);
  const dup = await findDuplicate(env, deps.q, { ...g, dedupe_key: key }, img ? img.sha256 : null);
  // A decision already made about the same duplicate stands.
  const dupOut = dup ? (prev && prev.kind === dup.kind && prev.message === dup.message ? { ...dup, decision: prev.decision } : dup) : null;
  await updateGift(env, giftId, { dedupe_key: key, rule: ruleFor(g), dup_json: dupOut ? JSON.stringify(dupOut) : null, prayer: g.prayer || (prayerIn(g.memo) ? 1 : 0) });
  g = (await getGift(env, giftId))!;
  // the photo copies to Blackbaud only for the rule gifts
  await env.DB.prepare('UPDATE ge_image SET copy_to_bb = ? WHERE gift_id = ?').bind(g.rule ? 1 : 0, giftId).run();
  return g;
}

/** A cash row has no photo. The keyer types the amount and picks the partner; it counts on the tape like any other gift. */
export async function addCash(env: Env, depositId: string, who: { name: string; email: string }, amountCents: number): Promise<GiftRow> {
  const dep = await getDeposit(env, depositId);
  if (!dep || dep.status !== 'open') throw new Error('This deposit is not open for rows.');
  const id = newId('gg');
  const stamp = nowIso();
  const seq = ((await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM ge_gift WHERE deposit_id = ?').bind(depositId).first<{ n: number }>())?.n || 0) + 1;
  await env.DB.prepare(
    `INSERT INTO ge_gift (id, deposit_id, seq, status, kind, amount_cents, gift_date, fund_id, fund_name, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(id, depositId, seq, 'review', 'cash', amountCents, dep.deposit_date, WHERE_NEEDED_MOST, 'Where Needed Most', who.name, stamp, stamp)
    .run();
  await logEvent(env, { deposit_id: depositId, gift_id: id, kind: 'cash_row_added', actor: who.name });
  return (await getGift(env, id))!;
}
