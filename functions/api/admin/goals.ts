import { HttpError } from '../../_lib/http';
import { adminRoute, readBody } from '../../_lib/admin/route';
import { currentYear, goalsSource, listGoals, saveGoal, seedGoals, setGoalsSource } from '../../_lib/goals/store';
import { tieOut } from '../../_lib/goals/tieout';
import { dropSummaryCache } from '../../_lib/hub/kpi';

function yearOf(raw: unknown): number {
  const y = Number(raw) || currentYear();
  if (!Number.isInteger(y) || y < 2020 || y > 2100) throw new HttpError(400, 'bad_year', 'Pick a year from 2020 to 2100.');
  return y;
}

// Fundraiser goals. GET ?year= returns every fundraiser with the goals saved for the year, the source the hub reads, and (for the
// current year) the tie-out against the KPI dashboard. PUT saves one fundraiser. POST {action: "seed"} copies the Blackbaud copy's
// goals into FavorOS where none are saved; POST {action: "source", to} switches where the hub reads goals, and refuses "favoros"
// unless every team's goal ties out to the dashboard first.
export const onRequestGet = adminRoute(async ({ env, url }) => {
  const year = yearOf(url.searchParams.get('year'));
  const [rows, source] = await Promise.all([listGoals(env, year), goalsSource(env)]);
  const tie = year === currentYear() ? await tieOut(env).catch(() => null) : null;
  return { year, currentYear: currentYear(), source, rows, tie };
});

export const onRequestPut = adminRoute(async ({ env, request, user }) => {
  const b = await readBody(request);
  const row = await saveGoal(env, user.email, { fundraiserId: String(b.fundraiserId || ''), year: yearOf(b.year), goals: b.goals || {}, note: b.note });
  if ((await goalsSource(env)) === 'favoros') await dropSummaryCache();
  return { row };
});

export const onRequestPost = adminRoute(async ({ env, request, user }) => {
  const b = await readBody(request);
  if (b.action === 'seed') return { ...(await seedGoals(env, user.email, yearOf(b.year))) };
  if (b.action === 'source') {
    const to = b.to === 'favoros' ? 'favoros' : 'dashboard';
    if (to === 'favoros') {
      const t = await tieOut(env);
      if (!t.allMatch) throw new HttpError(409, 'not_tied', 'The goals in FavorOS do not match the KPI dashboard yet. Fix the lines marked as different first.');
    }
    await setGoalsSource(env, user.email, to);
    await dropSummaryCache();
    return { source: to };
  }
  throw new HttpError(400, 'bad_action', 'Use seed or source.');
});
