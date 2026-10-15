// Every request to the hub passes through here. With sign-in on, a page asks for Google sign-in
// first and an API call without a user gets 401. Whoever is signed in reaches the functions as
// X-Hub-* headers (see _lib/session.ts).
import { json, type Env } from './_lib/http';
import { crossSiteWrite, resolveUser, signinEnforced, withUserHeaders } from './_lib/session';
import { REDIRECTS } from '../src/data/areas';
import { countAiCalls, withAiCaller } from './_lib/admin/aiuse';
import { fieldMayOpen } from './_lib/field';
import { decide, serveApp } from './_lib/app2';
import { decideWeb, serveWeb, webCookie } from './_lib/web';
import { TESTER_REFUSAL, isTester, testerWriteBlocked } from './_lib/testuser';
import { noteUse } from './_lib/hub/usage';
import { withAssetCache } from './_lib/assetcache';
import { honorSavedCookie, withHubWrites } from './_lib/admin/hubcache';

const CANONICAL_HOST = 'dash.favorintl.org';
// The alias and the bare Pages address send people to the one address Google sign-in accepts.
const REDIRECT_HOSTS = new Set(['hub.favorintl.org', 'favor-hub-d4n.pages.dev']);

// Files the sign-in page itself needs, and files with nothing private in them.
// /_app/ holds the React app's built files (app/, served by functions/_lib/app2.ts for people who opted in).
const STATIC_PREFIXES = ['/_astro/', '/_app/assets/', '/_app/islands/', '/_w/', '/images/', '/js/', '/css/', '/fonts/', '/receipts/fonts/'];
const STATIC_FILES = new Set(['/robots.txt', '/favicon.ico', '/receipts/paper-front.jpg', '/manifest.webmanifest', '/apple-touch-icon.png', '/version.json', '/sw.js', '/m/manifest.webmanifest']);

// Open without sign-in: the sign-in page and its API, the approver's emailed review link (its token
// is the key), the agent queue (it checks the agent key itself), and the admin password sign-in
// that scripts use (it checks the password itself), and the service doors the Favor Brain calls with
// the shared key (each checks the key itself).
const OPEN_PREFIXES = ['/api/auth/', '/api/agent/', '/api/service/', '/api/meet-guest/', '/api/book/', '/api/asana/hook/'];
const OPEN_PATHS = new Set([
  '/login',
  '/login/',
  // Google connect and its callback check the person themselves and send a signed-out one to sign-in with
  // the page they asked for (functions/api/google/*.ts). Without this, a lost session returned raw JSON.
  '/api/google/connect',
  '/api/google/callback',
  // Asana sends a person back here after Connect Asana; the signed state names them (functions/_lib/projects/sync-oauth.ts).
  '/api/asana/oauth/callback',
  '/meet/g',
  '/meet/g/',
  // Booking pages for partners (meetbook.ts) and a repeating meeting's one link, which forwards to the room or the guest door.
  '/meet/with',
  '/meet/with/',
  '/meet/s',
  '/meet/s/',
  '/expenses/review',
  '/expenses/review/',
  '/chat-email/off',
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

const NAV_MOVED = new Map(REDIRECTS);

// A clip's share page and its video are reachable without sign-in at the middleware; each decides for
// itself by the clip's share switch (functions/c/[id].ts, functions/api/clips/[id]/media.ts).
const CLIP_OPEN = /^\/(c\/[0-9a-f]{32}\/?|api\/clips\/[0-9a-f]{32}\/(media|info|views))$/;

function isHtml(res: Response): boolean {
  return (res.headers.get('Content-Type') || '').includes('text/html');
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  // Who is asking, for the AI budget guard: filled in once the user is known.
  const who = { tester: false, closed: false };
  honorSavedCookie(ctx.request.headers.get('Cookie'));
  return withAiCaller(who, () => withHubWrites(() => handle(ctx, who)));
};

const handle = async (ctx: Parameters<PagesFunction<Env>>[0], who: { tester: boolean; closed: boolean }): Promise<Response> => {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const path = url.pathname;
  const enforce = signinEnforced(env);
  countAiCalls(env);

  if (enforce && REDIRECT_HOSTS.has(url.hostname)) {
    url.protocol = 'https:';
    url.hostname = CANONICAL_HOST;
    url.port = '';
    const method = request.method.toUpperCase();
    return Response.redirect(url.toString(), method === 'GET' || method === 'HEAD' ? 301 : 308);
  }

  if (RETIRED[path]) return Response.redirect(new URL(RETIRED[path], url).toString(), 301);
  // Short and older addresses from the navigation registry (src/data/areas.ts) land on the page they became.
  const bare = path.length > 1 ? path.replace(/\/$/, '') : path;
  // An old request link (/requests/?r=<id>, in emails, Chat cards and notices) opens that request in Projects.
  const asked = bare === '/requests' ? url.searchParams.get('r') : null;
  if (asked && /^[A-Za-z0-9_-]{4,80}$/.test(asked)) return Response.redirect(new URL(`/projects/?r=${asked}`, url).toString(), 301);
  const moved = NAV_MOVED.get(bare);
  if (moved) return Response.redirect(new URL(moved + (moved.includes('?') ? '' : url.search), url).toString(), 301);

  // The web app's built files (hashed, nothing private) come from its Worker.
  if (path.startsWith('/_w/') && env.WEB) {
    const res = await env.WEB.fetch(request);
    return res.ok ? withAssetCache(res, path, url) : res;
  }

  if (STATIC_FILES.has(path) || STATIC_PREFIXES.some((p) => path.startsWith(p))) {
    const res = await ctx.next();
    return res.ok ? withAssetCache(res, path, url) : res;
  }

  let user = null;
  try {
    user = await resolveUser(env, request);
  } catch (err) {
    console.error('[signin] resolve', err);
  }
  if (user && isTester(user.email)) {
    who.tester = true;
    who.closed = /(?:^|;\s*)hub_ai_closed=1/.test(request.headers.get('Cookie') || '');
  }
  const forwarded = withUserHeaders(request, user);
  const open = OPEN_PATHS.has(path) || CLIP_OPEN.test(path) || OPEN_PREFIXES.some((p) => path.startsWith(p));

  // Field staff (a partner domain an admin allowed, approved one by one) reach Chat, Meetings and Favor Brain and nothing else.
  if (enforce && user && user.role === 'field' && !open && !fieldMayOpen(path)) {
    if (path.startsWith('/api/')) return json({ ok: false, error: 'forbidden', message: 'That is not part of the field staff app.' }, 403);
    return Response.redirect(new URL('/chat/', url).toString(), 302);
  }

  // A change made with the browser's sign-in cookie must come from a FavorOS page. Every *.favorintl.org site shares the cookie's
  // SameSite scope, so a page on another Favor site could otherwise post here as the person signed in. Scripts with a key are exempt.
  if (user && !open && crossSiteWrite(request, url, user.via)) {
    return json({ ok: false, error: 'cross_site', message: 'That change did not come from a FavorOS page. Reload the page and try again.' }, 403);
  }

  // The FavorOS Tester never writes to Blackbaud, sends email or notifies a person (functions/_lib/testuser.ts).
  if (user && testerWriteBlocked(user.email, request.method, path)) {
    return json({ ok: false, error: 'test_user', message: TESTER_REFUSAL }, 403);
  }

  // Google is part of signing in: a person with no connected Google account goes to Google's consent
  // screen before any page opens, and that one screen asks for everything FavorOS uses. A cookie set
  // when they connect saves the lookup on later pages. Scripts and the admin password are exempt.
  let setGc = false;
  if (enforce && user && user.via === 'google' && !isTester(user.email) && user.role !== 'field' && !path.startsWith('/api/') && !open && !path.startsWith('/connect')) {
    const marked = /(?:^|;\s*)hub_gc=1/.test(request.headers.get('Cookie') || '');
    if (!marked) {
      const row = await env.DB.prepare('SELECT 1 AS ok FROM hub_google WHERE email = ?').bind(user.email).first().catch(() => ({ ok: 1 }));
      if (!row) return Response.redirect(new URL('/api/google/connect?next=' + encodeURIComponent(path + url.search), url).toString(), 302);
      setGc = true;
    }
  }
  // The connected-Google cookie rides on whichever page answers, classic or web.
  const withGc = (res: Response): Response => {
    if (!setGc) return res;
    const out = new Response(res.body, res);
    if (isHtml(res)) out.headers.set('Cache-Control', 'private, no-cache');
    out.headers.append('Set-Cookie', 'hub_gc=1; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax');
    return out;
  };

  let webRoutes: string[] | null = null;
  if (user && !open && !path.startsWith('/api/')) {
    // The web app (web/, the favoros-web Worker) takes a route an admin turned on, for the people in its audience.
    const w = await decideWeb(env, request, url, user).catch((err) => { console.error('[web]', err); return { kind: 'pass', routes: [] as string[] } as const; });
    if (w.kind === 'switch') return new Response(null, { status: 302, headers: { Location: new URL(w.to, url).toString(), 'Set-Cookie': w.cookie, 'Cache-Control': 'no-store' } });
    if (w.kind === 'web') {
      if (enforce) noteUse(ctx, user, request.method, path);
      return withGc(await serveWeb(env, forwarded));
    }
    webRoutes = w.routes;
    // The React app takes a page only for an admin-enabled route and a person who opted in; any other page falls through unchanged.
    const d = await decide(env, request, url, user).catch((err) => { console.error('[app2]', err); return { kind: 'pass' } as const; });
    if (d.kind === 'redirect') return new Response(null, { status: 302, headers: { Location: new URL(d.to, url).toString(), 'Set-Cookie': d.cookie, 'Cache-Control': 'no-store' } });
    if (d.kind === 'app') return serveApp(env, url);
  }

  if (user || open || !enforce) {
    // Adoption tracker: one cheap write per person, day and area, after the page has gone out (functions/_lib/hub/usage.ts).
    if (user && !open && enforce) noteUse(ctx, user, request.method, path);
    const res = withGc(await ctx.next(forwarded));
    if (!enforce || open || !isHtml(res)) return res;
    // A signed-in page must not sit in a shared cache.
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'private, no-cache');
    // Classic pages learn which routes the web app serves this person, so a link there loads whole (hub-swap.js).
    if (webRoutes) out.headers.append('Set-Cookie', webCookie(webRoutes));
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
