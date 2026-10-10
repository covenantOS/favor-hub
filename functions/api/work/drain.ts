import { work } from '../../_lib/work/route';
import { drain, noteCall } from '../../_lib/work/service';

// The overnight run. Sends batches held for tonight, and any that stopped partway. The agent key (the small drain Worker) or an admin only.
export const onRequestPost = work(
  async ({ ctx }) => {
    const out = await drain(ctx);
    await noteCall(ctx, 'drain:called', `${out.ran} sent, ${out.left} left`);
    return out as any;
  },
  { adminOnly: true }
);
