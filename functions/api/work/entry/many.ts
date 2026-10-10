import { work, body } from '../../../_lib/work/route';
import { entryMany } from '../../../_lib/work/entry';

// One contact, many partners: one date, one way, one summary, entered on each partner picked.
export const onRequestPost = work(async ({ request, ctx }) => {
  const b = await body(request);
  return entryMany(ctx, {
    owner: String(b.owner || ''),
    date: String(b.date || ''),
    channel: String(b.channel || ''),
    summary: String(b.summary || ''),
    tags: Array.isArray(b.tags) ? b.tags.map(String) : [],
    constituent_ids: Array.isArray(b.constituent_ids) ? b.constituent_ids.map(String) : [],
    req: typeof b.req === 'string' ? b.req : undefined,
  }) as any;
});
