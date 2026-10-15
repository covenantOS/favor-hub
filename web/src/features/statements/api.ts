// Giving statements reads and writes. Reads are queryOptions over /api/statements (the server's desk rules apply unchanged); writes and the
// client-started previews go through stmPost. This module imports no components, so the route file can use it.
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

export type ListKey = 'mail' | 'email' | 'other';
export const LIST_NAME: Record<string, string> = { mail: 'Mail', email: 'Email', other: 'Other' };
export const TABS: [string, string][] = [
  ['one', 'One statement'],
  ['year', 'Year-end run'],
  ['files', 'Print files'],
  ['wording', 'Wording'],
];

export interface Me {
  name: string;
  admin: boolean;
  today: string;
  defaultYear: number;
  thisYear: number;
  emailOn: boolean;
  driveOn: boolean;
  size: number;
  copy: Record<string, string>;
  fields: { key: string; label: string }[];
}

export interface Hit {
  id: string;
  lookup: string;
  name: string;
  kind: string;
  place: string;
  gifts: number;
  last: string;
}

export interface Line {
  gift: string;
  date: string;
  amount: number;
  kind: string;
  fund: string;
  flags: string[];
  from?: string;
}

export interface Statement {
  partner: { id: string; lookup: string; name: string; address: string[]; email: string };
  from: string;
  to: string;
  period: string;
  gifts: Line[];
  notDeductible: Line[];
  soft: Line[];
  refunds: Line[];
  left: { gift: string; date: string; amount: number; reason: string; why: string }[];
  totals: { gifts: number; giftCount: number; notDeductible: number; soft: number; refunds: number; net: number; taxBasis: number };
  notes: string[];
}

export interface Batch {
  id: string;
  kind: string;
  list: string;
  year: number | null;
  from: string;
  to: string;
  count: number;
  gifts: number;
  amount: number;
  skipped: number;
  seq: number;
  status: string;
  createdBy: string;
  createdAt: string;
  printedAt: string | null;
  downloadedAt: string | null;
  driveFile: string;
}

export interface PlanList {
  count: number;
  total: number;
  issued: number;
  remaining: number;
}
export interface Tie {
  label: string;
  mine: number | null;
  other: number | null;
  kind: 'money' | 'count';
  status: 'match' | 'differs' | 'none';
  note?: string;
}
export interface Plan {
  year: number;
  lists: Record<ListKey, PlanList>;
  none: { count: number; total: number };
  open: Batch | null;
  batches: Batch[];
  ties: Tie[];
  size: number;
}

/** What the preview and the PDF ask for: a partner and a year, or a partner and two dates. */
export interface Ask {
  cid: string;
  includeSoft: boolean;
  year?: string;
  from?: string;
  to?: string;
}

export const stmKeys = {
  me: ['stm', 'me'] as const,
  find: (q: string) => ['stm', 'find', q] as const,
  preview: (a: Ask) => ['stm', 'preview', a] as const,
  plan: (year: string, bump: number) => ['stm', 'plan', year, bump] as const,
  files: (bump: number) => ['stm', 'files', bump] as const,
};

export const meQuery = queryOptions({
  queryKey: stmKeys.me,
  queryFn: async () => (await hubGet('/api/statements/me')) as Me,
  staleTime: 30_000,
  retry: false,
});

export const planQuery = (year: string, bump: number) =>
  queryOptions({
    queryKey: stmKeys.plan(year, bump),
    queryFn: async () => ((await hubGet('/api/statements/yearend?year=' + encodeURIComponent(year))) as { plan: Plan }).plan,
    staleTime: 0,
    retry: false,
  });

export const filesQuery = (bump: number) =>
  queryOptions({
    queryKey: stmKeys.files(bump),
    queryFn: async () => ((await hubGet('/api/statements/batches')) as { batches: Batch[] }).batches,
    staleTime: 0,
    retry: false,
  });

export class StmError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** A call from the browser (the same-site rule of the desk plus X-Hub-Request). A 401 sends the person to sign in. */
export async function stmApi<T = Record<string, any>>(path: string, body?: unknown, method?: string): Promise<T> {
  const headers: Record<string, string> = { 'X-Hub-Request': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method: method || (body !== undefined ? 'POST' : 'GET'), credentials: 'same-origin', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as any;
  if (res.status === 401 && data.error === 'signin') {
    location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search);
    throw new StmError('Sign in again.', 401);
  }
  if (!res.ok || data.ok === false) throw new StmError(data.message || 'Something went wrong. Try again.', res.status);
  return data as T;
}

export const askBody = (a: Ask): Record<string, unknown> => {
  const body: Record<string, unknown> = { cid: a.cid, includeSoft: a.includeSoft };
  if (a.from !== undefined || a.to !== undefined) {
    body.from = a.from || '';
    body.to = a.to || '';
  } else body.year = a.year;
  return body;
};

/** The year-end run opens on last year (the server's defaultYear), so the route can start that read with the tab. */
export function prefetchStatements(qc: import('@tanstack/react-query').QueryClient, tab: string, eastern: string): void {
  void qc.prefetchQuery(meQuery);
  if (tab === 'files') void qc.prefetchQuery(filesQuery(0));
  if (tab === 'year') void qc.prefetchQuery(planQuery(String(Number(eastern.slice(0, 4)) - 1), 0));
}
