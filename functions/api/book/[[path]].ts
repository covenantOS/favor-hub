// Booking pages, the public side: /meet/with/ calls these without a hub sign-in (a staff-only meeting type needs one).
//   GET  /api/book/page?u=<handle>                 the owner's name and meeting types
//   GET  /api/book/slots?u=&t=&from=&days=         open start times
//   POST /api/book/book                            book a time
//   GET  /api/book/manage?b=&k=                    one booking, from the partner's email link
//   POST /api/book/manage                          cancel or move it
import { errorJson, handleError, json } from '../../_lib/http';
import { withMeetSettings } from '../../_lib/admin/settings';
import { book, manageAct, manageGet, publicPage, publicSlots } from '../../_lib/meetbook';
import type { MeetEnv } from '../../_lib/meet';

export const onRequest: PagesFunction<MeetEnv> = async ({ request, env: raw, params }) => {
  try {
    const env = await withMeetSettings(raw);
    const parts = ((params.path as string[]) || []).filter(Boolean);
    const url = new URL(request.url);
    const signedIn = !!request.headers.get('X-Hub-Email');
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const body = async () => ((await request.json().catch(() => ({}))) as Record<string, unknown>);
    const m = request.method;
    if (parts[0] === 'page' && m === 'GET') return json(await publicPage(env, url.searchParams.get('u') || '', signedIn));
    if (parts[0] === 'slots' && m === 'GET') return json(await publicSlots(env, url.searchParams, signedIn));
    if (parts[0] === 'book' && m === 'POST') return json(await book(env, await body(), url.origin, ip, signedIn));
    if (parts[0] === 'manage' && m === 'GET') return json(await manageGet(env, url.searchParams.get('b') || '', url.searchParams.get('k') || ''));
    if (parts[0] === 'manage' && m === 'POST') return json(await manageAct(env, await body(), url.origin));
    return errorJson('not_found', 'Not found.', 404);
  } catch (err) {
    return handleError(err);
  }
};
