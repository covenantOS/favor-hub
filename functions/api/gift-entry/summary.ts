import { gift } from '../../_lib/gifts/route';
import { daySummary, recentDates } from '../../_lib/gifts/summary';
import { etParts } from '../../_lib/actions/intake';
import { isTester } from '../../_lib/testuser';
import { HttpError } from '../../_lib/http';

// The day's summary against the deposit totals. ?date=YYYY-MM-DD, today (Eastern) by default.
export const onRequestGet = gift(async ({ env, url, user }) => {
  const date = url.searchParams.get('date') || etParts(new Date()).date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'bad_date', 'Pick a date.');
  const t = isTester(user.email);
  return { summary: await daySummary(env, date, t), dates: await recentDates(env, t) };
});
