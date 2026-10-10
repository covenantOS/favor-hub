import { work, body } from '../../../_lib/work/route';
import { addPartner } from '../../../_lib/work/addpartner';
import { HttpError } from '../../../_lib/http';

// The stand-in for adding a partner: the same checks and the same calls, answered with made-up ids, and nothing sent to Blackbaud.
// Admins and the agent key only.
export const onRequestPost = work(async ({ request, ctx, wu }) => {
  if (wu.scope.role !== 'admin' && wu.user.via !== 'agent') throw new HttpError(403, 'admin_only', 'Only an admin can use the stand-in.');
  return addPartner(ctx, await body(request), { standin: true }) as any;
});
