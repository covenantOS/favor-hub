// The FavorOS web app's server reads. A Worker reached through the Pages service binding cannot fetch the Pages project back
// (Cloudflare answers 522 to that loop), so the favoros-web Worker reads /api through this relay. It forwards GETs under /api/ to
// dash.favorintl.org with the visitor's own cookie, so every sign-in and privacy rule applies unchanged. It answers only callers
// that carry the shared key (WEB_KEY, the same secret the favoros-web Worker holds), and never forwards a write.
interface Env {
  WEB_KEY?: string;
}

const HUB = 'https://dash.favorintl.org';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const key = env.WEB_KEY || '';
    if (key.length < 24 || request.headers.get('X-Web-Key') !== key) return new Response('Not found', { status: 404 });
    if (request.method !== 'GET' || !url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    const headers: Record<string, string> = { 'X-Hub-Request': '1', accept: request.headers.get('accept') || 'application/json' };
    const cookie = request.headers.get('cookie');
    if (cookie) headers.cookie = cookie;
    const res = await fetch(HUB + url.pathname + url.search, { headers, redirect: 'manual' });
    const out = new Response(res.body, res);
    out.headers.delete('set-cookie');
    out.headers.set('cache-control', 'no-store');
    return out;
  },
};
