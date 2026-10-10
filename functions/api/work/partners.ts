import { work } from '../../_lib/work/route';

// Type-ahead over partners by name, email or phone, the owner's portfolio first.
export const onRequestGet = work(async ({ ctx, url }) => {
  const q = (url.searchParams.get('q') || '').slice(0, 80);
  const owner = (url.searchParams.get('owner') || '').slice(0, 20);
  return { rows: await ctx.repo.partners(q, owner || undefined, 8) };
});
