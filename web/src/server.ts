// The FavorOS web Worker. It has no public address: the Pages middleware (functions/_middleware.ts) hands it the routes listed in
// the hub setting web.routes, after sign-in and every guard, with the person in X-Hub-* headers. Built files live under /_w/ and are
// served by the platform before this code runs.
import handler from '@tanstack/react-start/server-entry';
import { env } from 'cloudflare:workers';
import { HUB_ORIGIN } from './lib/hub';
import { deferEntry } from './lib/defer-entry';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/_w/ping') {
      // Health, and whether this Worker can read the hub's /api through the relay with the caller's session (the server reads depend on
      // it). ?path=/api/... tries another GET route and reports its status and time.
      const path = url.searchParams.get('path') || '/api/hub/nav';
      if (!path.startsWith('/api/')) return Response.json({ ok: false, message: 'path must start with /api/' }, { status: 400 });
      const t0 = Date.now();
      let status = 0;
      let err = '';
      try {
        const r = await fetch(HUB_ORIGIN + path, { headers: { 'X-Hub-Request': '1', 'X-Web-Key': (env as unknown as { WEB_KEY?: string }).WEB_KEY || '', cookie: request.headers.get('cookie') || '' }, signal: AbortSignal.timeout(10000) });
        status = r.status;
      } catch (e) {
        err = String((e as Error).message || e).slice(0, 200);
      }
      return Response.json({ ok: true, at: new Date().toISOString(), path, status, ms: Date.now() - t0, err, nav: path === '/api/hub/nav' ? status : undefined }, { headers: { 'cache-control': 'no-store' } });
    }
    // Only the middleware calls this Worker, and it always names the person. Anything else is refused.
    if (!request.headers.get('X-Hub-Email')) return new Response('Not found', { status: 404 });
    const res = await handler.fetch(request);
    const html = (res.headers.get('content-type') || '').includes('text/html') && !!res.body;
    // A page's scripts start once its stylesheets have arrived (lib/defer-entry.ts), so the two do not share a slow link.
    const out = new Response(html ? deferEntry(res.body!, request.headers.get('cookie') || '') : res.body, res);
    if (html) {
      out.headers.set('Cache-Control', 'private, no-cache');
      out.headers.set('X-Hub-Front', 'web');
    }
    return out;
  },
};
