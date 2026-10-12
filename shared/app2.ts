// The routes the React app serves, in one place. The Pages middleware (functions/_lib/app2.ts) and the app's router both read this list.
// A route only reaches people when an admin lists it in the hub setting app2.routes AND the person opted in (cookie hub_app2).
// Every other path keeps serving the Astro page it always did.
export const MIGRATED_ROUTES = ['/'] as const;

export type MigratedRoute = (typeof MIGRATED_ROUTES)[number];

export const APP2_COOKIE = 'hub_app2';
export const APP2_SETTING_ROUTES = 'app2.routes';
export const APP2_SETTING_AUDIENCE = 'app2.audience';

/** "/chat" and "/chat/" are the same route; "/" stays "/". */
export function normalizeRoute(path: string): string {
  const p = path.split('?')[0].split('#')[0] || '/';
  return p.length > 1 ? p.replace(/\/+$/, '') + '/' : '/';
}

/** The routes an admin turned on: a comma list, or * for every migrated route. Unknown routes are dropped. */
export function parseRoutes(value: string | null | undefined): string[] {
  const v = String(value || '').trim();
  if (!v) return [];
  const all = MIGRATED_ROUTES.map((r) => normalizeRoute(r));
  if (v === '*') return all;
  const asked = new Set(v.split(',').map((s) => normalizeRoute(s.trim())).filter(Boolean));
  return all.filter((r) => asked.has(r));
}

/** "/" matches only itself. Any other listed route also owns the paths under it (/chat/ owns /chat/general). */
export function routeServed(path: string, routes: string[]): boolean {
  const p = normalizeRoute(path);
  return routes.some((r) => (r === '/' ? p === '/' : p === r || p.startsWith(r)));
}
