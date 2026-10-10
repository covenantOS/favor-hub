import { work, param } from '../../../../_lib/work/route';
import { actionExtra } from '../../../../_lib/work/edit';
import { HttpError } from '../../../../_lib/http';

// Notes, tags with their ids, or attachments on one action. Not in the mirror, so each is one Blackbaud call, kept ten minutes.
export const onRequestGet = work(async ({ ctx, params, url }) => {
  const what = url.searchParams.get('what') || '';
  if (what !== 'notes' && what !== 'tags' && what !== 'attachments') throw new HttpError(400, 'bad_what', 'Ask for notes, tags or attachments.');
  return { rows: await actionExtra(ctx, param(params, 'id'), what, { fresh: url.searchParams.get('fresh') === '1' }) };
});
