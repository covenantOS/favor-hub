import { work, body, param } from '../../../_lib/work/route';
import { entryPatch } from '../../../_lib/work/entry';

// Change one entry row: the partner, the date, how it went out, the summary, tags, the ask, or skip it.
export const onRequestPatch = work(async ({ request, ctx, params }) => entryPatch(ctx, param(params, 'id'), await body(request)) as any);
