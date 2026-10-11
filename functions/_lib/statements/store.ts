// What the hub keeps about giving statements: the wording (Admin settings), the print files and who has been issued a
// year-end statement, the one-file-at-a-time lock, and a short log. Tables are in db/statements.sql.
import { HttpError, newId, nowIso, type Env } from '../http';
import { cleanCopy, DEFAULT_COPY, WORDING, type StatementCopy } from './copy';

export const DEFAULT_BATCH = 100;

export async function settingValue(env: Env, id: string, fallback: string): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM hub_settings WHERE key = ? LIMIT 1').bind(id).first<{ value: string }>().catch(() => null);
  return row ? row.value : fallback;
}

export async function emailOn(env: Env): Promise<boolean> {
  return (await settingValue(env, 'statements.email', 'off')) === 'on';
}

export async function batchSize(env: Env): Promise<number> {
  const n = Math.floor(Number(await settingValue(env, 'statements.batch_size', String(DEFAULT_BATCH))));
  return Number.isFinite(n) && n >= 10 && n <= 500 ? n : DEFAULT_BATCH;
}

export async function driveFolder(env: Env): Promise<string> {
  return (await settingValue(env, 'statements.drive_folder', '')).trim();
}

/** The wording as saved in Admin, filled in with the default wherever a field was never saved. */
export async function getCopy(env: Env): Promise<StatementCopy> {
  const rows = await env.DB.prepare("SELECT key, value FROM hub_settings WHERE key LIKE 'statements.w.%'").all<{ key: string; value: string }>().catch(() => ({ results: [] as { key: string; value: string }[] }));
  const saved: Partial<Record<keyof StatementCopy, string>> = {};
  for (const r of rows.results || []) {
    const f = WORDING.find((w) => w.id === r.key);
    if (f) saved[f.key] = r.value;
  }
  return cleanCopy(saved);
}

export { DEFAULT_COPY };

export interface PartnerEntry {
  id: string;
  lookup: string;
  name: string;
  /** Net total of the statement, cents. */
  cents: number;
  /** The tax-list basis, cents. */
  basis: number;
  email?: string;
  skipped?: string;
}

export interface BatchRow {
  id: string;
  kind: string;
  list: string;
  year: number | null;
  from_date: string;
  to_date: string;
  include_soft: number;
  count: number;
  gifts: number;
  amount_cents: number;
  basis_cents: number;
  skipped: number;
  seq: number;
  pdf_key: string;
  partners: string;
  copy: string;
  status: string;
  created_by: string;
  created_at: string;
  printed_by: string;
  printed_at: string | null;
  downloaded_at: string | null;
  drive_file: string;
}

export function summary(b: BatchRow): Record<string, unknown> {
  return {
    id: b.id,
    kind: b.kind,
    list: b.list,
    year: b.year,
    from: b.from_date,
    to: b.to_date,
    includeSoft: !!b.include_soft,
    count: b.count,
    gifts: b.gifts,
    amount: b.amount_cents / 100,
    basis: b.basis_cents / 100,
    skipped: b.skipped,
    seq: b.seq,
    status: b.status,
    createdBy: b.created_by,
    createdAt: b.created_at,
    printedBy: b.printed_by,
    printedAt: b.printed_at,
    downloadedAt: b.downloaded_at,
    driveFile: b.drive_file || '',
  };
}

export async function getBatch(env: Env, id: string): Promise<BatchRow> {
  const row = await env.DB.prepare('SELECT * FROM stm_batches WHERE id = ?').bind(id).first<BatchRow>();
  if (!row) throw new HttpError(404, 'not_found', 'That print file is not on the list.');
  return row;
}

export async function recentBatches(env: Env, limit = 40): Promise<BatchRow[]> {
  const r = await env.DB.prepare('SELECT * FROM stm_batches WHERE status <> ? ORDER BY created_at DESC LIMIT ?').bind('discarded', limit).all<BatchRow>();
  return r.results || [];
}

/** The year-end print file that is not marked printed yet. Only one may be open. */
export async function openYearEnd(env: Env): Promise<BatchRow | null> {
  return env.DB.prepare("SELECT * FROM stm_batches WHERE kind = 'yearend' AND status = 'printing' ORDER BY created_at LIMIT 1").first<BatchRow>();
}

export async function issuedFor(env: Env, year: number): Promise<Map<string, { list: string; batch: string; cents: number }>> {
  const r = await env.DB.prepare('SELECT cid, list, batch_id, cents FROM stm_issued WHERE year = ?').bind(year).all<{ cid: string; list: string; batch_id: string; cents: number }>();
  return new Map((r.results || []).map((x) => [String(x.cid), { list: x.list, batch: x.batch_id, cents: x.cents }]));
}

export async function logEvent(env: Env, actor: string, kind: string, batchId: string, detail: string): Promise<void> {
  await env.DB.prepare('INSERT INTO stm_log (at, actor, kind, batch_id, detail) VALUES (?, ?, ?, ?, ?)').bind(nowIso(), actor, kind, batchId, detail.slice(0, 2000)).run().catch(() => {});
}

/* ---------------------------------------------------------- one file at a time */

const LOCK = 'lock:make_file';

/** Held while a print file is made, so two people pressing at once cannot put one partner in two files. */
export async function takeLock(env: Env, actor: string): Promise<boolean> {
  const stale = new Date(Date.now() - 3 * 60_000).toISOString();
  await env.DB.prepare('DELETE FROM stm_state WHERE key = ? AND updated_at < ?').bind(LOCK, stale).run();
  const out = await env.DB.prepare('INSERT INTO stm_state (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING').bind(LOCK, '', actor, nowIso()).run();
  return (out.meta?.changes ?? 0) > 0;
}

export async function dropLock(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM stm_state WHERE key = ?').bind(LOCK).run();
}

/* ------------------------------------------------------------------ writing */

export interface NewBatch {
  kind: 'single' | 'yearend';
  list: string;
  year: number | null;
  from: string;
  to: string;
  includeSoft: boolean;
  count: number;
  gifts: number;
  amountCents: number;
  basisCents: number;
  skipped: number;
  seq: number;
  pdf: Uint8Array;
  partners: PartnerEntry[];
  copy: StatementCopy;
  actor: string;
}

/**
 * Stores the file and the record. A year-end file also writes who it was issued to, in the same batch of statements, so
 * the next run starts after them. A single statement is made, not issued: it can be made again.
 */
export async function saveBatch(env: Env, n: NewBatch): Promise<BatchRow> {
  const id = newId('sb');
  const key = `statements/${n.kind}/${id}.pdf`;
  await env.UPLOADS.put(key, n.pdf, { httpMetadata: { contentType: 'application/pdf' } });
  const at = nowIso();
  const status = n.kind === 'single' ? 'made' : 'printing';
  const stmts = [
    env.DB.prepare(
      `INSERT INTO stm_batches (id, kind, list, year, from_date, to_date, include_soft, count, gifts, amount_cents, basis_cents, skipped, seq, pdf_key, partners, copy, status, created_by, created_at, printed_by, printed_at, downloaded_at, drive_file)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL, NULL, '')`
    ).bind(id, n.kind, n.list, n.year, n.from, n.to, n.includeSoft ? 1 : 0, n.count, n.gifts, n.amountCents, n.basisCents, n.skipped, n.seq, key, JSON.stringify(n.partners), JSON.stringify(n.copy), status, n.actor, at),
  ];
  if (n.kind === 'yearend' && n.year) {
    for (const p of n.partners) {
      stmts.push(env.DB.prepare('INSERT INTO stm_issued (year, cid, list, batch_id, cents, issued_at) VALUES (?, ?, ?, ?, ?, ?)').bind(n.year, p.id, n.list, id, p.cents, at));
    }
  }
  try {
    for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  } catch (err) {
    // A partner issued by another file in the meantime: undo this one so no partner is in two files.
    await env.DB.prepare('DELETE FROM stm_issued WHERE batch_id = ?').bind(id).run().catch(() => {});
    await env.DB.prepare('DELETE FROM stm_batches WHERE id = ?').bind(id).run().catch(() => {});
    await env.UPLOADS.delete(key).catch(() => {});
    console.error('statements: saving a batch failed', err);
    throw new HttpError(409, 'conflict', 'Someone else made a file that includes some of these partners. Reload and make the next file.');
  }
  return getBatch(env, id);
}

export async function markPrinted(env: Env, id: string, actor: string): Promise<BatchRow> {
  const b = await getBatch(env, id);
  if (b.kind !== 'yearend') throw new HttpError(400, 'not_yearend', 'Only a year-end file is marked printed.');
  if (b.status === 'printed') return b;
  if (b.status !== 'printing') throw new HttpError(409, 'closed', 'That print file is closed.');
  await env.DB.prepare("UPDATE stm_batches SET status = 'printed', printed_by = ?, printed_at = ? WHERE id = ? AND status = 'printing'").bind(actor, nowIso(), id).run();
  await logEvent(env, actor, 'printed', id, `${b.count} statements`);
  return getBatch(env, id);
}

/** Throw a print file away before it is printed. Its partners go back to the waiting list. */
export async function discard(env: Env, id: string, actor: string): Promise<BatchRow> {
  const b = await getBatch(env, id);
  if (b.status !== 'printing') throw new HttpError(409, 'closed', 'Only a print file that is not marked printed can be thrown away.');
  await env.DB.batch([
    env.DB.prepare("UPDATE stm_batches SET status = 'discarded' WHERE id = ? AND status = 'printing'").bind(id),
    env.DB.prepare('DELETE FROM stm_issued WHERE batch_id = ?').bind(id),
  ]);
  await logEvent(env, actor, 'discarded', id, `${b.count} statements back on the list`);
  return getBatch(env, id);
}

export async function markDownloaded(env: Env, id: string): Promise<void> {
  await env.DB.prepare('UPDATE stm_batches SET downloaded_at = ? WHERE id = ? AND downloaded_at IS NULL').bind(nowIso(), id).run().catch(() => {});
}
