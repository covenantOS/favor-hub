// Every integration's extra routes, registered once when /api/integrations loads.
//   POST clip-place { clip_id, kind, ref, message_id?, suggest_log? }   a clip sent as a reply, tied to where it went
//   GET  clip-marks?clip=                                              the task and adjustment marks on a clip's comments
//   POST clip-comments/:cid/task { project_id?, owner_email? }         Make this a task
//   POST clip-comments/:cid/adjust { on, done }                        mark as an adjustment, or tick it done
//   GET  clip-log?partner=                                             my clips suggested for this partner's contact log
//   POST clip-log/act { clip_id, partner_id, action: log|dismiss, confirm }
import { json } from '../http';
import { addRoutes } from './route';
import { actOnSuggestion, logSuggestions, markAdjust, markTask, marksFor, placeClip } from './cliplinks';

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
  return null;
});
