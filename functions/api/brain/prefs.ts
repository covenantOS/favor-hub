import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';
import { brainFlag } from '../../_lib/admin/settings';

// What this person has already been shown on the Favor Brain page. Today: the connect popup, shown once.
const KEYS = new Set(['connect_seen']);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    let seen: string[] = [];
    try {
      seen = ((await env.DB.prepare('SELECT key FROM brain_prefs WHERE email = ?').bind(user.email.toLowerCase()).all<{ key: string }>()).results || []).map((r) => r.key);
    } catch {
      // the table arrives with db/prefs.sql; until then the page falls back to this browser's memory
    }
    // Admin > Favor Brain can switch the connect window off for everyone.
    return json({ ok: true, seen, prompt: await brainFlag(env, 'brain.connect_prompt').catch(() => true) });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const body = (await request.json().catch(() => ({}))) as { key?: unknown };
    if (typeof body.key !== 'string' || !KEYS.has(body.key)) return errorJson('bad_key', 'Unknown setting.', 400);
    await env.DB.prepare('INSERT OR IGNORE INTO brain_prefs (email, key, at) VALUES (?, ?, ?)').bind(user.email.toLowerCase(), body.key, new Date().toISOString()).run();
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};
