import { receiptsDays } from '../../_lib/admin/settings';
import { agentKeyOk } from '../../_lib/testuser';
import { DEFAULT_DAYS, waitingView } from '../../_lib/receipts/store';
import { errorJson, handleError, json, type Env } from '../../_lib/http';

// The scheduled read of the waiting list from Blackbaud, so the Receipts page always opens on a copy a few minutes old and never waits
// on the 6 second query. Called by the small Worker every 10 minutes through the working day, with the agent key.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!agentKeyOk(env, request)) return errorJson('forbidden', 'Invalid or missing agent key', 403);
    const days = Math.min(Math.max(await receiptsDays(env).catch(() => DEFAULT_DAYS), 7), 365);
    const t0 = Date.now();
    const view = await waitingView(env, days, true);
    return json({ ok: true, days, letters: view.letters.length, held: view.held.length, ms: Date.now() - t0 });
  } catch (err) {
    return handleError(err);
  }
};
