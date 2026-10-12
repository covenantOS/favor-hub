import { work } from '../../_lib/work/route';
import { refreshSnapshots } from '../../_lib/work/partner';
import { etParts } from '../../_lib/actions/intake';

// The scheduled pass that keeps the Work lists' saved Blackbaud answers current. Called every five minutes by the small Worker
// (agent key). It does nothing outside 6 AM to 9 PM Eastern; a person's open of a list reads from the saved answers at any hour.
export const onRequestPost = work(
  async ({ ctx }) => {
    const hour = etParts(new Date()).hour;
    if (hour < 6 || hour >= 21) return { ok: true, refreshed: 0, left: 0, why: 'night' } as any;
    return { ok: true, ...(await refreshSnapshots(ctx.env)) } as any;
  },
  { adminOnly: true }
);
