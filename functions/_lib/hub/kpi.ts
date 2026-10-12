// The KPI dashboard (kpi.favorintl.org) from inside the hub.
//
// The hub never recomputes a KPI number. It signs a short KPI session for the person, asks the KPI
// dashboard's own API (through the service binding, or over the internet when the binding is
// missing), and shows the answer. The same key lets the hub hand a person over to the dashboard
// itself (/api/kpi/enter), so the KPI pages open inside the hub already signed in.
import { HttpError, type Env } from '../http';
import { pace, type Pace } from './reporting-math';

const KPI_URL = 'https://kpi.favorintl.org';
const SUMMARY_CACHE = 'https://hub-cache.favorintl.org/kpi/summary-v2';
const SUMMARY_SECONDS = 15 * 60;

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let s = '';
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An HS256 token in the KPI dashboard's own session format, signed with its key. */
export async function kpiToken(env: Env, claims: Record<string, unknown>, seconds: number): Promise<string> {
  if (!env.KPI_JWT_SECRET) throw new HttpError(503, 'kpi_not_set_up', 'The KPI dashboard is not connected to FavorOS yet.');
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...claims, iat: now, exp: now + seconds }));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.KPI_JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

export function kpiBase(env: Env): string {
  return (env.KPI_URL || KPI_URL).replace(/\/$/, '');
}

export async function kpiGet<T>(env: Env, path: string, who: { email: string; name: string }): Promise<T> {
  const token = await kpiToken(env, { email: who.email, name: who.name }, 300);
  const req = () => new Request(kpiBase(env) + path, { headers: { Cookie: `session=${token}`, 'User-Agent': 'favor-hub' } });
  let res: Response | null = null;
  if (env.KPI) {
    try {
      res = await env.KPI.fetch(req());
    } catch {
      res = null;
    }
  }
  // No binding, or a local copy whose binding has no KPI Worker running beside it (it answers 503).
  if (!res || res.status >= 500) res = await fetch(req());
  if (!res.ok) throw new HttpError(502, 'kpi', `The KPI dashboard answered ${res.status} for ${path}.`);
  return (await res.json()) as T;
}

export interface KpiTeam {
  key: string;
  name: string;
  amount: number;
  goal: number;
  /** "awarded" for Grants, whose goal is measured on awards; "raised" for the others. */
  measure: 'raised' | 'awarded';
}

export interface KpiSummary {
  asOf: string;
  lastUpdated: string | null;
  raised: number;
  goal: number;
  raisedLastYear: number | null;
  teams: KpiTeam[];
  /** Where each total ends the year at this pace (year, rdd, grants, pc, ce, mk). Missing on a copy kept before this existed. */
  pace?: Record<string, Pace>;
}

type Goals = { goals?: { annualGoal?: number }; totals?: { lastYear?: { portfolio?: { giving?: Array<number | null> } } } };

/**
 * The year against goal and each team against its goal, as the KPI dashboard shows them.
 * Kept for fifteen minutes; the dashboard's numbers change once or twice a day.
 */
// Today's year card shows only team totals against goals, which every staff member may see (Will,
// 2026-10-08). The KPI dashboard limits each team's tab by person, so the hub reads those totals under
// a leadership account and caches one copy for everyone.
export const SUMMARY_READER = { email: 'will@favorintl.org', name: 'Staff hub' };

export async function kpiSummary(env: Env): Promise<KpiSummary> {
  const who = SUMMARY_READER;
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(SUMMARY_CACHE).catch(() => undefined);
  if (hit) return (await hit.json()) as KpiSummary;

  const [ytd, fresh, rdd, ce, pc, grants, mk] = await Promise.all([
    kpiGet<{ annualGoal: number; teamTotals: Array<{ team: string; portfolio_amount: number }>; donorKpis?: { current?: { as_of: string; ytd_revenue: number }; lastYear?: { ytd_revenue: number }; trend?: Array<{ asOf: string; ytdRevenue: number }> } }>(env, '/api/cf/ytd', who),
    kpiGet<{ lastUpdated?: string }>(env, '/api/cf/freshness', who).catch(() => ({ lastUpdated: undefined })),
    kpiGet<Goals>(env, '/api/cf/rdd', who),
    kpiGet<Goals>(env, '/api/cf/ce', who),
    kpiGet<Goals>(env, '/api/cf/pc', who),
    kpiGet<Goals & { awards?: { awarded?: number } }>(env, '/api/cf/grants', who),
    kpiGet<Goals>(env, '/api/cf/marketing', who),
  ]);
  const team = (name: string) => Number(ytd.teamTotals.find((t) => t.team === name)?.portfolio_amount) || 0;
  const goal = (g: Goals) => Number(g.goals?.annualGoal) || 0;
  const summary: KpiSummary = {
    asOf: ytd.donorKpis?.current?.as_of || '',
    lastUpdated: fresh.lastUpdated || null,
    raised: Number(ytd.donorKpis?.current?.ytd_revenue) || 0,
    goal: Number(ytd.annualGoal) || 0,
    raisedLastYear: ytd.donorKpis?.lastYear ? Number(ytd.donorKpis.lastYear.ytd_revenue) || 0 : null,
    teams: [
      { key: 'rdd', name: 'RDD team', amount: team('RDDs'), goal: goal(rdd), measure: 'raised' },
      { key: 'grants', name: 'Grants', amount: Number(grants.awards?.awarded) || 0, goal: goal(grants), measure: 'awarded' },
      { key: 'pc', name: 'Partner Care', amount: team('Partner Care'), goal: goal(pc), measure: 'raised' },
      { key: 'ce', name: 'Church Engagement', amount: team('Church Engagement'), goal: goal(ce), measure: 'raised' },
      { key: 'mk', name: 'Marketing', amount: team('Marketing'), goal: goal(mk), measure: 'raised' },
    ],
  };
  summary.pace = paceFor(summary, { rdd, ce, pc, mk }, ytd.donorKpis?.trend || [], ytd.donorKpis?.lastYear ? Number(ytd.donorKpis.lastYear.ytd_revenue) || 0 : null);
  await cache
    .put(SUMMARY_CACHE, new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${SUMMARY_SECONDS}` } }))
    .catch(() => undefined);
  return summary;
}

/** Year and team pacing from the answers the summary already holds. Last year's pattern comes from each team's own monthly totals. */
export function paceFor(summary: KpiSummary, teams: { rdd: Goals; ce: Goals; pc: Goals; mk: Goals }, trend: Array<{ asOf: string; ytdRevenue: number }>, lyToDate: number | null): Record<string, Pace> {
  const asOf = summary.asOf || new Date().toISOString().slice(0, 10);
  const lastYearEnd = trend.find((t) => t.asOf === `${Number(asOf.slice(0, 4)) - 1}-12-31`);
  const out: Record<string, Pace> = {
    year: pace({ key: 'year', name: 'Raised this year', raised: summary.raised, goal: summary.goal, asOf, lyToDate, lyTotal: lastYearEnd ? Number(lastYearEnd.ytdRevenue) || null : null }),
  };
  const monthly: Record<string, Array<number | null> | undefined> = {
    rdd: teams.rdd.totals?.lastYear?.portfolio?.giving,
    pc: teams.pc.totals?.lastYear?.portfolio?.giving,
    ce: teams.ce.totals?.lastYear?.portfolio?.giving,
    mk: teams.mk.totals?.lastYear?.portfolio?.giving,
  };
  for (const t of summary.teams) {
    out[t.key] = pace({ key: t.key, name: t.name, measure: t.measure, raised: t.amount, goal: t.goal, asOf, lastYearMonthly: monthly[t.key] || null });
  }
  return out;
}
