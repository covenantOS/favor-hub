import { route } from '../../../_lib/statements/route';
import { recentBatches, summary } from '../../../_lib/statements/store';

// Print files made so far, newest first.
export const onRequestGet = route(async ({ env }) => ({ batches: (await recentBatches(env, 60)).map(summary) }));
