import { gift, pid } from '../../../../_lib/gifts/route';
import { readAndMatch } from '../../../../_lib/gifts/capture';
import { getGift, updateGift, type ImageRow } from '../../../../_lib/gifts/store';
import { HttpError } from '../../../../_lib/http';
import { depositView } from '../../../../_lib/gifts/view';

// Read the photo again (a bad first read, or a retaken photo added to the same row). Replaces what the readers proposed, so the row
// goes back to needing a glance.
export const onRequestPost = gift(async ({ env, params, actor, deps }) => {
  const g = await getGift(env, pid(params));
  if (!g || g.status === 'removed') throw new HttpError(404, 'not_found', 'That row is not here.');
  const img = await env.DB.prepare('SELECT * FROM ge_image WHERE gift_id = ? ORDER BY uploaded_at DESC LIMIT 1').bind(g.id).first<ImageRow>();
  if (!img) throw new HttpError(409, 'no_photo', 'This row has no photo to read.');
  const obj = await env.GIFT_CAPTURES.get(img.r2_key);
  if (!obj) throw new HttpError(409, 'no_photo', 'The photo is not in storage.');
  await updateGift(env, g.id, { status: 'reading', confirmed_by: null, confirmed_at: null });
  await readAndMatch(env, deps, g.deposit_id, g.id, img.id, new Uint8Array(await obj.arrayBuffer()), img.mime, img.sha256, actor);
  return { view: await depositView(env, g.deposit_id) };
});
