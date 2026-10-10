import { work } from '../../_lib/work/route';
import { getCodes, meFor, typesByFundraiser } from '../../_lib/work/edit';
import { todayEt } from '../../_lib/work/service';

// The lists every field picks from (types, statuses, locations, note types, tags with their values, opportunity statuses and
// purposes), read from Blackbaud once a week, plus who is signed in for the smart defaults.
export const onRequestGet = work(async ({ ctx, url }) => {
  const codes = await getCodes(ctx, { force: url.searchParams.get('force') === '1' && ctx.email.endsWith('@favorintl.org') });
  return { codes, me: await meFor(ctx.env, ctx.email), types: await typesByFundraiser(ctx.env), today: todayEt() };
});
