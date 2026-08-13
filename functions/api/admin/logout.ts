import { clearSessionCookie, readCookie } from '../../_lib/auth';
import { json, nowIso, type Env } from '../../_lib/http';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = readCookie(request);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ? OR expires_at < ?').bind(token, nowIso()).run();
  }
  return json({ ok: true, admin: false }, 200, { 'Set-Cookie': clearSessionCookie() });
};
