// Reads for the Gifts pages. Each goes through hubGet (the server asks /api with the visitor's cookie while the page renders, the browser
// asks the usual way) and is drawn with useSuspenseQuery inside Suspense. A read that fails comes back as { error: status } so the card
// that needs it says so and the rest of the page still draws.
import { queryOptions } from '@tanstack/react-query';
import { hubGet, HubReadError } from '../../lib/hub';

export type Failed = { error: number };
export type Read<T> = T | Failed;
export const failed = <T,>(r: Read<T>): r is Failed => !!r && typeof r === 'object' && 'error' in (r as object) && typeof (r as Failed).error === 'number';

async function read<T>(path: string): Promise<Read<T>> {
  try {
    return (await hubGet(path)) as T;
  } catch (e) {
    return { error: e instanceof HubReadError ? e.status : 0 };
  }
}

export interface OnlineRow { name: string; cents: number; date: string; kind?: string; cid?: string }
export interface LetterRow { name: string; cents: number; fund?: string; date: string; state?: string; stateLabel?: string }
export interface ChartDay { date: string; weekday: string; checksCents: number; cardCents: number; otherCents: number }
export interface Overview {
  ok: true;
  today: string;
  pickupDay?: boolean;
  mail?: { startedToday: number; openDeposits: number } | null;
  online?: { toApprove: number; cents: number; rows: OnlineRow[] } | null;
  review?: { waiting: number } | null;
  blackbaud?: { deposits: number; items: number; cents: number } | null;
  receipts?: { left: number; lastFile: { at: string; gifts: number; marked: number } | null } | null;
  letters?: { month: number; rows: LetterRow[] } | null;
  chart?: { days: ChartDay[]; capCents: number } | null;
}
export interface MonthDeposit {
  source: string;
  status: string;
  favorosId?: string | null;
  kind?: string;
  batch?: string | null;
  giftDate: string;
  items: number;
  cash?: number;
  totalCents: number;
  addedDate?: string;
}
export interface Month {
  ok: true;
  ym: string;
  deposits: MonthDeposit[];
  totals: { deposits: number; items: number; totalCents: number };
}

export const overviewQuery = queryOptions({ queryKey: ['gifts', 'overview'] as const, queryFn: () => read<Overview>('/api/gifts/overview'), staleTime: 20_000 });
export const monthQuery = queryOptions({ queryKey: ['gifts', 'month'] as const, queryFn: () => read<Month>('/api/gift-entry/month'), staleTime: 20_000 });
