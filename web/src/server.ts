// The FavorOS web Worker. It has no public address: the Pages middleware (functions/_middleware.ts) hands it the routes listed in
// the hub setting web.routes, after sign-in and every guard, with the person in X-Hub-* headers. Built files live under /_w/ and are
// served by the platform before this code runs.
import handler from '@tanstack/react-start/server-entry';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/_w/ping') return Response.json({ ok: true, at: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } });
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
