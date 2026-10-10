import { work, body } from '../../../_lib/work/route';
import { entryPaste } from '../../../_lib/work/entry';
import { HttpError } from '../../../_lib/http';

// Rows copied from an RDD's tracking sheet. Each is matched to a partner (email, then phone, then name); rows already here or in Blackbaud are skipped.
export const onRequestPost = work(async ({ request, ctx }) => {
  const b = await body(request);
  const owner = String(b.owner || '').slice(0, 20);
  if (!owner) throw new HttpError(400, 'missing_field', 'Pick whose contacts these are.');
  return entryPaste(ctx, owner, String(b.text || '')) as any;
});
