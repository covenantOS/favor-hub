// The reads behind the Clips pages. Light on purpose: route files import this module (never a component) so the first-screen script
// stays under the budget. A refused read (403 on the admin view) is thrown as a HubReadError and the page says why.
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

export type ClipScope = 'mine' | 'all';

export interface ClipRow {
  id: string;
  owner_name: string;
  owner_team: string;
  owner_email?: string;
  title: string;
  summary: string;
  status: string;
  share: number;
  staff_link: number;
  access: string | null;
  kind: string;
  size_bytes: number;
  duration_ms: number;
  has_poster: number;
  views: number;
  created_at: string;
  level: string;
  mine: boolean;
  match: { at: number; text: string } | null;
}

export interface ClipUsage {
  used: number;
  cap: number;
  maxMs: number;
  pct: number;
  warn: boolean;
  full: boolean;
  clips: number;
  oldestUnwatched: { id: string; title: string; created_at: string; size_bytes: number }[];
}

export interface ClipPerson {
  email: string;
  name: string;
  team?: string;
  clips: number;
  bytes: number;
  blocked?: number;
}

export interface ClipsAnswer {
  ok: boolean;
  clips: ClipRow[];
  scope: ClipScope;
  usage?: ClipUsage;
  people?: ClipPerson[];
  cap?: number;
}

/** The library: the same read the classic page makes (one on load, one per search, and a repeat every four seconds while a clip is being named). */
export const clipsQuery = (scope: ClipScope, q = '') =>
  queryOptions({
    queryKey: ['clips', scope, q] as const,
    queryFn: async (): Promise<ClipsAnswer> => {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (scope === 'all') p.set('scope', 'all');
      const qs = p.toString();
      return (await hubGet('/api/clips' + (qs ? '?' + qs : ''))) as ClipsAnswer;
    },
    // This read tidies and names clips on the server as it answers, so it runs only when the page asks (load, search, a finished
    // recording, a delete), never on a window focus or a timer the page did not set.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

export interface AdminSetting {
  id: string;
  label: string;
  hint: string;
  kind: 'int' | 'enum' | 'text' | 'date' | 'access';
  options: { value: string; label: string }[];
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
  group: string;
}

export interface ClipsSettingsAnswer {
  ok: boolean;
  settings: AdminSetting[];
  extras: { usage?: { email: string; name: string; clips: number; bytes: number }[] };
}

export const clipsSettingsQuery = queryOptions({
  queryKey: ['admin-settings', 'clips'] as const,
  queryFn: async (): Promise<ClipsSettingsAnswer> => (await hubGet('/api/admin/settings?area=clips')) as ClipsSettingsAnswer,
  staleTime: 20_000,
  refetchOnWindowFocus: false,
});
