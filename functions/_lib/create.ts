import { hitRateLimit } from './auth';
import { ALLOWED_TYPES, MAX_FILE_BYTES, MAX_FILES, insertRequest, publicShape, saveAttachment } from './db';
import {
  HttpError,
  asSurface,
  asTrimmed,
  clientIp,
  errorJson,
  handleError,
  json,
  type Env,
} from './http';

const TITLE_FROM_BODY = 90;

function titleFrom(title: string, body: string): string {
  if (title) return title;
  const line = body.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || 'Untitled request';
  return line.length > TITLE_FROM_BODY ? `${line.slice(0, TITLE_FROM_BODY - 1)}...` : line;
}

async function parseBody(request: Request): Promise<{
  name: string;
  email: string;
  surface: ReturnType<typeof asSurface>;
  title: string;
  body: string;
  page_url: string;
  honeypot: string;
  files: Array<{ bytes: ArrayBuffer; filename: string; contentType: string }>;
}> {
  const ctype = request.headers.get('content-type') || '';
  if (ctype.includes('multipart/form-data')) {
    const form = await request.formData();
    const files: Array<{ bytes: ArrayBuffer; filename: string; contentType: string }> = [];
    for (const [key, value] of form.entries()) {
      if (key !== 'files' && key !== 'file') continue;
      if (typeof value === 'string') continue;
      const blob = value as File;
      files.push({
        bytes: await blob.arrayBuffer(),
        filename: blob.name || 'upload.jpg',
        contentType: blob.type || 'application/octet-stream',
      });
    }
    return {
      name: asTrimmed(form.get('name'), 'name', 80),
      email: asTrimmed(form.get('email'), 'email', 120, false),
      surface: asSurface(form.get('surface')),
      title: asTrimmed(form.get('title'), 'title', 160, false),
      body: asTrimmed(form.get('body'), 'body', 8000),
      page_url: asTrimmed(form.get('page_url'), 'page_url', 400, false),
      honeypot: asTrimmed(form.get('company'), 'company', 80, false),
      files,
    };
  }
  const data = (await request.json()) as Record<string, unknown>;
  return {
    name: asTrimmed(data.name, 'name', 80),
    email: asTrimmed(data.email, 'email', 120, false),
    surface: asSurface(data.surface),
    title: asTrimmed(data.title, 'title', 160, false),
    body: asTrimmed(data.body, 'body', 8000),
    page_url: asTrimmed(data.page_url, 'page_url', 400, false),
    honeypot: asTrimmed(data.company, 'company', 80, false),
    files: [],
  };
}

export async function checkRateAndCreate({ request, env }: { request: Request; env: Env }): Promise<Response> {
  try {
    const ip = clientIp(request);
    if (await hitRateLimit(env, `submit:${ip}`, 12, 3600)) {
      return errorJson('rate_limited', 'Slow down a moment. You can submit again shortly.', 429);
    }
    const parsed = await parseBody(request);
    if (parsed.honeypot) return json({ ok: true, ignored: true });
    if (parsed.body.length < 8) throw new HttpError(400, 'too_short', 'Tell us what you want changed, in a sentence or two.');
    if (parsed.files.length > MAX_FILES) throw new HttpError(400, 'too_many_files', `Up to ${MAX_FILES} pictures.`);
    for (const file of parsed.files) {
      if (file.bytes.byteLength > MAX_FILE_BYTES) throw new HttpError(400, 'file_too_large', 'Each picture must be under 4 MB.');
      if (!ALLOWED_TYPES.includes(file.contentType) && !/\.(jpe?g|png|webp|gif)$/i.test(file.filename)) {
        throw new HttpError(400, 'bad_file', 'Pictures only (jpg, png, webp, gif).');
      }
    }
    const row = await insertRequest(env, {
      title: titleFrom(parsed.title, parsed.body),
      body: parsed.body,
      surface: parsed.surface,
      submitter_name: parsed.name,
      submitter_email: parsed.email || undefined,
      page_url: parsed.page_url || undefined,
      source: 'form',
    });
    const saved = [];
    for (const file of parsed.files) {
      const type = ALLOWED_TYPES.includes(file.contentType) ? file.contentType : 'image/jpeg';
      saved.push(await saveAttachment(env, row.id, { ...file, contentType: type }));
    }
    return json({ ok: true, request: publicShape(row, saved, [], false) }, 201);
  } catch (err) {
    return handleError(err);
  }
}
