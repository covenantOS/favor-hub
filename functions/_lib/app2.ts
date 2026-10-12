// The hand-off between the Astro pages and the React app (app/). The middleware asks here before it serves a page.
//
// The React app serves a route only when all of these hold:
//   1. the route is in MIGRATED_ROUTES (shared/app2.ts, what the app has built),
//   2. an admin listed it in the hub setting app2.routes (a comma list, or *),
//   3. the person is in the audience (hub setting app2.audience: admin, the default, or all),
//   4. the person opted in (cookie hub_app2, set by /?app2=1 or POST /api/hub/app2),
//   5. the request is a page load, not a script's fetch (hub-swap.js reads pages with fetch and must keep getting the Astro page).
// Everyone else gets the Astro page, unchanged. Nothing is read from the database for a person without the cookie.
import { APP2_COOKIE, APP2_SETTING_AUDIENCE, APP2_SETTING_ROUTES, parseRoutes, routeServed } from '../../shared/app2';
import type { Env } from './http';
import type { HubUser } from './session';

export type Audience = 'admin' | 'all';

export interface App2Settings {
  routes: string[];
  audience: Audience;
}

/** The two settings, read together. A missing table or row means off. */
export async function readApp2Settings(env: Env): Promise<App2Settings> {
  try {
    const rows = await env.DB.prepare('SELECT key, value FROM hub_settings WHERE key IN (?, ?)')
      .bind(APP2_SETTING_ROUTES, APP2_SETTING_AUDIENCE)
      .all<{ key: string; value: string }>();
    const by = new Map((rows.results || []).map((r) => [r.key, r.value]));
    return { routes: parseRoutes(by.get(APP2_SETTING_ROUTES)), audience: by.get(APP2_SETTING_AUDIENCE) === 'all' ? 'all' : 'admin' };
  } catch {
    return { routes: [], audience: 'admin' };
  }
}

export function inAudience(user: HubUser | null, s: App2Settings): boolean {
  if (!user) return false;
  if (user.via !== 'google' && user.via !== 'password') return false;
  return s.audience === 'all' || user.role === 'admin';
}

export function hasOptInCookie(request: Request): boolean {
  return new RegExp(`(?:^|;\\s*)${APP2_COOKIE}=[^;]+`).test(request.headers.get('Cookie') || '');
}

/** A browser opening the page (not a script reading it). Older browsers without Sec-Fetch headers count when they accept HTML. */
export function isPageLoad(request: Request): boolean {
  if (request.method !== 'GET') return false;
  const dest = request.headers.get('Sec-Fetch-Dest');
  if (dest) return dest === 'document';
  return (request.headers.get('Accept') || '').includes('text/html') && !request.headers.get('X-Hub-Request');
}

/** The cookie: the routes served, readable by the Astro pages' scripts (so a link to a React route loads whole). Not HttpOnly on purpose. */
export function optInCookie(routes: string[], on: boolean): string {
  if (!on) return `${APP2_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
  return `${APP2_COOKIE}=${encodeURIComponent(routes.join('~') || '-')}; Path=/; Max-Age=2592000; Secure; SameSite=Lax`;
}

export type Decision = { kind: 'app' } | { kind: 'redirect'; to: string; cookie: string } | { kind: 'pass' };

/**
 * What to do with this request. `?app2=1` opts in and `?app2=0` opts out (both land on the same path without the parameter).
 * The settings are read only for a person with the cookie, or one using the switch.
 */
export async function decide(env: Env, request: Request, url: URL, user: HubUser | null): Promise<Decision> {
  if (request.method !== 'GET') return { kind: 'pass' };
  const switchParam = url.searchParams.get('app2');
  if (switchParam === '1' || switchParam === '0') {
    if (!user) return { kind: 'pass' };
    const s = await readApp2Settings(env);
    const clean = new URL(url);
    clean.searchParams.delete('app2');
    const to = clean.pathname + clean.search;
    if (switchParam === '1') {
      if (!inAudience(user, s) || !s.routes.length) return { kind: 'redirect', to, cookie: optInCookie([], false) };
      return { kind: 'redirect', to, cookie: optInCookie(s.routes, true) };
    }
    return { kind: 'redirect', to, cookie: optInCookie([], false) };
  }
  // ?classic=1 is the way out for one page load: the app uses it for a page that cannot run inside the frame.
  if (url.searchParams.get('classic') === '1') return { kind: 'pass' };
  if (!user || !hasOptInCookie(request) || !isPageLoad(request)) return { kind: 'pass' };
  const s = await readApp2Settings(env);
  if (!inAudience(user, s) || !routeServed(url.pathname, s.routes)) return { kind: 'pass' };
  return { kind: 'app' };
}

/** The app's page, from the static assets. Never cached by a shared cache: it is only for signed-in people. */
export async function serveApp(env: Env, url: URL): Promise<Response> {
  const res = await env.ASSETS.fetch(new Request(new URL('/_app/', url).toString()));
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'private, no-cache');
  out.headers.set('X-Hub-Front', 'app2');
  return out;
}
