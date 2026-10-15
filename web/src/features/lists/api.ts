// Lists, Standard reports and Credit and assignments: the reads (queryOptions over /api/lists, drawn on the server and in the browser) and
// the browser-side calls (the counts and rows a list asks for as it is built, saves, exports, decisions). This module imports no
// components, so the route files can use it.
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';
import type { ListSpec } from './spec';

// ---- what the server sends ----
export interface Snapshot { asOf: string; builtAt: string; households: number; gifts: number }
export interface Holder { id: string; name: string; team?: string }
export interface Team { id: string; label: string }
export interface Fund { id: string; name: string; category?: string; inactive?: boolean }
export interface Appeal { id: string; code: string; name: string }
export interface Menus {
  states?: string[];
  funds?: Fund[];
  appeals?: Appeal[];
  holders?: Holder[];
  teams?: Team[];
  holderTypes?: string[];
  firstCats?: string[];
  fundCats?: string[];
  appealCats?: string[];
  methods?: string[];
  solicit?: string[];
  codes?: string[];
  attrs?: string[];
  rels?: string[];
  events?: string[];
}
export interface ColDef { key: string; label: string; type: string; only: string | null; def: boolean; live: string | null }
export type Scope = 'private' | 'team' | 'all';
export interface Saved { id: string; owner: string; ownerName: string; name: string; kind: string; spec: unknown; scope: Scope; team: string | null; updatedAt: string; mine: boolean }
export interface ListsMeta {
  snapshot: Snapshot | null;
  today: string;
  menus: Menus | null;
  columns: ColDef[];
  saved: Saved[];
  contacts: boolean;
  admin: boolean;
  me: { email: string; name: string };
}
export interface CountAnswer { n: number; total: number; partners: number }
export interface Tie { status: 'match' | 'differs' | 'none' | string; label: string; kpi: number | null; mine: number; note?: string }
export interface CountReply { ok?: boolean; count: CountAnswer; tie: Tie | null; leftOut: number; ms: number; message?: string }
export interface Col { key: string; label: string; type: string }
export interface Row { [key: string]: any }
export interface RowsReply { ok?: boolean; columns: Col[]; rows: Row[]; count: CountAnswer; page: number; pageSize: number; message?: string }

export interface Change {
  id: string;
  kind: 'credit' | 'assignment';
  giftId: string;
  fundraiser: string;
  change: { op?: string; amount?: number; closedMonth?: boolean; type?: string };
  reason: string;
  state: string;
  proposedBy: string;
  proposedAt: string;
  decidedBy: string | null;
  result: string | null;
}
export interface CreditOverview {
  waiting: Change[];
  recent: Change[];
  apply: boolean;
  testLimit: string;
  approvers?: string;
  mayApprove: boolean;
  admin: boolean;
  me: string;
}
export interface ReportParam { id: string; label: string; type: string; def: string; options: [string, string][] }
export interface ReportItem { id: string; name: string; group: string; about: string; open: boolean; params: ReportParam[] }
export interface ReportsList { reports: ReportItem[]; periods: [string, string][] }
export interface ReportCol { key: string; label: string; type: string }
export interface ReportTie { status: string; label: string; kpi: number | null; mine: number; note?: string }
export interface ReportResult {
  id: string;
  name: string;
  params: ReportParam[];
  values?: Record<string, string>;
  from: string;
  to: string;
  primary: string;
  columns: ReportCol[];
  rows: Row[];
  tiles: { label: string; kind: string; value: any }[];
  ties: ReportTie[];
  note?: string;
}

// ---- reads ----
// The builder's menus are large (about 130 KB); they change only when the snapshot is rebuilt, so the answer is kept for five minutes and
// is read again on demand (after a list is saved or deleted), not each time the window gets focus.
export const listsMetaQuery = queryOptions({
  queryKey: ['lists', 'meta'] as const,
  queryFn: async () => (await hubGet('/api/lists')) as ListsMeta,
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
  retry: false,
});

export const creditQuery = queryOptions({
  queryKey: ['lists', 'credit'] as const,
  queryFn: async () => (await hubGet('/api/lists/credit')) as CreditOverview,
  staleTime: 20_000,
  retry: false,
});

export const reportsQuery = queryOptions({
  queryKey: ['lists', 'reports'] as const,
  queryFn: async () => (await hubGet('/api/lists/report')) as ReportsList,
  staleTime: 5 * 60_000,
  retry: false,
});

/** The report's address: id first, then each value that is set. */
export function reportPath(id: string, values: Record<string, string | null | undefined>): string {
  const q = ['id=' + encodeURIComponent(id)];
  for (const [k, v] of Object.entries(values)) if (v !== '' && v != null) q.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  return '/api/lists/report?' + q.join('&');
}
export const reportQuery = (id: string, values: Record<string, string>) =>
  queryOptions({
    queryKey: ['lists', 'report', id, values] as const,
    queryFn: async () => (await hubGet(reportPath(id, values))) as ReportResult,
    staleTime: 60_000,
    retry: false,
  });

// Route loaders start the reads and never wait for them, so the frame streams at once and each part fills in as its read answers.
export const prefetchLists = (qc: QueryClient) => void qc.prefetchQuery(listsMetaQuery);
export const prefetchCredit = (qc: QueryClient) => void qc.prefetchQuery(creditQuery);
/** The report ids the server has (functions/_lib/lists/reports.ts; tests/lists-web.test.mjs keeps the two lists equal). Only these are read ahead, so an address with a made-up ?r= draws the menu and the server never answers 404 to a page read. */
export const REPORT_IDS = ['giving', 'credit', 'portfolio', 'new-lost', 'status', 'first-time', 'retention', 'actions', 'grants'] as const;
export function prefetchReports(qc: QueryClient, id?: string) {
  void qc.prefetchQuery(reportsQuery);
  if (id && (REPORT_IDS as readonly string[]).includes(id)) void qc.prefetchQuery(reportQuery(id, {}));
}

// ---- browser-side calls ----
export const UNREACHED = 'FavorOS could not be reached. Check the connection and try again.';
export type Answer<T = Record<string, any>> = T & { ok?: boolean; message?: string; _status: number };

/** One call to the hub's /api. Never throws: a failure comes back as { ok: false, message } with the status in _status, as the classic pages read it. */
export async function call<T = Record<string, any>>(path: string, body?: unknown, method?: 'POST' | 'PUT' | 'DELETE'): Promise<Answer<T>> {
  const init: RequestInit =
    body === undefined && !method
      ? { credentials: 'same-origin' }
      : { method: method || 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) };
  try {
    const r = await fetch(path, init);
    const d = (await r.json().catch(() => ({}))) as Record<string, any>;
    d._status = r.status;
    return d as Answer<T>;
  } catch {
    return { ok: false, message: UNREACHED, _status: 0 } as Answer<T>;
  }
}

export const listsCall = <T = Record<string, any>>(path: string, body?: unknown, method?: 'POST' | 'PUT' | 'DELETE') => call<T>('/api/lists' + path, body, method);
export const creditCall = <T = Record<string, any>>(path: string, body?: unknown, method?: 'POST' | 'PUT' | 'DELETE') => call<T>('/api/lists/credit' + path, body, method);

/** The list's title in a file name or a sheet: the saved list's name, else Gift list or Partner list. */
export const exportTitle = (spec: ListSpec, savedName: string): string => savedName || (spec.kind === 'gifts' ? 'Gift list' : 'Partner list');
