// Documents on a partner record: letters of inquiry, DAF letters, award letters, W-9s. The file lives in FavorOS's private bucket (the
// master copy) and is copied to the partner record in Blackbaud as an attachment, so the record there carries it too. The list reads
// both: what FavorOS holds and what Blackbaud holds (read live, kept ten minutes), matched by the attachment id the copy returned.
// Nothing here changes a gift, an amount or any other field of the record.
import { HttpError, newId, nowIso, type Env } from '../http';
import { addMeter } from './db';
import { cleanName, FILE_TYPES, MAX_FILE } from './upload';
import type { Ctx } from './service';

export const DOC_KINDS = ['Letter of inquiry', 'DAF letter', 'Award letter', 'W-9', 'Report', 'Agreement', 'Other'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const DOCS_SQL = `CREATE TABLE IF NOT EXISTS partner_docs (
  id TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  bb_state TEXT NOT NULL,
  bb_attachment_id TEXT,
  bb_error TEXT,
  doc_date TEXT,
  uploaded_by TEXT NOT NULL,
  uploaded_email TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  removed_at TEXT
)`;
const INDEX_SQL = 'CREATE INDEX IF NOT EXISTS partner_docs_cid ON partner_docs (cid, removed_at)';
const ready = new WeakSet<object>();
export async function ensureDocs(env: Env): Promise<void> {
  const db = env.DB as unknown as object;
  if (ready.has(db)) return;
  await env.DB.prepare(DOCS_SQL).run();
  await env.DB.prepare(INDEX_SQL).run();
  ready.add(db);
}

const ID = /^\d{1,12}$/;
const bucketOf = (env: Env): R2Bucket => {
  const b = (env as unknown as { UPLOADS?: R2Bucket }).UPLOADS;
  if (!b) throw new HttpError(503, 'no_storage', 'File storage is not connected to FavorOS.');
  return b;
};

export interface DocRow {
  id: string;
  kind: string;
  name: string;
  fileName: string;
  mime: string;
  size: number;
  /** FavorOS holds the file. */
  inFavorOS: boolean;
  /** Blackbaud: done (attached there), pending, failed, standin (a test, never sent) or only (Blackbaud holds it, FavorOS does not). */
  blackbaud: 'done' | 'pending' | 'failed' | 'standin' | 'only';
  blackbaudError: string;
  date: string;
  by: string;
  at: string;
  /** The Blackbaud attachment id. */
  bbId: string;
  /** Opens in FavorOS. Empty for a Blackbaud-only row, which opens in Blackbaud. */
  url: string;
  mine: boolean;
}

/** Who may add or remove documents: admins, the Support Team, grants writers, directors and Partner Care. */
export function mayDocs(s: Ctx['scope']): boolean {
  return !s || s.all || s.role === 'support' || s.role === 'grants' || s.role === 'director' || s.role === 'partner_care';
}

const KIND_SET = new Set<string>(DOC_KINDS);

export async function listDocs(ctx: Ctx, cid: string, opts: { fresh?: boolean; readBb?: boolean } = {}): Promise<{ rows: DocRow[]; bbRead: boolean; kinds: readonly string[]; can: boolean }> {
  if (!ID.test(cid)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  await ensureDocs(ctx.env);
  const own = (await ctx.env.DB.prepare('SELECT * FROM partner_docs WHERE cid = ? AND removed_at IS NULL ORDER BY uploaded_at DESC').bind(cid).all<any>()).results;
  const rows: DocRow[] = own.map((r) => ({
    id: String(r.id),
    kind: r.kind,
    name: r.name,
    fileName: r.file_name,
    mime: r.mime,
    size: Number(r.size) || 0,
    inFavorOS: true,
    blackbaud: (r.bb_state as DocRow['blackbaud']) || 'pending',
    blackbaudError: r.bb_error || '',
    date: r.doc_date || String(r.uploaded_at).slice(0, 10),
    by: r.uploaded_by,
    at: r.uploaded_at,
    bbId: r.bb_attachment_id || '',
    url: `/api/work/partners/${cid}/documents/${r.id}`,
    mine: !!ctx.email && r.uploaded_email === ctx.email,
  }));
  let bbRead = false;
  if (opts.readBb !== false) {
    const live = await readBb(ctx, cid, !!opts.fresh).catch(() => null);
    if (live) {
      bbRead = true;
      const known = new Set(own.map((r) => String(r.bb_attachment_id || '')).filter(Boolean));
      for (const a of live) {
        if (known.has(String(a.id))) continue;
        rows.push({
          id: 'bb:' + a.id,
          kind: 'Blackbaud',
          name: String(a.name || a.file_name || 'Attachment'),
          fileName: String(a.file_name || ''),
          mime: String(a.content_type || ''),
          size: Number(a.file_size) || 0,
          inFavorOS: false,
          blackbaud: 'only',
          blackbaudError: '',
          date: String(a.date || '').slice(0, 10),
          by: '',
          at: String(a.date || ''),
          bbId: String(a.id),
          url: '',
          mine: false,
        });
      }
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { rows, bbRead, kinds: DOC_KINDS, can: mayDocs(ctx.scope) };
}

/** The partner's attachments in Blackbaud, kept ten minutes (act_cache). One call. */
async function readBb(ctx: Ctx, cid: string, fresh: boolean): Promise<any[] | null> {
  const key = `pdocs:${cid}`;
  if (!fresh) {
    const hit = await ctx.env.DB.prepare('SELECT value, at FROM act_cache WHERE key = ?').bind(key).first<{ value: string; at: string }>().catch(() => null);
    if (hit && Date.now() - Date.parse(hit.at) < 10 * 60_000) return JSON.parse(hit.value);
  }
  const r = await ctx.repo.send([{ method: 'GET', path: `/constituent/v1/constituents/${cid}/attachments` }]);
  await addMeter(ctx.env, r.results.length, r.callsToday);
  const res = r.results[0];
  if (!res || !res.ok) return null;
  const list: any[] = Array.isArray(res.body) ? res.body : (res.body && (res.body.value || res.body.attachments)) || [];
  await ctx.env.DB.prepare('INSERT INTO act_cache (key, value, at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at')
    .bind(key, JSON.stringify(list), nowIso())
    .run()
    .catch(() => undefined);
  return list;
}

export interface AddDeps {
  /** Tests and stand-in runs set this: the file is kept in FavorOS and nothing is sent to Blackbaud. */
  standin?: boolean;
  put?: typeof fetch;
}

export async function addDoc(ctx: Ctx, cid: string, file: File, o: { kind: string; name?: string; date?: string }, deps: AddDeps = {}): Promise<DocRow> {
  if (!ID.test(cid)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  if (!mayDocs(ctx.scope)) throw new HttpError(403, 'not_yours', 'Your role does not add documents.');
  if (!file || typeof (file as any).arrayBuffer !== 'function') throw new HttpError(400, 'no_file', 'Pick a file first.');
  if (file.size > MAX_FILE) throw new HttpError(400, 'too_big', 'Files up to 10 MB can be attached here.');
  const fileName = cleanName(file.name);
  if (!FILE_TYPES.test(fileName)) throw new HttpError(400, 'bad_type', 'Attach a PDF, Word, Excel or image file.');
  const kind = KIND_SET.has(o.kind) ? o.kind : 'Other';
  const name = String(o.name || '').replace(/\s+/g, ' ').trim().slice(0, 150) || `${kind}: ${fileName}`.slice(0, 150);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(o.date || '')) ? String(o.date) : nowIso().slice(0, 10);
  await ensureDocs(ctx.env);
  const id = newId('pd');
  const bytes = await file.arrayBuffer();
  const mime = file.type || 'application/octet-stream';
  const r2 = `pdoc_${cid}/${id}-${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}`;
  await bucketOf(ctx.env).put(r2, bytes, { httpMetadata: { contentType: mime } });
  await ctx.env.DB.prepare(
    'INSERT INTO partner_docs (id, cid, kind, name, file_name, mime, size, r2_key, bb_state, doc_date, uploaded_by, uploaded_email, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
  )
    .bind(id, cid, kind, name, fileName, mime, bytes.byteLength, r2, deps.standin ? 'standin' : 'pending', date, ctx.actor, ctx.email, nowIso())
    .run();
  if (!deps.standin) await copyToBlackbaud(ctx, id, deps.put).catch(() => undefined);
  await ctx.env.DB.prepare('DELETE FROM act_cache WHERE key = ?').bind(`pdocs:${cid}`).run().catch(() => undefined);
  const out = (await listDocs(ctx, cid, { readBb: false })).rows.find((x) => x.id === id);
  return out!;
}

/** Put the stored file at Blackbaud's upload address and attach it to the partner. Safe to run again after a failure. */
export async function copyToBlackbaud(ctx: Ctx, id: string, put: typeof fetch = fetch, cid?: string): Promise<'done' | 'failed'> {
  const row = await ctx.env.DB.prepare('SELECT * FROM partner_docs WHERE id = ? AND removed_at IS NULL').bind(id).first<any>();
  if (!row || (cid && row.cid !== cid)) throw new HttpError(404, 'no_doc', 'That document is gone.');
  if (row.bb_state === 'done') return 'done';
  if (row.bb_state === 'standin') return 'done';
  const fail = async (msg: string): Promise<'failed'> => {
    await ctx.env.DB.prepare("UPDATE partner_docs SET bb_state = 'failed', bb_error = ? WHERE id = ?").bind(msg.slice(0, 300), id).run();
    return 'failed';
  };
  const obj = await bucketOf(ctx.env).get(row.r2_key);
  if (!obj) return fail('The stored file is missing.');
  const bytes = await obj.arrayBuffer();
  const d = await ctx.repo.send([{ method: 'POST', path: '/constituent/v1/documents', body: { file_name: row.file_name, upload_thumbnail: false } }]);
  await addMeter(ctx.env, d.results.length, d.callsToday);
  const doc = d.results[0];
  if (!doc || !doc.ok || !doc.body || !doc.body.file_id || !doc.body.file_upload_request) return fail(doc && doc.refused ? 'The Blackbaud connection does not allow file uploads yet.' : 'Blackbaud gave no upload address.');
  const up = doc.body.file_upload_request;
  const headers: Record<string, string> = {};
  for (const h of Array.isArray(up.headers) ? up.headers : []) if (h && h.name) headers[String(h.name)] = String(h.value ?? '');
  if (!headers['Content-Type']) headers['Content-Type'] = row.mime;
  const res = await put(String(up.url), { method: String(up.method || 'PUT'), headers, body: bytes });
  if (!res.ok) return fail(`The file did not reach Blackbaud (${res.status}).`);
  const a = await ctx.repo.send([
    { method: 'POST', path: '/constituent/v1/constituents/attachments', body: { parent_id: row.cid, type: 'Physical', file_id: String(doc.body.file_id), file_name: row.file_name, name: row.name, date: `${row.doc_date}T00:00:00` } },
  ]);
  await addMeter(ctx.env, a.results.length, a.callsToday);
  const ar = a.results[0];
  if (!ar || !ar.ok || !ar.body || !ar.body.id) return fail(ar && ar.refused ? 'The Blackbaud connection does not allow this attachment yet.' : 'Blackbaud did not save the attachment.');
  await ctx.env.DB.prepare("UPDATE partner_docs SET bb_state = 'done', bb_attachment_id = ?, bb_error = NULL WHERE id = ?").bind(String(ar.body.id), id).run();
  return 'done';
}

export async function removeDoc(ctx: Ctx, cid: string, id: string): Promise<void> {
  await ensureDocs(ctx.env);
  const row = await ctx.env.DB.prepare('SELECT * FROM partner_docs WHERE id = ? AND cid = ? AND removed_at IS NULL').bind(id, cid).first<any>();
  if (!row) throw new HttpError(404, 'no_doc', 'That document is gone.');
  const s = ctx.scope;
  if (s && !s.all && s.role !== 'support' && row.uploaded_email !== ctx.email) throw new HttpError(403, 'not_yours', 'Only the person who added a document, the Support Team or an admin removes it.');
  if (row.bb_state === 'done' && row.bb_attachment_id) {
    const r = await ctx.repo.send([{ method: 'DELETE', path: `/constituent/v1/constituents/attachments/${row.bb_attachment_id}` }]);
    await addMeter(ctx.env, r.results.length, r.callsToday);
    const x = r.results[0];
    if (!x || (!x.ok && x.status !== 404)) throw new HttpError(502, 'blackbaud_wait', 'Blackbaud did not remove its copy. The document stays; try again in a minute.');
  }
  await ctx.env.DB.prepare('UPDATE partner_docs SET removed_at = ? WHERE id = ?').bind(nowIso(), id).run();
  await bucketOf(ctx.env).delete(row.r2_key).catch(() => undefined);
  await ctx.env.DB.prepare('DELETE FROM act_cache WHERE key = ?').bind(`pdocs:${cid}`).run().catch(() => undefined);
}

export async function openDoc(ctx: Ctx, cid: string, id: string): Promise<Response> {
  await ensureDocs(ctx.env);
  const gone = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  const row = await ctx.env.DB.prepare('SELECT * FROM partner_docs WHERE id = ? AND cid = ? AND removed_at IS NULL').bind(id, cid).first<any>();
  if (!row) return gone();
  const obj = await bucketOf(ctx.env).get(row.r2_key);
  if (!obj) return gone();
  const safe = String(row.file_name).replace(/[^\w.() -]/g, '_');
  return new Response(obj.body, {
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': row.mime, 'Content-Disposition': `inline; filename="${safe}"` },
  });
}
