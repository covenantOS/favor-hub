// The hand-off to the FavorOS web app (web/, TanStack Start on the favoros-web Worker). The middleware asks here after sign-in and
// every guard. The web app serves a page only when all of these hold:
//   1. the route is built (WEB_ROUTES in shared/web.ts) and an admin listed it in the hub setting web.routes (a comma list, or *),
//   2. the person is in web.audience: testers (the two test accounts and Will, the default), admin, or all,
//   3. the person has not opted out with ?web=0 (cookie hub_web_off), and the address does not carry ?classic=1,
//   4. the request is a page load (hub-swap.js reads classic pages with fetch and must keep getting them),
//   5. the WEB binding exists (a preview without it keeps every Astro page).
// Everyone else gets the Astro page, unchanged. See the plan: Obsidian Projects/FavorOS React migration plan.md.
import { WEB_COOKIE, WEB_EXACT_ROUTES, WEB_OFF_COOKIE, WEB_ONLY_ROUTES, WEB_OWN_SWITCH, WEB_SETTING_AUDIENCE, WEB_SETTING_ROUTES, parseWebEntries, webServes, type WebAudience, type WebEntry } from '../../shared/web';
import { mayUseMoves } from './moves/access';
import { mayUseOther } from './other-gifts/access';
import { isPageLoad } from './app2';
import { hubSettings } from './admin/hubcache';
import { isTester } from './testuser';
import type { Env } from './http';
import type { HubUser } from './session';

/** Pages the middleware leaves open without sign-in. A signed-in person still gets the web app's version when the route is turned on for them. */
export const WEB_OPEN_PAGES = new Set(['/expenses/review', '/expenses/review/']);

export interface WebSettings {
  routes: WebEntry[];
  audience: WebAudience;
}

const OWNER = 'will@favorintl.org';

/** The two settings, read together from the cached settings. A missing table or row means off. */
export async function readWebSettings(env: Env): Promise<WebSettings> {
  try {
    const by = await hubSettings(env);
    const a = by.get(WEB_SETTING_AUDIENCE)?.value;
    return { routes: parseWebEntries(by.get(WEB_SETTING_ROUTES)?.value), audience: a === 'all' || a === 'admin' ? a : 'testers' };
  } catch {
    return { routes: [], audience: 'testers' };
  }
}

export function inAudience(user: HubUser | null, audience: WebAudience): boolean {
  if (!user) return false;
  if (user.via !== 'google' && user.via !== 'password') return false;
  if (user.role === 'field') return false;
  const email = user.email.toLowerCase();
  if (email === OWNER) return true;
  // A test account gets every route held to testers. A route held to admins follows its role, so a test account set to staff (the way
  // staff-facing checks are run) sees the classic page there, as a real staff member does.
  if (isTester(email)) return audience !== 'admin' || user.role === 'admin';
  if (audience === 'all') return true;
  if (audience === 'admin') return user.role === 'admin';
  return false;
}

/** The listed routes this person gets: each route's own audience (/projects/@all), or the web.audience default. */
export function routesFor(user: HubUser | null, s: WebSettings): string[] {
  return s.routes.filter((e) => inAudience(user, e.audience || s.audience)).map((e) => e.route);
}

/** The default audience only (kept for callers that ask). */
export const inWebAudience = (user: HubUser | null, s: WebSettings): boolean => inAudience(user, s.audience);

export const optedOut = (request: Request): boolean => new RegExp(`(?:^|;\\s*)${WEB_OFF_COOKIE}=1`).test(request.headers.get('Cookie') || '');

export type WebDecision = { kind: 'today' } | { kind: 'web'; routes: string[] } | { kind: 'switch'; to: string; cookie: string } | { kind: 'pass'; routes: string[] };

/**
 * What to do with a signed-in page request. `?web=0` opts this person out (every page from Astro) and `?web=1` back in; both land on
 * the same address without the parameter. `routes` in a pass is what this person would get from the web app, for the hub_web cookie.
 */
export async function decideWeb(env: Env, request: Request, url: URL, user: HubUser | null): Promise<WebDecision> {
  if (request.method !== 'GET' || !user) return { kind: 'pass', routes: [] };
  const sw = url.searchParams.get('web');
  if (sw === '0' || sw === '1') {
    const clean = new URL(url);
    clean.searchParams.delete('web');
    const cookie = sw === '0' ? `${WEB_OFF_COOKIE}=1; Path=/; Max-Age=2592000; Secure; SameSite=Lax` : `${WEB_OFF_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
    return { kind: 'switch', to: clean.pathname + clean.search, cookie };
  }
  if (!env.WEB) return { kind: 'pass', routes: [] };
  // A route with its own switch (Other gifts, hub setting gifts.other) is served to whoever that setting allows, with no web.routes entry.
  const own = user.role === 'field' ? [] : await ownRoutesFor(env, user);
  const s = await readWebSettings(env);
  // A page with no Astro twin cannot fall back, so it ignores the opt-out. It still follows its audience (its entry, else web.audience):
  // a person outside it is sent to Today. List a page open to staff as @all.
  const listed = s.routes.map((e) => e.route);
  const signedIn = user.role !== 'field' && (user.via === 'google' || user.via === 'password');
  const asked = listed.length > 0 && webServes(url.pathname, WEB_ONLY_ROUTES) && webServes(url.pathname, listed) && signedIn;
  const mine = routesFor(user, s);
  const only = asked && webServes(url.pathname, mine);
  if (asked && !only && isPageLoad(request)) return { kind: 'today' };
  const onlyMine = user.role === 'field' ? [] : mine.filter((r) => webServes(r, WEB_ONLY_ROUTES));
  const out = optedOut(request);
  // `routes` is every route this person gets from the web app. The web page carries it back in the hub_web cookie, so a link inside the web
  // app moves in the app only to a route that is on for this person, and a route held to testers or admins never opens for anyone else.
  const routes = out ? onlyMine : [...new Set([...routesFor(user, s), ...onlyMine, ...own])];
  if (only && url.searchParams.get('classic') !== '1' && isPageLoad(request)) return { kind: 'web', routes: routes.length ? routes : onlyMine };
  if (out) return { kind: 'pass', routes: onlyMine };
  if (!routes.length) return { kind: 'pass', routes: [] };
  if (url.searchParams.get('classic') === '1' || !isPageLoad(request) || !webServes(url.pathname, routes)) return { kind: 'pass', routes };
  return { kind: 'web', routes };
}

/** The own-switch routes this person may open: their setting is on for them. */
async function ownRoutesFor(env: Env, user: HubUser): Promise<string[]> {
  const out: string[] = [];
  for (const route of Object.keys(WEB_OWN_SWITCH)) {
    if (route === '/gifts/other/' && (await mayUseOther(env, user).catch(() => false))) out.push(route);
    if (route === '/moves/' && (await mayUseMoves(env, user).catch(() => false))) out.push(route);
  }
  return out;
}

/** The cookie classic pages read (hub-swap.js) so a link to a web route loads the page whole instead of swapping the Astro body in. */
export function webCookie(routes: string[]): string {
  if (!routes.length) return `${WEB_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
  // An exact route carries a $ so hub-swap.js loads only that address whole (/gifts/$ leaves /gifts/letters/ to swap in as before).
  const list = routes.map((r) => ((WEB_EXACT_ROUTES as readonly string[]).includes(r) ? r + '$' : r));
  return `${WEB_COOKIE}=${encodeURIComponent(list.join('~'))}; Path=/; Max-Age=86400; Secure; SameSite=Lax`;
}

/** Hand the request (with the X-Hub-* person headers the middleware set) to the web app. */
export async function serveWeb(env: Env, forwarded: Request): Promise<Response> {
  const res = await env.WEB!.fetch(forwarded);
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'private, no-cache');
  out.headers.set('X-Hub-Front', 'web');
  return out;
}

