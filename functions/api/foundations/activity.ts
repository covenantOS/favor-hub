import { actorOf, requireFoundationsUser } from '../../_lib/foundations/auth';
import { retryWaiting } from '../../_lib/foundations/blackbaud';
import { handleError, json, type Env } from '../../_lib/http';

/** What this page has sent to Blackbaud, newest first, and anything still waiting to go. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireFoundationsUser(env, request);
    const log = await env.DB.prepare(
      `SELECT l.kind, l.actor, l.method, l.path, l.ok, l.status, l.detail, l.created_at, l.foundation_id, f.name AS foundation
       FROM fnd_log l LEFT JOIN fnd_foundations f ON f.id = l.foundation_id
       ORDER BY l.created_at DESC LIMIT 150`
    ).all();
    const waiting = await env.DB.prepare(
      `SELECT c.id, c.foundation_id, f.name AS foundation, c.contact_date, c.how, c.rdd_name, c.bb_state, c.bb_tags_state, c.bb_error
       FROM fnd_contacts c JOIN fnd_foundations f ON f.id = c.foundation_id
       WHERE c.source = 'app' AND (c.bb_state <> 'posted' OR c.bb_tags_state = 'waiting')
       ORDER BY c.created_at DESC LIMIT 60`
    ).all();
    return json({ ok: true, log: log.results, waiting: waiting.results });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireFoundationsUser(env, request);
    const tried = await retryWaiting(env, actorOf(request), 12);
    return json({ ok: true, tried });
  } catch (err) {
    return handleError(err);
  }
};
