// The FavorOS web Worker. It has no public address: the Pages middleware (functions/_middleware.ts) hands it the routes listed in
// the hub setting web.routes, after sign-in and every guard, with the person in X-Hub-* headers. Built files live under /_w/ and are
// served by the platform before this code runs.
import handler from '@tanstack/react-start/server-entry';
import { env } from 'cloudflare:workers';
import { HUB_ORIGIN } from './lib/hub';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/_w/ping') {
      // Health, and whether this Worker can read the hub's /api with the caller's session (the server reads depend on it).
      let nav = 0;
      let err = '';
      try {
        const r = await fetch(HUB_ORIGIN + '/api/hub/nav', {
          headers: { 'X-Hub-Request': '1', 'X-Web-Key': (env as unknown as { WEB_KEY?: string }).WEB_KEY || '', cookie: request.headers.get('cookie') || '' } });
        nav = r.status;
      } catch (e) {
        err = String((e as Error).message || e).slice(0, 200);
      }
      return Response.json({ ok: true, at: new Date().toISOString(), nav, err }, { headers: { 'cache-control': 'no-store' } });
    }
    // Only the middleware calls this Worker, and it always names the person. Anything else is refused.
    if (!request.headers.get('X-Hub-Email')) return new Response('Not found', { status: 404 });
    const res = await handler.fetch(request);
    const out = new Response(res.body, res);
    if ((out.headers.get('content-type') || '').includes('text/html')) {
      out.headers.set('Cache-Control', 'private, no-cache');
      out.headers.set('X-Hub-Front', 'web');
    }
    return out;
  },
};
