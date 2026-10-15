// The routes the FavorOS web app (web/, TanStack Start on the favoros-web Worker) has built, in one place. The Pages middleware
// (functions/_lib/web.ts), the classic swap script and the web app's links all read it. A route reaches people only when an admin
// lists it in the hub setting web.routes AND the person is in web.audience. Everything else keeps its Astro page.
import { normalizeRoute } from './app2';

export const WEB_ROUTES = ['/web-check/', '/gifts/recurring/', '/churches/', '/data-care/', '/gifts/other/', '/admin/goals/'] as const;

/** Routes that have no Astro page. Anyone signed in who may use the hub gets them once an admin lists them in web.routes, whatever the audience. */
export const WEB_ONLY_ROUTES = ['/churches/', '/data-care/'] as const;

/**
 * Routes that carry their own switch. The hub setting named here decides who gets the page (off, admins or on), so turning the feature on is one
 * change and never needs web.routes or web.audience. Will and the two test accounts always get it. Everything else keeps its Astro page.
 */
export const WEB_OWN_SWITCH: Record<string, string> = { '/gifts/other/': 'gifts.other' };

export const WEB_SETTING_ROUTES = 'web.routes';
export const WEB_SETTING_AUDIENCE = 'web.audience';
/** Readable by classic scripts: the routes this person gets from the web app, joined with ~, so hub-swap.js loads them whole. */
export const WEB_COOKIE = 'hub_web';
/** Set by ?web=0 for one person: every page from Astro until ?web=1. */
export const WEB_OFF_COOKIE = 'hub_web_off';

export type WebAudience = 'testers' | 'admin' | 'all';

/** The routes an admin turned on: a comma list, or * for every built route. Unknown routes are dropped. */
export function parseWebRoutes(value: string | null | undefined): string[] {
  const v = String(value || '').trim();
  if (!v) return [];
  // A route with its own switch is never turned on from web.routes, not even by *.
  const all = WEB_ROUTES.filter((r) => !WEB_OWN_SWITCH[r]).map((r) => normalizeRoute(r));
  if (v === '*') return all;
  const asked = new Set(v.split(',').map((s) => normalizeRoute(s.trim())).filter(Boolean));
  return all.filter((r) => asked.has(r));
}

/** "/" matches only itself. Any other route owns the paths under it (/projects/ owns /projects/p/). */
export function webServes(path: string, routes: readonly string[]): boolean {
  const p = normalizeRoute(path);
  return routes.some((r) => (r === '/' ? p === '/' : p === r || p.startsWith(r)));
}

/** The own-switch route this path belongs to, if any. */
export function ownSwitchRoute(path: string): string | null {
  const p = normalizeRoute(path);
  return Object.keys(WEB_OWN_SWITCH).find((r) => p === normalizeRoute(r) || p.startsWith(normalizeRoute(r))) ?? null;
}
