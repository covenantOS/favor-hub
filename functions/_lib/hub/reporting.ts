// Reporting inside the hub: goal pacing, click-to-explain and weekly highlights.
//
// Every number comes from the KPI dashboard (through the service binding, as kpi.ts does) or from the gift rows the
// Favor Brain returns for the same slices the dashboard's revenue-by-source line uses. Nothing is recomputed from a
// second source, and each answer carries a tie: the gifts for a month are added up and set beside the dashboard's own
// month figure, so a gap shows on the page instead of staying hidden.
//
// One copy of the data is kept for fifteen minutes for everyone (the same pattern as kpiSummary). A person's own access
// decides which team sections they may open; the totals on Executive are open to every KPI user.
import { HttpError, type Env } from '../http';
import { isTestPartnerRecord } from '../testpartners.ts';
import { kpiGet, SUMMARY_READER } from './kpi';
import { applyFavorosGoals } from '../goals/apply';
import {
  dayInfo,
  dayLabel,
  explain,
  lastDayOf,
  monthKey,
  money0,
  pace,
  prevMonthKey,
  weeklyHighlight,
  type Change,
  type GiftRow,
  type Highlight,
  type HighlightGrants,
  type Pace,
  type SliceMonth,
} from './reporting-math';

const DATA_SECONDS = 15 * 60;
const BRAIN_URL = 'https://mcp.favorintl.org';

export const SLICES = [
  ['rdds', 'RDDs'],
  ['npmg', 'Non-portfolio major gifts'],
  ['grants', 'Grants Team'],
  ['marketing', 'Marketing'],
  ['pc', 'Partner Care'],
  ['ce', 'Church Engagement'],
  ['other', 'Other'],
  ['none', 'No team credit'],
] as const;

type Monthly = Array<number | null>;
interface KpiMonth {
  month: string;
  now: number | null;
  reported: number | null;
}

interface TeamApi {
  goals?: { annualGoal?: number };
  totals?: { lastYear?: { portfolio?: { giving?: Monthly } }; thisYear?: { portfolio?: { giving?: Monthly } } };
  monthly?: KpiMonth[] | null;
}

interface GrantsApi {
  goals?: { annualGoal?: number };
  awards?: {
    awarded?: number;
    received?: number;
    toCome?: number;
    count?: number;
    enteredThrough?: string;
    months?: Array<{ month: string; awarded: number; awards: number; received: number }>;
    open?: Array<{ name: string; awarded: number; received: number; toCome: number }>;
  };
}

interface YtdApi {
  annualGoal: number;
  teamTotals: Array<{ team: string; portfolio_amount: number }>;
  totals?: { allSources?: { giving?: Monthly } };
  donorKpis?: { current?: { as_of: string; ytd_revenue: number }; lastYear?: { ytd_revenue: number }; trend?: Array<{ asOf: string; ytdRevenue: number }> };
}

export interface TeamDef {
  key: 'rdd' | 'pc' | 'ce' | 'mk' | 'grants';
  name: string;
  /** The KPI dashboard's team key, as /auth/verify lists it. */
  access: string;
  slices: string[];
  teamTotal: string;
  measure: 'raised' | 'awarded';
}

export const TEAMS: TeamDef[] = [
  { key: 'rdd', name: 'RDD team', access: 'rdd', slices: ['rdds'], teamTotal: 'RDDs', measure: 'raised' },
  { key: 'grants', name: 'Grants', access: 'grants', slices: ['grants'], teamTotal: 'Grants Team', measure: 'awarded' },
  { key: 'pc', name: 'Partner Care', access: 'pc', slices: ['pc'], teamTotal: 'Partner Care', measure: 'raised' },
  { key: 'ce', name: 'Church Engagement', access: 'ce', slices: ['ce'], teamTotal: 'Church Engagement', measure: 'raised' },
  { key: 'mk', name: 'Marketing', access: 'marketing', slices: ['marketing'], teamTotal: 'Marketing', measure: 'raised' },
];

export interface ReportData {
  asOf: string;
  lastUpdated: string | null;
  year: { raised: number; goal: number; lyToDate: number | null; trend: Array<{ asOf: string; ytdRevenue: number }>; monthly: Monthly };
  teams: Array<{ key: string; raised: number; goal: number; lastYearMonthly: Monthly | null; thisYearMonthly: Monthly | null; months: KpiMonth[] }>;
  grants: GrantsApi['awards'] | null;
  /** Gift rows for this month and last month, by slice. Empty when the Brain did not answer. */
  slices: SliceMonth[];
  giftsAvailable: boolean;
}

type BrainEnv = Env & { BRAIN_HUB_KEY?: string; BRAIN_URL?: string };

async function brainSlice(env: BrainEnv, slice: string, label: string, month: string): Promise<SliceMonth | null> {
  if (!env.BRAIN_HUB_KEY) return null;
  try {
    const res = await fetch(`${(env.BRAIN_URL || BRAIN_URL).replace(/\/$/, '')}/hub/drill`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.BRAIN_HUB_KEY}`,
        'X-Acting-Email': SUMMARY_READER.email,
        'X-Acting-Name': SUMMARY_READER.name,
        'Content-Type': 'application/json',
        'User-Agent': 'favor-hub',
      },
      body: JSON.stringify({ kind: 'slice', slice, month }),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { ok?: boolean; rows?: Array<Record<string, unknown>>; total?: number; count?: number };
    if (d.ok === false) return null;
    const kept = (d.rows || []).filter((r) => !isTestPartnerRecord(r.record_id));
    const dropped = (d.rows || []).filter((r) => isTestPartnerRecord(r.record_id));
    const rows: GiftRow[] = kept.map((r) => ({
      date: String(r.date || '').slice(0, 10),
      partner: String(r.partner || ''),
      cid: r.record_id != null && String(r.record_id) ? String(r.record_id) : null,
      amount: Number(r.amount) || 0,
      gift_amount: Number(r.gift_amount) || 0,
    }));
    const droppedTotal = dropped.reduce((t, r) => t + (Number(r.amount) || 0), 0);
    return { slice, label, month, rows, total: (Number(d.total) || 0) - droppedTotal, count: (Number(d.count) || d.rows?.length || 0) - dropped.length };
  } catch {
    return null;
  }
}

// v2 (2026-10-14): gift rows carry the partner's record id, and a third month feeds the 8-week line on the highlight cards.
const SNAP_KEY = 'data-v2';
const FRESH_MS = DATA_SECONDS * 1000;
const LOCK_MS = 3 * 60 * 1000;

/**
 * The stored copy of the last full read, served at once. A copy older than fifteen minutes is rebuilt in the background
 * (one rebuild at a time), so a page never waits on the KPI dashboard and the Favor Brain. Only the very first read, or a
 * read before the table exists, builds in the request.
 */
export async function reportData(env: Env, waitUntil?: (p: Promise<unknown>) => void): Promise<ReportData> {
  let row: { data: string; built_at: string } | null = null;
  try {
    row = await env.DB.prepare('SELECT data, built_at FROM report_snapshots WHERE key = ?').bind(SNAP_KEY).first<{ data: string; built_at: string }>();
  } catch {
    return buildReportData(env);
  }
  // A row still holding the placeholder (a first build that failed or is running) is no copy: build it here.
  if (row && row.data && row.data !== 'null') {
    const age = Date.now() - new Date(row.built_at).getTime();
    if (age > FRESH_MS && waitUntil) waitUntil(refreshSnapshot(env).catch(() => undefined));
    return JSON.parse(row.data) as ReportData;
  }
  return refreshSnapshot(env);
}

/** Rebuilds the stored copy unless another rebuild started in the last three minutes. */
export async function refreshSnapshot(env: Env): Promise<ReportData> {
  const now = new Date().toISOString();
  const lock = new Date(Date.now() - LOCK_MS).toISOString();
  await env.DB.prepare('INSERT OR IGNORE INTO report_snapshots (key, data, built_at) VALUES (?, ?, ?)').bind(SNAP_KEY, 'null', '1970-01-01T00:00:00.000Z').run().catch(() => undefined);
  const got = await env.DB.prepare('UPDATE report_snapshots SET refreshing_at = ? WHERE key = ? AND (refreshing_at IS NULL OR refreshing_at < ?)').bind(now, SNAP_KEY, lock).run();
  if (!(got.meta?.changes > 0)) {
    const cur = await env.DB.prepare('SELECT data FROM report_snapshots WHERE key = ?').bind(SNAP_KEY).first<{ data: string }>();
    if (cur && cur.data !== 'null') return JSON.parse(cur.data) as ReportData;
  }
  try {
    const data = await buildReportData(env);
    await env.DB.prepare('UPDATE report_snapshots SET data = ?, built_at = ?, refreshing_at = NULL WHERE key = ?').bind(JSON.stringify(data), new Date().toISOString(), SNAP_KEY).run();
    return data;
  } catch (err) {
    await env.DB.prepare('UPDATE report_snapshots SET refreshing_at = NULL WHERE key = ?').bind(SNAP_KEY).run().catch(() => undefined);
    throw err;
  }
}

export async function buildReportData(env: Env): Promise<ReportData> {
  const who = SUMMARY_READER;
  const [ytd, fresh, rdd, ce, pc, grants, mk] = await Promise.all([
    kpiGet<YtdApi>(env, '/api/cf/ytd', who),
    kpiGet<{ lastUpdated?: string }>(env, '/api/cf/freshness', who).catch(() => ({ lastUpdated: undefined })),
    kpiGet<TeamApi>(env, '/api/cf/rdd', who),
    kpiGet<TeamApi>(env, '/api/cf/ce', who),
    kpiGet<TeamApi>(env, '/api/cf/pc', who),
    kpiGet<GrantsApi>(env, '/api/cf/grants', who),
    kpiGet<TeamApi>(env, '/api/cf/marketing', who),
  ]);
  await applyFavorosGoals(env, { ytd, rdd, ce, pc, grants, mk });
  const asOf = ytd.donorKpis?.current?.as_of || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const thisKey = monthKey(asOf);
  const prevKey = prevMonthKey(asOf);
  const prev2Key = prevMonthKey(prevKey + '-15');
  const apis: Record<string, TeamApi | GrantsApi> = { rdd, ce, pc, mk, grants };
  const total = (name: string) => Number(ytd.teamTotals.find((t) => t.team === name)?.portfolio_amount) || 0;

  const pulls = await Promise.all(SLICES.flatMap(([slice, label]) => [brainSlice(env, slice, label, thisKey), brainSlice(env, slice, label, prevKey), brainSlice(env, slice, label, prev2Key)]));
  const slices = pulls.filter((s): s is SliceMonth => !!s);

  const data: ReportData = {
    asOf,
    lastUpdated: fresh.lastUpdated || null,
    year: {
      raised: Number(ytd.donorKpis?.current?.ytd_revenue) || 0,
      goal: Number(ytd.annualGoal) || 0,
      lyToDate: ytd.donorKpis?.lastYear ? Number(ytd.donorKpis.lastYear.ytd_revenue) || 0 : null,
      trend: ytd.donorKpis?.trend || [],
      monthly: ytd.totals?.allSources?.giving || [],
    },
    teams: TEAMS.map((t) => {
      const api = apis[t.key] as TeamApi & GrantsApi;
      return {
        key: t.key,
        raised: t.key === 'grants' ? Number(grants.awards?.awarded) || 0 : total(t.teamTotal),
        goal: Number(api.goals?.annualGoal) || 0,
        lastYearMonthly: api.totals?.lastYear?.portfolio?.giving || null,
        thisYearMonthly: api.totals?.thisYear?.portfolio?.giving || null,
        months: Array.isArray(api.monthly) ? api.monthly : [],
      };
    }),
    grants: grants.awards || null,
    slices,
    // This month and last month for every slice; the third month only lengthens the 8-week line.
    giftsAvailable: slices.filter((x) => x.month !== prev2Key).length === SLICES.length * 2,
  };
  return data;
}

const sliceOf = (data: ReportData, slices: string[], month: string): SliceMonth[] => data.slices.filter((s) => slices.includes(s.slice) && s.month === month);

const teamDef = (key: string) => TEAMS.find((t) => t.key === key);

/** Year pace and each team's pace, from the same figures the Executive page and the team tabs show. */
export function paces(data: ReportData): Record<string, Pace> {
  const lastYearEnd = data.year.trend.find((t) => t.asOf === `${Number(data.asOf.slice(0, 4)) - 1}-12-31`);
  const out: Record<string, Pace> = {
    year: pace({ key: 'year', name: 'Raised this year', raised: data.year.raised, goal: data.year.goal, asOf: data.asOf, lyToDate: data.year.lyToDate, lyTotal: lastYearEnd ? Number(lastYearEnd.ytdRevenue) || null : null }),
  };
  for (const t of TEAMS) {
    const row = data.teams.find((x) => x.key === t.key);
    if (!row) continue;
    out[t.key] = pace({ key: t.key, name: t.name, measure: t.measure, raised: row.raised, goal: row.goal, asOf: data.asOf, lastYearMonthly: row.lastYearMonthly });
  }
  return out;
}

export interface HighlightSet {
  week: { from: string; to: string };
  overall: Highlight;
  teams: Highlight[];
}

function grantsLines(data: ReportData): string[] {
  const g = data.grants;
  if (!g) return [];
  const lines: string[] = [];
  const m = (g.months || []).find((x) => x.month === monthKey(data.asOf));
  const last = (g.months || []).find((x) => x.month === prevMonthKey(data.asOf));
  lines.push(`${money0(Number(g.awarded) || 0)} awarded this year from ${Number(g.count) || 0} awards, ${money0(Number(g.received) || 0)} of it received.`);
  if (m && last) lines.push(m.awards ? `${m.awards} ${m.awards === 1 ? 'award' : 'awards'} entered this month for ${money0(m.awarded)}. Last month had ${last.awards} for ${money0(last.awarded)}.` : `No awards are entered this month yet. Last month had ${last.awards} for ${money0(last.awarded)}.`);
  if (g.toCome) lines.push(`${money0(Number(g.toCome))} is still to come from ${(g.open || []).length} open ${(g.open || []).length === 1 ? 'award' : 'awards'}.`);
  if (g.enteredThrough) lines.push(`Awards are entered through ${dayLabel(g.enteredThrough)}.`);
  return lines;
}

function grantsCard(data: ReportData): HighlightGrants | null {
  const g = data.grants;
  if (!g) return null;
  const m = (g.months || []).find((x) => x.month === monthKey(data.asOf));
  const last = (g.months || []).find((x) => x.month === prevMonthKey(data.asOf));
  return {
    awarded: Number(g.awarded) || 0,
    count: Number(g.count) || 0,
    received: Number(g.received) || 0,
    toCome: Number(g.toCome) || 0,
    open: (g.open || []).length,
    thisMonth: m ? { awards: m.awards, awarded: m.awarded } : null,
    lastMonth: last ? { awards: last.awards, awarded: last.awarded } : null,
    enteredThrough: g.enteredThrough || null,
  };
}

export function highlights(data: ReportData, allowed: string[] | 'all'): HighlightSet {
  const p = paces(data);
  const thisKey = monthKey(data.asOf);
  const prevKey = prevMonthKey(data.asOf);
  const prev2Key = prevMonthKey(prevKey + '-15');
  const rowsOf = (slices: string[]) => [thisKey, prevKey, prev2Key].flatMap((m) => sliceOf(data, slices, m).flatMap((s) => s.rows));
  // The 8-week line starts where every slice it covers has rows: the month before last when it loaded, last month otherwise.
  const fromOf = (slices: string[]) => (slices.every((sl) => data.slices.some((x) => x.slice === sl && x.month === prev2Key)) ? prev2Key + '-01' : prevKey + '-01');
  const monthTotal = (slices: string[], month: string) => (data.giftsAvailable ? sliceOf(data, slices, month).reduce((s, x) => s + x.total, 0) : null);
  const overall = weeklyHighlight({
    key: 'year',
    name: 'All of Favor',
    asOf: data.asOf,
    rows: rowsOf(SLICES.map(([s]) => s)),
    rowsFrom: fromOf(SLICES.map(([s]) => s)),
    pace: p.year || null,
    monthSoFar: monthTotal(SLICES.map(([s]) => s), thisKey),
    lastMonthTotal: monthTotal(SLICES.map(([s]) => s), prevKey),
  });
  const teams = TEAMS.filter((t) => allowed === 'all' || allowed.includes(t.access)).map((t) =>
    weeklyHighlight({
      key: t.key,
      name: t.name,
      asOf: data.asOf,
      rows: rowsOf(t.slices),
      rowsFrom: fromOf(t.slices),
      pace: p[t.key] || null,
      monthSoFar: t.key === 'grants' ? null : monthTotal(t.slices, thisKey),
      lastMonthTotal: t.key === 'grants' ? null : monthTotal(t.slices, prevKey),
      extra: t.key === 'grants' ? grantsLines(data) : [],
      grants: t.key === 'grants' ? grantsCard(data) : null,
      noun: t.key === 'grants' ? 'grant payment' : 'gift',
    }),
  );
  return { week: { from: overall.from, to: overall.to }, overall, teams };
}

export interface Explained extends Change {
  /** A gap between the month's gifts and the dashboard's month figure, when there is one, with the reason in one line. */
  tie: { gifts: number; kpi: number; ok: boolean; note?: string } | null;
  /** Grants only: the open awards, since awards are not gifts. */
  awards?: Array<{ name: string; awarded: number; received: number; toCome: number }>;
}

/** The tie line. A gift list that runs ahead of the dashboard is gifts that arrived after the dashboard's last rebuild. */
function tieOf(data: ReportData, gifts: number, kpi: number): { gifts: number; kpi: number; ok: boolean; note?: string } {
  const gap = Math.round((gifts - kpi) * 100) / 100;
  if (Math.abs(gap) < 0.01) return { gifts, kpi, ok: true };
  const at = data.lastUpdated ? new Date(data.lastUpdated).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '';
  const dollars = '$' + Math.abs(gap).toFixed(2);
  const note = gap > 0
    ? `The ${dollars} difference is a gift entered in Blackbaud after the dashboard last rebuilt${at ? ' at ' + at + ' Eastern' : ''}. It closes at the next rebuild, 5 a.m. or 5 p.m.`
    : `The dashboard counts ${dollars} more than the gifts listed, from a gift changed after the dashboard last rebuilt.`;
  return { gifts, kpi, ok: false, note };
}

/** The "what is in it and why it changed" answer for the year or one team. */
export function explainKey(data: ReportData, key: string): Explained {
  const thisKey = monthKey(data.asOf);
  const prevKey = prevMonthKey(data.asOf);
  const d = dayInfo(data.asOf);
  if (key === 'year') {
    const all = SLICES.map(([s]) => s);
    const end = data.year.trend.find((t) => t.asOf === lastDayOf(prevKey));
    const endAmount = end ? Number(end.ytdRevenue) : data.year.monthly.length ? data.year.monthly.slice(0, d.month - 1).reduce<number>((s, v) => s + (Number(v) || 0), 0) : null;
    const thisMonth = sliceOf(data, all, thisKey);
    const out = explain({ key, label: 'Raised so far this year', asOf: data.asOf, shown: data.year.raised, endLastMonth: endAmount, thisMonth, lastMonth: sliceOf(data, all, prevKey) });
    const kpiMonth = data.year.monthly[d.month - 1];
    const gifts = thisMonth.reduce((s, x) => s + x.total, 0);
    return { ...out, tie: data.giftsAvailable && kpiMonth != null ? tieOf(data, gifts, Number(kpiMonth)) : null };
  }
  const t = teamDef(key);
  const row = data.teams.find((x) => x.key === key);
  if (!t || !row) throw new HttpError(400, 'bad_key', 'That number has no explanation to open.');
  if (key === 'grants') {
    const g = data.grants;
    const m = (g?.months || []).find((x) => x.month === thisKey);
    const last = (g?.months || []).find((x) => x.month === prevKey);
    const monthsBefore = (g?.months || []).filter((x) => x.month < thisKey).reduce((s, x) => s + x.awarded, 0);
    const story: string[] = [];
    if (m) story.push(`${m.awards} ${m.awards === 1 ? 'award is' : 'awards are'} entered for ${money0(m.awarded)} in the month so far.`);
    if (last) story.push(`Last month had ${last.awards} for ${money0(last.awarded)}.`);
    if (g?.enteredThrough) story.push(`Awards are entered through ${g.enteredThrough}, so a month can fill in after it starts.`);
    story.push(`${money0(Number(g?.received) || 0)} of the ${money0(row.raised)} awarded has been received and ${money0(Number(g?.toCome) || 0)} is still to come.`);
    return {
      key,
      label: 'Grants awarded this year',
      asOf: data.asOf,
      shown: row.raised,
      headline: m ? `${money0(row.raised)} awarded this year, ${money0(monthsBefore)} of it by the end of ${prevKey}.` : `${money0(row.raised)} awarded this year.`,
      story,
      from: { label: `end of ${prevKey}`, amount: monthsBefore },
      delta: row.raised - monthsBefore,
      lines: (g?.months || []).filter((x) => x.awarded || x.received).map((x) => ({ label: x.month, amount: x.awarded, note: `${x.awards} ${x.awards === 1 ? 'award' : 'awards'}` })),
      linesLabel: 'Awarded by month',
      top: [],
      topLabel: '',
      tie: { gifts: (g?.months || []).reduce((s, x) => s + x.awarded, 0), kpi: row.raised, ok: Math.abs((g?.months || []).reduce((s, x) => s + x.awarded, 0) - row.raised) < 0.01 },
      awards: g?.open || [],
    };
  }
  const monthNow = row.months.find((x) => x.month === thisKey);
  const monthsBefore = row.months.filter((x) => x.month < thisKey).reduce((s, x) => s + (Number(x.now) || 0), 0);
  const lastRow = row.months.find((x) => x.month === prevKey);
  const restated = lastRow && lastRow.reported != null && lastRow.now != null ? { month: prevKey, reported: Number(lastRow.reported), now: Number(lastRow.now) } : null;
  const thisMonth = sliceOf(data, t.slices, thisKey);
  const out = explain({ key, label: `${t.name}, this year`, asOf: data.asOf, shown: row.raised, endLastMonth: row.months.length ? monthsBefore : null, thisMonth, lastMonth: sliceOf(data, t.slices, prevKey), restated });
  const gifts = thisMonth.reduce((s, x) => s + x.total, 0);
  const kpi = monthNow && monthNow.now != null ? Number(monthNow.now) : null;
  return { ...out, tie: data.giftsAvailable && kpi != null ? tieOf(data, gifts, kpi) : null };
}

/** The KPI teams this person may open, as /auth/verify lists them; every team for the agent and script sessions. */
export async function teamsOf(env: Env, user: { email: string; name: string; via?: string }): Promise<string[]> {
  if (user.via !== 'google') return TEAMS.map((t) => t.access);
  try {
    const v = await kpiGet<{ teams?: string[] }>(env, '/auth/verify', { email: user.email, name: user.name });
    return Array.isArray(v.teams) ? v.teams : [];
  } catch {
    return [];
  }
}
