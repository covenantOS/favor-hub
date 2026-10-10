import { work, body } from '../../../_lib/work/route';
import { addPartner } from '../../../_lib/work/addpartner';
import { HttpError } from '../../../_lib/http';

// Add a partner to Blackbaud. The agent key and every role test are turned away here and use /api/work/partner-add/standin, so a test never makes a real record.
export const onRequestPost = work(async ({ request, ctx, wu }) => {
  if (wu.user.via === 'agent') throw new HttpError(403, 'test_only', 'The agent key never makes a real record. Use /api/work/partner-add/standin.');
  return addPartner(ctx, await body(request), { standin: false }) as any;
});
