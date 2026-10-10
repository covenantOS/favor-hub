// One check or reply-slip photo from the phone, stored in gift entry's private bucket (favor-gift-captures, binding GIFT_CAPTURES) under
// the prefix mobile/. Nothing serves these objects: there is no public route to the bucket and no /api/uploads/ key, so a photo is
// readable only by code that reads the bucket directly. The metadata sits in mobile_captures.
//
// A phone photo is not attached to a deposit here. Gift entry's own phone flow (a deposit, its rows, the tape) is its own set of routes,
// and the app adopts them when that contract lands. Until then a mobile/ photo waits for gift entry to claim it by client_id.
import { HttpError, nowIso } from '../http';
import type { MobileEnv } from './auth';
import { clientIdOf } from './route';

export const MAX_BYTES = 12 * 1024 * 1024;
export const CAPTURE_KINDS = ['check', 'reply_slip'] as const;

async function digestHex(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function imageKind(bytes: Uint8Array): 'jpg' | 'png' | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  return null;
}

export async function storeCapture(env: MobileEnv, email: string, request: Request) {
  if (!env.GIFT_CAPTURES) throw new HttpError(503, 'no_bucket', 'Photo upload is not switched on yet.');
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BYTES + 64 * 1024) throw new HttpError(413, 'too_big', 'That photo is over 12 MB. The app shrinks it before sending.');
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, 'bad_form', 'Send the photo as a form upload.');
  }
  const clientId = clientIdOf(form.get('client_id'));
  const kind = String(form.get('kind') || '');
  if (!(CAPTURE_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'bad_kind', 'kind must be check or reply_slip.');
  const rawAt = String(form.get('captured_at') || '');
  const capturedAt = rawAt && Number.isFinite(Date.parse(rawAt)) ? new Date(rawAt).toISOString() : null;
  const file = form.get('image');
  if (!file || typeof file === 'string') throw new HttpError(400, 'no_image', 'Attach the photo as "image".');
  const blob = file as unknown as Blob;
  if (blob.size > MAX_BYTES) throw new HttpError(413, 'too_big', 'That photo is over 12 MB. The app shrinks it before sending.');

  const again = await env.DB.prepare('SELECT client_id, r2_key, bytes, kind FROM mobile_captures WHERE email = ? AND client_id = ?').bind(email, clientId).first<{ r2_key: string; bytes: number; kind: string }>();
  if (again) return { stored: true, id: clientId, bytes: again.bytes, kind: again.kind, repeat: true };

  const buf = new Uint8Array(await blob.arrayBuffer());
  const type = imageKind(buf);
  if (!type) throw new HttpError(400, 'bad_image', 'Send a JPEG photo. The app converts HEIC before sending.');
  const key = `mobile/${new Date().toISOString().slice(0, 7)}/${clientId}.${type}`;
  await env.GIFT_CAPTURES.put(key, buf, { httpMetadata: { contentType: type === 'jpg' ? 'image/jpeg' : 'image/png' }, customMetadata: { kind } });
  try {
    await env.DB.prepare('INSERT INTO mobile_captures (email, client_id, kind, r2_key, bytes, sha256, captured_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(email, clientId, kind, key, buf.length, await digestHex(buf), capturedAt, nowIso())
      .run();
  } catch (err) {
    // A second request with the same client_id won the insert; the object it wrote has the same key.
    const raced = await env.DB.prepare('SELECT bytes, kind FROM mobile_captures WHERE email = ? AND client_id = ?').bind(email, clientId).first<{ bytes: number; kind: string }>();
    if (raced) return { stored: true, id: clientId, bytes: raced.bytes, kind: raced.kind, repeat: true };
    throw err;
  }
  return { stored: true, id: clientId, bytes: buf.length, kind, repeat: false };
}
