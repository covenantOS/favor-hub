// Release badges: Alpha, Beta or New beside an area or page in the menu, the page header and the help article title.
// One map below. A key is an area id or a page id from src/data/areas.ts, `help:<slug>` for one help article, or `lite`
// for the Data saver item. A page's own badge wins over its area's. Admins change a badge without a deploy in
// Admin > Settings > People (hub_settings release.badges, a JSON object such as {"projects":"beta","ask":"none"});
// /api/hub/nav sends that object to every page as `release`.
import type { NavArea } from './areas';

export type Badge = 'alpha' | 'beta' | 'new';
export type BadgeOverrides = Record<string, Badge | 'none'>;

export const BADGE_LABEL: Record<Badge, string> = { alpha: 'Alpha', beta: 'Beta', new: 'New' };
export const BADGE_TITLE: Record<Badge, string> = {
  alpha: 'Alpha: built in the last few days. Expect changes and tell us what breaks.',
  beta: 'Beta: in daily use and still changing.',
  new: 'New this week.',
};

export const RELEASE: Record<string, Badge | 'none'> = {
  // Areas. The Work area split on 2026-10-14: Partners and Gifts in daily use (Beta), Projects and Staff new (Alpha).
  partners: 'beta',
  gifts: 'beta',
  projects: 'alpha', // Synced with Asana
  staff: 'alpha',
  meet: 'alpha', // Meetings: calendar, scheduling, booking pages, series, notes
  chat: 'alpha',
  mail: 'alpha',
  ask: 'beta', // Favor Brain
  today: 'beta',
  kpi: 'none', // Reporting carries no badge (Will, 2026-10-14)
  // Pages whose stage differs from their area's: a dot on the tab, the word beside the page's title.
  clips: 'none', // fully released (Will, 2026-10-14), so it does not take the Meetings badge
  board: 'none', // Requests: in use since the spring, so it does not take the Projects badge
  'online-gifts': 'alpha',
  statements: 'alpha',
  lists: 'alpha',
  'list-reports': 'alpha',
  'list-credit': 'alpha',
  welcome: 'alpha',
  lite: 'alpha',
};

const VALID = new Set(['alpha', 'beta', 'new', 'none']);

/** Keeps only well-formed entries of an admin's saved JSON. */
export function parseOverrides(raw: unknown): BadgeOverrides {
  let o: unknown = raw;
  if (typeof raw === 'string') {
    try {
      o = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  const out: BadgeOverrides = {};
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const val = String(v).toLowerCase();
    if (k && VALID.has(val)) out[k] = val as Badge | 'none';
  }
  return out;
}

function own(key: string, ov: BadgeOverrides): Badge | null {
  const v = key in ov ? ov[key] : RELEASE[key];
  return !v || v === 'none' ? null : v;
}

/** The badge for one key on its own (an area link, the Data saver item). */
export function badgeFor(key: string, ov: BadgeOverrides = {}): Badge | null {
  return own(key, ov);
}

/** Page ids that are also area ids get their own key, so a page badge never lands on the whole area. */
const PAGE_KEY: Record<string, string> = { work: 'work-center', meet: 'meet-calendar', chat: 'chat-page', mail: 'mail-page', learn: 'learn-mine', kpi: 'kpi-executive', projects: 'projects-page' };
export const pageKey = (pageId: string) => PAGE_KEY[pageId] || pageId;

/** A page's badge: its own, else its area's. */
export function pageBadge(pageId: string, areaId: string, ov: BadgeOverrides = {}): Badge | null {
  const k = pageKey(pageId);
  if (k in ov || RELEASE[k]) return own(k, ov);
  return own(areaId, ov);
}

/** A help article's badge: `help:<slug>`, else the first non-admin page whose Learn link is that article. */
export function helpBadge(slug: string, areas: NavArea[], ov: BadgeOverrides = {}): Badge | null {
  const k = 'help:' + slug;
  if (k in ov || RELEASE[k]) return own(k, ov);
  if (slug === 'phone-app') return own('lite', ov);
  for (const a of areas) {
    if (a.id === 'admin' || a.id === 'help') continue;
    for (const p of a.pages) if (p.learn === slug) return pageBadge(p.id, a.id, ov);
  }
  return null;
}

/** Every key with its default and label, for the admin setting's hint and the tests. */
export function releaseKeys(areas: NavArea[]): Array<{ key: string; label: string; def: Badge | null }> {
  const rows: Array<{ key: string; label: string; def: Badge | null }> = [];
  for (const a of areas) {
    for (const p of a.pages) if (!p.ext && p.label !== a.label) rows.push({ key: pageKey(p.id), label: `${a.label} › ${p.label}`, def: pageBadge(p.id, a.id) });
  }
  rows.push({ key: 'lite', label: 'Data saver (Lite mode)', def: own('lite', {}) });
  return rows;
}

/** The pill's markup, for Astro pages and the classic scripts. */
export function badgeHtml(b: Badge | null, key: string, cls = ''): string {
  if (!b) return '';
  return `<em class="h-rel h-rel--${b}${cls ? ' ' + cls : ''}" data-rel="${key}" title="${BADGE_TITLE[b]}">${BADGE_LABEL[b]}</em>`;
}
