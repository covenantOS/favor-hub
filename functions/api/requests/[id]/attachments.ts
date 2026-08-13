import { requireAdmin } from '../../../_lib/auth';
import { ALLOWED_TYPES, MAX_FILE_BYTES, attachmentsFor, eventsFor, getRequest, publicShape, saveAttachment } from '../../../_lib/db';
import { HttpError, handleError, json, type Env } from '../../../_lib/http';

export const onRequestPost: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    await requireAdmin(env, request);
    const id = String(params.id || '');
    const row = await getRequest(env, id);
    if (!row) throw new HttpError(404, 'not_found', 'Request not found');
    const form = await request.formData();
    const saved = [];
    for (const [key, value] of form.entries()) {
      if (key !== 'files' && key !== 'file') continue;
      if (typeof value === 'string') continue;
      const blob = value as File;
      const bytes = await blob.arrayBuffer();
      if (bytes.byteLength > MAX_FILE_BYTES) throw new HttpError(400, 'file_too_large', 'Each picture must be under 4 MB.');
      const type = blob.type && ALLOWED_TYPES.includes(blob.type) ? blob.type : 'image/jpeg';
      saved.push(await saveAttachment(env, id, { bytes, filename: blob.name || 'upload.jpg', contentType: type }));
    }
    const [atts, events] = await Promise.all([attachmentsFor(env, [id]), eventsFor(env, id)]);
    return json({ ok: true, added: saved.length, request: publicShape(row, atts.get(id) || [], events, true) });
  } catch (err) {
    return handleError(err);
  }
};
