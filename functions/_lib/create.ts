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
import { isEmail, notifyNewRequest } from './notify';

const TITLE_FROM_BODY = 90;

function titleFrom(title: string, body: string): string {
  if (title) return title;
  const line = body.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || 'Untitled request';
  return line.length > TITLE_FROM_BODY ? `${line.slice(0, TITLE_FROM_BODY - 1)}...` : line;
}

function typeFrom(file: { filename: string; contentType: string }): string {
  if (ALLOWED_TYPES.includes(file.contentType)) return file.contentType;
  const n = file.filename.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (n.endsWith('.doc')) return 'application/msword';
  if (n.endsWith('.txt')) return 'text/plain';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.gif')) return 'image/gif';
  if (/\.jpe?g$/.test(n)) return 'image/jpeg';
  return file.contentType || 'application/octet-stream';
}

type Parsed = {
  name: string;
  email: string;
  surface: ReturnType<typeof asSurface>;
  title: string;
  body: string;
  page_url: string;
  honeypot: string;
  noPhotoReason: string;
  files: Array<{ bytes: ArrayBuffer; filename: string; contentType: string }>;
};

async function parseBody(request: Request): Promise<Parsed> {
  const ctype = request.headers.get('content-type') || '';
  if (ctype.includes('multipart/form-data')) {
    const form = await request.formData();
    const files: Parsed['files'] = [];
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
      email: asTrimmed(form.get('email'), 'email', 120),
      surface: asSurface(form.get('surface')),
      title: asTrimmed(form.get('title'), 'title', 160),
      body: asTrimmed(form.get('body'), 'body', 16000, false),
      page_url: asTrimmed(form.get('page_url'), 'page_url', 400, false),
      honeypot: asTrimmed(form.get('company'), 'company', 80, false),
      noPhotoReason: asTrimmed(form.get('no_photo_reason'), 'no_photo_reason', 400, false),
      files,
    };
  }
  const data = (await request.json()) as Record<string, unknown>;
  return {
    name: asTrimmed(data.name, 'name', 80),
    email: asTrimmed(data.email, 'email', 120),
    surface: asSurface(data.surface),
    title: asTrimmed(data.title, 'title', 160),
    body: asTrimmed(data.body, 'body', 16000, false),
    page_url: asTrimmed(data.page_url, 'page_url', 400, false),
    honeypot: asTrimmed(data.company, 'company', 80, false),
    noPhotoReason: asTrimmed(data.no_photo_reason, 'no_photo_reason', 400, false),
    files: [],
  };
}

export async function checkRateAndCreate({
  request,
  env,
  waitUntil,
}: {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}): Promise<Response> {
  try {
    const ip = clientIp(request);
    if (await hitRateLimit(env, `submit:${ip}`, 12, 3600)) {
      return errorJson('rate_limited', 'Slow down a moment. You can submit again shortly.', 429);
    }
    const parsed = await parseBody(request);
    if (parsed.honeypot) return json({ ok: true, ignored: true });
    if (!isEmail(parsed.email)) throw new HttpError(400, 'bad_email', 'A real email is required.');
    if (!parsed.title) throw new HttpError(400, 'missing_title', 'Give a one-line summary. One word is enough.');
    const body = parsed.body || parsed.title;
    if (parsed.files.length > MAX_FILES) throw new HttpError(400, 'too_many_files', `Up to ${MAX_FILES} files.`);
    for (const file of parsed.files) {
      if (file.bytes.byteLength > MAX_FILE_BYTES) throw new HttpError(400, 'file_too_large', 'Each file must be under 4 MB.');
      if (!ALLOWED_TYPES.includes(file.contentType) && !/\.(jpe?g|png|webp|gif|pdf|docx?|txt)$/i.test(file.filename)) {
        throw new HttpError(400, 'bad_file', 'Pictures, PDF, Word, or text only.');
      }
    }
    const row = await insertRequest(env, {
      title: titleFrom(parsed.title, body),
      body,
      surface: parsed.surface,
      submitter_name: parsed.name,
      submitter_email: parsed.email,
      page_url: parsed.page_url,
      source: 'form',
    });
    const saved = [];
    for (const file of parsed.files) {
      saved.push(await saveAttachment(env, row.id, { ...file, contentType: typeFrom(file) }));
    }
    waitUntil(notifyNewRequest(env, row).catch((err) => console.error('[requests] notify', err)));
    return json({ ok: true, request: publicShape(row, saved, [], false) }, 201);
  } catch (err) {
    return handleError(err);
  }
}
