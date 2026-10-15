// Early access (hub setting early_access, a list of emails and teams): the people who see features still in Alpha or Beta, and the
// apps held back from staff for now (Meetings, Chat, Mail, Clips). Admins always see them. Everyone else does not get them in the rail,
// tabs, Ctrl K, the tour or What's new, and a direct address sends them to Today.
import { RELEASE, pageKey } from './release';

/** Areas that stay open to all staff whatever their badge: the daily work and the core pages moved to React. */
export const OPEN_AREAS = new Set(['today', 'partners', 'gifts', 'projects', 'ask', 'staff', 'kpi', 'admin', 'help']);
/** Areas held to Early access whole. */
export const EARLY_AREAS = new Set(['meet', 'chat', 'mail']);
/** Single pages held to Early access whatever their badge. */
export const EARLY_PAGES = new Set(['partners-moves', 'partners-datacare', 'other-gifts', 'partners-grants', 'first-gifts', 'recurring', 'reporting']);

/** True when a page (by id, inside an area by id) is for Early access only. Reads the built-in badges. */
export function earlyOnly(areaId: string, pageId: string): boolean {
  if (pageId === 'clips') return false;
  if (EARLY_AREAS.has(areaId) || EARLY_PAGES.has(pageId)) return true;
  const own = RELEASE[pageKey(pageId)];
  if (own === 'alpha' || own === 'beta') return true;
  if (!OPEN_AREAS.has(areaId)) {
    const a = RELEASE[areaId];
    return a === 'alpha' || a === 'beta';
  }
  return false;
}

/** The addresses of pages held to Early access whole (a path another open page also uses is left out). Trailing slash, no query. */
export function earlyPaths(areas: Array<{ pages: Array<{ href: string; early?: boolean; ext?: boolean }> }>): Set<string> {
  const norm = (h: string) => h.split('?')[0].replace(/\/?$/, '/');
  const open = new Set<string>();
  const held = new Set<string>();
  for (const a of areas) for (const p of a.pages) if (!p.ext) (p.early ? held : open).add(norm(p.href));
  for (const o of open) held.delete(o);
  return held;
}
