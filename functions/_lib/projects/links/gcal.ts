// Due dates on the owner's Google Calendar.
// A task that has an owner and a due date puts one event on that owner's own primary calendar, through the owner's own Google
// connection (the same per-person token Meetings uses to book). It needs the calendar.events scope, which Meetings asks for on
// the first booking; a person who has not allowed it gets no event and the task panel says so. The event has no guests, so Google
// sends nobody an invitation; a task with a due date and no time is an all-day event, with a time it is 30 minutes.
// Every write passes the notice gate (requests.notify and requests.notify.only) and the person's own choice (hub_project_prefs).
// Events are written only when a task is made or changed (syncTask), never backfilled.
import type { Env } from '../../http';
import { CAL_EVENTS, accessToken, hasScopes } from '../../hub/google';
import { lower, type TaskRow } from '../db';
import { getPrefs } from './email';
import { ORIGIN, TZ, noticeGate, taskLine, taskUrl } from './shared';

export type CalEnv = Env & { MEET_CAL_URL?: string };
const CAL = 'https://www.googleapis.com/calendar/v3';
const cal = (env: CalEnv) => env.MEET_CAL_URL || CAL;

/** The scope a person must allow before due dates reach their calendar. */
export const CALENDAR_SCOPE = CAL_EVENTS;

const addMinutes = (date: string, time: string, min: number) => {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + min;
  const day = total >= 1440 ? new Date(Date.parse(date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10) : date;
  const t = total % 1440;
  return { date: day, time: `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` };
};

export function eventBody(t: { title: string; code: string | null; due_date: string; due_time: string | null; description?: string }, url: string, project: string) {
  const summary = `${t.code ? t.code + ' ' : ''}${t.title}`.slice(0, 200);
  const description = `Due in the Favor hub${project ? ` (${project})` : ''}: ${url}${t.description ? '\n\n' + t.description.slice(0, 800) : ''}`;
  if (!t.due_time) {
    const next = new Date(Date.parse(t.due_date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
    return { summary, description, start: { date: t.due_date }, end: { date: next }, transparency: 'transparent', reminders: { useDefault: true }, source: { title: 'Favor hub', url } };
  }
  const end = addMinutes(t.due_date, t.due_time, 30);
  return {
    summary, description,
    start: { dateTime: `${t.due_date}T${t.due_time}:00`, timeZone: TZ },
    end: { dateTime: `${end.date}T${end.time}:00`, timeZone: TZ },
    reminders: { useDefault: true }, source: { title: 'Favor hub', url },
  };
}

export type CalState = 'off' | 'not_connected' | 'needs_scope' | 'blocked' | 'synced' | 'removed' | 'failed';

async function tokenFor(env: Env, email: string): Promise<{ token: string } | 'not_connected' | 'needs_scope'> {
  const t = await accessToken(env, email).catch(() => null);
  if (!t) return 'not_connected';
  if (!hasScopes(t.scopes, [CAL_EVENTS])) return 'needs_scope';
  return { token: t.token };
}

async function dropEvent(env: CalEnv, email: string, taskId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT event_id FROM hub_task_gcal WHERE task_id = ? AND email = ?').bind(taskId, email).first<{ event_id: string }>().catch(() => null);
  if (!row) return false;
  const tk = await tokenFor(env, email);
  if (typeof tk !== 'string') {
    await fetch(`${cal(env)}/calendars/primary/events/${encodeURIComponent(row.event_id)}?sendUpdates=none`, { method: 'DELETE', headers: { Authorization: `Bearer ${tk.token}` } }).catch(() => undefined);
  }
  await env.DB.prepare('DELETE FROM hub_task_gcal WHERE task_id = ? AND email = ?').bind(taskId, email).run();
  return true;
}

/**
 * Makes the calendar match one task: an event for its owner while it is open with a due date, nothing otherwise. An owner change
 * moves the event to the new owner's calendar. Never throws.
 */
export async function syncTask(env: CalEnv, taskId: string, prevOwner?: string | null): Promise<Record<string, CalState>> {
  const out: Record<string, CalState> = {};
  try {
    const row = await env.DB.prepare('SELECT * FROM hub_tasks WHERE id = ?').bind(taskId).first<TaskRow>();
    // Anyone who had an event and no longer should loses it: a new owner, a done task, a cleared date.
    const had = ((await env.DB.prepare('SELECT email FROM hub_task_gcal WHERE task_id = ?').bind(taskId).all<{ email: string }>()).results || []).map((r) => lower(r.email));
    const owner = row ? lower(row.owner_email) : '';
    const wanted = !!row && !!owner && !!row.due_date && row.status !== 'done' && row.status !== 'dropped';
    for (const e of new Set([...had, ...(prevOwner ? [lower(prevOwner)] : [])])) {
      if (e && (!wanted || e !== owner)) { if (await dropEvent(env, e, taskId)) out[e] = 'removed'; }
    }
    if (!wanted || !row) return out;
    if (!(await noticeGate(env))(owner)) return { ...out, [owner]: 'blocked' };
    if (!(await getPrefs(env, owner)).calendar) return { ...out, [owner]: 'off' };
    const tk = await tokenFor(env, owner);
    if (typeof tk === 'string') return { ...out, [owner]: tk };
    const line = await taskLine(env, taskId);
    const url = taskUrl(row, line?.project_key ? { key: line.project_key } : null, ORIGIN);
    const body = eventBody({ title: row.title, code: row.code, due_date: row.due_date!, due_time: row.due_time, description: row.description }, url, line?.project_name || '');
    const stamp = JSON.stringify([body.summary, row.due_date, row.due_time]);
    const have = await env.DB.prepare('SELECT event_id, stamp FROM hub_task_gcal WHERE task_id = ? AND email = ?').bind(taskId, owner).first<{ event_id: string; stamp: string }>();
    if (have && have.stamp === stamp) return { ...out, [owner]: 'synced' };
    const headers = { Authorization: `Bearer ${tk.token}`, 'content-type': 'application/json' };
    let res: Response;
    if (have) res = await fetch(`${cal(env)}/calendars/primary/events/${encodeURIComponent(have.event_id)}?sendUpdates=none`, { method: 'PUT', headers, body: JSON.stringify(body) });
    else res = await fetch(`${cal(env)}/calendars/primary/events?sendUpdates=none`, { method: 'POST', headers, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as { id?: string };
    if (!res.ok || !(j.id || have)) {
      // An event the person deleted by hand comes back on the next change.
      if (have && (res.status === 404 || res.status === 410)) await env.DB.prepare('DELETE FROM hub_task_gcal WHERE task_id = ? AND email = ?').bind(taskId, owner).run();
      return { ...out, [owner]: 'failed' };
    }
    await env.DB.prepare(
      `INSERT INTO hub_task_gcal (task_id, email, event_id, stamp, synced_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(task_id, email) DO UPDATE SET event_id = excluded.event_id, stamp = excluded.stamp, synced_at = excluded.synced_at`
    ).bind(taskId, owner, j.id || have!.event_id, stamp, new Date().toISOString()).run();
    return { ...out, [owner]: 'synced' };
  } catch (err) {
    console.error('[projects] calendar', err);
    return out;
  }
}

/** What the task panel shows about the owner's calendar. */
export async function calendarStatus(env: Env, taskId: string): Promise<{ owner: string | null; state: CalState | 'none'; label: string }> {
  const row = await env.DB.prepare('SELECT owner_email, due_date, status FROM hub_tasks WHERE id = ?').bind(taskId).first<{ owner_email: string | null; due_date: string | null; status: string }>().catch(() => null);
  if (!row || !row.owner_email) return { owner: null, state: 'none', label: 'No owner, so no calendar event.' };
  if (!row.due_date) return { owner: row.owner_email, state: 'none', label: 'Set a due date to put it on the owner\'s calendar.' };
  const owner = lower(row.owner_email);
  const have = await env.DB.prepare('SELECT 1 AS ok FROM hub_task_gcal WHERE task_id = ? AND email = ?').bind(taskId, owner).first().catch(() => null);
  if (have) return { owner, state: 'synced', label: 'On the owner\'s Google Calendar.' };
  if (!(await getPrefs(env, owner)).calendar) return { owner, state: 'off', label: 'The owner keeps tasks off their calendar.' };
  const tk = await tokenFor(env, owner);
  if (tk === 'not_connected') return { owner, state: 'not_connected', label: 'The owner has not connected Google.' };
  if (tk === 'needs_scope') return { owner, state: 'needs_scope', label: 'The owner has not allowed calendar events yet.' };
  if (!(await noticeGate(env))(owner)) return { owner, state: 'blocked', label: 'Calendar events start when staff notices are on.' };
  return { owner, state: 'failed', label: 'Not on the calendar yet.' };
}
