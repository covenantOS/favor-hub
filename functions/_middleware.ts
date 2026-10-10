// Every request to the hub passes through here. With sign-in on, a page asks for Google sign-in
// first and an API call without a user gets 401. Whoever is signed in reaches the functions as
// X-Hub-* headers (see _lib/session.ts).
import { json, type Env } from './_lib/http';
import { resolveUser, signinEnforced, withUserHeaders } from './_lib/session';

const CANONICAL_HOST = 'dash.favorintl.org';
// The alias and the bare Pages address send people to the one address Google sign-in accepts.
const REDIRECT_HOSTS = new Set(['hub.favorintl.org', 'favor-hub-d4n.pages.dev']);

// Files the sign-in page itself needs, and files with nothing private in them.
const STATIC_PREFIXES = ['/_astro/', '/images/', '/js/', '/fonts/', '/receipts/fonts/'];
const STATIC_FILES = new Set(['/robots.txt', '/favicon.ico', '/receipts/paper-front.jpg']);

// Open without sign-in: the sign-in page and its API, the approver's emailed review link (its token
// is the key), the agent queue (it checks the agent key itself), and the admin password sign-in
// that scripts use (it checks the password itself), and the service doors the Favor Brain calls with
// the shared key (each checks the key itself).
const OPEN_PREFIXES = ['/api/auth/', '/api/agent/', '/api/service/', '/api/meet-guest/'];
const OPEN_PATHS = new Set([
  '/login',
  '/login/',
  '/meet/g',
  '/meet/g/',
  '/expenses/review',
  '/expenses/review/',
  '/api/expenses/review',
  '/api/admin/login',
  '/api/admin/logout',
]);

// Pages that were retired on 2026-10-08. Their numbers live in the KPI dashboard's own tabs now.
const RETIRED: Record<string, string> = {
  '/rdd': '/dashboard/?page=%2Frdds',
  '/rdd/': '/dashboard/?page=%2Frdds',
  '/newsletter-analytics': '/dashboard/?page=%2Fmarketing',
  '/newsletter-analytics/': '/dashboard/?page=%2Fmarketing',
};

// A clip's share page and its video are reachable without sign-in at the middleware; each decides for
// itself by the clip's share switch (functions/c/[id].ts, functions/api/clips/[id]/media.ts).
const CLIP_OPEN = /^\/(c\/[0-9a-f]{32}\/?|api\/clips\/[0-9a-f]{32}\/(media|info|views))$/;

function isHtml(res: Response): boolean {
  return (res.headers.get('Content-Type') || '').includes('text/html');
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const path = url.pathname;
  const enforce = signinEnforced(env);

  if (enforce && REDIRECT_HOSTS.has(url.hostname)) {
    url.protocol = 'https:';
    url.hostname = CANONICAL_HOST;
    url.port = '';
    const method = request.method.toUpperCase();
    return Response.redirect(url.toString(), method === 'GET' || method === 'HEAD' ? 301 : 308);
  }

  if (RETIRED[path]) return Response.redirect(new URL(RETIRED[path], url).toString(), 301);

  if (STATIC_FILES.has(path) || STATIC_PREFIXES.some((p) => path.startsWith(p))) return ctx.next();

  let user = null;
  try {
    user = await resolveUser(env, request);
  } catch (err) {
    console.error('[signin] resolve', err);
  }
  const forwarded = withUserHeaders(request, user);
  const open = OPEN_PATHS.has(path) || CLIP_OPEN.test(path) || OPEN_PREFIXES.some((p) => path.startsWith(p));

  // Google is part of signing in: a person with no connected Google account goes to Google's consent
  // screen before any page opens (calendar, Drive file names, mail headers; read-only). A cookie set
  // when they connect saves the lookup on later pages. Scripts and the admin password are exempt.
  if (enforce && user && user.via === 'google' && !path.startsWith('/api/') && !open && !path.startsWith('/connect')) {
    const marked = /(?:^|;\s*)hub_gc=1/.test(request.headers.get('Cookie') || '');
    if (!marked) {
      const row = await env.DB.prepare('SELECT 1 AS ok FROM hub_google WHERE email = ?').bind(user.email).first().catch(() => ({ ok: 1 }));
      if (!row) return Response.redirect(new URL('/api/google/connect?next=' + encodeURIComponent(path + url.search), url).toString(), 302);
      const res = await ctx.next(forwarded);
      const out = new Response(res.body, res);
      if (isHtml(res)) out.headers.set('Cache-Control', 'private, no-cache');
      out.headers.append('Set-Cookie', 'hub_gc=1; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax');
      return out;
    }
  }

  if (user || open || !enforce) {
    const res = await ctx.next(forwarded);
    if (!enforce || open || !isHtml(res)) return res;
    // A signed-in page must not sit in a shared cache.
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'private, no-cache');
    return out;
  }

  if (path.startsWith('/api/')) {
    return json({ ok: false, error: 'signin', message: 'Sign in with your Favor Google account first.' }, 401);
  }
  const next = path + url.search;
  const login = new URL('/login/', url);
  if (next !== '/') login.searchParams.set('next', next);
  return Response.redirect(login.toString(), 302);
};
