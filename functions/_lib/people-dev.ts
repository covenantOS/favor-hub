// Who reports to whom, and who counts as HR. Shared by Evaluations, Learn and Onboarding.
// hub_reporting is edited in Admin > People (a Supervisor drop-down and a start date on each person). Names come from people.ts.
import type { Env } from './http';

export interface Reporting {
  email: string;
  supervisor: string;
  department: string;
  title: string;
  startDate: string;
}

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
type Db = Pick<Env, 'DB'>;

async function all<T>(env: Db, sql: string, ...bind: unknown[]): Promise<T[]> {
  try {
    return ((await env.DB.prepare(sql).bind(...bind).all<T>()).results || []) as T[];
  } catch {
    // A table that is not there yet answers nothing.
    return [];
  }
}

/** The supervisor's email for a person, or '' when none is recorded. */
export async function supervisorOf(env: Db, email: string): Promise<string> {
  const r = await all<{ s: string | null }>(env, 'SELECT supervisor_email AS s FROM hub_reporting WHERE email = ?', lower(email));
  return lower(r[0]?.s);
}

/** Emails of the people who report to this person directly. */
export async function reportsOf(env: Db, email: string): Promise<string[]> {
  const r = await all<{ email: string }>(env, 'SELECT email FROM hub_reporting WHERE supervisor_email = ? ORDER BY email', lower(email));
  return r.map((x) => lower(x.email)).filter(Boolean);
}

type Row = { email: string; supervisor_email: string | null; department: string | null; title: string | null; start_date: string | null };
const shape = (x: Row): Reporting => ({ email: lower(x.email), supervisor: lower(x.supervisor_email), department: x.department || '', title: x.title || '', startDate: x.start_date || '' });

/** Department, title, start date and supervisor for one person (empty strings where blank). */
export async function reportingOf(env: Db, email: string): Promise<Reporting> {
  const e = lower(email);
  const r = await all<Row>(env, 'SELECT email, supervisor_email, department, title, start_date FROM hub_reporting WHERE email = ?', e);
  return r[0] ? shape(r[0]) : { email: e, supervisor: '', department: '', title: '', startDate: '' };
}

/** Every reporting row, for lists and pickers. */
export async function allReporting(env: Db): Promise<Reporting[]> {
  return (await all<Row>(env, 'SELECT email, supervisor_email, department, title, start_date FROM hub_reporting')).map(shape);
}

/** True for a person an admin marked as HR in Admin > People. Hub admins are not included; use isHrOrAdmin for either. */
export async function isHr(env: Db, email: string): Promise<boolean> {
  const r = await all<{ email: string }>(env, 'SELECT email FROM hub_hr WHERE email = ?', lower(email));
  return r.length > 0;
}

/** Admin rights in the people areas: a hub admin or someone marked HR. */
export async function isHrOrAdmin(env: Db, user: { email: string; role: string } | null | undefined): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return isHr(env, user.email);
}
