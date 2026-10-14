// Meetings: repeating series. One hub_meeting_series row holds the rule; each occurrence is a hub_meetings row with its own room,
// notes and recording, made about 60 days ahead (and at least four ahead) by materialize. Google Calendar holds ONE repeating event
// for the series (RRULE plus EXDATE); one occurrence changed or cancelled alone is Google's instance of it
// (<series event id>_<original start>), never a second event.
//
// Edits and cancels take a scope:
//   this       the one occurrence (it becomes detached: later "all" edits leave its time alone)
//   following  this and every later one: the series ends the day before and a new series starts here (Google: UNTIL on the old
//              event, a new repeating event for the rest)
//   all        the whole series; past meetings keep their notes and times
import { HttpError, nowIso } from './http';
import { emailsOf, hex, isHost, mayReadNotes, ledPeople, wasPresent, type Meeting, type MeetEnv } from './meet';
import { calFetch, createEvent, sendReminder, TZ } from './meetcal';
import { buildIcs } from './meetics';
import { cleanRule, dayBefore, describe, expand, exdateLine, instanceId, restAfter, toRRule, wallOf, instantOf, type Rule } from './meetrecur';

export type Scope = 'this' | 'following' | 'all';
export const SCOPES: Scope[] = ['this', 'following', 'all'];

export interface Series {
  id: string;
  host_email: string;
  host_name: string;
  title: string;
  agenda: string;
  duration_min: number;
  rec_mode: string;
  access: string;
  invitees: string;
  remind: number;
  post_channel: string;
  rule: string;
  tz: string;
  dtstart: string;
  exdates: string;
  calendar_event_id: string;
  calendar_owner: string;
  template_id: string;
  team: string;
  drive_folder: string;
  carry_actions: number;
  parent_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

const HORIZON_DAYS = 60;
const MIN_AHEAD = 4;
const DAY = 86400_000;

export const seriesUrl = (origin: string, sid: string) => `${origin}/meet/s/?id=${sid}`;
export const ruleOf = (s: Pick<Series, 'rule'>): Rule => cleanRule(safe(s.rule, null)) || cleanRule(null, 'weekly')!;
const exOf = (s: Pick<Series, 'exdates'>): string[] => safe<string[]>(s.exdates, []);
function safe<T>(j: string, d: T): T {
  try { return (JSON.parse(j) as T) ?? d; } catch { return d; }
}

/** The Google recurrence lines for a series: its RRULE and the skipped dates. */
export function recurrenceOf(s: Pick<Series, 'rule' | 'dtstart' | 'tz' | 'exdates'>): string[] {
  const ex = exdateLine(exOf(s));
  return [toRRule(ruleOf(s), s.dtstart, s.tz || TZ), ...(ex ? [ex] : [])];
}

/** The series row. A series booked before 2026-10-14 has none: it is made from its first meeting and its old repeat word. */
export async function loadSeries(env: MeetEnv, sid: string): Promise<Series> {
  const row = await env.DB.prepare('SELECT * FROM hub_meeting_series WHERE id = ?').bind(sid).first<Series>();
  if (row) return row;
  const first = await env.DB.prepare(`SELECT * FROM hub_meetings WHERE series_id = ? ORDER BY COALESCE(NULLIF(orig_start, ''), starts_at) LIMIT 1`).bind(sid).first<Meeting & { post_channel?: string }>();
  if (!first || !first.starts_at) throw new HttpError(404, 'not_found', 'That series does not exist.');
  const rule = cleanRule(null, first.repeat) || cleanRule(null, 'weekly')!;
  const s: Series = {
    id: sid, host_email: first.host_email, host_name: first.host_name, title: first.title, agenda: first.agenda, duration_min: first.duration_min,
    rec_mode: first.rec_mode, access: first.access, invitees: first.invitees, remind: first.remind, post_channel: first.post_channel || '',
    rule: JSON.stringify(rule), tz: TZ, dtstart: first.starts_at, exdates: '[]', calendar_event_id: first.calendar_event_id, calendar_owner: first.host_email,
    template_id: '', team: '', drive_folder: first.drive_folder || '', carry_actions: 1, parent_id: '', status: 'active', created_at: first.created_at, updated_at: nowIso(),
  };
  await insertSeries(env, s);
  // Old rows carry no original start; their start is it.
  await env.DB.prepare(`UPDATE hub_meetings SET orig_start = starts_at WHERE series_id = ? AND orig_start = '' AND starts_at IS NOT NULL`).bind(sid).run();
  return s;
}

function insertSeries(env: MeetEnv, s: Series) {
  return env.DB.prepare(
    `INSERT OR REPLACE INTO hub_meeting_series (id, host_email, host_name, title, agenda, duration_min, rec_mode, access, invitees, remind, post_channel, rule, tz, dtstart, exdates,
       calendar_event_id, calendar_owner, template_id, team, drive_folder, carry_actions, parent_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(s.id, s.host_email, s.host_name, s.title, s.agenda, s.duration_min, s.rec_mode, s.access, s.invitees, s.remind, s.post_channel, s.rule, s.tz, s.dtstart, s.exdates,
    s.calendar_event_id, s.calendar_owner, s.template_id, s.team, s.drive_folder, s.carry_actions, s.parent_id, s.status, s.created_at, s.updated_at).run();
}

async function saveSeries(env: MeetEnv, s: Series) {
  s.updated_at = nowIso();
  await insertSeries(env, s);
}

/** The start times this series should have rows for now: from 12 hours ago to 60 days out, and never fewer than four ahead. */
export function wanted(s: Pick<Series, 'rule' | 'dtstart' | 'tz' | 'exdates'>, now = Date.now()): string[] {
  const rule = ruleOf(s);
  const ex = new Set(exOf(s).map((x) => new Date(x).toISOString()));
  const all = expand(rule, s.dtstart, { tz: s.tz || TZ, toMs: now + 400 * DAY, limit: 800 }).filter((t) => !ex.has(t));
  const from = now - 12 * 3600_000;
  const ahead = all.filter((t) => Date.parse(t) >= from);
  const inWindow = ahead.filter((t) => Date.parse(t) <= now + HORIZON_DAYS * DAY);
  return inWindow.length >= MIN_AHEAD ? inWindow : ahead.slice(0, MIN_AHEAD);
}

/** Rows for the occurrences that have none yet. An occurrence already made (any status, matched on its original start) is left alone. */
export async function materialize(env: MeetEnv, s: Series, opts: { firstId?: string; gkey?: string; now?: number } = {}): Promise<number> {
  if (s.status !== 'active') return 0;
  const want = wanted(s, opts.now);
  if (!want.length) {
    const left = await env.DB.prepare(`SELECT 1 AS x FROM hub_meetings WHERE series_id = ? AND status = 'scheduled' LIMIT 1`).bind(s.id).first();
    if (!left) { s.status = 'ended'; await saveSeries(env, s); }
    return 0;
  }
  const have = new Set(((await env.DB.prepare('SELECT orig_start FROM hub_meetings WHERE series_id = ?').bind(s.id).all<{ orig_start: string }>()).results || []).map((r) => r.orig_start));
  const idTaken = opts.firstId ? !!(await env.DB.prepare('SELECT 1 AS x FROM hub_meetings WHERE id = ?').bind(opts.firstId).first()) : true;
  let gkey = opts.gkey || '';
  if (s.access === 'guests' && !gkey) gkey = (await env.DB.prepare('SELECT gkey FROM hub_meeting_guest WHERE meeting_id = ?').bind('s:' + s.id).first<{ gkey: string }>())?.gkey || '';
  const rows: D1PreparedStatement[] = [];
  let first = true;
  for (const at of want) {
    if (have.has(at)) continue;
    const id = first && !idTaken && opts.firstId ? opts.firstId : hex(12);
    first = false;
    rows.push(env.DB.prepare(
      `INSERT INTO hub_meetings (id, title, agenda, host_email, host_name, starts_at, ends_at, duration_min, rec_mode, access, invitees, status, created_at, repeat, series_id,
         calendar_event_id, backup_link, remind, post_channel, orig_start, tz, drive_folder)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, '', ?, ?, ?, ?, ?)`
    ).bind(id, s.title, s.agenda, s.host_email, s.host_name, at, new Date(Date.parse(at) + s.duration_min * 60000).toISOString(), s.duration_min, s.rec_mode, s.access,
      s.invitees, nowIso(), ruleOf(s).freq, s.id, s.calendar_event_id, s.remind, s.post_channel, at, s.tz || TZ, s.drive_folder));
    if (gkey) rows.push(env.DB.prepare('INSERT OR REPLACE INTO hub_meeting_guest (meeting_id, gkey) VALUES (?, ?)').bind(id, gkey));
  }
  if (rows.length) await env.DB.batch(rows);
  return rows.length;
}

/**
 * After the rule or the time changed: the scheduled, not-detached rows from `from` on take the new starts in order (their ids,
 * rooms and links stay), rows left over are removed (they were never used) and missing ones are made. Template fields go on too.
 */
async function resync(env: MeetEnv, s: Series, from: string, opts: { fields?: boolean } = {}) {
  const rows = (await env.DB.prepare(
    `SELECT id, orig_start, starts_at, detached FROM hub_meetings WHERE series_id = ? AND status = 'scheduled' AND orig_start >= ? ORDER BY orig_start`
  ).bind(s.id, from).all<{ id: string; orig_start: string; starts_at: string; detached: number }>()).results || [];
  const loose = rows.filter((r) => !r.detached);
  const keptStarts = new Set(rows.filter((r) => r.detached).map((r) => r.orig_start));
  const want = wanted(s).filter((t) => t >= from && !keptStarts.has(t));
  const stmts: D1PreparedStatement[] = [];
  loose.forEach((r, i) => {
    const at = want[i];
    if (!at) {
      stmts.push(env.DB.prepare(`DELETE FROM hub_meetings WHERE id = ? AND status = 'scheduled' AND started_at IS NULL`).bind(r.id));
      stmts.push(env.DB.prepare('DELETE FROM hub_meeting_reminders WHERE meeting_id = ?').bind(r.id));
      return;
    }
    const end = new Date(Date.parse(at) + s.duration_min * 60000).toISOString();
    if (at !== r.starts_at) stmts.push(env.DB.prepare('DELETE FROM hub_meeting_reminders WHERE meeting_id = ?').bind(r.id));
    stmts.push(env.DB.prepare('UPDATE hub_meetings SET starts_at = ?, ends_at = ?, orig_start = ?, duration_min = ? WHERE id = ?').bind(at, end, at, s.duration_min, r.id));
  });
  if (opts.fields !== false) {
    stmts.push(env.DB.prepare(
      `UPDATE hub_meetings SET title = ?, rec_mode = ?, access = ?, invitees = ?, remind = ?, calendar_event_id = ?, repeat = ? WHERE series_id = ? AND status = 'scheduled' AND orig_start >= ?`
    ).bind(s.title, s.rec_mode, s.access, s.invitees, s.remind, s.calendar_event_id, ruleOf(s).freq, s.id, from));
    // The agenda goes on the ones not yet given the last meeting's open items; those keep theirs.
    stmts.push(env.DB.prepare(`UPDATE hub_meetings SET agenda = ? WHERE series_id = ? AND status = 'scheduled' AND orig_start >= ? AND carried = 0`).bind(s.agenda, s.id, from));
  }
  if (stmts.length) await env.DB.batch(stmts);
  await materialize(env, s);
}

// ---------------------------------------------------------------- creating

export interface SeriesInput {
  title: string;
  agenda: string;
  durationMin: number;
  rec: string;
  access: string;
  invitees: Array<{ email: string; name: string; team: string; guest: boolean }>;
  remind: number;
  rule: Rule;
  startsAt: string;
  tz?: string;
  calendar: boolean;
  templateId?: string;
  team?: string;
  driveFolder?: string;
  postChannel?: string;
  gkey?: string;
  /** The room links in the calendar event (the series link, so every occurrence opens its own room). */
  roomUrl: string;
  guestUrl?: string;
  /** An existing Google event (Move to FavorOS for a whole series): no new event is made. */
  calendarEventId?: string;
  exdates?: string[];
}

/** A new series: the Google event first (so a refusal leaves nothing half made), then the series row and its first rows. Returns the first meeting's id, which is also the series id. */
export async function createSeries(env: MeetEnv, user: { email: string; name: string }, inp: SeriesInput, sid = hex(12)): Promise<{ id: string; calendar: boolean; backup: string }> {
  const tz = inp.tz || TZ;
  const s: Series = {
    id: sid, host_email: user.email.toLowerCase(), host_name: user.name, title: inp.title, agenda: inp.agenda, duration_min: inp.durationMin, rec_mode: inp.rec, access: inp.access,
    invitees: JSON.stringify(inp.invitees), remind: inp.remind, post_channel: inp.postChannel || '', rule: JSON.stringify(inp.rule), tz, dtstart: new Date(inp.startsAt).toISOString(),
    exdates: JSON.stringify(inp.exdates || []), calendar_event_id: inp.calendarEventId || '', calendar_owner: user.email.toLowerCase(), template_id: inp.templateId || '', team: inp.team || '',
    drive_folder: inp.driveFolder || '', carry_actions: 1, parent_id: '', status: 'active', created_at: nowIso(), updated_at: nowIso(),
  };
  if (!expand(inp.rule, s.dtstart, { tz, limit: 1 }).length) throw new HttpError(400, 'bad_rule', 'That repeat ends before the first meeting.');
  let backup = '';
  if (inp.calendar && !inp.calendarEventId) {
    const ev = await createEvent(env, user.email, {
      title: inp.title, agenda: inp.agenda, roomUrl: inp.roomUrl, guestUrl: inp.guestUrl, startsAt: s.dtstart, endsAt: new Date(Date.parse(s.dtstart) + inp.durationMin * 60000).toISOString(),
      attendees: inp.invitees.map((i) => i.email).filter((e) => e !== s.host_email), recording: inp.rec, repeat: 'none', recurrence: recurrenceOf(s), tz,
    });
    s.calendar_event_id = ev.id;
    backup = ev.meetLink;
  }
  await insertSeries(env, s);
  if (inp.gkey) await env.DB.prepare('INSERT OR REPLACE INTO hub_meeting_guest (meeting_id, gkey) VALUES (?, ?)').bind('s:' + sid, inp.gkey).run();
  await materialize(env, s, { firstId: sid, gkey: inp.gkey });
  if (backup) await env.DB.prepare('UPDATE hub_meetings SET backup_link = ? WHERE series_id = ?').bind(backup, sid).run();
  return { id: sid, calendar: !!s.calendar_event_id, backup };
}

// ---------------------------------------------------------------- Google, one series event

async function gPatch(env: MeetEnv, s: Series, eventId: string, body: Record<string, unknown>, notify = true): Promise<boolean> {
  if (!eventId) return false;
  const r = await calFetch(env, s.calendar_owner || s.host_email, `/events/${encodeURIComponent(eventId.replace(/^ext:/, ''))}?sendUpdates=${notify ? 'all' : 'none'}`, { method: 'PATCH', body });
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new HttpError(502, 'calendar', 'Google Calendar did not accept the change.');
  return r.ok;
}
async function gDelete(env: MeetEnv, s: Series, eventId: string): Promise<void> {
  if (!eventId) return;
  const r = await calFetch(env, s.calendar_owner || s.host_email, `/events/${encodeURIComponent(eventId.replace(/^ext:/, ''))}?sendUpdates=all`, { method: 'DELETE' });
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new HttpError(502, 'calendar', 'Google Calendar did not cancel it.');
}
const gTime = (iso: string, tz: string) => ({ dateTime: new Date(iso).toISOString(), timeZone: tz });

// ---------------------------------------------------------------- editing

export interface SeriesPatch {
  title?: string;
  agenda?: string;
  startsAt?: string;
  durationMin?: number;
  rec?: string;
  access?: string;
  invitees?: SeriesInput['invitees'];
  remind?: number;
  rule?: Rule;
}

function mayEdit(s: Series, m: Meeting, user: { email: string; role: string }) {
  if (!isHost(m, user.email) && user.role !== 'admin' && s.host_email !== user.email.toLowerCase()) throw new HttpError(403, 'host_only', 'Only the host can change this meeting.');
}

/** What the host sees before a change: a conflict list is separate (meetsched.ts). This is the edit itself. */
export async function editOccurrence(env: MeetEnv, user: { email: string; role: string }, m: Meeting, scope: Scope, p: SeriesPatch, origin: string): Promise<{ ok: true; seriesId: string; scope: Scope }> {
  const s = await loadSeries(env, m.series_id);
  mayEdit(s, m, user);
  if (m.status !== 'scheduled') throw new HttpError(400, 'not_scheduled', 'Only a meeting that has not started can change.');
  const orig = m.orig_start || m.starts_at || '';
  const isFirst = orig <= s.dtstart || !(await env.DB.prepare(`SELECT 1 AS x FROM hub_meetings WHERE series_id = ? AND orig_start < ? AND status != 'cancelled' LIMIT 1`).bind(s.id, orig).first());
  if (scope === 'following' && isFirst) scope = 'all';
  const dur = p.durationMin ? Math.min(480, Math.max(5, Math.round(p.durationMin))) : 0;

  if (scope === 'this') {
    if (p.rule) throw new HttpError(400, 'scope', 'A repeat changes for this and following meetings, or for all of them.');
    const start = p.startsAt ? new Date(p.startsAt).toISOString() : m.starts_at!;
    const len = dur || m.duration_min;
    const end = new Date(Date.parse(start) + len * 60000).toISOString();
    const sets: string[] = ['starts_at = ?', 'ends_at = ?', 'duration_min = ?'];
    const vals: unknown[] = [start, end, len];
    if (typeof p.title === 'string') { sets.push('title = ?'); vals.push(p.title); }
    if (typeof p.agenda === 'string') { sets.push('agenda = ?'); vals.push(p.agenda); }
    if (p.rec) { sets.push('rec_mode = ?'); vals.push(p.rec); }
    if (p.access) { sets.push('access = ?'); vals.push(p.access); }
    if (p.invitees) { sets.push('invitees = ?'); vals.push(JSON.stringify(p.invitees)); }
    sets.push('detached = 1');
    if (s.calendar_event_id) {
      const body: Record<string, unknown> = { start: gTime(start, s.tz), end: gTime(end, s.tz) };
      if (p.title) body.summary = p.title;
      if (p.invitees) body.attendees = p.invitees.map((i) => ({ email: i.email }));
      await gPatch(env, s, instanceId(s.calendar_event_id, orig), body);
    }
    await env.DB.prepare(`UPDATE hub_meetings SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, m.id).run();
    if (start !== m.starts_at) {
      await env.DB.prepare('DELETE FROM hub_meeting_reminders WHERE meeting_id = ?').bind(m.id).run();
      await noticeOne(env, s, { ...m, starts_at: start, ends_at: end, title: p.title || m.title }, 'moved', origin);
    }
    return { ok: true, seriesId: s.id, scope };
  }

  // The fields every occurrence from here on shares.
  const apply = (t: Series) => {
    if (typeof p.title === 'string' && p.title) t.title = p.title;
    if (typeof p.agenda === 'string') t.agenda = p.agenda;
    if (dur) t.duration_min = dur;
    if (p.rec) t.rec_mode = p.rec;
    if (p.access) t.access = p.access;
    if (p.invitees) t.invitees = JSON.stringify(p.invitees);
    if (typeof p.remind === 'number') t.remind = p.remind;
  };
  // A new start moves the series by the same number of days and to the new time of day.
  const shifted = (base: string): string => {
    if (!p.startsAt) return base;
    const a = wallOf(orig, s.tz), b = wallOf(p.startsAt, s.tz), w = wallOf(base, s.tz);
    const days = Math.round((Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d)) / DAY);
    const x = new Date(Date.UTC(w.y, w.mo - 1, w.d + days));
    return new Date(instantOf(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), b.h, b.mi, s.tz)).toISOString();
  };
  // A weekly rule on fixed days follows a moved day: Tuesday meetings moved to Wednesday repeat on Wednesday.
  const followDay = (r: Rule): Rule => {
    if (!p.startsAt || p.rule || r.freq !== 'weekly' || r.byDay.length !== 1) return r;
    return { ...r, byDay: [wallOf(p.startsAt, s.tz).wd] };
  };

  if (scope === 'all') {
    apply(s);
    const timeChanged = !!p.startsAt && p.startsAt !== m.starts_at;
    if (timeChanged) s.dtstart = shifted(s.dtstart);
    if (p.rule || timeChanged) { s.rule = JSON.stringify(followDay(p.rule || ruleOf(s))); if (timeChanged) s.exdates = '[]'; }
    if (s.calendar_event_id) {
      const body: Record<string, unknown> = { summary: s.title, attendees: safe<Array<{ email: string }>>(s.invitees, []).filter((i) => i.email !== s.host_email).map((i) => ({ email: i.email })) };
      if (timeChanged || dur || p.rule) Object.assign(body, { start: gTime(s.dtstart, s.tz), end: gTime(new Date(Date.parse(s.dtstart) + s.duration_min * 60000).toISOString(), s.tz), recurrence: recurrenceOf(s) });
      await gPatch(env, s, s.calendar_event_id, body);
    }
    await saveSeries(env, s);
    await resync(env, s, new Date(Math.min(Date.now() - 12 * 3600_000, Date.parse(orig))).toISOString());
    if (timeChanged && !s.calendar_event_id) await noticeSeries(env, s, 'moved', origin);
    return { ok: true, seriesId: s.id, scope };
  }

  // this and following: the old series stops the day before this one; a new series (id = this meeting's id) carries on.
  const oldRule = ruleOf(s);
  const next: Series = { ...s, id: m.id, parent_id: s.id, created_at: nowIso(), calendar_event_id: '', exdates: JSON.stringify(exOf(s).filter((x) => x > orig)) };
  apply(next);
  next.dtstart = p.startsAt ? new Date(p.startsAt).toISOString() : orig;
  next.rule = JSON.stringify(followDay(p.rule || restAfter(oldRule, s.dtstart, orig, s.tz)));
  if (!p.startsAt && p.rule) next.dtstart = orig;
  s.rule = JSON.stringify({ ...oldRule, end: { kind: 'until', until: dayBefore(orig, s.tz) } });
  s.exdates = JSON.stringify(exOf(s).filter((x) => x < orig));
  if (s.calendar_event_id) {
    await gPatch(env, s, s.calendar_event_id, { recurrence: recurrenceOf(s) });
    const ev = await createEvent(env, next.calendar_owner || next.host_email, {
      title: next.title, agenda: next.agenda, roomUrl: seriesUrl(origin, next.id), startsAt: next.dtstart, endsAt: new Date(Date.parse(next.dtstart) + next.duration_min * 60000).toISOString(),
      attendees: safe<Array<{ email: string }>>(next.invitees, []).map((i) => i.email).filter((e) => e !== next.host_email), recording: next.rec_mode, repeat: 'none', recurrence: recurrenceOf(next), tz: next.tz,
    });
    next.calendar_event_id = ev.id;
  }
  await saveSeries(env, s);
  await insertSeries(env, next);
  const gk = await env.DB.prepare('SELECT gkey FROM hub_meeting_guest WHERE meeting_id = ?').bind('s:' + s.id).first<{ gkey: string }>();
  if (gk?.gkey) await env.DB.prepare('INSERT OR REPLACE INTO hub_meeting_guest (meeting_id, gkey) VALUES (?, ?)').bind('s:' + next.id, gk.gkey).run();
  // Rows from here on belong to the new series, keep their ids, and take its times and fields. Detached ones are not detached from the new rule.
  await env.DB.prepare(`UPDATE hub_meetings SET series_id = ?, detached = 0 WHERE series_id = ? AND orig_start >= ? AND status = 'scheduled'`).bind(next.id, s.id, orig).run();
  await resync(env, next, new Date(Math.min(Date.parse(orig), Date.parse(next.dtstart))).toISOString());
  await materialize(env, s);
  if (!next.calendar_event_id && p.startsAt && p.startsAt !== m.starts_at) await noticeSeries(env, next, 'moved', origin);
  return { ok: true, seriesId: next.id, scope };
}

// ---------------------------------------------------------------- cancelling

export async function cancelOccurrence(env: MeetEnv, user: { email: string; role: string }, m: Meeting, scope: Scope, origin: string): Promise<{ ok: true; cancelled: number; scope: Scope }> {
  const s = await loadSeries(env, m.series_id);
  mayEdit(s, m, user);
  const orig = m.orig_start || m.starts_at || '';
  const isFirst = orig <= s.dtstart || !(await env.DB.prepare(`SELECT 1 AS x FROM hub_meetings WHERE series_id = ? AND orig_start < ? AND status != 'cancelled' LIMIT 1`).bind(s.id, orig).first());
  if (scope === 'following' && isFirst) scope = 'all';
  if (scope === 'this') {
    s.exdates = JSON.stringify([...new Set([...exOf(s), orig])].sort());
    if (s.calendar_event_id) await gDelete(env, s, instanceId(s.calendar_event_id, orig));
    await saveSeries(env, s);
    await env.DB.prepare(`UPDATE hub_meetings SET status = 'cancelled' WHERE id = ? AND status = 'scheduled'`).bind(m.id).run();
    await noticeOne(env, s, m, 'cancelled', origin);
    return { ok: true, cancelled: 1, scope };
  }
  const since = scope === 'all' ? '' : orig;
  const rows = ((await env.DB.prepare(`SELECT * FROM hub_meetings WHERE series_id = ? AND status = 'scheduled' AND orig_start >= ?`).bind(s.id, since).all<Meeting>()).results || []);
  if (scope === 'all') {
    if (s.calendar_event_id) await gDelete(env, s, s.calendar_event_id);
    s.status = 'cancelled';
  } else {
    s.rule = JSON.stringify({ ...ruleOf(s), end: { kind: 'until', until: dayBefore(orig, s.tz) } });
    s.exdates = JSON.stringify(exOf(s).filter((x) => x < orig));
    if (s.calendar_event_id) await gPatch(env, s, s.calendar_event_id, { recurrence: recurrenceOf(s) });
  }
  await saveSeries(env, s);
  await env.DB.prepare(`UPDATE hub_meetings SET status = 'cancelled' WHERE series_id = ? AND status = 'scheduled' AND orig_start >= ?`).bind(s.id, since).run();
  if (!s.calendar_event_id) await noticeSeries(env, { ...s, rule: s.rule }, 'cancelled', origin, rows[0]);
  return { ok: true, cancelled: rows.length, scope };
}

// ---------------------------------------------------------------- notices when no Google invite carries the change

const people = (invitees: string, host: string) => emailsOf(invitees).filter((e) => e !== host.toLowerCase() && !e.startsWith('guest:'));

async function noticeOne(env: MeetEnv, s: Series, m: Meeting, kind: 'moved' | 'cancelled', origin: string) {
  if (s.calendar_event_id || !m.starts_at) return;
  const end = m.ends_at || new Date(Date.parse(m.starts_at) + m.duration_min * 60000).toISOString();
  const url = `${origin}/meet/room/?m=${m.id}`;
  const ics = buildIcs({ uid: `${m.id}@favoros`, method: kind === 'cancelled' ? 'CANCEL' : 'REQUEST', sequence: Math.floor(Date.now() / 1000), startsAt: m.starts_at, endsAt: end, title: m.title, url, organizer: { name: s.host_name, email: s.host_email } });
  for (const e of people(m.invitees, s.host_email)) await sendReminder(env, [e], { title: m.title, startsAt: m.starts_at, endsAt: end, durationMin: m.duration_min, roomUrl: url, backup: '', rec: m.rec_mode, kind, host: s.host_name || s.host_email, hostEmail: s.host_email, ics }).catch(() => false);
}

async function noticeSeries(env: MeetEnv, s: Series, kind: 'moved' | 'cancelled', origin: string, at?: Meeting) {
  if (s.calendar_event_id) return;
  const start = at?.starts_at || wanted(s)[0] || s.dtstart;
  const end = new Date(Date.parse(start) + s.duration_min * 60000).toISOString();
  const url = seriesUrl(origin, s.id);
  const ics = buildIcs({ uid: `series-${s.id}@favoros`, method: kind === 'cancelled' ? 'CANCEL' : 'REQUEST', sequence: Math.floor(Date.now() / 1000), startsAt: s.dtstart, endsAt: new Date(Date.parse(s.dtstart) + s.duration_min * 60000).toISOString(), title: s.title, url, organizer: { name: s.host_name, email: s.host_email }, rrule: toRRule(ruleOf(s), s.dtstart, s.tz), exdate: exdateLine(exOf(s)) || undefined });
  const note = kind === 'cancelled' ? '' : `New schedule: ${describe(ruleOf(s), s.dtstart, s.tz)}.`;
  for (const e of people(s.invitees, s.host_email)) await sendReminder(env, [e], { title: s.title, startsAt: start, endsAt: end, durationMin: s.duration_min, roomUrl: url, backup: '', rec: s.rec_mode, kind, host: s.host_name || s.host_email, hostEmail: s.host_email, ics, note, sender: s.host_name }).catch(() => false);
}

// ---------------------------------------------------------------- the agenda carried forward

/** The next occurrence's agenda gets the open action items from the last meeting in the series, once its notes are ready. */
export async function carryForward(env: MeetEnv, now = Date.now()): Promise<number> {
  const due = ((await env.DB.prepare(
    `SELECT m.* FROM hub_meetings m JOIN hub_meeting_series s ON s.id = m.series_id
      WHERE m.status = 'scheduled' AND m.carried = 0 AND s.carry_actions = 1 AND m.starts_at BETWEEN ? AND ? LIMIT 40`
  ).bind(new Date(now).toISOString(), new Date(now + 3 * DAY).toISOString()).all<Meeting>()).results || []);
  let n = 0;
  for (const m of due) {
    const prev = await env.DB.prepare(
      `SELECT id, starts_at, started_at, notes_status FROM hub_meetings WHERE series_id = ? AND status = 'ended' AND COALESCE(starts_at, started_at) < ? ORDER BY COALESCE(starts_at, started_at) DESC LIMIT 1`
    ).bind(m.series_id, m.starts_at).first<{ id: string; starts_at: string; started_at: string; notes_status: string }>();
    if (prev && prev.notes_status !== 'ready' && prev.notes_status !== 'failed' && prev.notes_status !== 'none') continue; // notes still coming
    const open = prev ? ((await env.DB.prepare('SELECT text, owner_name FROM hub_meeting_actions WHERE meeting_id = ? AND done = 0 ORDER BY idx').bind(prev.id).all<{ text: string; owner_name: string }>()).results || []) : [];
    let agenda = m.agenda;
    if (open.length) {
      const day = new Date(prev!.starts_at || prev!.started_at).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
      const lines = open.slice(0, 15).map((a) => `- ${a.text}${a.owner_name ? ` (${a.owner_name})` : ''}`);
      agenda = `${m.agenda ? m.agenda.trim() + '\n\n' : ''}Open from ${day}:\n${lines.join('\n')}`.slice(0, 2000);
    }
    await env.DB.prepare('UPDATE hub_meetings SET agenda = ?, carried = 1 WHERE id = ?').bind(agenda, m.id).run();
    n++;
  }
  return n;
}

/** The cron pass: every active series keeps its rows made ahead, and agendas get carried forward. */
export async function seriesPass(env: MeetEnv): Promise<{ made: number; carried: number }> {
  let made = 0;
  // Series booked before series rows existed get one the first time the pass sees them.
  const legacy = ((await env.DB.prepare(
    `SELECT DISTINCT series_id FROM hub_meetings WHERE series_id != '' AND status = 'scheduled' AND series_id NOT IN (SELECT id FROM hub_meeting_series) LIMIT 50`
  ).all<{ series_id: string }>()).results || []);
  for (const r of legacy) await loadSeries(env, r.series_id).catch((e) => console.warn('[meet] legacy series', r.series_id, e));
  const active = ((await env.DB.prepare(`SELECT * FROM hub_meeting_series WHERE status = 'active' LIMIT 500`).all<Series>()).results || []);
  for (const s of active) made += await materialize(env, s).catch((e) => { console.warn('[meet] materialize', s.id, e); return 0; });
  const carried = await carryForward(env).catch((e) => { console.warn('[meet] carry', e); return 0; });
  return { made, carried };
}

// ---------------------------------------------------------------- the series page

export async function seriesPage(env: MeetEnv, user: { email: string; role: string }, sid: string) {
  const s = await loadSeries(env, sid);
  // The chain: series split from this one or that this one came from, so the page shows every meeting under one name.
  const chain = new Set<string>([s.id]);
  for (let i = 0, cur = s.parent_id; cur && i < 20; i++) {
    chain.add(cur);
    cur = (await env.DB.prepare('SELECT parent_id FROM hub_meeting_series WHERE id = ?').bind(cur).first<{ parent_id: string }>())?.parent_id || '';
  }
  const kids = ((await env.DB.prepare(`SELECT id FROM hub_meeting_series WHERE parent_id IN (${[...chain].map(() => '?').join(',')})`).bind(...chain).all<{ id: string }>()).results || []);
  kids.forEach((k) => chain.add(k.id));
  const ids = [...chain];
  const rows = ((await env.DB.prepare(`SELECT * FROM hub_meetings WHERE series_id IN (${ids.map(() => '?').join(',')}) ORDER BY COALESCE(starts_at, created_at)`).bind(...ids).all<Meeting>()).results || []);
  const led = await ledPeople(env, user.email);
  const canSee = rows.some((m) => mayReadNotes(m, user as never, led)) || s.host_email === user.email.toLowerCase() || user.role === 'admin';
  if (!canSee) throw new HttpError(404, 'not_found', 'That series does not exist.');
  const counts = new Map<string, { n: number; open: number }>();
  const ended = rows.filter((m) => m.status === 'ended').map((m) => m.id);
  for (let i = 0; i < ended.length; i += 50) {
    const chunk = ended.slice(i, i + 50);
    const a = await env.DB.prepare(`SELECT meeting_id, COUNT(*) AS n, SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END) AS open FROM hub_meeting_actions WHERE meeting_id IN (${chunk.map(() => '?').join(',')}) GROUP BY meeting_id`).bind(...chunk).all<{ meeting_id: string; n: number; open: number }>();
    for (const r of a.results || []) counts.set(r.meeting_id, { n: r.n, open: r.open });
  }
  const may = async (m: Meeting) => mayReadNotes(m, user as never, led, await wasPresent(env, m.id, user.email));
  const past = [];
  for (const m of rows.filter((x) => x.status === 'ended').reverse()) {
    const ok = await may(m);
    past.push({ id: m.id, title: m.title, startsAt: m.starts_at || m.started_at, notesStatus: m.notes_status, summary: ok ? m.summary.slice(0, 600) : '', canRead: ok, actions: counts.get(m.id) || { n: 0, open: 0 } });
  }
  const upcoming = rows.filter((x) => x.status === 'scheduled' || x.status === 'live').map((m) => ({ id: m.id, title: m.title, startsAt: m.starts_at, endsAt: m.ends_at, status: m.status, detached: !!(m as Meeting & { detached?: number }).detached, agenda: m.agenda }));
  const cancelled = rows.filter((x) => x.status === 'cancelled' && (x.starts_at || '') > nowIso()).map((m) => ({ id: m.id, startsAt: m.starts_at }));
  const rule = ruleOf(s);
  return {
    ok: true,
    series: {
      id: s.id, title: s.title, agenda: s.agenda, hostEmail: s.host_email, hostName: s.host_name, durationMin: s.duration_min, rec: s.rec_mode, access: s.access, tz: s.tz,
      invitees: safe(s.invitees, []), rule, rrule: toRRule(rule, s.dtstart, s.tz), describe: describe(rule, s.dtstart, s.tz), dtstart: s.dtstart, status: s.status,
      calendar: !!s.calendar_event_id, mine: s.host_email === user.email.toLowerCase() || user.role === 'admin', templateId: s.template_id, team: s.team, carryActions: !!s.carry_actions,
    },
    upcoming, past, cancelled,
  };
}

/** The occurrence a series link opens now: the live one, else the next one not yet over, else the last one. */
export async function currentOf(env: MeetEnv, sid: string, now = Date.now()): Promise<string> {
  const live = await env.DB.prepare(`SELECT id FROM hub_meetings WHERE series_id = ? AND status = 'live' LIMIT 1`).bind(sid).first<{ id: string }>();
  if (live) return live.id;
  // A meeting stays "the current one" from 30 minutes after it was due to end until it is over.
  const next = await env.DB.prepare(`SELECT id FROM hub_meetings WHERE series_id = ? AND status = 'scheduled' AND ends_at > ? ORDER BY starts_at LIMIT 1`).bind(sid, new Date(now - 30 * 60000).toISOString()).first<{ id: string }>();
  if (next) return next.id;
  // A series split later: follow it on.
  const kid = await env.DB.prepare(`SELECT id FROM hub_meeting_series WHERE parent_id = ? ORDER BY created_at DESC LIMIT 1`).bind(sid).first<{ id: string }>();
  if (kid && kid.id !== sid) return currentOf(env, kid.id, now);
  const last = await env.DB.prepare(`SELECT id FROM hub_meetings WHERE series_id = ? ORDER BY starts_at DESC LIMIT 1`).bind(sid).first<{ id: string }>();
  return last?.id || '';
}
