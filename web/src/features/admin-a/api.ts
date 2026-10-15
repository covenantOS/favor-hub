// Every read behind the Admin pages of this group. Light on purpose: the route files import this module (never a component).
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

const get = <T>(path: string) => hubGet(path) as Promise<T>;

/* ------------------------------------------------------------------ Overview */
export type HealthStatus = 'ok' | 'late' | 'failed' | 'unknown';
export interface HealthPart {
  label: string;
  at: string | null;
  status: HealthStatus;
}
export interface HealthItem {
  id: string;
  label: string;
  status: HealthStatus;
  at: string | null;
  detail: string;
  parts?: HealthPart[];
  dayOnly?: boolean;
  meter?: { used: number; of: number; share?: number; shareLabel?: string };
}
export interface Health {
  at: string;
  items: HealthItem[];
}
export const healthQuery = queryOptions({
  queryKey: ['admin', 'health'] as const,
  queryFn: () => get<Health>('/api/admin/health'),
  staleTime: 20_000,
  refetchInterval: 120_000,
});

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  key: string;
  label: string;
  before: string | null;
  after: string | null;
  note?: string;
}
export const recentAuditQuery = queryOptions({
  queryKey: ['admin', 'audit', 'recent'] as const,
  queryFn: () => get<{ entries: AuditEntry[] }>('/api/admin/audit?limit=5'),
  staleTime: 10_000,
});

/* ------------------------------------------------------------------ Audit log */
export const AUDIT_PAGE = 100;
export const auditPath = (area: string, before?: number) => '/api/admin/audit?limit=' + AUDIT_PAGE + (area ? '&area=' + encodeURIComponent(area) : '') + (before ? '&before=' + before : '');
export const auditQuery = (area: string) =>
  queryOptions({
    queryKey: ['admin', 'audit', 'list', area] as const,
    queryFn: () => get<{ entries: AuditEntry[] }>(auditPath(area)),
    staleTime: 10_000,
  });
