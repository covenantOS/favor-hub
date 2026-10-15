// The POC Worker. Start renders the routes it owns (/projects/). Hub assets and /api reads go to production with the caller's
// cookie, read only. Every other page redirects to the live hub, the way the strangler front sends unported routes to Astro.
import handler from '@tanstack/react-start/server-entry';

const HUB = 'https://dash.favorintl.org';
const OWNED = new Set(['/projects/', '/projects']);
const PASS = /^\/(api|fonts|images|js|css|sw\.js$|manifest\.webmanifest$|version\.json$|favicon)/;

export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/_serverFn') || url.pathname.startsWith('/_server')) return handler.fetch(request, env as never, ctx as never);
    if (PASS.test(url.pathname)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return Response.json({ ok: false, message: 'The preview is read only.' }, { status: 403 });
      const h = new Headers(request.headers);
      h.delete('host');
      const res = await fetch(HUB + url.pathname + url.search, { headers: h, redirect: 'manual' });
      const out = new Response(res.body, res);
      out.headers.delete('set-cookie');
      return out;
    }
    if (url.pathname === '/') return Response.redirect(url.origin + '/projects/', 302);
    if (!OWNED.has(url.pathname)) return Response.redirect(HUB + url.pathname + url.search, 302);
    if (!/(?:^|;\s*)favor_hub_session=/.test(request.headers.get('cookie') || ''))
      return new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>FavorOS preview</title><p style="font:16px system-ui;margin:32px">This preview reads FavorOS with a FavorOS session. It has none, so there is nothing to show.</p>', { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } });
    return handler.fetch(request, env as never, ctx as never);
  },
};
