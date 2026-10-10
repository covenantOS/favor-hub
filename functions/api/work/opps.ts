import { work } from '../../_lib/work/route';
import { oppsFor } from '../../_lib/work/edit';

// Opportunities (moves management): every one, or one partner's, or one fundraiser's, newest change first.
export const onRequestGet = work(async ({ ctx, url }) => {
  const cid = (url.searchParams.get('cid') || '').replace(/\D/g, '').slice(0, 12);
  const fr = (url.searchParams.get('fr') || '').replace(/\D/g, '').slice(0, 12);
  const rows = await oppsFor(ctx, cid ? [cid] : null, { fr: fr || undefined, limit: 1500 });
  return { rows };
});
