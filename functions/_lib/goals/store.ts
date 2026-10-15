// Fundraiser goals in FavorOS. The table holds the numbers; the Blackbaud copy (the mirror) still says who each fundraiser is
// (type, team lead, start and end dates). Team goals are derived the way the KPI dashboard derives them (kpi-dashboard
// backend/routes/teams.js), so the two can be tied out line by line before the hub reads from here.
import { HttpError, nowIso, type Env } from '../http';
import { mirror } from '../foundations/blackbaud';
import { audit, hubGet, hubPut } from '../admin/settings';

export const GOAL_FIELDS = ['annual_goal', 'q1_goal', 'q2_goal', 'q3_goal', 'q4_goal', 'prev_q4_goal'] as const;
export type GoalField = (typeof GOAL_FIELDS)[number];
export const SOURCE_KEY = 'goals.source';
export const MAX_GOAL = 1_000_000_000;

export interface Fundraiser {
  id: string;
  name: string;
  type: string;
  lead: boolean;
  active: boolean;
  start: string | null;
  end: string | null;
  /** What the Blackbaud copy holds today, for the "copy from Blackbaud" step and the tie-out. */
  bb: Record<GoalField, number | null>;
}

export interface GoalRow extends Fundraiser {
  goals: Record<GoalField, number | null>;
  note: string;
  updatedBy: string | null;
  updatedAt: string | null;
  saved: boolean;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const day = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);

export async function fundraisers(env: Env): Promise<Fundraiser[]> {
  const rows = await mirror<any>(
    env,
    `SELECT id, TRIM(COALESCE(fundraiser_first_name, '') || ' ' || COALESCE(fundraiser_last_name, '')) AS name, fundraiser_type AS type,
            fundraiser_team_lead AS lead, fundraiser_active AS active, fundraiser_start_date AS start, fundraiser_end_date AS end,
            annual_goal, q1_goal, q2_goal, q3_goal, q4_goal, prev_q4_goal
       FROM fundraisers ORDER BY fundraiser_active DESC, fundraiser_type, fundraiser_last_name`
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name || '').replace(/\s+/g, ' ').trim() || `Fundraiser ${r.id}`,
    type: String(r.type || ''),
    lead: Number(r.lead) === 1,
    active: Number(r.active) === 1,
    start: day(r.start),
    end: day(r.end),
    bb: Object.fromEntries(GOAL_FIELDS.map((f) => [f, num(r[f])])) as Fundraiser['bb'],
  }));
}

interface Stored {
  fundraiser_id: string;
  year: number;
  note: string | null;
  updated_by: string;
  updated_at: string;
  [k: string]: unknown;
}

export async function storedGoals(env: Env, year: number): Promise<Map<string, Stored>> {
  const r = await env.DB.prepare('SELECT * FROM fundraiser_goals WHERE year = ?').bind(year).all<Stored>().catch(() => ({ results: [] as Stored[] }));
  return new Map((r.results || []).map((x) => [String(x.fundraiser_id), x]));
}

export async function listGoals(env: Env, year: number): Promise<GoalRow[]> {
  const [fr, stored] = await Promise.all([fundraisers(env), storedGoals(env, year)]);
  return fr.map((f) => {
    const s = stored.get(f.id);
    return {
      ...f,
      goals: Object.fromEntries(GOAL_FIELDS.map((k) => [k, s ? num(s[k]) : null])) as GoalRow['goals'],
      note: s?.note || '',
      updatedBy: s?.updated_by || null,
      updatedAt: s?.updated_at || null,
      saved: Boolean(s),
    };
  });
}

export interface GoalInput {
  fundraiserId: string;
  year: number;
  goals: Partial<Record<GoalField, number | null>>;
  note?: string;
}

function cleanGoal(label: string, v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_GOAL) throw new HttpError(400, 'bad_goal', `${label} must be an amount from 0 to ${MAX_GOAL.toLocaleString('en-US')}.`);
  return Math.round(n * 100) / 100;
}

const LABEL: Record<GoalField, string> = {
  annual_goal: 'Annual goal',
  q1_goal: 'Quarter 1 goal',
  q2_goal: 'Quarter 2 goal',
  q3_goal: 'Quarter 3 goal',
  q4_goal: 'Quarter 4 goal',
  prev_q4_goal: 'Last year quarter 4 goal',
};

export async function saveGoal(env: Env, actor: string, input: GoalInput): Promise<GoalRow> {
  const year = Number(input.year);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new HttpError(400, 'bad_year', 'Pick a year from 2020 to 2100.');
  const fid = String(input.fundraiserId || '').replace(/\D/g, '');
  const fr = (await fundraisers(env)).find((f) => f.id === fid);
  if (!fr) throw new HttpError(404, 'no_fundraiser', 'That fundraiser is not in Blackbaud.');
  const vals = Object.fromEntries(GOAL_FIELDS.map((f) => [f, cleanGoal(LABEL[f], input.goals?.[f])])) as Record<GoalField, number | null>;
  const note = String(input.note || '').slice(0, 300);
  const before = (await storedGoals(env, year)).get(fid);
  const at = nowIso();
  await env.DB.prepare(
    `INSERT INTO fundraiser_goals (fundraiser_id, year, annual_goal, q1_goal, q2_goal, q3_goal, q4_goal, prev_q4_goal, note, updated_by, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(fundraiser_id, year) DO UPDATE SET annual_goal = excluded.annual_goal, q1_goal = excluded.q1_goal, q2_goal = excluded.q2_goal, q3_goal = excluded.q3_goal,
       q4_goal = excluded.q4_goal, prev_q4_goal = excluded.prev_q4_goal, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  )
    .bind(fid, year, vals.annual_goal, vals.q1_goal, vals.q2_goal, vals.q3_goal, vals.q4_goal, vals.prev_q4_goal, note, actor, at)
    .run();
  await audit(env, {
    actor,
    area: 'goals',
    key: `goals.${year}.${fid}`,
    label: `${fr.name} goals ${year}`,
    before: before ? JSON.stringify(Object.fromEntries(GOAL_FIELDS.map((f) => [f, num(before[f])]))) : null,
    after: JSON.stringify(vals),
    note,
  });
  const row = (await listGoals(env, year)).find((r) => r.id === fid);
  return row!;
}

/** Copies the Blackbaud copy's goals for the year into FavorOS for every fundraiser that has none saved yet. Existing rows stay. */
export async function seedGoals(env: Env, actor: string, year: number): Promise<{ added: number; kept: number }> {
  const [fr, stored] = await Promise.all([fundraisers(env), storedGoals(env, year)]);
  let added = 0;
  const at = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const f of fr) {
    if (stored.has(f.id)) continue;
    if (!GOAL_FIELDS.some((k) => f.bb[k] !== null)) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO fundraiser_goals (fundraiser_id, year, annual_goal, q1_goal, q2_goal, q3_goal, q4_goal, prev_q4_goal, note, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(f.id, year, f.bb.annual_goal, f.bb.q1_goal, f.bb.q2_goal, f.bb.q3_goal, f.bb.q4_goal, f.bb.prev_q4_goal, 'Copied from the Blackbaud copy', actor, at)
    );
    added += 1;
  }
  for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
  await audit(env, { actor, area: 'goals', key: `goals.seed.${year}`, label: `Copied ${added} fundraiser goals from the Blackbaud copy`, before: null, after: String(added), note: '' });
  return { added, kept: stored.size };
}

/** The share of a calendar year a fundraiser is on the team (the KPI dashboard's yearShare). */
export function yearShare(start: string | null, end: string | null, year: number): number {
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year + 1, 0, 1);
  const from = start ? Math.max(yearStart, Date.parse(`${String(start).slice(0, 10)}T00:00:00Z`)) : yearStart;
  const to = end ? Math.min(yearEnd, Date.parse(`${String(end).slice(0, 10)}T00:00:00Z`) + 86400000) : yearEnd;
  return to > from ? (to - from) / (yearEnd - yearStart) : 0;
}

export type TeamKey = 'exec' | 'rdd' | 'grants' | 'pc' | 'ce' | 'mk';
export const TEAM_NAMES: Record<TeamKey, string> = { exec: 'U.S. year goal', rdd: 'RDD team', grants: 'Grants', pc: 'Partner Care', ce: 'Church Engagement', mk: 'Marketing' };

type TeamInput = { type: string; lead: boolean; start: string | null; end: string | null; goal: number | null };

/**
 * Each team's annual goal from per-fundraiser goals, by the dashboard's rules: the year goal is the first Executive Director whose
 * end date has not passed and who has a goal; the RDD team is every RDD's goal for the share of the year they are on the team; the
 * other teams read their team lead.
 */
export function teamGoals(rows: TeamInput[], year: number, today: string): Record<TeamKey, number> {
  const lead = (test: (t: string) => boolean) => rows.find((r) => r.lead && test(r.type));
  const exec = rows.find((r) => /executive/i.test(r.type) && (r.end ? r.end >= today : true) && r.goal !== null);
  const rdd = rows.filter((r) => /RDD/.test(r.type)).reduce((sum, r) => sum + (r.goal ?? 0) * yearShare(r.start, r.end, year), 0);
  return {
    exec: exec?.goal ?? 0,
    rdd: Math.round(rdd),
    grants: lead((t) => /foundation/i.test(t))?.goal ?? 0,
    pc: lead((t) => t === 'Partner Care')?.goal ?? 0,
    ce: lead((t) => /church/i.test(t))?.goal ?? 0,
    mk: lead((t) => t.toLowerCase() === 'marketing')?.goal ?? 0,
  };
}

export function todayEt(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}
export function currentYear(): number {
  return Number(todayEt().slice(0, 4));
}

export async function goalsSource(env: Env): Promise<'dashboard' | 'favoros'> {
  return (await hubGet(env, SOURCE_KEY))?.value === 'favoros' ? 'favoros' : 'dashboard';
}

export async function setGoalsSource(env: Env, actor: string, to: 'dashboard' | 'favoros'): Promise<void> {
  const before = await goalsSource(env);
  await hubPut(env, SOURCE_KEY, to, actor);
  await audit(env, { actor, area: 'goals', key: SOURCE_KEY, label: 'Where fundraiser goals are read from', before, after: to, note: '' });
}

/** Team goals from the FavorOS table for the current year. */
export async function favorosTeamGoals(env: Env): Promise<Record<TeamKey, number>> {
  const year = currentYear();
  const rows = await listGoals(env, year);
  return teamGoals(rows.map((r) => ({ type: r.type, lead: r.lead, start: r.start, end: r.end, goal: r.goals.annual_goal })), year, todayEt());
}

/** Church Engagement's annual goal for a year, from fundraiser_goals (the team lead's row). 0 when no goal is saved. */
export async function churchGoal(env: Env, year: number = currentYear()): Promise<number> {
  const rows = await listGoals(env, year);
  return teamGoals(rows.map((r) => ({ type: r.type, lead: r.lead, start: r.start, end: r.end, goal: r.goals.annual_goal })), year, todayEt()).ce;
}

/** The goals the hub reads when the source is FavorOS; null while the source is still the dashboard. */
export async function activeTeamGoals(env: Env): Promise<Record<TeamKey, number> | null> {
  if ((await goalsSource(env)) !== 'favoros') return null;
  return favorosTeamGoals(env);
}

/** One fundraiser's annual goal when the source is FavorOS, else undefined (the caller keeps the Blackbaud copy's value). */
export async function fundraiserGoalOverride(env: Env, fid: string): Promise<number | null | undefined> {
  if ((await goalsSource(env)) !== 'favoros') return undefined;
  const s = (await storedGoals(env, currentYear())).get(String(fid));
  return s ? num(s.annual_goal) : null;
}
