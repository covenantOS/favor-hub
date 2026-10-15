// Admin pages, group B (Appeal codes, Gifts, Receipts, Giving statements, Expenses, Projects, Work Center): the reads behind them. Light on
// purpose: route files import this module, never a component.
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';
import { hubSend } from '../../lib/write';

export interface Setting {
  id: string;
  group: string;
  label: string;
  hint: string;
  kind: 'enum' | 'int' | 'text' | 'date' | 'access';
  options: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  unit: string;
  bb: boolean;
  contact: boolean;
  spend: boolean;
  value: string;
  saved: boolean;
  by: string;
  at: string;
  canReset: boolean;
}

export interface WorkExtras {
  rules: Array<{ rule: string; text: string }>;
  tags: Array<{ name: string; type: string; values: string[] }>;
  tagsAt: string;
  calls: { used: number; cap: number; lane: number };
}
export interface Sub {
  id: string;
  start: string;
  end: string;
  name: string;
  email: string;
}
export interface SettingsAnswer {
  area: string;
  settings: Setting[];
  extras: Partial<WorkExtras> & { overrides?: Sub[] };
}

export const settingsQuery = (area: string) =>
  queryOptions({
    queryKey: ['admin', 'settings', area] as const,
    queryFn: async (): Promise<SettingsAnswer> => (await hubGet('/api/admin/settings?area=' + area)) as SettingsAnswer,
    staleTime: 10_000,
  });

/* ------------------------------------------------------------------------------------------------------- appeal codes */
export interface Prefix {
  letter: string;
  label: string;
  hint: string;
  suffix?: string;
  category?: string;
}
export interface AppealRecent {
  code: string;
  description: string;
  category: string;
  start: string;
  inactive?: boolean;
}
export interface CodeRequest {
  id: string;
  kind: string;
  code: string;
  description: string;
  category?: string;
  start_date?: string;
  state: string;
  requested_at: string;
  requested_by: string;
}
export interface AppealsAnswer {
  prefixes: Prefix[];
  categories: Array<{ category: string }>;
  recent: AppealRecent[];
  requests: CodeRequest[];
}
export const appealsQuery = queryOptions({
  queryKey: ['admin', 'appeal-codes'] as const,
  queryFn: async (): Promise<AppealsAnswer> => (await hubGet('/api/admin/appeal-codes')) as AppealsAnswer,
  staleTime: 10_000,
});

/* ------------------------------------------------------------------------------------------------------------ gifts */
export interface GiftEntrySettings {
  people: Array<{ email: string; name: string; role: string; access: boolean; posting: boolean }>;
  candidates: Array<{ email: string; name: string }>;
  second: number;
}
export interface OnlineGiftsSetting {
  apply: boolean;
  testLimit: string;
}
export interface OtherGiftsSetting {
  mode: string;
}
/** Gift entry settings: a refusal (not an admin) ends the page; any other failure leaves the card saying it did not load, as the classic page does. */
const orNull = async <T,>(read: () => Promise<unknown>, keepRefusal: boolean): Promise<T | null> => {
  try {
    return (await read()) as T;
  } catch (e) {
    const status = (e as { status?: number }).status;
    // On the server a failed read stays a failure (the answer would otherwise travel to the browser as a good "null" and stay for ten seconds);
    // the browser asks again and the card says so only if that fails too.
    if (typeof window === 'undefined' || (keepRefusal && (status === 403 || status === 401))) throw e;
    return null;
  }
};
export const giftEntrySettingsQuery = queryOptions({
  queryKey: ['admin', 'gift-entry-settings'] as const,
  queryFn: (): Promise<GiftEntrySettings | null> => orNull<GiftEntrySettings>(() => hubGet('/api/gift-entry/settings'), true),
  staleTime: 10_000,
});
export const otherGiftsSettingsQuery = queryOptions({
  queryKey: ['admin', 'other-gifts-settings'] as const,
  queryFn: (): Promise<OtherGiftsSetting | null> => orNull<OtherGiftsSetting>(() => hubGet('/api/other-gifts/settings'), false),
  staleTime: 10_000,
});

/** Online gifts' write switch is read with an empty POST (the classic page does the same; the route has no GET for it), so only the browser asks. */
export const onlineGiftsSettingQuery = queryOptions({
  queryKey: ['admin', 'online-gifts-setting'] as const,
  queryFn: (): Promise<OnlineGiftsSetting | null> => hubSend('/api/online-gifts/setting', 'POST', {}, (d) => d as OnlineGiftsSetting).catch(() => null),
  staleTime: 10_000,
});

/* ----------------------------------------------------------------------------------------------------------- projects */
export interface AdminProjectsSettings {
  enabled: string;
  marketing_project: string;
  sealing: boolean;
  token: { saved: boolean; by?: string; who?: { name: string; email: string; workspaces?: Array<{ name: string }>; at: string } | null };
}
export interface HubProject {
  id: string;
  key: string;
  name: string;
  team?: string;
  status: string;
  lead_email: string;
  open: number;
  done: number;
  from_asana?: boolean;
}
export interface RunRow {
  id: string;
  created_at: string;
  mode: string;
  selection: string[];
  status: string;
  calls: number;
}
export interface AdminProjectsAnswer {
  settings: AdminProjectsSettings;
  projects: HubProject[];
  runs: RunRow[];
}
export const adminProjectsQuery = queryOptions({
  queryKey: ['admin', 'projects'] as const,
  queryFn: async (): Promise<AdminProjectsAnswer> => (await hubGet('/api/admin/projects')) as AdminProjectsAnswer,
  staleTime: 10_000,
});

export interface AsanaAdmin {
  sync: string;
  queue: { outbox: number; outbox_failed: number; inbox: number };
  connected: number;
  waiting_until?: string;
  require?: { on: boolean; people: Array<{ email: string; connected: boolean }>; extra: string[]; skip: string[] };
  projects: Array<{ gid: string; name: string; team?: string; modified_at?: string; enabled: boolean; webhook: boolean; last_reconcile?: string }>;
  log?: Array<{ at: string; dir: string; text: string }>;
}
export const asanaAdminQuery = queryOptions({
  queryKey: ['admin', 'asana-admin'] as const,
  queryFn: async (): Promise<AsanaAdmin> => (await hubGet('/api/asana/admin')) as AsanaAdmin,
  staleTime: 10_000,
});
