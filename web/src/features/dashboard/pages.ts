// Reporting > Executive and the team tabs (/dashboard/): which KPI dashboard page each address shows and which menu entry belongs to it.
// Pure, so the address rules are tested without a browser (tests/dashboard-web.test.mjs).
import { AREAS } from '../../../../src/data/areas';

export const KPI_ORIGIN = 'https://kpi.favorintl.org';

interface KpiEntry {
  id: string;
  kpiPage: string;
  label: string;
}

const AREA = AREAS.find((a) => a.id === 'kpi');
/** The menu entries that open a dashboard page, in menu order: Executive, the team pages, Definitions. */
export const KPI_ENTRIES: KpiEntry[] = (AREA?.pages ?? []).filter((p) => p.kpiPage).map((p) => ({ id: p.id, kpiPage: p.kpiPage as string, label: p.label }));

/** The dashboard page an address asks for: ?page=%2Frdds is /rdds, no page is the Executive page. Anything that is not a path inside the dashboard is the Executive page. */
export function pageOf(raw: unknown): string {
  const p = typeof raw === 'string' ? raw : '';
  return /^\/[^\s#\\]*$/.test(p) && !p.startsWith('//') && !p.includes('..') ? p : '/';
}

/** The hub address that shows a dashboard page. */
export const hubHref = (page: string): string => (page === '/' ? '/dashboard/' : '/dashboard/?page=' + encodeURIComponent(page));

/** A dashboard address in the hub's embedded mode (no header or footer of its own). */
export const withEmbed = (page: string): string => page + (page.includes('?') ? '&' : '?') + 'embed=1';

/** The menu entry a dashboard page belongs to (a page under /rdds/ belongs to RDD team). Pages the menu does not list keep Executive. */
export function navIdOf(page: string): string {
  const hit = KPI_ENTRIES.find((e) => e.kpiPage === page) ?? KPI_ENTRIES.find((e) => e.kpiPage !== '/' && page.startsWith(e.kpiPage + '/'));
  return hit?.id ?? 'kpi';
}

/** "Updated Oct 15, 9:05 AM" or "Not updated since ...", in Eastern time, as the dashboard reports it. */
export function freshText(lastUpdated: unknown, stale: boolean): string {
  const d = new Date(String(lastUpdated ?? ''));
  if (!lastUpdated || Number.isNaN(d.getTime())) return '';
  const at = d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (stale ? 'Not updated since ' : 'Updated ') + at;
}
