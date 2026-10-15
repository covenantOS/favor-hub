// Admin > Reports: the one read behind the page. Light on purpose: the route file imports this module (never a component).
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

export interface AdminReport {
  id: string;
  group: string;
  name: string;
  ready: boolean;
  roles: string[];
  original: string[];
  saved: boolean;
}

export interface AdminReports {
  audiences: Array<{ value: string; label: string }>;
  groups: Array<{ id: string; label: string }>;
  reports: AdminReport[];
}

export const adminReportsQuery = queryOptions({
  queryKey: ['admin', 'reports'] as const,
  queryFn: async (): Promise<AdminReports> => (await hubGet('/api/admin/reports')) as AdminReports,
  staleTime: 10_000,
});
