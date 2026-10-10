import { work } from '../../_lib/work/route';
import { freshen } from '../../_lib/work/service';

// The hourly freshness pass. Asks Blackbaud which actions changed since the last pass and has the sync worker re-read them, so the lists
// are current between the mirror's two daily syncs. Called by the small overnight Worker (agent key) or by an admin.
export const onRequestPost = work(async ({ ctx }) => freshen(ctx, { force: false }) as any, { adminOnly: true });
