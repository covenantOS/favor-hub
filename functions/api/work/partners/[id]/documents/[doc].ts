import { HttpError } from '../../../../../_lib/http';
import { SYSTEM_ID } from '../../../../../_lib/work/partner';
import { copyToBlackbaud, listDocs, openDoc, removeDoc } from '../../../../../_lib/work/partner-docs';
import { recordPreview } from '../../../../../_lib/work/preview';
import { param, work } from '../../../../../_lib/work/route';

const check = (id: string, doc: string) => {
  if (!SYSTEM_ID.test(id)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  if (!/^pd_?[A-Za-z0-9_-]{4,60}$/.test(doc)) throw new HttpError(404, 'no_doc', 'That document is gone.');
};

// Open (GET), remove (DELETE) or send to Blackbaud again (POST) one document. The file is served only to signed-in people the Work Center gate lets in.
export const onRequestGet = work(async ({ ctx, params, wu }) => {
  if (!recordPreview(wu)) throw new HttpError(404, 'not_open', 'Documents are not open yet.');
  const id = param(params, 'id');
  const doc = param(params, 'doc');
  check(id, doc);
  return await openDoc(ctx, id, doc);
});
export const onRequestDelete = work(async ({ ctx, params, wu }) => {
  if (!recordPreview(wu)) throw new HttpError(404, 'not_open', 'Documents are not open yet.');
  const id = param(params, 'id');
  const doc = param(params, 'doc');
  check(id, doc);
  await removeDoc(ctx, id, doc);
  return {};
});
export const onRequestPost = work(async ({ ctx, params, wu }) => {
  if (!recordPreview(wu)) throw new HttpError(404, 'not_open', 'Documents are not open yet.');
  const id = param(params, 'id');
  const doc = param(params, 'doc');
  check(id, doc);
  const state = await copyToBlackbaud(ctx, doc, fetch, id);
  return { state, ...(await listDocs(ctx, id, { readBb: false })) };
});
