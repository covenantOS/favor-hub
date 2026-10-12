// Workload across the team: open tasks by owner and week, each person measured against their own usual week.
//   usual week   the median number of tasks that came due per week over the last 12 weeks (done or open), at least 3 weeks of history
//   heavy        a week above max(1.5 x usual, usual + 3, 6)
//   overloaded   a week above max(2 x usual, usual + 6, 10)
//   behind       five or more open tasks already past due
// High priority counts 1.5 and low priority 0.5, so ten routine posts weigh less than ten deadlines. A person with no history
// is measured against a usual week of 4.
import type { Env } from '../../http';
import { staffDirectory, type Person } from '../../people';
import { visibleTask, type Actor } from '../access';
import { lower, todayEastern } from '../db';

export const DAY = 86400000;
export const dn = (s: string): number => Math.floor(Date.parse(s + 'T12:00:00Z') / DAY);
export const ymd = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10);
/** Monday of the week holding this date. */
export const weekStart = (s: string): string => {
  const n = dn(s);
  const dow = (n + 4) % 7; // 1970-01-01 was a Thursday; 0 = Sunday
  return ymd(n - ((dow + 6) % 7));
};
export const addDays = (s: string, d: number): string => ymd(dn(s) + d);

export type Level = 'ok' | 'heavy' | 'over';

export const weightOf = (priority: string | null | undefined): number => (priority === 'high' ? 1.5 : priority === 'low' ? 0.5 : 1);

export function levelFor(weight: number, usual: number): Level {
  const heavy = Math.max(Math.ceil(usual * 1.5), usual + 3, 6);
  const over = Math.max(usual * 2, usual + 6, 10);
  return weight > over ? 'over' : weight > heavy ? 'heavy' : 'ok';
}

export interface LoadTask {
  code: string | null;
  title: string;
  project_key: string | null;
  due: string;
  priority: string;
}

export interface WeekCell {
  start: string;
  count: number;
  weight: number;
  level: Level;
  tasks: LoadTask[];
}

export interface PersonLoad {
  email: string;
  name: string;
  title: string;
  team: string;
  picture: string;
  usual: number;
  history: number;
  overdue: number;
  undated: number;
  open: number;
  behind: boolean;
  level: Level;
  weeks: WeekCell[];
}

export interface Warning {
  email: string;
  name: string;
  week: string;
  count: number;
  usual: number;
  level: Level | 'behind';
  text: string;
}

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

interface OpenRow {
  owner_email: string;
  due_date: string | null;
  priority: string;
  code: string | null;
  title: string;
  project_key: string | null;
}

/** Each person's usual week from the last 12 weeks of due dates. */
export async function usualWeeks(env: Env, today: string): Promise<Map<string, { usual: number; history: number }>> {
  const from = addDays(weekStart(today), -84);
  const rows = await env.DB.prepare(
    `SELECT owner_email, due_date FROM hub_tasks WHERE owner_email IS NOT NULL AND due_date IS NOT NULL AND due_date >= ? AND due_date < ? AND status <> 'dropped'`
  )
    .bind(from, weekStart(today))
    .all<{ owner_email: string; due_date: string }>();
  const per = new Map<string, Map<string, number>>();
  for (const r of rows.results || []) {
    const e = lower(r.owner_email);
    const w = weekStart(r.due_date);
    const m = per.get(e) || new Map<string, number>();
    m.set(w, (m.get(w) || 0) + 1);
    per.set(e, m);
  }
  const out = new Map<string, { usual: number; history: number }>();
  for (const [e, m] of per) out.set(e, { usual: m.size >= 3 ? Math.max(1, median([...m.values()])) : 4, history: m.size });
  return out;
}

export interface WorkloadOut {
  today: string;
  weeks: string[];
  people: PersonLoad[];
  warnings: Warning[];
}

/** The team's load for the next `weeks` weeks. A person sees the tasks the projects rules let them see. */
export async function teamWorkload(env: Env, actor: Actor, opts: { weeks?: number; team?: string; today?: string } = {}): Promise<WorkloadOut> {
  const today = opts.today || todayEastern();
  const n = Math.max(2, Math.min(12, Math.floor(Number(opts.weeks)) || 8));
  const w0 = weekStart(today);
  const weeks = Array.from({ length: n }, (_, i) => addDays(w0, i * 7));
  const vis = visibleTask(actor, 't');
  const [dir, usual, rows] = await Promise.all([
    staffDirectory(env),
    usualWeeks(env, today),
    env.DB.prepare(
      `SELECT t.owner_email, t.due_date, t.priority, t.code, t.title, p.key AS project_key
         FROM hub_tasks t LEFT JOIN hub_projects p ON p.id = t.project_id
        WHERE t.owner_email IS NOT NULL AND t.status NOT IN ('done', 'dropped') AND (p.id IS NULL OR p.status = 'active') AND ${vis.sql}
        ORDER BY t.due_date LIMIT 6000`
    )
      .bind(...vis.args)
      .all<OpenRow>(),
  ]);
  const team = lower(opts.team);
  const people = new Map<string, PersonLoad>();
  const mk = (p: Person): PersonLoad => ({
    email: p.email, name: p.name, title: p.title, team: p.team, picture: p.picture,
    usual: usual.get(p.email)?.usual ?? 4, history: usual.get(p.email)?.history ?? 0,
    overdue: 0, undated: 0, open: 0, behind: false, level: 'ok',
    weeks: weeks.map((start) => ({ start, count: 0, weight: 0, level: 'ok' as Level, tasks: [] })),
  });
  for (const p of dir) if (!team || lower(p.team) === team) people.set(p.email, mk(p));
  const end = addDays(weeks[n - 1], 6);
  for (const r of rows.results || []) {
    const row = people.get(lower(r.owner_email));
    if (!row) continue;
    row.open++;
    if (!r.due_date) {
      row.undated++;
      continue;
    }
    if (r.due_date < today) {
      row.overdue++;
      continue;
    }
    if (r.due_date > end) continue;
    const cell = row.weeks[Math.floor((dn(r.due_date) - dn(w0)) / 7)];
    if (!cell) continue;
    cell.count++;
    cell.weight += weightOf(r.priority);
    if (cell.tasks.length < 10) cell.tasks.push({ code: r.code, title: r.title, project_key: r.project_key, due: r.due_date, priority: r.priority });
  }
  const warnings: Warning[] = [];
  for (const p of people.values()) {
    p.behind = p.overdue >= 5;
    for (const c of p.weeks) {
      c.level = levelFor(c.weight, p.usual);
      if (c.level !== 'ok') {
        warnings.push({
          email: p.email, name: p.name, week: c.start, count: c.count, usual: p.usual, level: c.level,
          text: `${p.name} has ${c.count} tasks due the week of ${c.start}. A usual week is ${p.usual}.`,
        });
        if (p.level !== 'over') p.level = c.level;
      }
    }
    if (p.behind) {
      warnings.push({ email: p.email, name: p.name, week: w0, count: p.overdue, usual: p.usual, level: 'behind', text: `${p.name} has ${p.overdue} tasks past due.` });
      if (p.level === 'ok') p.level = 'heavy';
    }
  }
  const rank = (l: string) => (l === 'over' ? 0 : l === 'heavy' ? 1 : l === 'behind' ? 2 : 3);
  warnings.sort((a, b) => rank(a.level) - rank(b.level) || a.week.localeCompare(b.week));
  const list = [...people.values()].filter((p) => p.open > 0 || p.level !== 'ok').sort((a, b) => rank(a.level) - rank(b.level) || b.open - a.open || a.name.localeCompare(b.name));
  return { today, weeks, people: list, warnings };
}

/**
 * What adding these tasks would do: for each person and week the plan touches, the count they already carry plus the new ones,
 * judged against their usual week. Used by the plan draft so the owner column shows who is already full.
 */
export async function assess(env: Env, adds: { email: string; due: string; priority?: string }[], today = todayEastern()): Promise<Warning[]> {
  if (!adds.length) return [];
  const [dir, usual] = await Promise.all([staffDirectory(env), usualWeeks(env, today)]);
  const names = new Map(dir.map((p) => [p.email, p.name]));
  const who = [...new Set(adds.map((a) => lower(a.email)))];
  const from = weekStart(adds.reduce((m, a) => (a.due < m ? a.due : m), adds[0].due));
  const to = addDays(weekStart(adds.reduce((m, a) => (a.due > m ? a.due : m), adds[0].due)), 6);
  const have = new Map<string, { n: number; w: number }>();
  for (const e of who) {
    const r = await env.DB.prepare(
      `SELECT due_date, priority FROM hub_tasks WHERE owner_email = ? AND status NOT IN ('done', 'dropped') AND due_date >= ? AND due_date <= ?`
    )
      .bind(e, from, to)
      .all<{ due_date: string; priority: string }>();
    for (const t of r.results || []) {
      const k = e + '|' + weekStart(t.due_date);
      const h = have.get(k) || { n: 0, w: 0 };
      h.n++;
      h.w += weightOf(t.priority);
      have.set(k, h);
    }
  }
  const mine = new Map<string, { n: number; w: number }>();
  for (const a of adds) {
    const k = lower(a.email) + '|' + weekStart(a.due);
    const m = mine.get(k) || { n: 0, w: 0 };
    m.n++;
    m.w += weightOf(a.priority);
    mine.set(k, m);
  }
  const out: Warning[] = [];
  for (const [k, m] of mine) {
    const [email, week] = k.split('|');
    const u = usual.get(email)?.usual ?? 4;
    const before = have.get(k) || { n: 0, w: 0 };
    const level = levelFor(before.w + m.w, u);
    if (level === 'ok') continue;
    const name = names.get(email) || email;
    out.push({
      email, name, week, count: before.n + m.n, usual: u, level,
      text: `${name} would have ${before.n + m.n} tasks due the week of ${week}. A usual week is ${u}.`,
    });
  }
  return out.sort((a, b) => a.week.localeCompare(b.week));
}
