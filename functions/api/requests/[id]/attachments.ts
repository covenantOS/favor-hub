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
      if (bytes.byteLength > MAX_FILE_BYTES) throw new HttpError(400, 'file_too_large', 'Each file must be under 4 MB.');
      const name = blob.name || 'upload.bin';
      const type =
        blob.type && ALLOWED_TYPES.includes(blob.type)
          ? blob.type
          : /\.pdf$/i.test(name)
            ? 'application/pdf'
            : /\.docx$/i.test(name)
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : /\.doc$/i.test(name)
                ? 'application/msword'
                : /\.txt$/i.test(name)
                  ? 'text/plain'
                  : blob.type && blob.type.startsWith('image/')
                    ? blob.type
                    : 'application/octet-stream';
      if (!ALLOWED_TYPES.includes(type) && type !== 'application/octet-stream') {
        throw new HttpError(400, 'bad_file', 'Pictures, PDF, Word, or text only.');
      }
      if (type === 'application/octet-stream' && !/\.(jpe?g|png|webp|gif|pdf|docx?|txt)$/i.test(name)) {
        throw new HttpError(400, 'bad_file', 'Pictures, PDF, Word, or text only.');
      }
      saved.push(await saveAttachment(env, id, { bytes, filename: name, contentType: type === 'application/octet-stream' ? 'application/pdf' : type }));
    }
    const [atts, events] = await Promise.all([attachmentsFor(env, [id]), eventsFor(env, id)]);
    return json({ ok: true, added: saved.length, request: publicShape(row, atts.get(id) || [], events, true) });
  } catch (err) {
    return handleError(err);
  }
};
