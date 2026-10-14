// A partner's giving before the gift on screen, for the deposit screen's history panel: how many gifts, the lifetime total and the last
// gift. Read from the Blackbaud copy (up to 12 hours old). GET ?cid=<constituent record id>&before=YYYY-MM-DD. Gift entry access only.
import { gift } from '../../_lib/gifts/route';
import { HttpError } from '../../_lib/http';
import { mirror } from '../../_lib/foundations/blackbaud';
import { historyOf } from '../../_lib/gifts/history';

export const onRequestGet = gift(async ({ env, url }) => {
  const cid = String(url.searchParams.get('cid') || '').trim();
  const before = String(url.searchParams.get('before') || '').trim();
  if (!/^\d{1,12}$/.test(cid)) throw new HttpError(400, 'bad_partner', 'Pick a partner first.');
  if (before && !/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new HttpError(400, 'bad_date', 'Pick a date.');
  const rows = (await mirror(
    env,
    `SELECT g.gift_amount AS amt, DATE(g.gift_date) AS d FROM gifts g
      WHERE g.constituent_record_id = ?1 AND g.gift_amount > 0 AND g.gift_type IN ('Donation', 'RecurringGiftPayment', 'PledgePayment')
        AND (?2 = '' OR DATE(g.gift_date) < ?2)`,
    [cid, before]
  )) as Array<{ amt: number | null; d: string | null }>;
  return { history: historyOf(rows) };
});
