import { HttpError } from '../../../../../_lib/http';
import { isTester } from '../../../../../_lib/testuser';
import { SYSTEM_ID } from '../../../../../_lib/work/partner';
import { addDoc, listDocs } from '../../../../../_lib/work/partner-docs';
import { param, work } from '../../../../../_lib/work/route';

// Documents on a partner record: the list (FavorOS's copies and Blackbaud's attachments) and adding one. Anyone who can open the
// partner record can read the list; the same gate as the record applies. A test account or the agent key keeps the file in FavorOS and
// sends nothing to Blackbaud.
export const onRequestGet = work(async ({ ctx, params, url }) => {
  const id = param(params, 'id');
  if (!SYSTEM_ID.test(id)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  return { ...(await listDocs(ctx, id, { fresh: url.searchParams.get('fresh') === '1' })) };
});

export const onRequestPost = work(async ({ ctx, params, request, wu }) => {
  const id = param(params, 'id');
  if (!SYSTEM_ID.test(id)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  const form = await request.formData().catch(() => null);
  const file = form ? (form.get('file') as unknown as File | null) : null;
  const standin = wu.user.via === 'agent' || isTester(wu.user.email) || !!ctx.testCid;
  const row = await addDoc(ctx, id, file as File, { kind: String(form?.get('kind') || ''), name: String(form?.get('name') || ''), date: String(form?.get('date') || '') }, { standin });
  return { doc: row };
});
