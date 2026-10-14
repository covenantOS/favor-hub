// Scheduled jobs and the production smoke check, as Admin > Overview shows them. The favor-work-drain Worker writes one row per job to
// hub_cron_runs after every run (db/cron-runs.sql): last_ok on success, last_error and a growing fails count on a failure. Here each job
// gets a status from that row and how often it is meant to run.
import type { Env } from '../http';

export type JobStatus = 'ok' | 'late' | 'failed' | 'unknown';

export interface JobDef {
  id: string;
  label: string;
  /** Longest gap, in minutes, between two good runs while the job is meant to be running. */
  okMin: number;
  /** The job runs only in these UTC hours (inclusive start, exclusive end, may wrap past midnight), or on weekdays only. */
  hours?: [number, number];
  weekdays?: boolean;
}

// Kept in step with workers/favor-work-drain/src/index.js. okMin is about three runs' worth, so one slow run is not a failure.
export const JOBS: JobDef[] = [
  { id: 'meetings', label: 'Meeting reminders and notes', okMin: 20 },
  { id: 'chat-email', label: 'Chat email', okMin: 20 },
  { id: 'notify', label: 'Task and feedback email', okMin: 20 },
  { id: 'project-status', label: 'Friday project updates', okMin: 20 },
  { id: 'snapshots', label: 'Work list answers', okMin: 20 },
  { id: 'receipts-warm', label: 'Receipts waiting list', okMin: 40, hours: [10, 2] },
  { id: 'ai-reconcile', label: 'Workers AI budget', okMin: 40 },
  { id: 'digest', label: 'Morning email', okMin: 40, hours: [11, 15], weekdays: true },
  { id: 'gift-entry', label: 'Gift entry photos', okMin: 40, hours: [10, 19] },
  { id: 'lists', label: 'Lists snapshot', okMin: 3 * 60 },
  { id: 'fresh', label: 'Blackbaud changes', okMin: 3 * 60 },
  { id: 'drain', label: 'Overnight sender', okMin: 50, hours: [0, 8] },
  { id: 'smoke', label: 'Production smoke check', okMin: 90 },
];

export interface JobRow {
  job: string;
  last_run: string;
  last_ok: string | null;
  last_error: string | null;
  error_at: string | null;
  detail: string;
  fails: number;
  ms: number;
}

export interface JobState {
  id: string;
  label: string;
  status: JobStatus;
  at: string | null;
  detail: string;
}

const t = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

/** When the job's current run window opened (the top of its first hour today, or yesterday for a window that wraps past midnight). */
function windowStart(def: JobDef, now: number): number {
  if (!def.hours) return -Infinity;
  const d = new Date(now);
  let at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), def.hours[0]);
  if (at > now) at -= 24 * 3600_000;
  return at;
}

function inWindow(def: JobDef, now: number): boolean {
  const d = new Date(now);
  if (def.weekdays && (d.getUTCDay() === 0 || d.getUTCDay() === 6)) return false;
  if (!def.hours) return true;
  const [a, b] = def.hours;
  const h = d.getUTCHours();
  return a < b ? h >= a && h < b : h >= a || h < b;
}

/** The state of one job from its row. A failed last run is failed; a job overdue while it is meant to run is late, and failed at twice that. */
export function jobState(def: JobDef, row: JobRow | undefined, now: number): JobState {
  if (!row) return { id: def.id, label: def.label, status: 'unknown', at: null, detail: 'No run recorded yet' };
  const lastRun = t(row.last_run);
  const lastOk = t(row.last_ok);
  const failedLast = !!row.error_at && (!Number.isFinite(lastOk) || t(row.error_at) >= lastOk);
  if (failedLast) {
    const n = Number(row.fails) || 1;
    return { id: def.id, label: def.label, status: 'failed', at: row.error_at, detail: `${n === 1 ? 'Last run failed' : `Failed ${n} runs in a row`}: ${String(row.last_error || '').slice(0, 160)}` };
  }
  // A job that only runs in certain hours is judged from when its window opened, so the night's gap is not a late run.
  const since = Math.max(Number.isFinite(lastOk) ? lastOk : -Infinity, windowStart(def, now));
  const age = Number.isFinite(since) ? now - since : Infinity;
  const limit = def.okMin * 60_000;
  let status: JobStatus = 'ok';
  // Outside its hours a job is not expected to run, so an old last run is fine then.
  if (inWindow(def, now) && age > limit) status = age > 2 * limit ? 'failed' : 'late';
  return { id: def.id, label: def.label, status, at: Number.isFinite(lastOk) ? row.last_ok : Number.isFinite(lastRun) ? row.last_run : null, detail: status === 'ok' ? row.detail || '' : 'No good run since ' + (row.last_ok || 'the job was added') };
}

export async function jobStates(env: Env, now = Date.now()): Promise<JobState[]> {
  const rows = ((await env.DB.prepare('SELECT * FROM hub_cron_runs').all<JobRow>()).results || []) as JobRow[];
  const by = new Map(rows.map((r) => [r.job, r]));
  return JOBS.map((d) => jobState(d, by.get(d.id), now));
}
