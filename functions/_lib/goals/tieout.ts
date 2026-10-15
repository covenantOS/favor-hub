// Ties the goals FavorOS holds to the ones the KPI dashboard shows, team by team, before the hub reads from FavorOS.
import type { Env } from '../http';
import { kpiGet, SUMMARY_READER } from '../hub/kpi';
import { favorosTeamGoals, TEAM_NAMES, type TeamKey } from './store';

export interface TieLine {
  key: TeamKey;
  name: string;
  dashboard: number;
  favoros: number;
  match: boolean;
}

type Goals = { goals?: { annualGoal?: number } };

/** The dashboard's own annual goal per team, read fresh under the hub's reader account (no cache). */
export async function dashboardGoals(env: Env): Promise<Record<TeamKey, number>> {
  const who = SUMMARY_READER;
  const [ytd, rdd, ce, pc, grants, mk] = await Promise.all([
    kpiGet<{ annualGoal?: number }>(env, '/api/cf/ytd', who),
    kpiGet<Goals>(env, '/api/cf/rdd', who),
    kpiGet<Goals>(env, '/api/cf/ce', who),
    kpiGet<Goals>(env, '/api/cf/pc', who),
    kpiGet<Goals>(env, '/api/cf/grants', who),
    kpiGet<Goals>(env, '/api/cf/marketing', who),
  ]);
  const g = (x: Goals) => Number(x.goals?.annualGoal) || 0;
  return { exec: Number(ytd.annualGoal) || 0, rdd: g(rdd), grants: g(grants), pc: g(pc), ce: g(ce), mk: g(mk) };
}

export async function tieOut(env: Env): Promise<{ lines: TieLine[]; allMatch: boolean }> {
  const [dash, mine] = await Promise.all([dashboardGoals(env), favorosTeamGoals(env)]);
  const lines = (Object.keys(TEAM_NAMES) as TeamKey[]).map((key) => ({
    key,
    name: TEAM_NAMES[key],
    dashboard: dash[key],
    favoros: mine[key],
    // Whole dollars: the dashboard rounds the RDD sum and the others are stored amounts.
    match: Math.round(dash[key]) === Math.round(mine[key]),
  }));
  return { lines, allMatch: lines.every((l) => l.match) };
}
