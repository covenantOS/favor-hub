import { work, body } from '../../../_lib/work/route';
import { entrySheet } from '../../../_lib/work/entry';
import { HttpError } from '../../../_lib/http';

// The hub reads an owner's tracking sheet tabs itself. Rows already here or in Blackbaud are skipped. { owner, force? }
export const onRequestPost = work(async ({ request, ctx }) => {
  const b = await body(request);
  const owner = String(b.owner || '').slice(0, 20);
  if (!owner) throw new HttpError(400, 'missing_field', 'Pick whose contacts these are.');
  return entrySheet(ctx, owner, { force: b.force === true }) as any;
});
