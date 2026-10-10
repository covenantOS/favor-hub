// Copying a check photo to Blackbaud as a gift attachment, after the batch is committed and only for the rule gifts (designated
// fund, $5,000 or more, giving fund or foundation). Every photo stays in the private R2 bucket as the master; this is a copy.
// P0 (2026-10-10) proved the three steps on a direct gift: POST /gift/v1/documents, PUT the bytes to the URL it returns (Blackbaud's
// file service, so it does not spend the lane), POST /gift/v1/gifts/attachments. No attachment tag is needed. A batch gift has no
// gift id, so nothing attaches until Jennifer commits; then the hub finds each committed gift by partner, date and the hub id in its
// Reference. Cost: 3 lane calls per rule gift.
import { newId, nowIso } from '../http';
import { recordLane, BACKOFF_MIN, MAX_ATTEMPTS, type Ctx } from './flow';
import { sayWhy } from './bb';
import { getDeposit, giftsOf, logEvent, type ImageRow } from './store';

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface AttachDeps {
  /** The photo's bytes from the private bucket. */
  bytes: (key: string) => Promise<Uint8Array | null>;
  /** PUT to Blackbaud's file service. Tests pass a stand-in. */
  put?: Fetcher;
}

const fileNameFor = (g: { check_number: string | null; id: string }, img: ImageRow) => `check-${g.check_number || g.id}.${img.mime === 'image/png' ? 'png' : 'jpg'}`;

export async function ensureAttachRows(c: Ctx, depositId: string): Promise<number> {
  const imgs = (await c.env.DB.prepare('SELECT * FROM ge_image WHERE deposit_id = ? AND copy_to_bb = 1 AND attached_at IS NULL').bind(depositId).all<ImageRow>()).results;
  let made = 0;
  for (const img of imgs) {
    const r = await c.env.DB.prepare('INSERT OR IGNORE INTO ge_outbox (id, deposit_id, op, status, created_at) VALUES (?,?,?,?,?)').bind(newId('go'), depositId, `attach:${img.id}`, 'queued', nowIso()).run();
    made += Number(r.meta?.changes) || 0;
  }
  return made;
}

/** Attach every due photo for a committed deposit. Returns how many attached and how many are still waiting. */
export async function runAttachments(c: Ctx, depositId: string, deps: AttachDeps): Promise<{ attached: number; waiting: number; failed: number }> {
  const d = await getDeposit(c.env, depositId);
  const out = { attached: 0, waiting: 0, failed: 0 };
  if (!d || d.status !== 'committed') return out;
  await ensureAttachRows(c, depositId);
  const rows = (await c.env.DB.prepare("SELECT * FROM ge_outbox WHERE deposit_id = ? AND op LIKE 'attach:%' AND status IN ('queued', 'waiting') ORDER BY created_at").bind(depositId).all<any>()).results;
  const gifts = await giftsOf(c.env, depositId);
  const now = (c.now ? c.now() : new Date()).toISOString();
  for (const row of rows) {
    if (row.next_try_at && row.next_try_at > now) {
      out.waiting++;
      continue;
    }
    const imgId = String(row.op).slice('attach:'.length);
    const img = await c.env.DB.prepare('SELECT * FROM ge_image WHERE id = ?').bind(imgId).first<ImageRow>();
    const gift = img ? gifts.find((g) => g.id === img.gift_id) : null;
    const fail = async (cls: 'wait' | 'retry' | 'final', msg: string) => {
      const attempts = Number(row.attempts) + 1;
      if (cls === 'final' || attempts >= MAX_ATTEMPTS) {
        await c.env.DB.prepare("UPDATE ge_outbox SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?").bind(attempts, msg.slice(0, 300), row.id).run();
        if (img) await c.env.DB.prepare('UPDATE ge_image SET attach_error = ? WHERE id = ?').bind(msg.slice(0, 300), img.id).run();
        out.failed++;
      } else {
        const wait = cls === 'wait' ? 12 * 60 : BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
        await c.env.DB.prepare("UPDATE ge_outbox SET status = 'queued', attempts = ?, next_try_at = ?, last_error = ? WHERE id = ?")
          .bind(attempts, new Date(Date.parse(now) + wait * 60000).toISOString(), msg.slice(0, 300), row.id)
          .run();
        out.waiting++;
      }
    };
    if (!img || !gift || !gift.partner_id) {
      await fail('final', 'The photo or its gift is missing.');
      continue;
    }
    // 1. find the committed gift
    let giftId = gift.bb_gift_id;
    if (!giftId) {
      const day = gift.gift_date || d.deposit_date;
      const a = await c.send([{ method: 'GET', path: `/gift/v1/gifts?constituent_id=${gift.partner_id}&start_gift_date=${day}&end_gift_date=${day}&limit=50` }]);
      await recordLane(c.env, a);
      if (a.capped) { await fail('wait', a.wait || 'At the daily limit.'); continue; }
      const r = a.results[0];
      if (!r) { await fail('retry', a.wait || 'Blackbaud did not answer.'); continue; }
      if (!r.ok) { await fail(r.status >= 500 || r.status === 429 ? 'retry' : 'final', sayWhy(r.body)); continue; }
      const list: any[] = (r.body && r.body.value) || (r.body && r.body.gifts) || [];
      const hit = list.find((x) => String(x.reference || '').includes(`hub ${gift.id}`));
      if (!hit) { await fail('retry', 'The committed gift was not found yet. The Reference carries the hub id.'); continue; }
      giftId = String(hit.id);
      await c.env.DB.prepare('UPDATE ge_gift SET bb_gift_id = ? WHERE id = ?').bind(giftId, gift.id).run();
    }
    // 2. an upload address
    const name = fileNameFor(gift, img);
    const doc = await c.send([{ method: 'POST', path: '/gift/v1/documents', body: { file_name: name, upload_thumbnail: false } }]);
    await recordLane(c.env, doc);
    if (doc.capped) { await fail('wait', doc.wait || 'At the daily limit.'); continue; }
    const dr = doc.results[0];
    if (!dr) { await fail('retry', doc.wait || 'Blackbaud did not answer.'); continue; }
    if (!dr.ok) { await fail(dr.status >= 500 || dr.status === 429 ? 'retry' : 'final', sayWhy(dr.body)); continue; }
    const fileId = String(dr.body && dr.body.file_id);
    const up = dr.body && dr.body.file_upload_request;
    if (!fileId || !up || !up.url) { await fail('retry', 'Blackbaud gave no upload address.'); continue; }
    // 3. the bytes go straight to Blackbaud's file service
    const bytes = await deps.bytes(img.r2_key);
    if (!bytes) { await fail('final', 'The photo is not in storage.'); continue; }
    const headers: Record<string, string> = { 'Content-Type': img.mime };
    for (const h of up.headers || []) headers[String(h.name)] = String(h.value);
    const put = await (deps.put || ((u, i) => fetch(u, i)))(String(up.url), { method: String(up.method || 'PUT'), headers, body: bytes });
    if (!put.ok) { await fail('retry', `The upload answered ${put.status}.`); continue; }
    // 4. attach it to the gift
    const att = await c.send([{ method: 'POST', path: '/gift/v1/gifts/attachments', body: { parent_id: giftId, type: 'Physical', file_id: fileId, file_name: name, name: `Check ${gift.check_number || ''}`.trim() + ' (hub)', date: `${gift.gift_date || d.deposit_date}T00:00:00` } }]);
    await recordLane(c.env, att);
    const ar = att.results[0];
    if (!ar) { await fail('retry', att.wait || 'Blackbaud did not answer.'); continue; }
    if (!ar.ok) { await fail(ar.status >= 500 || ar.status === 429 ? 'retry' : 'final', sayWhy(ar.body)); continue; }
    await c.env.DB.prepare('UPDATE ge_image SET bb_file_id = ?, bb_attachment_id = ?, attached_at = ?, attach_error = NULL WHERE id = ?').bind(fileId, String(ar.body && ar.body.id), nowIso(), img.id).run();
    await c.env.DB.prepare("UPDATE ge_outbox SET status = 'done', done_at = ?, last_error = NULL WHERE id = ?").bind(nowIso(), row.id).run();
    await logEvent(c.env, { deposit_id: depositId, gift_id: gift.id, kind: 'attachment_copied', actor: c.actor, detail: { gift: giftId } });
    out.attached++;
  }
  return out;
}
