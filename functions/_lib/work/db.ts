// The Work Center's own tables in the hub database (db/work.sql, the act_ prefix): settings, the staff list, the event log, the
// daily call meter and the lock that stops two windows from running one batch at once.
import { newId, nowIso, type Env } from '../http';
import { utcDay } from '../actions/batch';

export async function getSetting(env: Env, key: string, fallback = ''): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM act_settings WHERE key = ? LIMIT 1').bind(key).first<{ value: string }>();
  return row ? row.value : fallback;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO act_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(key, value, nowIso())
    .run();
}

export interface StaffRow {
  email: string;
  name: string;
  team: string;
  bb_fundraiser_id: string | null;
  work_center: number;
  entry_owner: number;
  entry_type: string | null;
  sheet_tab: string | null;
  active: number;
  updated_at: string;
}

export async function listStaff(env: Env): Promise<StaffRow[]> {
  const r = await env.DB.prepare('SELECT * FROM act_staff ORDER BY team, name').all<StaffRow>();
  return r.results;
}

export async function staffByEmail(env: Env, email: string): Promise<StaffRow | null> {
  return env.DB.prepare('SELECT * FROM act_staff WHERE email = ? LIMIT 1').bind(email.toLowerCase()).first<StaffRow>();
}

export type Release = 'admins' | 'support';

export async function getRelease(env: Env): Promise<Release> {
  return (await getSetting(env, 'release', 'admins')) === 'support' ? 'support' : 'admins';
}

export interface EventInput {
  actor: string;
  actor_email: string;
  batch_id?: string | null;
  action_id?: string | null;
  kind: string;
  method?: string;
  path?: string;
  ok?: boolean;
  status?: number;
  detail?: string;
}

export async function logEvent(env: Env, e: EventInput): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO act_events (id, at, actor, actor_email, batch_id, action_id, kind, method, path, ok, status, detail) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  )
    .bind(newId('wce'), nowIso(), e.actor, e.actor_email, e.batch_id ?? null, e.action_id ?? null, e.kind, e.method ?? null, e.path ?? null, e.ok === undefined ? null : e.ok ? 1 : 0, e.status ?? null, (e.detail || '').slice(0, 900))
    .run();
}

export interface Meter {
  day: string;
  calls: number;
  route: number;
  used: number; // the larger of the two: what the day's allowance has actually been spent on
}

export async function getMeter(env: Env, day = utcDay()): Promise<Meter> {
  const row = await env.DB.prepare('SELECT calls, route_calls FROM act_meter WHERE day = ? LIMIT 1').bind(day).first<{ calls: number; route_calls: number | null }>();
  const calls = Number(row?.calls) || 0;
  const route = Number(row?.route_calls) || 0;
  return { day, calls, route, used: Math.max(calls, route) };
}

/** Record calls the Work Center made and the route's own count after them. */
export async function addMeter(env: Env, calls: number, routeCalls?: number, day = utcDay()): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO act_meter (day, calls, route_calls, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET calls = calls + excluded.calls, route_calls = COALESCE(excluded.route_calls, route_calls), updated_at = excluded.updated_at`
  )
    .bind(day, calls, routeCalls ?? null, nowIso())
    .run();
}

/** One window runs a batch at a time. A lock older than two minutes counts as dropped. */
export async function takeLock(env: Env, batchId: string, actor: string): Promise<boolean> {
  const key = `lock:${batchId}`;
  const stale = new Date(Date.now() - 2 * 60_000).toISOString();
  await env.DB.prepare('DELETE FROM act_settings WHERE key = ? AND updated_at < ?').bind(key, stale).run();
  const out = await env.DB.prepare('INSERT INTO act_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING').bind(key, actor, nowIso()).run();
  return (out.meta?.changes ?? 0) > 0;
}

export async function dropLock(env: Env, batchId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM act_settings WHERE key = ?').bind(`lock:${batchId}`).run();
}

/** Contacts waiting to be entered, for the menu badge. One cheap read on the hub database; never the mirror. */
export async function waitingCount(env: Env): Promise<number> {
  const since = new Date(Date.now() - 45 * 86400000).toISOString();
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM act_submissions WHERE state IN ('waiting', 'failed') AND created_at >= ?").bind(since).first<{ n: number }>().catch(() => null);
  return Number(r?.n) || 0;
}
