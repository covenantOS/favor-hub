import { HttpError } from '../../../_lib/http';
import { storyFor } from '../../../_lib/brief/story';
import { loadPartner, mirrorQ, SYSTEM_ID } from '../../../_lib/work/partner';
import { param, work } from '../../../_lib/work/route';
import { todayEt } from '../../../_lib/work/service';

// The story of one partner and the next best action, from the partner's records.
//   GET /api/brief/story/<partner id>?fresh=1
//   -> { ok, story: { text, at, health, why }, nba: { kind, label, why, channel, urgency }, rhythm: { cadence, lastDate, expectedNext, lateDays } }
export const onRequestGet = work(async ({ ctx, env, params, url }) => {
  const id = param(params, 'id');
  if (!SYSTEM_ID.test(id)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  const today = todayEt();
  const p = await loadPartner(mirrorQ(env), id, today);
  if (!p) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  const { story, facts, nba } = await storyFor(ctx, id, p, today, url.searchParams.get('fresh') === '1');
  return { story, nba, rhythm: { cadence: facts.rhythm.cadence, lastDate: facts.rhythm.lastDate, expectedNext: facts.rhythm.expectedNext, lateDays: facts.rhythm.lateDays } };
});
