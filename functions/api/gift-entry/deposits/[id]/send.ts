import { gift, pid } from '../../../../_lib/gifts/route';
import { advance, queueSend } from '../../../../_lib/gifts/flow';
import { HttpError } from '../../../../_lib/http';
import { stageNeeds } from '../../../../_lib/gifts/stage';

// Step 7: create the unapproved batch in Blackbaud. The steps are saved first (the outbox), then run; the page keeps calling /run.
export const onRequestPost = gift(async ({ flow, params }) => {
  if (!stageNeeds(2)) throw new HttpError(409, 'not_open_yet', 'Creating the batch in Blackbaud opens in the next stage. Keep entering in Blackbaud for now.');
  const id = pid(params);
  try {
    await queueSend(flow, id);
  } catch (e: any) {
    throw new HttpError(409, 'cannot_send', String(e && e.message ? e.message : e));
  }
  return { progress: await advance(flow, id) };
});
