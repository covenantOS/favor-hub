import { gift, pid } from '../../../../_lib/gifts/route';
import { depositView, laneRow } from '../../../../_lib/gifts/view';
import { getDeposit, logEvent } from '../../../../_lib/gifts/store';
import { HttpError } from '../../../../_lib/http';

export const onRequestGet = gift(async ({ env, params }) => {
  const v = await depositView(env, pid(params));
  if (!v) throw new HttpError(404, 'not_found', 'That deposit is not here.');
  return { ...v, lane: await laneRow(env) };
});

// Throw away a deposit that was never sent. Its photos stay in the private bucket under the retention rule; the deposit leaves the lists.
export const onRequestDelete = gift(async ({ env, params, actor }) => {
  const d = await getDeposit(env, pid(params));
  if (!d) throw new HttpError(404, 'not_found', 'That deposit is not here.');
  if (d.status !== 'open') throw new HttpError(409, 'already_sent', 'This deposit was already sent to Blackbaud. Remove the batch in Blackbaud first.');
  await env.DB.prepare("UPDATE ge_deposit SET status = 'removed' WHERE id = ?").bind(d.id).run();
  await env.DB.prepare("UPDATE ge_gift SET status = 'removed' WHERE deposit_id = ?").bind(d.id).run();
  await logEvent(env, { deposit_id: d.id, kind: 'deposit_removed', actor });
  return { removed: true };
});
