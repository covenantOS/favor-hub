import { gift, pid } from '../../../../_lib/gifts/route';
import { runDeposit } from '../../../../_lib/gifts/runner';
import { getDeposit } from '../../../../_lib/gifts/store';
import { depositView, laneRow } from '../../../../_lib/gifts/view';
import { HttpError } from '../../../../_lib/http';
import { stageNeeds } from '../../../../_lib/gifts/stage';

// Steps 7 to 9 from the status view: run what is due, watch the batch for Jennifer's approval, and copy photos once it is committed.
// A person can leave and come back; every step is safe to run again.
export const onRequestPost = gift(async ({ env, flow, params, url }) => {
  if (!stageNeeds(2)) throw new HttpError(409, 'not_open_yet', 'Creating the batch in Blackbaud opens in the next stage. Keep entering in Blackbaud for now.');
  const id = pid(params);
  if (!(await getDeposit(env, id))) throw new HttpError(404, 'not_found', 'That deposit is not here.');
  const pass = await runDeposit(env, flow, id, { force: url.searchParams.get('force') === '1' });
  const v = await depositView(env, id);
  return { ...v, watch: pass.watch, attach: pass.attach, lane: await laneRow(env) };
});
