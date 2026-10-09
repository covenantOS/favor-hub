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
// that scripts use (it checks the password itself).
const OPEN_PREFIXES = ['/api/auth/', '/api/agent/'];
const OPEN_PATHS = new Set([
  '/login',
  '/login/',
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
  const open = OPEN_PATHS.has(path) || OPEN_PREFIXES.some((p) => path.startsWith(p));

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
