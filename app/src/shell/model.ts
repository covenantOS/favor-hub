// What the menu shows for one person, worked out from the registry (src/data/areas.ts) and the answer from /api/hub/nav.
// Pure functions, so the rules the classic menu kept in DOM code (hubNavLayout in src/layouts/App.astro) have tests here.
import { AREAS, TAB_CAP, resolveNav, type NavArea, type NavPage } from '@hub/data/areas';
import type { Access } from '@shared/schemas';

export interface NavInput {
  access: Partial<Access> & Record<string, unknown>;
  kpiTeams: string[];
  counts: Record<string, number>;
  /** The nav id the route passes (the `nav` prop of the classic layout), such as "home" or "kpi-rdds". */
  navId: string;
  /** Unfinished tours (Help's tour entry). */
  tours?: number;
}

export interface PageView {
  page: NavPage;
  count: number;
  warn: boolean;
  on: boolean;
}

export interface AreaView {
  area: NavArea;
  pages: PageView[];
  visible: boolean;
  single: boolean;
  cur: boolean;
  href: string;
  sum: number;
  warn: boolean;
  inBar: boolean;
}

export interface NavView {
  areas: AreaView[];
  main: AreaView[];
  foot: AreaView[];
  /** Areas on the phone bar, in order, at most four. */
  bar: AreaView[];
  /** The More button's number: what the areas left off the bar, Admin and Help add up to. */
  more: number;
  curArea: string;
  tourCount: number;
}

export const pageVisible = (p: NavPage, access: NavInput['access'], kpiTeams: string[]): boolean => {
  if (p.need && !access[p.need]) return false;
  if (p.team && !kpiTeams.includes(p.team)) return false;
  return true;
};

const isOn = (p: NavPage, navId: string) => p.id === navId || (p.also || []).includes(navId);

export function buildNav(input: NavInput): NavView {
  const { access, kpiTeams, counts, navId } = input;
  const found = resolveNav(navId);
  const curArea = found ? found.area.id : '';
  const areas: AreaView[] = AREAS.map((area) => {
    const pages: PageView[] = area.pages
      .filter((p) => p.menu !== false && pageVisible(p, access, kpiTeams))
      .map((page) => {
        const count = page.count ? Number(counts[page.count]) || 0 : 0;
        return { page, count, warn: page.count === 'receiptsLeft' && count > 0, on: isOn(page, navId) };
      });
    const sum = pages.reduce((n, p) => n + p.count, 0);
    const first = pages[0];
    return {
      area,
      pages,
      visible: pages.length > 0,
      single: pages.length === 1,
      cur: area.id === curArea,
      href: first ? first.page.href : area.pages[0].href,
      sum,
      warn: pages.some((p) => p.warn),
      inBar: false,
    };
  });
  // The rail draws every area the person can open, top to bottom in barRank order. There is no More menu (Will, 2026-10-15).
  const main = areas.filter((a) => !a.area.foot).sort((x, y) => x.area.barRank - y.area.barRank);
  const foot = areas.filter((a) => a.area.foot);
  const ranked = main.filter((a) => a.visible).sort((x, y) => x.area.barRank - y.area.barRank);
  const bar = ranked.slice(0, 4);
  bar.forEach((a) => {
    a.inBar = true;
  });
  const byId = new Map(areas.map((a) => [a.area.id, a]));
  const offBar = main.filter((a) => !bar.includes(a));
  const more = offBar.reduce((n, a) => n + a.sum, 0) + (byId.get('admin')?.sum || 0) + (byId.get('help')?.sum || 0);
  return { areas, main, foot, bar, more, curArea, tourCount: input.tours || 0 };
}

/** The phone bar shows 99+ above 99; the rail shows the whole number. */
export const barCount = (n: number) => (n > 99 ? '99+' : n.toLocaleString('en-US'));
export const railCount = (n: number) => n.toLocaleString('en-US');

/** The page row for a nav id, with its area. */
export function pageOf(navId: string) {
  return resolveNav(navId);
}

/**
 * Whether this page's tab row is certain to be drawn, known before the menu answer arrives. The web app streams the top bar's frame
 * first and the tab row with the menu answer; on a phone the row is a second line, so the frame holds its space when the row will come.
 * The row is certain when the area has another menu page that anyone who may open this page may open too (same `need`, no KPI team),
 * so the row never ends up with fewer than two tabs. When it is not certain the frame holds nothing, the same as before.
 */
const sharedPages = (navId: string) => {
  const found = resolveNav(navId);
  if (!found) return [];
  const { area, page } = found;
  if (page.menu === false || page.ext || page.team) return [];
  return area.pages.filter((p) => !p.ext && p.menu !== false && !p.team && (p.need || '') === (page.need || ''));
};

export const tabRowHeld = (navId: string): boolean => sharedPages(navId).length >= 2;

/** How many children the held row has: the area's tabs (six at most) and the More button, which the real row always draws (hidden when
 * nothing is under it). The header lays out differently once the row has seven children, so the held row has the count most people
 * of this area get. Someone who may open fewer pages sees the other layout, three pixels different on a mid-width desktop, no more. */
export const tabRowCount = (navId: string): number => {
  const found = resolveNav(navId);
  const n = found ? found.area.pages.filter((p) => !p.ext && p.menu !== false && !p.team).length : 0;
  return Math.min(n, TAB_CAP) + 1;
};
