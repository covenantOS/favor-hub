import { work } from '../../_lib/work/route';
import { asksResponse } from '../../_lib/work/asks';

// The ask pipeline: every action tagged Amount of Ask in the last year, in its column. Read from the D1 copy of Blackbaud. No Blackbaud calls.
// Paged: status, state (one column), q (search), owner, range, offset and limit (default 50). Every filter runs over all asks on the server.
export const onRequestGet = work(async ({ ctx, url }) => {
  const p = url.searchParams;
  return asksResponse(ctx, (p.get('owner') || '').slice(0, 20), p.get('range') || '12m', {
    status: p.get('status') || 'all',
    state: p.get('state') || '',
    q: (p.get('q') || '').slice(0, 100),
    offset: Number(p.get('offset') || 0),
    limit: Number(p.get('limit') || 50),
  }) as any;
});
