// Gifts > Declines: the read, the types and the words. Pure and light, so the route file can import it.
// Ported from public/js/work-declines.js; the server is functions/_lib/work/declines-svc.ts (the D1 copy of Blackbaud, no Blackbaud calls on a read).
import { queryOptions } from '@tanstack/react-query';
import { workGet } from '../../partners/work/lists/core';

export type DeclineKind = 'hard' | 'soft' | 'full' | 'zeroed';
export interface DeclineRow {
  key: string;
  giftId: string;
  cid: string;
  name: string;
  place: string;
  kind: DeclineKind;
  kindLabel: string;
  reason: string;
  date: string;
  age: number;
  method: string;
  amount: number | null;
  scheduleStatus: string | null;
  attempts: number;
  paidSince: string | null;
  state: 'open' | 'paid' | 'ended' | 'done';
  status: string;
  holders: string[];
  phone: string | null;
  email: string | null;
  hasAddress: boolean;
  last: { how: string; at: string; by: string; outcome: string } | null;
}
export interface DeclinesData {
  ok: true;
  today: string;
  synced: string;
  rows: DeclineRow[];
  window: number;
  weekStart: string;
  stats: { open: number; hard: number; soft: number; other: number; closedWeek: number; paid: number };
}

export const declinesQuery = (as = '') =>
  queryOptions({
    queryKey: ['gifts', 'declines', as],
    queryFn: () => workGet<DeclinesData>('/api/work/declines', as),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

export const PAGE = 100;
export const KINDS: Record<string, string> = { hard: 'Hard rejects', soft: 'Soft rejects', other: 'Full amount or zeroed' };
export const STATUS: Record<string, string> = { open: 'Still open', fixed: 'Card or bank fixed', ended: 'Partner ended the gift', unreachable: 'Cannot reach', no_action: 'Nothing to do' };
export const HOW_LABEL: Record<string, string> = { call: 'Call', text: 'Text', email: 'Email', card: 'Card', note: 'Note' };
export const HOWS = ['call', 'text', 'email', 'card', 'note'] as const;
export type How = (typeof HOWS)[number];
export const telHref = (n: string) => 'tel:' + String(n).replace(/[^\d+]/g, '');

export const inKind = (r: DeclineRow, k: string): boolean => !k || (k === 'other' ? r.kind === 'full' || r.kind === 'zeroed' : r.kind === k);
