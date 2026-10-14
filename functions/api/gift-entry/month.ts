import { gift } from '../../_lib/gifts/route';
import { currentYm, monthDeposits, YM } from '../../_lib/gifts/month';
import { isTester } from '../../_lib/testuser';
import { HttpError } from '../../_lib/http';

// Every mail deposit of a month, whoever entered it (the admin desk in Blackbaud, or FavorOS). ?ym=YYYY-MM, this month (Eastern) by default.
export const onRequestGet = gift(async ({ env, url, user, q }) => {
  const ym = url.searchParams.get('ym') || currentYm();
  if (!YM.test(ym)) throw new HttpError(400, 'bad_month', 'Pick a month.');
  const out = await monthDeposits(q, ym, ym, { env, withTesters: isTester(user.email) });
  return { ym, deposits: out.deposits, totals: out.totals, asOf: out.asOf };
});
