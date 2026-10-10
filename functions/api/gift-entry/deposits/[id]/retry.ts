import { HttpError } from '../../../../_lib/http';
import { stageNeeds } from '../../../../_lib/gifts/stage';
import { gift, pid } from '../../../../_lib/gifts/route';
import { advance, retryDeposit } from '../../../../_lib/gifts/flow';

export const onRequestPost = gift(async ({ flow, params }) => {
  if (!stageNeeds(2)) throw new HttpError(409, 'not_open_yet', 'Creating the batch in Blackbaud opens in the next stage. Keep entering in Blackbaud for now.');
  const id = pid(params);
  await retryDeposit(flow, id);
  return { progress: await advance(flow, id) };
});
