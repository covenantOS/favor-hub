import { work, body } from '../../../_lib/work/route';
import { findMatches } from '../../../_lib/work/addpartner';

// The duplicate check for a partner about to be added. The mirror answers at once; { live: true } also asks Blackbaud's own duplicate search (one call).
export const onRequestPost = work(async ({ request, ctx }) => {
  const b = await body(request);
  return findMatches(ctx, b, { live: b.live === true }) as any;
});
