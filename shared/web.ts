// The routes the FavorOS web app (web/, TanStack Start on the favoros-web Worker) has built, in one place. The Pages middleware
// (functions/_lib/web.ts), the classic swap script and the web app's links all read it. A route reaches people only when an admin
// lists it in the hub setting web.routes AND the person is in web.audience. Everything else keeps its Astro page.
import { normalizeRoute } from './app2';

export const WEB_ROUTES = ['/web-check/', '/gifts/recurring/'] as const;

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
  const all = WEB_ROUTES.map((r) => normalizeRoute(r));
  if (v === '*') return all;
  const asked = new Set(v.split(',').map((s) => normalizeRoute(s.trim())).filter(Boolean));
  return all.filter((r) => asked.has(r));
}

/** "/" matches only itself. Any other route owns the paths under it (/projects/ owns /projects/p/). */
export function webServes(path: string, routes: readonly string[]): boolean {
  const p = normalizeRoute(path);
  return routes.some((r) => (r === '/' ? p === '/' : p === r || p.startsWith(r)));
}
