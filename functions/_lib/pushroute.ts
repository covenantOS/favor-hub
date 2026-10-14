// Push subscription routes (functions/api/push/*.ts call these). A person can subscribe, unsubscribe and send themselves one test
// notice. Nobody can send to anyone else from here.
import { HttpError, errorJson, handleError, json, nowIso, type Env } from './http';
import { hubUserOf } from './session';
import { pushToPeople, unb64u, validEndpoint, vapidPublicKey, type PushEnv } from './push';

type Handler = PagesFunction<PushEnv>;

function who(request: Request) {
  const user = hubUserOf(request);
  if (!user || user.via === 'agent') throw new HttpError(401, 'signin', 'Sign in first.');
  return user;
}

export const getKey: Handler = async ({ request, env }) => {
  try {
    who(request);
    const key = vapidPublicKey(env);
    return key ? json({ ok: true, key }) : errorJson('not_set_up', 'Notifications are not set up on this copy of FavorOS.', 503);
  } catch (err) {
    return handleError(err);
  }
};

export const subscribe: Handler = async ({ request, env }) => {
  try {
    const user = who(request);
    const b = (await request.json().catch(() => ({}))) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const endpoint = String(b.endpoint || '');
    const p256dh = String(b.keys?.p256dh || '');
    const auth = String(b.keys?.auth || '');
    if (!validEndpoint(endpoint)) throw new HttpError(400, 'bad_endpoint', 'That notification address is not valid.');
    try {
      const pub = unb64u(p256dh);
      if (pub.length !== 65 || pub[0] !== 4 || unb64u(auth).length !== 16) throw new Error('keys');
    } catch {
      throw new HttpError(400, 'bad_keys', 'The notification keys are not valid.');
    }
    // One browser belongs to one person: a subscription re-sent by someone else moves to them (a shared phone signs in a new person).
    await env.DB.prepare(
      `INSERT INTO push_subs (endpoint, email, p256dh, auth, user_agent, created_at, fails) VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(endpoint) DO UPDATE SET email = excluded.email, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, fails = 0`
    ).bind(endpoint, user.email.toLowerCase(), p256dh, auth, (request.headers.get('User-Agent') || '').slice(0, 200), nowIso()).run();
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};

export const unsubscribe: Handler = async ({ request, env }) => {
  try {
    const user = who(request);
    const b = (await request.json().catch(() => ({}))) as { endpoint?: unknown };
    await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND email = ?').bind(String(b.endpoint || ''), user.email.toLowerCase()).run();
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};

export const testSelf: Handler = async ({ request, env }) => {
  try {
    const user = who(request);
    const n = await pushToPeople(env, [user.email], { title: 'FavorOS', body: 'Notifications are on for this device.', url: '/chat/', tag: 'test' }, fetch, { loud: true });
    return json({ ok: true, sent: n });
  } catch (err) {
    return handleError(err);
  }
};

export type { Env };
