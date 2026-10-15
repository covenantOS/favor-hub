// Admin settings tabs: the one read behind a tab (GET /api/admin/settings?area=...). Light on purpose: route files import this, never a component.
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

export interface Setting {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  kind: 'enum' | 'int' | 'date' | 'text' | 'access';
  value: string;
  options: { value: string; label: string }[];
  min?: number;
  max?: number;
  unit?: string;
  saved?: boolean;
  at?: string;
  by?: string;
  canReset?: boolean;
  bb?: boolean;
  contact?: boolean;
  spend?: boolean;
}
export interface SettingsAnswer {
  settings: Setting[];
  extras?: Record<string, unknown>;
}

export const settingsQuery = (area: string) =>
  queryOptions({
    queryKey: ['admin', 'settings', area] as const,
    queryFn: async (): Promise<SettingsAnswer> => (await hubGet('/api/admin/settings?area=' + area)) as SettingsAnswer,
    staleTime: 10_000,
  });
