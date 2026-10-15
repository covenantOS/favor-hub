// Other gifts: the database side (db/other-gifts.sql). Nothing here talks to Blackbaud.
import { newId, nowIso, type Env } from '../http';
import { notTesterSql, TESTERS } from '../testuser';
import { batchName, type OgBatch, type OgGift } from './rules';

export async function logEvent(env: Env, e: { batch_id?: string | null; gift_id?: string | null; kind: string; actor: string; detail?: unknown }): Promise<void> {
  const detail = e.detail == null ? null : typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail);
  await env.DB.prepare('INSERT INTO og_event (at, batch_id, gift_id, kind, actor, detail) VALUES (?,?,?,?,?,?)')
    .bind(nowIso(), e.batch_id ?? null, e.gift_id ?? null, e.kind, e.actor, detail ? detail.slice(0, 1500) : null)
    .run();
}

export const getBatch = (env: Env, id: string) => env.DB.prepare('SELECT * FROM og_batch WHERE id = ? LIMIT 1').bind(id).first<OgBatch>();
export const getGift = (env: Env, id: string) => env.DB.prepare('SELECT * FROM og_gift WHERE id = ? LIMIT 1').bind(id).first<OgGift>();

export async function giftsOf(env: Env, batchId: string): Promise<OgGift[]> {
  return (await env.DB.prepare("SELECT * FROM og_gift WHERE batch_id = ? AND status <> 'removed' ORDER BY seq").bind(batchId).all<OgGift>()).results;
}

/** This person's open batch for the day, made the first time they save a gift. Each person enters into their own batch. */
export async function openBatchFor(env: Env, who: { name: string; email: string }, today: string): Promise<OgBatch> {
  const email = who.email.toLowerCase();
  const found = await env.DB.prepare("SELECT * FROM og_batch WHERE status = 'open' AND lower(created_by_email) = ? ORDER BY created_at DESC LIMIT 1").bind(email).first<OgBatch>();
  if (found) return found;
  const id = newId('ob');
  await env.DB.prepare('INSERT INTO og_batch (id, name, status, created_by, created_by_email, created_at) VALUES (?,?,?,?,?,?)').bind(id, batchName(today), 'open', who.name, email, nowIso()).run();
  await logEvent(env, { batch_id: id, kind: 'batch_created', actor: who.name });
  return (await getBatch(env, id))!;
}

/** Batches a viewer may see: real staff never see a batch a test account made, and the test accounts see only the test accounts' own. */
export async function listBatches(env: Env, viewerIsTester: boolean, limit = 30): Promise<(OgBatch & { gifts: number; cents: number })[]> {
  const who = viewerIsTester ? `lower(b.created_by_email) IN (${TESTERS.map((e) => `'${e}'`).join(', ')})` : notTesterSql('b.created_by_email');
  const r = await env.DB.prepare(
    `SELECT b.*, (SELECT COUNT(*) FROM og_gift g WHERE g.batch_id = b.id AND g.status <> 'removed') AS gifts,
            (SELECT COALESCE(SUM(g.amount_cents), 0) FROM og_gift g WHERE g.batch_id = b.id AND g.status <> 'removed') AS cents
       FROM og_batch b WHERE b.status <> 'removed' AND ${who} ORDER BY b.created_at DESC LIMIT ?`
  )
    .bind(limit)
    .all<OgBatch & { gifts: number; cents: number }>();
  return r.results;
}

export async function addGift(env: Env, batch: OgBatch, who: { name: string; email: string }, set: Record<string, string | number | null>): Promise<OgGift> {
  const id = newId('og');
  const seqRow = await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM og_gift WHERE batch_id = ?').bind(batch.id).first<{ n: number }>();
  const now = nowIso();
  await env.DB.prepare('INSERT INTO og_gift (id, batch_id, seq, status, kind, created_by, created_by_email, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, batch.id, Number(seqRow?.n) || 1, 'draft', String(set.kind || 'daf'), who.name, who.email.toLowerCase(), now, now)
    .run();
  const rest = { ...set };
  delete rest.kind;
  await updateGift(env, id, rest);
  await logEvent(env, { batch_id: batch.id, gift_id: id, kind: 'gift_added', actor: who.name, detail: { kind: set.kind } });
  return (await getGift(env, id))!;
}

export async function updateGift(env: Env, id: string, set: Record<string, string | number | null>): Promise<void> {
  const keys = Object.keys(set);
  if (!keys.length) return;
  const cols = keys.map((k) => `${k} = ?`).join(', ');
  await env.DB.prepare(`UPDATE og_gift SET ${cols}, updated_at = ? WHERE id = ?`).bind(...keys.map((k) => set[k]), nowIso(), id).run();
}

export async function batchCounts(env: Env): Promise<{ waiting: number; waitingCents: number }> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(g.amount_cents), 0) AS cents FROM og_gift g JOIN og_batch b ON b.id = g.batch_id
      WHERE b.status = 'waiting' AND g.status <> 'removed' AND ${notTesterSql('b.created_by_email')}`
  ).first<{ n: number; cents: number }>();
  return { waiting: Number(r?.n) || 0, waitingCents: Number(r?.cents) || 0 };
}
