import { work } from '../../_lib/work/route';
import { freshen, noteCall } from '../../_lib/work/service';

// The hourly freshness pass. Asks Blackbaud which actions changed since the last pass and has the sync worker re-read them, so the lists
// are current between the mirror's two daily syncs. Called by the small overnight Worker (agent key) or by an admin.
export const onRequestPost = work(
  async ({ ctx }) => {
    const out = await freshen(ctx, { force: false });
    await noteCall(ctx, 'fresh:called', out.ran ? 'ran' : out.why || 'skipped');
    return out as any;
  },
  { adminOnly: true }
);
