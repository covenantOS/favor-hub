import { work, body } from '../../../_lib/work/route';
import { requireFgl } from '../../../_lib/fgl/gate';
import { getWording, sampleFgl, saveWording } from '../../../_lib/fgl/store';
import { cleanWording, DEFAULT_WORDING, SIGNER_CHOICES, docFor, type Wording } from '../../../_lib/fgl/wording';
import { letterFor } from '../../../_lib/receipts/rules';
import { HttpError } from '../../../_lib/http';
import { todayEt } from '../../../_lib/work/service';

function preview(w: Wording) {
  const g = sampleFgl().gifts[0];
  return docFor(letterFor(g), w, todayEt(), w.signer);
}

// The letter wording and the signer a new print file starts with.
export const onRequestGet = work(async ({ ctx }) => {
  requireFgl(ctx);
  const { wording, saved } = await getWording(ctx.env);
  return { wording, defaults: DEFAULT_WORDING, saved, signers: SIGNER_CHOICES, preview: preview(wording) };
});

// { wording } saves, { reset: true } goes back to the default, { preview: wording } shows the merged letter for a made-up partner without saving.
export const onRequestPost = work(async ({ ctx, request }) => {
  requireFgl(ctx);
  const b = await body(request);
  if (b.preview && typeof b.preview === 'object') return { preview: preview(cleanWording(b.preview)) };
  const next = b.reset === true ? DEFAULT_WORDING : cleanWording(b.wording);
  if (next.text.length < 20) throw new HttpError(400, 'too_short', 'The letter needs at least a sentence.');
  const wording = await saveWording(ctx.env, next, ctx.actor);
  return { wording, preview: preview(wording) };
});
