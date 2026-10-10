import { work } from '../../_lib/work/route';
import { boardResponse, parseBoardQuery, resumeStuck } from '../../_lib/work/service';

// Every open action, with filters, facets and counts. The page reads it once and filters in the browser; ids=1 answers Select all.
export const onRequestGet = work(async ({ ctx, url, waitUntil }) => {
  waitUntil(resumeStuck(ctx).catch(() => undefined));
  return boardResponse(ctx, parseBoardQuery(url));
});
