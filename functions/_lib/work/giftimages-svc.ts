// Gift images: what the routes do. The list reads the mirror (giftimages.ts) and lays what the hub knows about each gift's attachments
// over it. Blackbaud calls go through the gift entry lane (favorintl.org /api/blackbaud/gift-entry), which keeps its own daily allowance
// apart from the upkeep route and the giving form. Asking whether a gift has an attachment costs 1 call. Attaching an image costs 3
// (an upload address, the attachment) plus the bytes, which go straight to Blackbaud's file service and spend no call. The image is
// also kept in the private gift bucket as the master copy. Nothing here changes a gift, a donor or an amount.
import { HttpError, newId, nowIso, type Env } from '../http';
import { mirrorQ } from './partner';
import { todayEt } from './service';
import { bbSender, laneToday, sayWhy, type BbSend } from '../gifts/bb';
import { recordLane } from '../gifts/flow';
import { cleanName, MAX_FILE } from './upload';
import { IMAGE_DAYS, loadImageRows, type ImageRow, type Known, type Why } from './giftimages';
import type { Ctx } from './service';

const ID = /^\d{1,12}$/;
export const mayGiftImages = (s: Ctx['scope']): boolean => !s || s.role === 'admin' || s.role === 'support';
export const KINDS = { check: 'Check', letter: 'Letter', other: 'Image' } as const;
export type ImgKind = keyof typeof KINDS;
const IMG_TYPES = /\.(pdf|png|jpe?g)$/i;
/** Checks asked about at one press. */
export const CHECK_MAX = 20;
/** The lane keeps this many calls for gift entry. */
export const LANE_RESERVE = 60;

export interface Deps {
  send: BbSend;
  lane: () => Promise<{ calls: number; cap: number } | null>;
  bucket?: R2Bucket | null;
  put?: typeof fetch;
}
export const depsFor = (env: Env): Deps => ({ send: bbSender(env), lane: () => laneToday(env), bucket: ((env as any).GIFT_CAPTURES as R2Bucket | undefined) ?? null, put: (u, i) => fetch(u, i) });

/** What the hub holds: its own checks and attachments, and the images Gift entry has copied to a committed gift. */
export async function knownMap(env: Env): Promise<Map<string, Known>> {
  const out = new Map<string, Known>();
  const own = await env.DB.prepare('SELECT gift_id, state, files, file_name, checked_at FROM act_giftimg').all<{ gift_id: string; state: string; files: number; file_name: string | null; checked_at: string }>().catch(() => ({ results: [] as any[] }));
  for (const r of own.results) out.set(String(r.gift_id), { state: r.state === 'has' ? 'has' : 'none', files: Number(r.files) || 0, file: r.file_name, checked_at: r.checked_at });
  const ge = await env.DB.prepare('SELECT DISTINCT g.bb_gift_id AS id FROM ge_gift g JOIN ge_image i ON i.gift_id = g.id WHERE i.attached_at IS NOT NULL AND g.bb_gift_id IS NOT NULL').all<{ id: string }>().catch(() => ({ results: [] as any[] }));
  for (const r of ge.results) if (!out.has(String(r.id))) out.set(String(r.id), { state: 'has', files: 1, file: null, checked_at: '' });
  return out;
}

export interface ImagesOut {
  ok: true;
  today: string;
  synced: string;
  window: number;
  rows: ImageRow[];
  stats: { need: number; unchecked: number; big: number; giving: number; designated: number };
  lane: { calls: number; cap: number; left: number } | null;
  checkMax: number;
}

export async function giftImagesResponse(ctx: Ctx, deps: Deps): Promise<ImagesOut> {
  if (!mayGiftImages(ctx.scope)) throw new HttpError(403, 'not_yours', 'Gift images is for the admin desk and the Support Team.');
  const today = todayEt();
  const synced = await ctx.repo.synced().catch(() => '');
  const rows = await loadImageRows(mirrorQ(ctx.env), { today, known: await knownMap(ctx.env) });
  const lane = await deps.lane().catch(() => null);
  const count = (w: Why) => rows.filter((r) => r.why === w).length;
  return {
    ok: true, today, synced, window: IMAGE_DAYS, rows,
    stats: { need: rows.filter((r) => r.state === 'none').length, unchecked: rows.filter((r) => r.state === 'unknown').length, big: count('big'), giving: count('giving_fund'), designated: count('designated') },
    lane: lane ? { calls: lane.calls, cap: lane.cap, left: Math.max(0, lane.cap - lane.calls - LANE_RESERVE) } : null,
    checkMax: CHECK_MAX,
  };
}

async function currentRow(ctx: Ctx, giftId: string): Promise<ImageRow | null> {
  const rows = await loadImageRows(mirrorQ(ctx.env), { today: todayEt(), known: await knownMap(ctx.env) });
  return rows.find((r) => r.giftId === giftId) || null;
}

async function save(env: Env, o: { giftId: string; cid: string; state: 'has' | 'none'; files: number; file?: string | null; source: string; actor: string; email: string; attached?: boolean }) {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO act_giftimg (gift_id, cid, state, files, file_name, source, checked_at, attached_at, actor, actor_email) VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(gift_id) DO UPDATE SET state = excluded.state, files = excluded.files, file_name = COALESCE(excluded.file_name, file_name), source = excluded.source,
       checked_at = excluded.checked_at, attached_at = COALESCE(excluded.attached_at, attached_at), actor = excluded.actor, actor_email = excluded.actor_email`
  ).bind(o.giftId, o.cid, o.state, o.files, o.file ?? null, o.source, now, o.attached ? now : null, o.actor, o.email).run();
}

/** Ask Blackbaud whether these gifts have an attachment. One call each, on the gift entry lane. */
export async function checkGifts(ctx: Ctx, idsIn: unknown, deps: Deps) {
  if (!mayGiftImages(ctx.scope)) throw new HttpError(403, 'not_yours', 'Gift images is for the admin desk and the Support Team.');
  const ids = [...new Set((Array.isArray(idsIn) ? idsIn : []).map(String).filter((x) => ID.test(x)))];
  if (!ids.length) throw new HttpError(400, 'no_gifts', 'Pick the gifts to check.');
  if (ids.length > CHECK_MAX) throw new HttpError(400, 'too_many', `Check ${CHECK_MAX} gifts or fewer at a time.`);
  const rows = await loadImageRows(mirrorQ(ctx.env), { today: todayEt(), known: await knownMap(ctx.env) });
  const mine = new Map(rows.map((r) => [r.giftId, r]));
  const todo = ids.filter((id) => mine.has(id));
  if (!todo.length) throw new HttpError(409, 'not_listed', 'Those gifts are not on the list any more. Reload the page.');
  const lane = await deps.lane().catch(() => null);
  if (lane && lane.cap - lane.calls - LANE_RESERVE < todo.length) throw new HttpError(429, 'lane_full', "Today's Blackbaud allowance for gift entry is nearly used. Check again after the reset, or open the gift in Blackbaud.");
  let has = 0;
  let none = 0;
  const failed: { giftId: string; error: string }[] = [];
  for (let i = 0; i < todo.length; i += 5) {
    const part = todo.slice(i, i + 5);
    const a = await deps.send(part.map((id) => ({ method: 'GET' as const, path: `/gift/v1/gifts/${id}/attachments` })));
    await recordLane(ctx.env, a).catch(() => undefined);
    if (a.capped || a.wait) {
      for (const id of part) failed.push({ giftId: id, error: a.wait || "At today's limit." });
      continue;
    }
    for (let k = 0; k < part.length; k++) {
      const r = a.results[k];
      const id = part[k];
      if (!r || !r.ok) { failed.push({ giftId: id, error: r ? sayWhy(r.body) : 'Blackbaud did not answer.' }); continue; }
      const list: unknown[] = Array.isArray(r.body && r.body.value) ? r.body.value : [];
      const n = Number(r.body && r.body.count) || list.length;
      await save(ctx.env, { giftId: id, cid: mine.get(id)!.cid, state: n > 0 ? 'has' : 'none', files: n, source: 'blackbaud', actor: ctx.actor, email: ctx.email });
      if (n > 0) has++; else none++;
    }
  }
  return { ok: true, checked: has + none, has, none, failed };
}

export interface AttachInput { giftId?: string; kind?: string; file?: File | null }

/** Put an image on a gift in Blackbaud, keep the master copy, and record it. */
export async function attachToGift(ctx: Ctx, input: AttachInput, deps: Deps) {
  if (!mayGiftImages(ctx.scope)) throw new HttpError(403, 'not_yours', 'Gift images is for the admin desk and the Support Team.');
  const giftId = String(input.giftId || '');
  if (!ID.test(giftId)) throw new HttpError(400, 'bad_gift', 'Pick a gift.');
  const kind = (input.kind && input.kind in KINDS ? input.kind : 'check') as ImgKind;
  const file = input.file;
  if (!file || typeof (file as any).arrayBuffer !== 'function' || !file.size) throw new HttpError(400, 'no_file', 'Pick the image first.');
  if (file.size > MAX_FILE) throw new HttpError(400, 'too_big', 'Files up to 10 MB can be attached here.');
  const fileName = cleanName(file.name);
  if (!IMG_TYPES.test(fileName)) throw new HttpError(400, 'bad_type', 'Attach a PDF, JPEG or PNG image.');
  const row = await currentRow(ctx, giftId);
  if (!row) {
    // A role test may attach only to a gift on its one test record.
    if (!ctx.testCid) throw new HttpError(409, 'not_listed', 'That gift is not on the list any more. Reload the page.');
    const g = await deps.send([{ method: 'GET', path: `/gift/v1/gifts/${giftId}` }]);
    const body = g.results[0] && g.results[0].body;
    if (!g.results[0] || !g.results[0].ok || !body || String(body.constituent_id) !== ctx.testCid) throw new HttpError(403, 'test_only', 'A role test may change only its one test record.');
  } else if (ctx.testCid && row.cid !== ctx.testCid) throw new HttpError(403, 'test_only', 'A role test may change only its one test record.');
  const lane = await deps.lane().catch(() => null);
  if (lane && lane.cap - lane.calls < 4) throw new HttpError(429, 'lane_full', "Today's Blackbaud allowance for gift entry is used. Attach it after the reset.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await deps.send([{ method: 'POST', path: '/gift/v1/documents', body: { file_name: fileName, upload_thumbnail: false } }]);
  await recordLane(ctx.env, doc).catch(() => undefined);
  const dr = doc.results[0];
  if (doc.capped || doc.wait || !dr) throw new HttpError(503, 'blackbaud_wait', (doc.wait || 'Blackbaud did not answer.') + ' Nothing was attached. Try again in a minute.');
  if (dr.refused) throw new HttpError(503, 'not_allowed', 'The Blackbaud connection does not allow gift attachments yet.');
  if (!dr.ok || !dr.body || !dr.body.file_id || !dr.body.file_upload_request) throw new HttpError(503, 'blackbaud_wait', `${sayWhy(dr.body)} Nothing was attached.`);
  const up = dr.body.file_upload_request;
  const headers: Record<string, string> = {};
  for (const h of Array.isArray(up.headers) ? up.headers : []) if (h && h.name) headers[String(h.name)] = String(h.value ?? '');
  if (!headers['Content-Type'] && file.type) headers['Content-Type'] = file.type;
  const put = await (deps.put || fetch)(String(up.url), { method: String(up.method || 'PUT'), headers, body: bytes });
  if (!put.ok) throw new HttpError(502, 'upload_failed', 'The file did not reach Blackbaud. Try again.');
  const date = `${row ? row.date : todayEt()}T00:00:00`;
  const label = `${KINDS[kind]} (hub)`;
  const att = await deps.send([{ method: 'POST', path: '/gift/v1/gifts/attachments', body: { parent_id: giftId, type: 'Physical', file_id: String(dr.body.file_id), file_name: fileName, name: label, date } }]);
  await recordLane(ctx.env, att).catch(() => undefined);
  const ar = att.results[0];
  if (att.capped || att.wait || !ar) throw new HttpError(503, 'blackbaud_wait', (att.wait || 'Blackbaud did not answer.') + ' The file may not be attached. Check the gift before you try again.');
  if (!ar.ok) throw new HttpError(503, 'blackbaud_wait', `${sayWhy(ar.body)} The file was not attached.`);
  if (deps.bucket) {
    await deps.bucket.put(`attach/${giftId}/${newId('gi')}-${fileName}`, bytes, { httpMetadata: { contentType: file.type || 'application/octet-stream' } }).catch(() => undefined);
  }
  await save(ctx.env, { giftId, cid: row ? row.cid : String(ctx.testCid || ''), state: 'has', files: 1, file: fileName, source: 'hub', actor: ctx.actor, email: ctx.email, attached: true });
  return { ok: true, giftId, file: fileName, attachmentId: String(ar.body && ar.body.id) };
}

