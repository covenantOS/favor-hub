import { mirrorQ, searchPartners } from '../../_lib/work/partner';
import { work } from '../../_lib/work/route';

// Type-ahead over partners by name, email or phone, the owner's portfolio first. With wide=1 (the global search) it also matches a
// lookup id and a street address.
export const onRequestGet = work(async ({ ctx, env, url }) => {
  const q = (url.searchParams.get('q') || '').slice(0, 80);
  const owner = (url.searchParams.get('owner') || '').slice(0, 20);
  if (url.searchParams.get('wide') === '1') return { rows: await searchPartners(ctx.repo, mirrorQ(env), q, owner || undefined, 10) };
  return { rows: await ctx.repo.partners(q, owner || undefined, 8) };
});
