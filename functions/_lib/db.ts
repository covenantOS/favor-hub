import { HttpError, REPOS, newId, nowIso, type Env, type Status, type Surface } from './http';

export interface RequestRow {
  id: string;
  title: string;
  body: string;
  surface: Surface;
  status: Status;
  submitter_name: string;
  submitter_email: string | null;
  source: string;
  page_url: string | null;
  sort_order: number;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  declined_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttachmentRow {
  id: string;
  request_id: string;
  r2_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export interface EventRow {
  id: string;
  request_id: string;
  kind: string;
  actor: string;
  payload: string | null;
  created_at: string;
}

const COLS = `id, title, body, surface, status, submitter_name, submitter_email, source, page_url, sort_order, approved_at, started_at, completed_at, declined_reason, created_at, updated_at`;

export function publicShape(
  row: RequestRow,
  attachments: AttachmentRow[] = [],
  events: EventRow[] = [],
  admin = false
) {
  const repo = REPOS[row.surface] ?? REPOS.website;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    surface: row.surface,
    status: row.status,
    submitter_name: row.submitter_name,
    page_url: row.page_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
    approved_at: row.approved_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    declined_reason: admin ? row.declined_reason : row.status === 'declined' ? row.declined_reason : null,
    submitter_email: admin ? row.submitter_email : null,
    source: row.source,
    repo: repo.repo,
    branch: repo.branch,
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      content_type: a.content_type,
      size_bytes: a.size_bytes,
      url: `/api/uploads/${a.r2_key}`,
    })),
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      actor: e.actor,
      payload: safeParse(e.payload),
      created_at: e.created_at,
    })),
  };
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function listRequests(env: Env, includeDeclined: boolean): Promise<RequestRow[]> {
  const sql = includeDeclined
    ? `SELECT ${COLS} FROM requests ORDER BY created_at DESC`
    : `SELECT ${COLS} FROM requests WHERE status != 'declined' ORDER BY created_at DESC`;
  const { results } = await env.DB.prepare(sql).all<RequestRow>();
  return results;
}

export async function getRequest(env: Env, id: string): Promise<RequestRow | null> {
  return env.DB.prepare(`SELECT ${COLS} FROM requests WHERE id = ?`).bind(id).first<RequestRow>();
}

export async function attachmentsFor(env: Env, ids: string[]): Promise<Map<string, AttachmentRow[]>> {
  const map = new Map<string, AttachmentRow[]>();
  if (!ids.length) return map;
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, request_id, r2_key, filename, content_type, size_bytes, created_at FROM attachments WHERE request_id IN (${placeholders}) ORDER BY created_at ASC`
  )
    .bind(...ids)
    .all<AttachmentRow>();
  for (const row of results) {
    const list = map.get(row.request_id) || [];
    list.push(row);
    map.set(row.request_id, list);
  }
  return map;
}

export async function eventsFor(env: Env, id: string): Promise<EventRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, request_id, kind, actor, payload, created_at FROM events WHERE request_id = ? ORDER BY created_at ASC`
  )
    .bind(id)
    .all<EventRow>();
  return results;
}

export async function addEvent(env: Env, requestId: string, kind: string, actor: string, payload?: unknown): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO events (id, request_id, kind, actor, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(newId('evt'), requestId, kind, actor, payload ? JSON.stringify(payload) : null, nowIso())
    .run();
}

export async function insertRequest(
  env: Env,
  input: {
    title: string;
    body: string;
    surface: Surface;
    submitter_name: string;
    submitter_email?: string;
    page_url?: string;
    source?: string;
    status?: Status;
  }
): Promise<RequestRow> {
  const id = newId('req');
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO requests (id, title, body, surface, status, submitter_name, submitter_email, source, page_url, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(
      id,
      input.title,
      input.body,
      input.surface,
      input.status || 'inbox',
      input.submitter_name,
      input.submitter_email || null,
      input.source || 'form',
      input.page_url || null,
      ts,
      ts
    )
    .run();
  await addEvent(env, id, 'created', input.submitter_name, { surface: input.surface });
  const row = await getRequest(env, id);
  if (!row) throw new HttpError(500, 'insert_failed', 'Could not save the request');
  return row;
}

export async function setStatus(
  env: Env,
  id: string,
  status: Status,
  actor: string,
  extra: { declined_reason?: string } = {}
): Promise<RequestRow> {
  const row = await getRequest(env, id);
  if (!row) throw new HttpError(404, 'not_found', 'Request not found');
  const ts = nowIso();
  const approved_at = status === 'approved' && !row.approved_at ? ts : row.approved_at;
  const started_at = status === 'in_progress' && !row.started_at ? ts : row.started_at;
  const completed_at = status === 'done' ? ts : status === 'inbox' ? null : row.completed_at;
  const declined_reason = status === 'declined' ? extra.declined_reason || row.declined_reason : null;
  await env.DB.prepare(
    `UPDATE requests SET status = ?, approved_at = ?, started_at = ?, completed_at = ?, declined_reason = ?, updated_at = ? WHERE id = ?`
  )
    .bind(status, approved_at, started_at, completed_at, declined_reason, ts, id)
    .run();
  await addEvent(env, id, 'status', actor, { from: row.status, to: status, declined_reason });
  const next = await getRequest(env, id);
  if (!next) throw new HttpError(500, 'update_failed', 'Could not update the request');
  return next;
}

export async function setPageUrl(env: Env, id: string, pageUrl: string): Promise<void> {
  await env.DB.prepare('UPDATE requests SET page_url = ?, updated_at = ? WHERE id = ?')
    .bind(pageUrl, nowIso(), id)
    .run();
}

export async function saveAttachment(
  env: Env,
  requestId: string,
  file: { bytes: ArrayBuffer; filename: string; contentType: string }
): Promise<AttachmentRow> {
  const id = newId('att');
  const ext = extFrom(file.filename, file.contentType);
  const key = `${requestId}/${id}${ext}`;
  await env.UPLOADS.put(key, file.bytes, { httpMetadata: { contentType: file.contentType } });
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO attachments (id, request_id, r2_key, filename, content_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, requestId, key, file.filename.slice(0, 180), file.contentType, file.bytes.byteLength, ts)
    .run();
  return {
    id,
    request_id: requestId,
    r2_key: key,
    filename: file.filename.slice(0, 180),
    content_type: file.contentType,
    size_bytes: file.bytes.byteLength,
    created_at: ts,
  };
}

function extFrom(filename: string, contentType: string): string {
  const fromName = filename.match(/\.(jpe?g|png|webp|gif|pdf|docx?|txt)$/i);
  if (fromName) {
    const ext = fromName[0].toLowerCase();
    return ext === '.jpeg' ? '.jpg' : ext;
  }
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';
  if (contentType.includes('pdf')) return '.pdf';
  if (contentType.includes('wordprocessingml')) return '.docx';
  if (contentType.includes('msword')) return '.doc';
  if (contentType.includes('text/plain')) return '.txt';
  return '.bin';
}

export const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_FILES = 6;
