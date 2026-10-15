import { og } from '../../_lib/other-gifts/route';
import { backfillFromComments } from '../../_lib/tributes/store';

// Admin only. Copies the tributes written in Blackbaud gift comments into FavorOS, flagged "from comment". Safe to run again: a gift
// that already has a row is skipped. Reads the Blackbaud copy and writes only FavorOS.
export const onRequestPost = og(
  async ({ env, actor }) => {
    return { ...(await backfillFromComments(env, actor)) };
  },
  { adminOnly: true }
);
