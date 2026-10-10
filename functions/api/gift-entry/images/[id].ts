import { gift, pid } from '../../../_lib/gifts/route';
import { HttpError } from '../../../_lib/http';
import { logEvent, type ImageRow } from '../../../_lib/gifts/store';

// A photo is never public. It streams only to a signed-in admin, never cached, and each look is logged.
export const onRequestGet = gift(async ({ env, params, actor }) => {
  const img = await env.DB.prepare('SELECT * FROM ge_image WHERE id = ?').bind(pid(params)).first<ImageRow>();
  if (!img) throw new HttpError(404, 'not_found', 'That photo is not here.');
  const obj = await env.GIFT_CAPTURES.get(img.r2_key);
  if (!obj) throw new HttpError(404, 'not_found', 'That photo is not in storage.');
  await logEvent(env, { deposit_id: img.deposit_id, gift_id: img.gift_id, kind: 'photo_viewed', actor });
  return new Response(obj.body, { headers: { 'Content-Type': img.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' } });
});
