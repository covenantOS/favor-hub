import { HttpError } from '../../../_lib/http';
import { timelineFor } from '../../../_lib/brief/story';
import { SYSTEM_ID } from '../../../_lib/work/partner';
import { param, work } from '../../../_lib/work/route';

// One partner's whole history, newest first: gifts, calls, emails, meetings, chat mentions, notes, events and clips.
//   GET /api/brief/timeline/<partner id>
//   -> { ok, partner: { id, name, place }, events: [{ id, kind, at, title, text, by, amount?, href?, open? }], counts, synced }
// Only people the Work Center gate opens for can read it (the work() wrapper), the same rule as the partner page.
export const onRequestGet = work(async ({ ctx, params }) => {
  const id = param(params, 'id');
  if (!SYSTEM_ID.test(id)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  const t = await timelineFor(ctx, id);
  if (!t) throw new HttpError(404, 'no_partner', 'No partner has that number. The copy of Blackbaud refreshes at 5 AM and 5 PM, so a record added since then is not in it yet.');
  return { ...t };
});
