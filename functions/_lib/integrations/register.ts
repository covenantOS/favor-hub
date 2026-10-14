// Every integration's extra routes, registered once when /api/integrations loads.
//   POST clip-place { clip_id, kind, ref, message_id?, suggest_log? }   a clip sent as a reply, tied to where it went
//   GET  clip-marks?clip=                                              the task and adjustment marks on a clip's comments
//   POST clip-comments/:cid/task { project_id?, owner_email? }         Make this a task
//   POST clip-comments/:cid/adjust { on, done }                        mark as an adjustment, or tick it done
//   GET  clip-log?partner=                                             my clips suggested for this partner's contact log
//   POST clip-log/act { clip_id, partner_id, action: log|dismiss, confirm }
//   GET  prep/upcoming                       prep packs for meetings in the next 15 minutes (the dock card)
//   GET  prep/meeting?m=                     the pack for one FavorOS meeting (its prep page)
//   POST prep/seen { key }                   the dock card was opened or closed
//   GET  prefs   POST prefs { prep_on?, prep_recurring?, followup_on?, followup_offer_closed? }
//   GET  followups                           follow-up drafts ready to open, and the one-time suggestion
//   POST followups/:meeting { action: opened|dismiss|draft }
import { json } from '../http';
import { addRoutes } from './route';
import { actOnSuggestion, logSuggestions, markAdjust, markTask, marksFor, placeClip } from './cliplinks';
import { markSeen, meetingPack, prefsFor, setPrefs, upcomingPacks } from './prep';
import { actOnFollowup, myFollowups } from './followup';

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const b = await request.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
};

addRoutes(async ({ request, env, user, path }, method, url) => {
  if (!user) return null;
  const [a, b, c] = path;
  if (a === 'clip-place' && method === 'POST') return json(await placeClip(env, user, await body(request)));
  if (a === 'clip-marks' && method === 'GET') return json(await marksFor(env, user, url.searchParams.get('clip') || ''));
  if (a === 'clip-comments' && b && c === 'task' && method === 'POST') return json(await markTask(env, user, b, await body(request)));
  if (a === 'clip-comments' && b && c === 'adjust' && method === 'POST') return json(await markAdjust(env, user, b, await body(request)));
  if (a === 'clip-log' && !b && method === 'GET') return json(await logSuggestions(env, user, url.searchParams.get('partner') || ''));
  if (a === 'clip-log' && b === 'act' && method === 'POST') return json(await actOnSuggestion(env, user, await body(request)));
  if (a === 'prep' && b === 'upcoming' && method === 'GET') return json(await upcomingPacks(env as never, user));
  if (a === 'prep' && b === 'meeting' && method === 'GET') return json(await meetingPack(env as never, user, url.searchParams.get('m') || ''));
  if (a === 'prep' && b === 'seen' && method === 'POST') { await markSeen(env, user, String((await body(request)).key || '')); return json({ ok: true }); }
  if (a === 'prefs' && !b && method === 'GET') return json({ ok: true, prefs: await prefsFor(env, user.email) });
  if (a === 'prefs' && !b && method === 'POST') return json({ ok: true, prefs: await setPrefs(env, user.email, await body(request)) });
  if (a === 'followups' && !b && method === 'GET') return json(await myFollowups(env, user));
  if (a === 'followups' && b && method === 'POST') return json(await actOnFollowup(env, user, b, await body(request)));
  return null;
});
