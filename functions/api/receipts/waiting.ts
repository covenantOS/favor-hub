import { receiptsDays } from '../../_lib/admin/settings';
import { requireReceiptsUser } from '../../_lib/receipts/auth';
import { DEFAULT_DAYS, waitingView } from '../../_lib/receipts/store';
import { handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { isTester } from '../../_lib/testuser';

/** Every gift Blackbaud has not thanked yet in the window, sorted into letters and the ones held back. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    await requireReceiptsUser(env, request);
    // The FavorOS test user gets made-up gifts with one of each problem, so the flagged view can be checked without Blackbaud.
    if (isTester(hubUserOf(request)?.email)) return json({ ok: true, sample: true, ...(await waitingView(env, 90, false, undefined, true)) });
    const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days')) || (await receiptsDays(env).catch(() => DEFAULT_DAYS)), 7), 365);
    return json({ ok: true, ...(await waitingView(env, days, new URL(request.url).searchParams.get('fresh') === '1', waitUntil)) });
  } catch (err) {
    return handleError(err);
  }
};
