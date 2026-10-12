import { errorJson, handleError, json, timingSafeEqualStr, type Env } from '../../_lib/http';
import { mayHear, tasksReady } from '../../_lib/requests/tasks';
import { brainView } from '../../_lib/requests/views';

// The Favor Brain asks what is on the request board for one person: what they own, what waits on them, what they sent and
// to whom, and what has news. Read only. It checks the shared key, that the address is a Favor address and that the person
// is not blocked. ?about=<name or email> narrows "sent by me" to one person. While request notices are closed to this person
// the answer is empty, the same as Today and the bell.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const key = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.BRAIN_HUB_KEY || !key || !timingSafeEqualStr(key, env.BRAIN_HUB_KEY)) return errorJson('signin', 'Not allowed.', 401);
    const email = String(request.headers.get('X-Acting-Email') || '').trim().toLowerCase();
    if (!/^[^@\s]+@favorintl\.org$/.test(email)) return errorJson('forbidden', 'Only Favor staff have requests.', 403);
    const row = await env.DB.prepare('SELECT blocked FROM hub_users WHERE email = ?').bind(email).first<{ blocked: number }>().catch(() => null);
    if (row && row.blocked) return errorJson('forbidden', 'That person is blocked in FavorOS.', 403);
    if (!(await tasksReady(env)) || !(await mayHear(env, email))) return json({ ok: true, for: email, mine: [], waiting_on_me: [], sent_by_me: [], waiting_on_others: [], news: [], note: 'Request notices are not on for this person yet.' });
    return json(await brainView(env, email, new URL(request.url).searchParams.get('about') || ''));
  } catch (err) {
    return handleError(err);
  }
};
