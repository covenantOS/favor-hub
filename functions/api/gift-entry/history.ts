// A partner's giving before the gift on screen, for the deposit screen's history panel: how many gifts, the lifetime total and the last
// gift. The household's credited giving (shared rule: soft credits through a DAF count for the partner, a spouse's gifts count) read
// from the Blackbaud copy (up to 12 hours old). GET ?cid=<constituent record id>&before=YYYY-MM-DD. Gift entry access only.
import { gift } from '../../_lib/gifts/route';
import { HttpError } from '../../_lib/http';
import { addDays } from '../../_lib/actions/completion';
import { partnerGiving } from '../../_lib/gifts/partner-giving';
import { mirrorQ } from '../../_lib/work/partner';
import { historyOf } from '../../_lib/gifts/history';

export const onRequestGet = gift(async ({ env, url }) => {
  const cid = String(url.searchParams.get('cid') || '').trim();
  const before = String(url.searchParams.get('before') || '').trim();
  if (!/^\d{1,12}$/.test(cid)) throw new HttpError(400, 'bad_partner', 'Pick a partner first.');
  if (before && !/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new HttpError(400, 'bad_date', 'Pick a date.');
  // Earlier than the gift on screen means dated up to the day before it.
  const g = await partnerGiving(mirrorQ(env), cid, before ? addDays(before, -1) : undefined);
  if (!g) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  return { history: historyOf(g) };
});
