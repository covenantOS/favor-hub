import { work } from '../../_lib/work/route';
import { oppLinked, oppNames, oppsFor } from '../../_lib/work/edit';

// Opportunities (moves management): every one, or one partner's, or one fundraiser's, newest change first, with partner names.
// ?linked=<opportunity id> answers the actions linked to that opportunity instead.
export const onRequestGet = work(async ({ ctx, url }) => {
  const linked = (url.searchParams.get('linked') || '').replace(/\D/g, '').slice(0, 12);
  if (linked) return { actions: await oppLinked(ctx, linked) };
  const cid = (url.searchParams.get('cid') || '').replace(/\D/g, '').slice(0, 12);
  const fr = (url.searchParams.get('fr') || '').replace(/\D/g, '').slice(0, 12);
  let rows = await oppsFor(ctx, cid ? [cid] : null, { fr: fr || undefined, limit: 1500 });
  const sc = ctx.scope;
  if (sc && !sc.all && !cid) rows = rows.filter((o) => o.fundraisers.some((f) => sc.fids.has(f)));
  return { rows, names: await oppNames(ctx, rows.map((r) => r.cid)) };
});
