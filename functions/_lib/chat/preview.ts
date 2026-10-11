// Previews of Google Drive files shared in Chat. The hub reads the file as the Favor service account (GOOGLE_SA_JSON, read-only Drive
// scope) and only for a Drive card that sits in a message this person can read, so a preview shows nobody a file that was not
// shared in their conversation. Google's own embed needs a Google sign-in inside the frame, which Safari blocks, so the hub
// sends the picture and the pages itself:
//   thumb    the file's thumbnail picture (Drive draws it), ?s= its size; at 1600 it is a readable first page
//   content  the pages: Google Docs, Sheets and Slides as a PDF, a PDF as is, a Word or Excel file as is (the page draws them)
import { HttpError, type Env } from '../http';
import { saToken } from '../work/sheetsa';
import * as store from './db';

const DRIVE = 'https://www.googleapis.com/drive/v3/files/';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const MAX_BYTES = 20 * 1024 * 1024;
const PRIVATE = { 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' };

const GOOGLE_PDF = new Set(['application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet', 'application/vnd.google-apps.presentation', 'application/vnd.google-apps.drawing']);
const AS_IS = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);

/** The Drive file id in a Docs, Sheets, Slides or Drive address, or null. */
export function driveIdOf(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/^(docs|drive)\.google\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/\/d\/([A-Za-z0-9_-]{10,})/) || (u.searchParams.get('id') || '').match(/^([A-Za-z0-9_-]{10,})$/);
  return m ? m[1] : null;
}

/** What a pasted Google address points at, read from the address alone. */
export function driveKindOfUrl(raw: string): 'doc' | 'sheet' | 'slides' | 'file' {
  if (/\/document\//.test(raw)) return 'doc';
  if (/\/spreadsheets\//.test(raw)) return 'sheet';
  if (/\/presentation\//.test(raw)) return 'slides';
  return 'file';
}

type PreviewEnv = Env & { GOOGLE_SA_JSON?: string };

/** The Drive card at position `index` in message `mid`, when this person can read that message. */
export async function sharedDriveFile(env: PreviewEnv, me: string, mid: number, index: number): Promise<{ id: string; url: string }> {
  const row = await store.getMessage(env as never, mid);
  if (!row || row.deleted_at || !store.canSee(row, me)) throw new HttpError(404, 'not_found', 'That file is gone.');
  await store.readableChannel(env as never, row.channel_id, me);
  let list: Array<Record<string, unknown>> = [];
  try {
    list = JSON.parse(row.attachments || '[]');
  } catch {
    list = [];
  }
  const a = list[index];
  const id = a && a.type === 'drive' ? driveIdOf(String(a.url || '')) : null;
  if (!id) throw new HttpError(404, 'not_found', 'That file is gone.');
  return { id, url: String(a.url) };
}

async function token(env: PreviewEnv, fetchFn: typeof fetch): Promise<string> {
  if (!env.GOOGLE_SA_JSON) throw new HttpError(503, 'no_preview', 'Previews of Drive files are not set up.');
  return saToken(env, fetchFn, SCOPE).catch(() => {
    throw new HttpError(503, 'no_preview', 'Google did not answer. Open the file in Drive.');
  });
}

async function meta(env: PreviewEnv, id: string, fetchFn: typeof fetch): Promise<{ name: string; mimeType: string; thumbnailLink?: string; size?: string }> {
  const t = await token(env, fetchFn);
  const res = await fetchFn(`${DRIVE}${id}?fields=name,mimeType,thumbnailLink,size&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new HttpError(res.status === 404 || res.status === 403 ? 404 : 502, 'no_preview', 'The hub cannot open this file. Open it in Drive.');
  return (await res.json()) as { name: string; mimeType: string; thumbnailLink?: string; size?: string };
}

/** The name and kind of a Drive file, for a pasted address. Null when the hub cannot read it. */
export async function driveCardFor(env: PreviewEnv, raw: string, fetchFn: typeof fetch = fetch): Promise<Record<string, unknown> | null> {
  const id = driveIdOf(raw);
  if (!id || !env.GOOGLE_SA_JSON) return null;
  try {
    const m = await meta(env, id, fetchFn);
    const t = m.mimeType;
    const kind = /spreadsheet|excel|csv/.test(t) ? 'sheet' : /presentation|powerpoint/.test(t) ? 'slides' : /pdf/.test(t) ? 'pdf' : /^image\//.test(t) ? 'photo' : /document|word/.test(t) ? 'doc' : 'file';
    return { type: 'drive', name: String(m.name || 'Drive file').slice(0, 200), kind, path: '', indexed: '', url: raw };
  } catch {
    return null;
  }
}

export async function driveThumb(env: PreviewEnv, id: string, size = 800, fetchFn: typeof fetch = fetch): Promise<Response> {
  const m = await meta(env, id, fetchFn);
  if (!m.thumbnailLink) return new Response('No picture', { status: 404, headers: PRIVATE });
  const t = await token(env, fetchFn);
  const res = await fetchFn(m.thumbnailLink.replace(/=s\d+$/, `=s${Math.max(200, Math.min(2000, Math.round(size) || 800))}`), { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) return new Response('No picture', { status: 404, headers: PRIVATE });
  return new Response(res.body, { headers: { ...PRIVATE, 'Content-Type': res.headers.get('Content-Type') || 'image/png' } });
}

export async function driveContent(env: PreviewEnv, id: string, fetchFn: typeof fetch = fetch): Promise<Response> {
  const m = await meta(env, id, fetchFn);
  const t = await token(env, fetchFn);
  let res: Response;
  let type = m.mimeType;
  if (GOOGLE_PDF.has(m.mimeType)) {
    res = await fetchFn(`${DRIVE}${id}/export?mimeType=application/pdf`, { headers: { Authorization: `Bearer ${t}` } });
    type = 'application/pdf';
  } else if (AS_IS.has(m.mimeType)) {
    if (Number(m.size || 0) > MAX_BYTES) throw new HttpError(413, 'too_big', 'This file is too big to preview. Open it in Drive.');
    res = await fetchFn(`${DRIVE}${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${t}` } });
  } else {
    throw new HttpError(415, 'no_preview', 'This kind of file opens in Drive.');
  }
  if (!res.ok) throw new HttpError(502, 'no_preview', 'Google did not send the file. Open it in Drive.');
  return new Response(res.body, { headers: { ...PRIVATE, 'Content-Type': type, 'Content-Disposition': 'inline', 'X-File-Kind': type } });
}
