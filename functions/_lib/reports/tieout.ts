// The tie-out line under every report: this report's total against the KPI dashboard's own figure.
// The hub never recomputes a KPI number. It reads the dashboard's /api/cf/ytd answer (the same
// donor_kpis snapshot and ytd_totals rows the dashboard shows) and compares.
//
// Active, LYBUNT and lapsed counts come only from KpiFigures.status, which is the sync worker's household
// function (re-nxt-cloud-sync src/kpi-builders/donor-kpis.js computeDonorSnapshot). A report must never
// count those groups with its own SQL and call the result the KPI count.
import { kpiGet } from '../hub/kpi';
import type { Env } from '../http';
import type { KpiFigures, TieOut } from './types';

// Totals only, like the Today page's year card, so the hub reads them under the leadership reader.
const READER = { email: 'will@favorintl.org', name: 'Staff hub' };
const CACHE = 'https://hub-cache.favorintl.org/reports/kpi-v1';

export interface YtdAnswer {
  totals?: { allSources?: { giving?: Array<number | null>; gifts?: Array<number | null> }; recurring?: { giving?: Array<number | null>; gifts?: Array<number | null> } };
  donorKpis?: {
    asOf?: string;
    current?: {
      as_of?: string;
      ytd_revenue?: number;
      ytd_gifts?: number;
      active_donors?: number;
      lybunt_donors?: number;
      lapsed_donors?: number;
      window?: { active_after?: string; lapsed_on_or_before?: string };
    };
  } | null;
}

const num = (v: unknown): number | null => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

export function figuresFrom(a: YtdAnswer): KpiFigures {
  const cur = a.donorKpis?.current;
  const pad = (x?: Array<number | null>) => Array.from({ length: 12 }, (_, i) => num(x?.[i]));
  return {
    asOf: cur?.as_of || a.donorKpis?.asOf || '',
    monthlyGiving: pad(a.totals?.allSources?.giving),
    monthlyGifts: pad(a.totals?.allSources?.gifts),
    monthlyRecurring: pad(a.totals?.recurring?.giving),
    monthlyRecurringGifts: pad(a.totals?.recurring?.gifts),
    ytdRevenue: num(cur?.ytd_revenue),
    ytdGifts: num(cur?.ytd_gifts),
    status:
      cur && cur.active_donors !== undefined
        ? {
            active: Number(cur.active_donors),
            lybunt: Number(cur.lybunt_donors),
            lapsed: Number(cur.lapsed_donors),
            activeAfter: cur.window?.active_after || '',
            lapsedOnOrBefore: cur.window?.lapsed_on_or_before || '',
          }
        : null,
  };
}

export async function kpiFigures(env: Env): Promise<KpiFigures | null> {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const hit = cache ? await cache.match(CACHE).catch(() => undefined) : undefined;
  if (hit) return (await hit.json()) as KpiFigures;
  try {
    const f = figuresFrom(await kpiGet<YtdAnswer>(env, '/api/cf/ytd', READER));
    if (cache) {
      await cache.put(CACHE, new Response(JSON.stringify(f), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' } })).catch(() => undefined);
    }
    return f;
  } catch {
    return null;
  }
}

export const round2 = (x: number) => Math.round(x * 100) / 100;

/** Compare a report figure with a KPI figure. Money matches to the cent; counts match exactly. */
export function compare(label: string, mine: number, kpi: number | null | undefined, kind: 'money' | 'count' = 'money', note?: string): TieOut {
  if (kpi === null || kpi === undefined) return { label, mine, kpi: null, kind, status: 'unavailable', note: note || 'The KPI dashboard did not answer.' };
  const diff = kind === 'money' ? round2(Math.abs(round2(mine) - round2(kpi))) : Math.abs(mine - kpi);
  const equal = kind === 'money' ? diff < 0.005 : diff === 0;
  return { label, mine, kpi, kind, status: equal ? 'match' : 'differs', diff: equal ? 0 : diff, note };
}

/** For a report with no KPI line. */
export const noTie = (note = 'This report has no figure on the KPI dashboard.'): TieOut => ({ label: '', mine: 0, kpi: null, kind: 'count', status: 'none', note });
