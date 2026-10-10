import { work } from '../../_lib/work/route';
import { drain } from '../../_lib/work/service';

// The overnight run. Sends batches held for tonight, and any that stopped partway. The agent key (the small drain Worker) or an admin only.
export const onRequestPost = work(async ({ ctx }) => drain(ctx) as any, { adminOnly: true });
