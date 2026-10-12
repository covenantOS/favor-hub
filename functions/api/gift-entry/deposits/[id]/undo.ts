import { gift, jsonBody, pid, requirePosting } from '../../../../_lib/gifts/route';
import { undoDeposit } from '../../../../_lib/gifts/flow';
import { getDeposit } from '../../../../_lib/gifts/store';
import { depositView, laneRow } from '../../../../_lib/gifts/view';
import { HttpError } from '../../../../_lib/http';

// Take the batch back the day it was made, while Blackbaud still shows it unapproved. A reason is required and goes in the log.
export const onRequestPost = gift(async ({ request, env, flow, params, canPost }) => {
  requirePosting(canPost);
  const id = pid(params);
  if (!(await getDeposit(env, id))) throw new HttpError(404, 'not_found', 'That deposit is not here.');
  const b = await jsonBody(request);
  const reason = String(b.reason == null ? '' : b.reason).replace(/\s+/g, ' ').trim();
  if (!reason) throw new HttpError(400, 'reason_needed', 'Say why you are taking the batch back.');
  const out = await undoDeposit(flow, id, reason);
  if (!out.ok) throw new HttpError(409, 'cannot_undo', out.why || 'The batch could not be taken back.');
  return { undone: out, ...(await depositView(env, id)), lane: await laneRow(env) };
});
