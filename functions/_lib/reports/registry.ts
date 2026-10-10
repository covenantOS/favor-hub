// Every report the hub will have, who uses each today, and which ones are built. The catalog is the
// whole plan (Q:\work\favor-bb-audit\wave2\reports-plan.md); a report is ready when its file under defs/
// exports a definition instead of null. Reports with no definition show "Coming soon".
import appealResults from './defs/appeal-results';
import caroleList from './defs/carole-list';
import contact from './defs/contact';
import dailyRevenue from './defs/daily-revenue';
import deposit from './defs/deposit';
import foundations from './defs/foundations';
import largeGifts from './defs/large-gifts';
import mailing from './defs/mailing';
import monthToMonth from './defs/month-to-month';
import packets from './defs/packets';
import portfolio from './defs/portfolio';
import prayer from './defs/prayer';
import queryMap from './defs/query-map';
import status from './defs/status';
import tax from './defs/tax';
import weeklyRecurring from './defs/weekly-recurring';
import ytdIncome from './defs/ytd-income';
import type { Audience, CatalogEntry, GroupId, ReportDef } from './types';

export const GROUPS: Array<{ id: GroupId; label: string }> = [
  { id: 'daily', label: 'Daily and weekly' },
  { id: 'thanks', label: 'Thank-you lists' },
  { id: 'lists', label: 'Partner and mailing lists' },
  { id: 'results', label: 'Results and yearly' },
];

export const ALL_AUDIENCES: Audience[] = ['admin_desk', 'operations', 'leadership', 'support', 'partner_care', 'rdd', 'grants', 'marketing'];

// "Who uses it" is the plan's column: the people who run each report today. Nothing is shown to a role that does not use it.
export const CATALOG: CatalogEntry[] = [
  { id: 'daily-revenue', group: 'daily', name: 'Daily Revenue Report', replaces: 'Daily Revenue Reporter 4.1 query and the 4.2 browser script', who: 'Admin desk', freq: 'Daily, after 9:30 AM', audience: ['admin_desk'], kpiTie: true, build: 'B1' },
  { id: 'weekly-recurring', group: 'daily', name: 'Weekly recurring report', replaces: 'Recurring payments gift list and the month-to-date recurring calculator', who: 'Admin desk', freq: 'Mondays', audience: ['admin_desk'], kpiTie: true, build: 'B1' },
  { id: 'ytd-income', group: 'daily', name: '2026 YTD Income', replaces: 'YTD Daily Totals query and the 2026 YTD Income sheet', who: 'Admin desk, leadership', freq: 'Daily', audience: ['admin_desk', 'leadership'], kpiTie: true, build: 'B1' },
  { id: 'month-to-month', group: 'daily', name: 'Month to month', replaces: 'Month to Month sheet', who: 'Admin desk, leadership', freq: 'Mondays', audience: ['admin_desk', 'leadership'], kpiTie: true, build: 'B1' },
  { id: 'deposit', group: 'daily', name: 'Deposit highlights for RDDs', replaces: 'Deposit email with RDD highlights', who: 'Admin desk', freq: 'Each deposit day (Mon, Wed, Fri)', audience: ['admin_desk'], kpiTie: true, build: 'B1' },
  { id: 'large-gifts', group: 'thanks', name: 'Gifts of $5,000 and up', replaces: '5k TY query and the $5,000 and Up lists', who: 'Support, Partner Care, Operations', freq: '1 to 3 times a week', audience: ['support', 'partner_care', 'operations'], kpiTie: false, build: 'B2' },
  { id: 'carole-list', group: 'thanks', name: 'Six-week email list, $5,000 partners', replaces: "Carole's email list query", who: 'Marketing', freq: 'Fridays', audience: ['marketing'], kpiTie: false, build: 'B2' },
  { id: 'packets', group: 'thanks', name: 'Thank-you packets, quarterly', replaces: 'Quarterly $5,000 packet list', who: 'Marketing', freq: 'Quarterly', audience: ['marketing'], kpiTie: false, build: 'B2' },
  { id: 'mailing', group: 'lists', name: 'Appeal mailing list', replaces: 'Appeal list, mail list and email list builder queries, state lists', who: 'Marketing', freq: 'Every four weeks', audience: ['marketing'], kpiTie: false, build: 'B3' },
  { id: 'status', group: 'lists', name: 'Active, LYBUNT and lapsed partners', replaces: 'Active Partners, LYBUNT, Lapsed and Annual Givers queries', who: 'RDDs, leadership', freq: 'Weekly', audience: ['rdd', 'leadership'], kpiTie: true, build: 'B3' },
  { id: 'portfolio', group: 'lists', name: 'Portfolio export', replaces: 'Full Portfolio and Partner Data templates', who: 'RDDs', freq: 'As needed', audience: ['rdd'], kpiTie: false, build: 'B3' },
  { id: 'prayer', group: 'lists', name: 'Prayer list', replaces: 'Prayer List query', who: 'Operations', freq: 'As needed', audience: ['operations'], kpiTie: false, build: 'B3' },
  { id: 'foundations', group: 'results', name: 'Foundations', replaces: 'Foundations List and Partner foundations queries', who: 'Grants, Operations', freq: 'As needed', audience: ['grants', 'operations'], kpiTie: true, build: 'B4' },
  { id: 'tax', group: 'results', name: 'Annual tax receipt lists', replaces: 'Annual Tax Receipts mail, email and others queries', who: 'Operations, Admin desk', freq: 'Each January', audience: ['operations', 'admin_desk'], kpiTie: true, build: 'B4' },
  { id: 'contact', group: 'results', name: 'Contact data lists', replaces: 'Email address and new constituent queries', who: 'Operations', freq: 'Weekly', audience: ['operations'], kpiTie: false, build: 'B4' },
  { id: 'appeal-results', group: 'results', name: 'Results by appeal', replaces: 'Appeal Analysis and Campaign Performance queries', who: 'Marketing', freq: 'Per mailing, and 60 days after', audience: ['marketing'], kpiTie: true, build: 'B4' },
];

/** The query map is a lookup for everyone. */
export const QUERY_MAP_ENTRY = { id: 'query-map', name: 'Where each Blackbaud query went' };

const DEFS: Record<string, ReportDef | null> = {
  'daily-revenue': dailyRevenue,
  'weekly-recurring': weeklyRecurring,
  'ytd-income': ytdIncome,
  'month-to-month': monthToMonth,
  deposit,
  'large-gifts': largeGifts,
  'carole-list': caroleList,
  packets,
  // Held until solicit codes and address validity are in the mirror and each list ties to its saved query (2026-10-10).
  mailing: null,
  status,
  portfolio,
  prayer,
  foundations,
  tax: null,
  contact: null,
  'appeal-results': appealResults,
  'query-map': queryMap,
};

export const defOf = (id: string): ReportDef | null => DEFS[id] ?? null;
export const entryOf = (id: string): CatalogEntry | null => CATALOG.find((e) => e.id === id) ?? null;
export const reportName = (id: string): string => entryOf(id)?.name ?? (id === QUERY_MAP_ENTRY.id ? QUERY_MAP_ENTRY.name : id);
export const isReady = (id: string): boolean => defOf(id) !== null;

/** Admins see every report. Everyone else sees a report only when one of their audiences uses it. */
export function mayOpen(entry: CatalogEntry, mine: Set<Audience>, admin: boolean): boolean {
  return admin || entry.audience.some((a) => mine.has(a));
}

export interface ListItem extends CatalogEntry {
  ready: boolean;
}

export function listFor(mine: Set<Audience>, admin: boolean): ListItem[] {
  return CATALOG.filter((e) => mayOpen(e, mine, admin)).map((e) => ({ ...e, ready: isReady(e.id) }));
}
