import { work, body } from '../../../_lib/work/route';
import { undoChange } from '../../../_lib/recurring/service';

// Put a change back within 24 hours. A stopped schedule cannot be restarted.
export const onRequestPost = work(async ({ request, ctx }) => (await undoChange(ctx, (await body(request)) as { id?: string; req?: string })) as any);
