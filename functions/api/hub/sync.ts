// Lite mode's single sync (public/js/lite.js): the reads a page polls for (bell, reminders, notices, chat inbox, meetings) in one
// request. Each part runs the same function the page would have called, with the same signed-in person (the middleware already
// put the person's X-Hub-* headers on this request), so every part keeps its own access rules.
import { onRequestGet as notifications } from './notifications';
import { onRequestGet as nav } from './nav';
import { onRequestGet as gate } from '../work/gate';
import { onRequestGet as reminders } from '../work/reminders';
import { onRequest as tasks } from '../tasks/[[path]]';
import { onRequest as chat } from '../chat/[[path]]';
import { onRequest as meet } from '../meet/[[path]]';
import { onRequest as notices } from '../requests/notices';

type Fn = (ctx: any) => Response | Promise<Response>;
const ROUTES: Record<string, [Fn, string[]?]> = {
  '/api/hub/notifications': [notifications as Fn],
  '/api/hub/nav': [nav as Fn],
  '/api/work/gate': [gate as Fn],
  '/api/work/reminders': [reminders as Fn],
  '/api/tasks/links/bell': [tasks as Fn, ['links', 'bell']],
  '/api/chat/inbox': [chat as Fn, ['inbox']],
  '/api/requests/notices': [notices as Fn],
  '/api/meet/meetings': [meet as Fn, ['meetings']],
  '/api/meet/meetings/calendar': [meet as Fn, ['meetings', 'calendar']],
  '/api/meet/meetings/directory': [meet as Fn, ['meetings', 'directory']],
};

const tag = (s: string | null) => (s || '').replace(/^W\//, '');

export const onRequestGet: PagesFunction = async (ctx) => {
  const url = new URL(ctx.request.url);
  const parts: Record<string, { status: number; body: unknown }> = {};
  for (const p of url.searchParams.getAll('p').slice(0, 12)) {
    let u: URL;
    try { u = new URL(p, url); } catch { continue; }
    const r = u.origin === url.origin ? ROUTES[u.pathname] : undefined;
    if (!r) { parts[p] = { status: 404, body: null }; continue; }
    try {
      const request = new Request(u.toString(), { method: 'GET', headers: ctx.request.headers });
      const res = await r[0]({ request, env: ctx.env, params: r[1] ? { path: r[1] } : {}, data: {}, waitUntil: ctx.waitUntil.bind(ctx), passThroughOnException: () => undefined, next: () => Promise.resolve(new Response(null, { status: 404 })), functionPath: u.pathname });
      const text = await res.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* not JSON */ }
      parts[p] = { status: res.status, body };
    } catch (err) {
      console.error('[sync]', p, err);
      parts[p] = { status: 502, body: null };
    }
  }
  // An answer identical to the one the phone already has comes back as 304 with no body.
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(JSON.stringify(parts)));
  const etag = '"' + Array.from(new Uint8Array(digest)).slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('') + '"';
  const headers = { ETag: etag, 'Cache-Control': 'no-store' };
  if (tag(ctx.request.headers.get('If-None-Match')) === tag(etag)) return new Response(null, { status: 304, headers });
  return new Response(JSON.stringify({ ok: true, at: Date.now(), parts }), { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } });
};
