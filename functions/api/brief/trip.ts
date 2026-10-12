import { HttpError } from '../../_lib/http';
import { bookFor } from '../../_lib/brief/facts';
import { parseTrip, planTrip, STATES, type TripAsk } from '../../_lib/brief/trip';
import { body, work } from '../../_lib/work/route';
import { todayEt } from '../../_lib/work/service';

// Trip planner. "I'm in Dallas Thursday" (or a city, state and date given separately) returns the partners near that city,
// a route through the ones most worth a visit and meeting slots.
//   POST /api/brief/trip   { text?, city?, state?, date?, owner?, radius?, max? }
//   -> { ok, ask, dest, radius, scanned, located, pending, stops: [...], route: { order, miles, driveMin, mapsUrl } | null, note }
export const onRequestPost = work(async ({ request, ctx, env }) => {
  const b = await body(request);
  const today = todayEt();
  let ask: TripAsk | null = null;
  if (b.city) ask = { city: String(b.city).slice(0, 60), state: String(b.state || '').toUpperCase().slice(0, 2), date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : today };
  else ask = await parseTrip(env, String(b.text || ''), today);
  if (!ask) throw new HttpError(400, 'no_place', 'Say where you will be, for example "Dallas on Thursday".');
  if (ask.state && !STATES[ask.state]) ask.state = '';
  const book = await bookFor(ctx, String(b.owner || ''), today);
  if (!book.portfolio) throw new HttpError(400, 'pick_director', 'Pick a director first. A trip plans around one director\'s partners.');
  const radius = [15, 25, 40, 60, 100].includes(Number(b.radius)) ? Number(b.radius) : 40;
  const max = Math.min(8, Math.max(1, Math.floor(Number(b.max) || 5)));
  const plan = await planTrip(env, ask, book.portfolio.rows, { radius, max });
  if (!plan.ok) throw new HttpError(404, 'no_place', plan.message);
  return { ...plan, owner: book.owner };
});
