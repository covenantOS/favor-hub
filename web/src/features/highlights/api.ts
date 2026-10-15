// Reporting > Highlights: the reads and writes behind the page. Light on purpose: the route file imports this module (never a component) so
// the first-screen script stays under the budget. The server's rules apply unchanged: /api/hub/reporting answers only people the KPI
// dashboard lets in, a team's section only for the people that team's tab lets in, and pins are private to the person who pinned them.
import { queryOptions } from '@tanstack/react-query';
import type { Highlight } from '@/features/highlights/HighlightCards';
import { hubGet } from '../../lib/hub';

export type PaceStatus = 'ahead' | 'close' | 'behind';

export interface Pace {
  key: string;
  name: string;
  measure: 'raised' | 'awarded';
  raised: number;
  goal: number;
  pctGoal: number;
  pctYear: number;
  expected: number;
  projectedLow: number;
  projectedHigh: number;
  status: PaceStatus;
  toGo: number;
  weeksLeft: number;
  perWeekNeeded: number;
}

/** A card's figures plus the sentences the server writes from the same fields (Copy as text uses the sentences). */
export type WeekHighlight = Highlight & { headline: string; lines: string[] };

export interface WeekAnswer {
  ok: boolean;
  asOf: string;
  lastUpdated?: string;
  giftsAvailable: boolean;
  teams: Array<{ key: string; name: string; measure: string }>;
  pace: Record<string, Pace>;
  highlights: { week: { from: string; to: string }; overall: WeekHighlight; teams: WeekHighlight[] };
}

export interface Pin {
  id: string;
  title: string;
  question: string;
  answer: { blocks?: Array<{ type: string; [k: string]: unknown }>; markdown?: string };
  asked_at: string;
  pos: number;
}

export interface PinsAnswer {
  ok: boolean;
  pins: Pin[];
  max: number;
}

export const weekQuery = queryOptions({
  queryKey: ['reporting', 'week'] as const,
  queryFn: async (): Promise<WeekAnswer> => (await hubGet('/api/hub/reporting')) as WeekAnswer,
  staleTime: 20_000,
});

export const pinsQuery = queryOptions({
  queryKey: ['reporting', 'pins'] as const,
  queryFn: async (): Promise<PinsAnswer> => (await hubGet('/api/reporting/pins')) as PinsAnswer,
  staleTime: 20_000,
});

export interface Sent {
  ok?: boolean;
  message?: string;
  pin?: Pin;
}

/** A write the person started (move, rename, unpin, refresh). It answers with the server's message instead of throwing, like the classic page's api(). */
export async function sendPin(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<Sent> {
  try {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Hub-Request': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = (await res.json().catch(() => ({}))) as Sent;
    return res.ok ? d : { ...d, ok: false };
  } catch {
    return { ok: false, message: 'FavorOS could not be reached. Check the connection and try again.' };
  }
}
