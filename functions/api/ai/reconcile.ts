import { agentKeyOk } from '../../_lib/testuser';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { reconcileNow } from '../../_lib/ai/admin';

// Every 10 minutes the favor-work-drain Worker calls this with the agent key: Cloudflare's own neuron totals for the last 7 days go
// over the guard's estimate (D1 ai_budget_day and KV ai:budget:<day>), and today's kill flag is set once the true total passes 9,000.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!agentKeyOk(env, request)) return errorJson('forbidden', 'Invalid or missing agent key', 403);
    return json({ ok: true, ...(await reconcileNow(env)) });
  } catch (err) {
    return handleError(err);
  }
};
