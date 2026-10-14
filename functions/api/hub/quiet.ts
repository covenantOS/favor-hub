import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { sameSite } from '../../_lib/work/route';
import { inQuiet, quietPrefsFor, saveQuiet } from '../../_lib/quiet';

// Quiet hours for the signed-in person (quiet.ts). Settings in the bell reads and saves these.
//   GET   { on, start, end, weekends, tz, quietNow }   start and end are minutes after local midnight
//   POST  { on?, start?, end?, weekends?, tz? }        start and end also take "HH:MM"
const shape = (p: { on: boolean; start: number; end: number; weekends: boolean; tz: string; saved: boolean }) => ({ ok: true, on: p.on, start: p.start, end: p.end, weekends: p.weekends, tz: p.tz, saved: p.saved, quietNow: inQuiet(p, new Date()) });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user || user.via === 'agent') return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const p = (await quietPrefsFor(env, [user.email])).get(user.email.toLowerCase())!;
    return json(shape(p));
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user || user.via === 'agent') return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    if (!sameSite(request)) return errorJson('cross_site', 'That change did not come from FavorOS. Reload the page and try again.', 403);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return json(shape(await saveQuiet(env, user.email, b)));
  } catch (err) {
    return handleError(err);
  }
};
