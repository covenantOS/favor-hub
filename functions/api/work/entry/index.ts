import { work } from '../../../_lib/work/route';
import { entryView } from '../../../_lib/work/entry';

// The week's contacts to enter: whose they are, the Monday 3:00 PM clock, how many are already in Blackbaud, and the rows.
export const onRequestGet = work(async ({ ctx, url }) => entryView(ctx, (url.searchParams.get('owner') || '').slice(0, 20)) as any);
