import { receiptsDays } from '../../_lib/admin/settings';
import { requireReceiptsUser } from '../../_lib/receipts/auth';
import { DEFAULT_DAYS, waitingView } from '../../_lib/receipts/store';
import { handleError, json, type Env } from '../../_lib/http';

/** Every gift Blackbaud has not thanked yet in the window, sorted into letters and the ones held back. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireReceiptsUser(env, request);
    const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days')) || (await receiptsDays(env).catch(() => DEFAULT_DAYS)), 7), 365);
    return json({ ok: true, ...(await waitingView(env, days)) });
  } catch (err) {
    return handleError(err);
  }
};
