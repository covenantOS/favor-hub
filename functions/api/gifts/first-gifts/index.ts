import { work } from '../../../_lib/work/route';
import { requireFgl, sampleFor } from '../../../_lib/fgl/gate';
import { fglView, FGL_DAYS } from '../../../_lib/fgl/store';
import { receiptsDays } from '../../../_lib/admin/settings';

// Acquisition first gifts Blackbaud has not acknowledged yet, sorted into letters and the ones held back. The FavorOS test user gets a made-up list.
export const onRequestGet = work(async ({ ctx, url, waitUntil }) => {
  requireFgl(ctx);
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || (await receiptsDays(ctx.env).catch(() => FGL_DAYS)), 7), 365);
  return (await fglView(ctx.env, { days, fresh: url.searchParams.get('fresh') === '1', defer: waitUntil, sample: sampleFor(ctx) })) as any;
});
