import { work, param } from '../../../../_lib/work/route';
import { createBatch } from '../../../../_lib/work/service';
import { addMeter } from '../../../../_lib/work/db';
import { HttpError } from '../../../../_lib/http';

const MAX = 10 * 1024 * 1024;

// A file attached to an action. Blackbaud gives an upload address (1 call), the file goes straight there, and the attachment itself
// is saved and sent like any other change (so Undo removes it). The page then runs the batch.
export const onRequestPost = work(async ({ ctx, params, request }) => {
  const id = param(params, 'id');
  if (!/^\d{1,12}$/.test(id)) throw new HttpError(400, 'bad_id', 'That is not an action.');
  const form = await request.formData().catch(() => null);
  const file = form ? (form.get('file') as unknown as File | null) : null;
  if (!file || typeof (file as any).arrayBuffer !== 'function') throw new HttpError(400, 'no_file', 'Pick a file first.');
  if (file.size > MAX) throw new HttpError(400, 'too_big', 'Files up to 10 MB can be attached here.');
  const fileName = String(file.name || 'file').replace(/[^\w .()-]+/g, '_').slice(0, 120) || 'file';
  const name = String((form && form.get('name')) || fileName).replace(/\s+/g, ' ').trim().slice(0, 150);
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
  const put = await fetch(String(up.url), { method: String(up.method || 'PUT'), headers, body: await file.arrayBuffer() });
  if (!put.ok) throw new HttpError(502, 'upload_failed', 'The file did not reach Blackbaud. Try again, or attach a link instead.');
  const out = await createBatch(ctx, { op: 'attach', ids: [id], attach: { name, file_id: String(doc.body.file_id), file_name: fileName }, req: String((form && form.get('req')) || '') || undefined } as any);
  return out as any;
});
