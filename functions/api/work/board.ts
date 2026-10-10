import { work } from '../../_lib/work/route';
import { boardResponse, freshen, parseBoardQuery, resumeStuck } from '../../_lib/work/service';

// Every open action, with filters, facets and counts. The page reads it once and filters in the browser; ids=1 answers Select all.
export const onRequestGet = work(async ({ ctx, url, waitUntil }) => {
  waitUntil(resumeStuck(ctx).catch(() => undefined));
  // Opening the board also refreshes it: at most one pass every 15 minutes, so the list is current within minutes of a change in Blackbaud.
  if (!url.searchParams.get('offset') && url.searchParams.get('ids') !== '1') waitUntil(freshen(ctx).catch(() => undefined));
  return boardResponse(ctx, parseBoardQuery(url));
});
