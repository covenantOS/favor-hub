import { gift, pid, type GiftArgs } from '../../../../_lib/gifts/route';
import { addPhoto, MAX_PHOTO_BYTES } from '../../../../_lib/gifts/capture';
import { HttpError } from '../../../../_lib/http';

// Step 2 and 3: one photo per request, sent as the raw image body (the page shrinks it first). The reply holds the row after both
// readers, the partner match and the duplicate guard have run, so the page shows it at once.
export async function photoHandler({ request, env, params, user, actor, deps, url }: GiftArgs): Promise<Record<string, unknown>> {
  const mime = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (mime !== 'image/jpeg' && mime !== 'image/png') throw new HttpError(415, 'bad_type', 'Send a JPEG or PNG photo.');
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length) throw new HttpError(400, 'empty', 'The photo was empty.');
  if (buf.length > MAX_PHOTO_BYTES) throw new HttpError(413, 'too_big', 'The photo is too large. Take it again.');
  const kind = ['check_front', 'slip', 'letter'].includes(url.searchParams.get('kind') || '') ? (url.searchParams.get('kind') as 'check_front' | 'slip' | 'letter') : 'check_front';
  try {
    const out = await addPhoto(env, deps, pid(params), { name: actor, email: user.email }, { bytes: buf, mime, kind, giftId: url.searchParams.get('gift') || undefined });
    return { giftId: out.gift.id, status: out.gift.status, duplicatePhoto: out.duplicatePhoto };
  } catch (e: any) {
    throw new HttpError(409, 'not_open', String(e && e.message ? e.message : e));
  }
}

export const onRequestPost = gift(photoHandler);
