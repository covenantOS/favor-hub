// Reports: the reads behind the list and one report. Light on purpose: the route file imports this module (never a component) so the
// first-screen script stays under the budget. The server's rules apply unchanged: /api/reports lists only the reports this person's role
// may open, and /api/reports/<id> refuses a report outside it.
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';
import { API, apiUrl } from './url';

export { API, BASE, apiUrl, askedOf, pageUrl } from './url';

export interface ListEntry {
  id: string;
  name: string;
  group: string;
  freq: string;
  who: string;
  replaces?: string;
  ready: boolean;
  kpiTie?: boolean;
}

export interface ListAnswer {
  ok: boolean;
  groups: Array<{ id: string; label: string }>;
  reports: ListEntry[];
  queryMap: { id: string; name: string; ready: boolean };
}

export type ColType = 'money' | 'int' | 'date' | 'pct' | 'chip' | 'cell' | 'cellint' | 'id' | 'text';

export interface Col {
  key: string;
  label: string;
  type?: ColType;
  total?: boolean;
}

export interface Filter {
  id: string;
  label: string;
  type: 'seg' | 'select' | 'date' | 'month' | 'text';
  options?: Array<[string, string]>;
  def: string;
  showWhen?: { id: string; is: string };
}

export interface Tile {
  label: string;
  value: number | string;
  kind?: 'money' | 'int' | 'text';
  sub?: string;
}

export interface Tie {
  label: string;
  mine: number;
  kpi: number | null;
  kind: 'money' | 'count';
  status: 'match' | 'differs' | 'none' | 'unavailable';
  diff?: number;
  note?: string;
  against?: string;
}

export type Row = Record<string, unknown> & { __key?: string; __cid?: string };

export interface Report {
  id: string;
  name: string;
  columns: Col[];
  filters: Filter[];
  values: Record<string, string>;
  rows: Row[];
  count: number;
  more: boolean;
  totals: Record<string, number>;
  tiles: Tile[];
  tie: Tie;
  ties: Tie[];
  mailFile: { label: string; name: string; rows: number } | null;
  post: string | null;
  note: string | null;
  editable: string[];
  asOf: string;
  pageSize: number;
}

export const listQuery = queryOptions({
  queryKey: ['reports', 'list'] as const,
  queryFn: async (): Promise<ListAnswer> => (await hubGet(API)) as ListAnswer,
  staleTime: 20_000,
});

/** One report. A running report writes one row to the run log on the server, so a read is not repeated on focus or reconnect. */
export const reportQuery = (id: string, asked: Record<string, string>) =>
  queryOptions({
    queryKey: ['reports', 'one', id, JSON.stringify(asked)] as const,
    queryFn: async (): Promise<Report> => ((await hubGet(apiUrl(id, asked))) as { report: Report }).report,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

