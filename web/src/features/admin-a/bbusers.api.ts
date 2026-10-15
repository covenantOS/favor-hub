// Admin > Blackbaud users: the two reads behind the page. Light on purpose: the route file imports this module (never a component).
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

export interface BbUser {
  name: string;
  email: string;
  active: boolean;
  access: Record<string, string | undefined> & { renxt?: string };
  admin: string[];
}
export interface BbUsers {
  users: BbUser[];
  at: string;
  summary: { total: number; active: number; inactive: number; renxtAdmins: number; renxtUsers: number } | null;
}
export const bbUsersQuery = queryOptions({
  queryKey: ['admin', 'bbusers'] as const,
  queryFn: async (): Promise<BbUsers> => (await hubGet('/api/work/bbusers')) as BbUsers,
  staleTime: 30_000,
});

export interface BbAccess {
  solutionAdmin?: boolean;
  roles?: Record<string, string>;
  groups?: string[];
}
export interface BbJob {
  id: string;
  kind: 'add' | 'access' | 'deactivate';
  email: string;
  name: string;
  state: 'queued' | 'running' | 'checked' | 'done' | 'failed' | 'cancelled';
  status: string;
  by: string;
  at: string;
  finished?: string;
  result?: string;
  access: BbAccess | null;
}
export interface BbJobs {
  jobs: BbJob[];
  open: number;
  form: {
    roles: Record<string, { label: string; levels: string[] }>;
    groups: string[];
    presets: Record<string, { solutionAdmin: boolean; roles: Record<string, string>; groups: string[] }>;
    states?: string[];
  };
}
/** The request list is a second thing on the page: when it does not answer, the users still show, and the page keeps the last list it had. */
export const bbJobsQuery = queryOptions({
  queryKey: ['admin', 'bbusers', 'jobs'] as const,
  queryFn: async (): Promise<BbJobs | null> => {
    try {
      return (await hubGet('/api/work/bbusers/jobs')) as BbJobs;
    } catch {
      return null;
    }
  },
  staleTime: 10_000,
  // While a request is open the desktop automation is working on it; ask again every 15 seconds.
  refetchInterval: (q) => (q.state.data && q.state.data.open ? 15_000 : false),
});
