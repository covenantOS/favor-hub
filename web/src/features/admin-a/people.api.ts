// Admin > People and roles: the reads behind the page. Light on purpose: the route file imports this module (never a component).
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

export interface Person {
  email: string;
  name: string;
  picture?: string;
  role: 'admin' | 'staff' | 'field';
  pending: boolean;
  envAdmin: boolean;
  blocked: boolean;
  note: string;
  signIns?: number;
  lastSeen?: string;
  team: string;
  fundraiser: string;
  workCenter: boolean;
  entryOwner: boolean;
  entryType: string;
  sheetTab: string;
  active: boolean;
  listed: boolean;
  supervisor: string;
  title: string;
  department: string;
  startDate: string;
  hr: boolean;
  sees: { workCenter: boolean; meetings: boolean; clips: boolean; reports: number; expenseLog: boolean; admin: boolean };
}
export interface Team {
  value: string;
  label: string;
}
export interface People {
  people: Person[];
  teams: Team[];
  entryTypes: string[];
}
export const peopleQuery = queryOptions({
  queryKey: ['admin', 'people'] as const,
  queryFn: async (): Promise<People> => (await hubGet('/api/admin/people')) as People,
  staleTime: 15_000,
});

export interface Preview {
  person: { email: string; name: string; role: string; blocked: boolean; team: string; workRole?: string | null };
  pages: Array<{ area: string; label: string; href: string }>;
  reports: string[];
  audiences?: string[];
  clipsRecord: boolean;
  note: string;
}
/** The answer to ?preview= is { preview }; the classic page read the fields off the answer itself, which never worked. Both shapes are read. */
export const previewQuery = (email: string) =>
  queryOptions({
    queryKey: ['admin', 'people', 'preview', email] as const,
    queryFn: async (): Promise<Preview> => {
      const d = (await hubGet('/api/admin/people?preview=' + encodeURIComponent(email))) as { preview?: Preview } & Partial<Preview>;
      return (d.preview || d) as Preview;
    },
    staleTime: 0,
    gcTime: 0,
  });

export interface SettingOption {
  value: string;
  label: string;
}
export interface PeopleSetting {
  id: string;
  label: string;
  hint?: string;
  value: string;
  options: SettingOption[];
}
export const peopleSettingsQuery = queryOptions({
  queryKey: ['admin', 'settings', 'people'] as const,
  queryFn: async (): Promise<{ settings: PeopleSetting[] }> => (await hubGet('/api/admin/settings?area=people')) as { settings: PeopleSetting[] },
  staleTime: 15_000,
  retry: false,
});

export interface BrainRule {
  kind: 'everyone' | 'role' | 'team' | 'lead' | 'person';
  key: string;
  package: string;
}
export interface BrainAccess {
  rules: BrainRule[];
  packages: Array<{ key: string; label: string }>;
  teams: string[];
  people: Array<{ name: string; email: string; team?: string; packages: string[]; fromGrants: string[]; removedByGrant: string[] }>;
}
export const brainAccessQuery = queryOptions({
  queryKey: ['admin', 'brain-access'] as const,
  queryFn: async (): Promise<BrainAccess> => (await hubGet('/api/admin/brain-access')) as BrainAccess,
  staleTime: 15_000,
  retry: false,
});

/** The list filters, as the Show drop-down offers them (the first, empty one is everyone). */
export const FILTERS: Array<[string, string]> = [
  ['', 'Everyone'],
  ['admin', 'Admins'],
  ['pending', 'Waiting for approval'],
  ['field', 'Field staff'],
  ['blocked', 'Blocked'],
  ['wc', 'Work Center access'],
  ['nolist', 'Not on the Work Center list'],
  ['nosup', 'No Reports to set'],
  ['hr', 'HR'],
];
export const isFilter = (v: unknown): v is string => typeof v === 'string' && FILTERS.some((f) => f[0] === v && v !== '');
