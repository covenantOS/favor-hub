// Puts the FavorOS goals into the answers read from the KPI dashboard, once an admin has switched the source (goals.source).
// Only the annual goal changes. Totals, quarters and pace inputs keep coming from the dashboard.
import type { Env } from '../http';
import { activeTeamGoals } from './store';

type Goals = { goals?: { annualGoal?: number } };

export async function applyFavorosGoals(
  env: Env,
  a: { ytd: { annualGoal?: number }; rdd: Goals; ce: Goals; pc: Goals; grants: Goals; mk: Goals }
): Promise<boolean> {
  const g = await activeTeamGoals(env).catch(() => null);
  if (!g) return false;
  a.ytd.annualGoal = g.exec;
  for (const k of ['rdd', 'ce', 'pc', 'grants', 'mk'] as const) a[k].goals = { ...(a[k].goals || {}), annualGoal: g[k] };
  return true;
}
