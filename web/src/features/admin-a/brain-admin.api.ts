// Brain admin (/brain/admin/): the three reads behind the page. Each answers with its data or with the words the classic page showed in its place
// (the page checks the Brain's admin on every call, so a refusal is data here and not a failure of the whole page). Light on purpose: the route file
// imports this module (never a component).
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

export interface BrainPerson {
  email: string;
  role: string;
  packages: string[];
  changed?: boolean;
  calls30?: number;
  last?: string;
}
export interface BrainRequest {
  id: number;
  name?: string;
  email: string;
  package: string;
  days: number;
  at: string;
  reason?: string;
}
export interface BrainDecided {
  email: string;
  package: string;
  decided_at: string;
  status: string;
}
export interface BrainCall {
  at: string;
  email: string;
  tool: string;
  question?: string;
  outcome?: string;
  reading?: string;
  rows?: number;
  args?: string;
}
export interface BrainOverview {
  packages: Record<string, string>;
  people: BrainPerson[];
  pending: BrainRequest[];
  decided: BrainDecided[];
  recent: BrainCall[];
}
export type Answer<T> = { denied: true } | { error: string } | { data: T };

const statusOf = (e: unknown) => (e as { status?: number }).status || 0;
async function read<T>(path: string): Promise<Answer<T>> {
  try {
    return { data: (await hubGet('/api/brain/' + path)) as T };
  } catch (e) {
    const status = statusOf(e);
    const message = (e as Error).message || '';
    // The Brain refuses a person who is not its admin with 403 admin_only.
    if (status === 403 || status === 401) return { denied: true };
    return { error: message || 'The Brain did not answer (' + status + ').' };
  }
}

export const brainOverviewQuery = queryOptions({
  queryKey: ['brain-admin', 'overview'] as const,
  queryFn: () => read<BrainOverview>('admin/overview'),
  staleTime: 10_000,
  retry: false,
});

export interface Missed {
  question?: string;
  tool: string;
  who: string;
  at: string;
  reading?: string;
  outcome?: string;
  term?: string;
  suggestion?: { kind: string; id: string; name: string } | null;
}
export interface Alias {
  id: number;
  term: string;
  kind: string;
  entity_name?: string;
  entity_id?: string;
  added_at: string;
}
export interface BrainNames {
  missed: Missed[];
  aliases: Alias[];
}
export const brainNamesQuery = queryOptions({
  queryKey: ['brain-admin', 'names'] as const,
  queryFn: () => read<BrainNames>('admin/names'),
  staleTime: 10_000,
  retry: false,
});

export interface IwaveStatus {
  balance?: number | null;
  balance_note?: string;
  balance_read_at?: string;
  refreshes_today?: { used?: number; daily_cap?: number };
  rated_partners?: number | null;
  credit_floor?: number;
  mode?: string;
  min_age_days?: number;
}
export interface IwaveProposal {
  id: number;
  credits_needed?: number;
  households?: number;
  scope_json?: string;
  email?: string;
  made_at: string;
  eligible?: number;
  held_partner_care?: number;
  balance_at?: number | null;
}
export interface IwaveLog {
  made_at: string;
  email?: string;
  kind?: string;
  constituent_id?: string;
  status?: string;
  detail?: string;
  credits_before?: number | null;
  credits_after?: number | null;
}
export interface Iwave {
  connected: boolean;
  message?: string;
  status?: IwaveStatus;
  proposals?: IwaveProposal[];
  log?: IwaveLog[];
}
export const brainIwaveQuery = queryOptions({
  queryKey: ['brain-admin', 'iwave'] as const,
  queryFn: () => read<Iwave>('admin/iwave'),
  staleTime: 10_000,
  retry: false,
});
