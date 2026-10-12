// A file put at Blackbaud's upload address: one call asks for the address, the bytes go straight there (Blackbaud's file service, so the
// bytes spend no call). The caller then attaches the returned file id to a record in an ordinary batch, so Undo removes the attachment.
// The action upload route (functions/api/work/actions/[id]/upload.ts) does the same steps for one existing action.
import { HttpError } from '../http';
import { addMeter } from './db';
import type { Ctx } from './service';

export const MAX_FILE = 10 * 1024 * 1024;
export const FILE_TYPES = /\.(pdf|docx?|xlsx?|png|jpe?g)$/i;

export interface Uploaded { file_id: string; file_name: string; name: string }

export function cleanName(name: string): string {
  return String(name || 'file').replace(/[^\w .()-]+/g, '_').slice(0, 120) || 'file';
}

/** Check a file from a form, then put it at Blackbaud's upload address. Throws a staff-worded error. */
export async function uploadFile(ctx: Ctx, file: File, label?: string, put: typeof fetch = fetch): Promise<Uploaded> {
  if (!file || typeof (file as any).arrayBuffer !== 'function') throw new HttpError(400, 'no_file', 'Pick a file first.');
  if (file.size > MAX_FILE) throw new HttpError(400, 'too_big', 'Files up to 10 MB can be attached here.');
  const fileName = cleanName(file.name);
  if (!FILE_TYPES.test(fileName)) throw new HttpError(400, 'bad_type', 'Attach a PDF, Word, Excel or image file.');
  const r = await ctx.repo.send([{ method: 'POST', path: '/constituent/v1/documents', body: { file_name: fileName, upload_thumbnail: false } }]);
  await addMeter(ctx.env, r.results.length, r.callsToday);
  const doc = r.results[0];
  if (!doc || !doc.ok || !doc.body || !doc.body.file_id || !doc.body.file_upload_request) {
    throw new HttpError(503, 'blackbaud_wait', doc && doc.refused ? 'The Blackbaud connection does not allow file uploads yet. Attach a link instead.' : 'Blackbaud did not give an upload address. Try again in a minute.');
  }
  const up = doc.body.file_upload_request;
  const headers: Record<string, string> = {};
  for (const h of Array.isArray(up.headers) ? up.headers : []) if (h && h.name) headers[String(h.name)] = String(h.value ?? '');
  if (!headers['Content-Type'] && file.type) headers['Content-Type'] = file.type;
  const res = await put(String(up.url), { method: String(up.method || 'PUT'), headers, body: await file.arrayBuffer() });
  if (!res.ok) throw new HttpError(502, 'upload_failed', 'The file did not reach Blackbaud. Try again, or attach a link instead.');
  return { file_id: String(doc.body.file_id), file_name: fileName, name: String(label || fileName).replace(/\s+/g, ' ').trim().slice(0, 150) };
}
