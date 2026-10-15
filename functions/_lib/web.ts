// The hand-off to the FavorOS web app (web/, TanStack Start on the favoros-web Worker). The middleware asks here after sign-in and
// every guard. The web app serves a page only when all of these hold:
//   1. the route is built (WEB_ROUTES in shared/web.ts) and an admin listed it in the hub setting web.routes (a comma list, or *),
//   2. the person is in web.audience: testers (the two test accounts and Will, the default), admin, or all,
//   3. the person has not opted out with ?web=0 (cookie hub_web_off), and the address does not carry ?classic=1,
//   4. the request is a page load (hub-swap.js reads classic pages with fetch and must keep getting them),
//   5. the WEB binding exists (a preview without it keeps every Astro page).
// Everyone else gets the Astro page, unchanged. See the plan: Obsidian Projects/FavorOS React migration plan.md.
import { WEB_COOKIE, WEB_OFF_COOKIE, WEB_SETTING_AUDIENCE, WEB_SETTING_ROUTES, parseWebRoutes, webServes, type WebAudience } from '../../shared/web';
import { isPageLoad } from './app2';
import { hubSettings } from './admin/hubcache';
import { isTester } from './testuser';
import type { Env } from './http';
import type { HubUser } from './session';

export interface WebSettings {
  routes: string[];
  audience: WebAudience;
}

const OWNER = 'will@favorintl.org';

/** The two settings, read together from the cached settings. A missing table or row means off. */
export async function readWebSettings(env: Env): Promise<WebSettings> {
  try {
    const by = await hubSettings(env);
    const a = by.get(WEB_SETTING_AUDIENCE)?.value;
    return { routes: parseWebRoutes(by.get(WEB_SETTING_ROUTES)?.value), audience: a === 'all' || a === 'admin' ? a : 'testers' };
  } catch {
    return { routes: [], audience: 'testers' };
  }
}

export function inWebAudience(user: HubUser | null, s: WebSettings): boolean {
  if (!user) return false;
  if (user.via !== 'google' && user.via !== 'password') return false;
  if (user.role === 'field') return false;
  const email = user.email.toLowerCase();
  if (s.audience === 'all') return true;
  if (s.audience === 'admin') return user.role === 'admin';
  return isTester(email) || email === OWNER;
}

export const optedOut = (request: Request): boolean => new RegExp(`(?:^|;\\s*)${WEB_OFF_COOKIE}=1`).test(request.headers.get('Cookie') || '');

export type WebDecision = { kind: 'web' } | { kind: 'switch'; to: string; cookie: string } | { kind: 'pass'; routes: string[] };

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
  const s = await readWebSettings(env);
  if (!s.routes.length || !inWebAudience(user, s) || optedOut(request)) return { kind: 'pass', routes: [] };
  if (url.searchParams.get('classic') === '1' || !isPageLoad(request) || !webServes(url.pathname, s.routes)) return { kind: 'pass', routes: s.routes };
  return { kind: 'web' };
}

/** The cookie classic pages read (hub-swap.js) so a link to a web route loads the page whole instead of swapping the Astro body in. */
export function webCookie(routes: string[]): string {
  if (!routes.length) return `${WEB_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
  return `${WEB_COOKIE}=${encodeURIComponent(routes.join('~'))}; Path=/; Max-Age=86400; Secure; SameSite=Lax`;
}

/** Hand the request (with the X-Hub-* person headers the middleware set) to the web app. */
export async function serveWeb(env: Env, forwarded: Request): Promise<Response> {
  const res = await env.WEB!.fetch(forwarded);
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'private, no-cache');
  out.headers.set('X-Hub-Front', 'web');
  return out;
}

/**
 * The web app's server reads: an /api GET on the Pages address carrying the shared key. A Worker's fetch to dash.favorintl.org
 * (its own zone) times out (522), so the Worker reads favor-hub-d4n.pages.dev instead, with the visitor's own cookie. Only GETs
 * to /api pass, and only with the key, so people still land on the one address Google sign-in accepts.
 */
export function webServerRead(env: Env, request: Request, url: URL): boolean {
  const key = env.WEB_KEY;
  if (!key || key.length < 24) return false;
  if (request.method !== 'GET' || !url.pathname.startsWith('/api/')) return false;
  return request.headers.get('X-Web-Key') === key;
}
