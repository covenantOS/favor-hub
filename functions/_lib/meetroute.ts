// Meetings API. One catch-all route; every call needs a signed-in person (admins only until MEET_RELEASE is "staff").
//   GET  meetings?scope=            list the meetings this person may open
//   POST meetings                   create ("start now" or booked)
//   GET  meetings/:id               one meeting and what this person may do in it
//   POST meetings/:id/join          get a pid, an SFU session and TURN servers
//   POST meetings/:id/sync          presence, roster, chat and host commands, once a second
//   POST meetings/:id/event         chat, reaction, host command
//   POST meetings/:id/sfu/:op       a checked pass-through to the SFU (tracks/new, renegotiate, tracks/update, tracks/close)
//   POST meetings/:id/tracks        say which tracks this person publishes
//   POST meetings/:id/leave
//   PUT  meetings/:id/rec/chunk/:epoch/:seq, POST rec/start|stop|claim, GET rec/status   (recording, Phase 2)
import { errorJson, handleError, json, nowIso, HttpError } from './http';
import { chatJson, plain, stamp } from './clipai';
import { makeNotes, pumpDrive, pumpTranscript, transcribeRow, type NotesOut } from './meetdrive';
import { calendarMeetings, createEvent, deleteEvent, freeBusy, getEvent, mayBook, patchEvent, sendReminder, swapConferencing, TZ } from './meetcal';
import { mayMove } from './meetprovider';
import {
  GONE_MS, ID_RE, MAX_PEOPLE, REC_STALE_MS, clean, emailsOf, getMeeting, getPresence, guestEmail, guestsOn, hex, iceServers, isHost, ledPeople, mayJoin, mayReadNotes, meetUser, sfuCall, sha,
  type Meeting, type MeetEnv, type Presence,
} from './meet';

const COMMANDS = new Set(['mute', 'camoff', 'remove', 'spot', 'unspot', 'lock', 'unlock', 'makehost', 'unhost', 'muteall', 'sharepolicy', 'letin', 'end', 'lowerhand', 'allowshare']);

export async function route({ request, env, params }: { request: Request; env: MeetEnv; params: Record<string, string | string[]> }, guestMode = false): Promise<Response> {
  try {
    const user = guestMode ? await guestUser(request, env, params) : meetUser(request, env);
    const parts = ((params.path as string[]) || []).filter(Boolean);
    const m = request.method;
    if (parts[0] !== 'meetings') return errorJson('not_found', 'Not found.', 404);
    const sub0 = parts[2] || '';
    if (guestMode && !(parts.length >= 3 && ID_RE.test(parts[1]) && ['guestinfo', 'join', 'sync', 'event', 'leave', 'tracks', 'sfu'].includes(sub0))) return errorJson('not_found', 'Not found.', 404);

    if (parts[1] === 'pump' && m === 'POST') return json(await pumpNext(env, user));
    if (parts[0] === 'meetings' && parts[1] === 'actions' && m === 'GET') return json(await myActions(env, user));
    if (parts[0] === 'meetings' && parts[1] === 'directory' && m === 'GET') return json(await directory(env));
    if (parts[0] === 'meetings' && parts[1] === 'bookstatus' && m === 'GET') return json({ ok: true, ...(await mayBook(env, user.email)), guestsEnabled: guestsOn(env) });
    if (parts[0] === 'meetings' && parts[1] === 'freebusy' && m === 'POST') { const b = (await request.json().catch(() => ({}))) as Record<string, unknown>; return json({ ok: true, calendars: await freeBusy(env, user.email, ((b.emails as string[]) || []).map(String), String(b.from), String(b.to)) }); }
    if (parts[0] === 'meetings' && parts[1] === 'calendar' && !parts[2] && m === 'GET') return json({ ok: true, ...(await calendarMeetings(env, user.email, (ids) => hubEventIds(env, ids))) });
    if (parts[0] === 'meetings' && parts[1] === 'calendar' && parts[2] === 'switch' && m === 'POST') return json(await switchToFavor(env, user, await request.json().catch(() => ({})), new URL(request.url).origin));
    if (parts[0] === 'meetings' && parts[1] === 'remind' && m === 'POST') return json(await remind(env, new URL(request.url).origin));
    if (parts.length === 1) {
      if (m === 'GET') { const sp = new URL(request.url).searchParams; return json(await listMeetings(env, user, sp.get('scope') || 'upcoming', (sp.get('q') || '').trim().slice(0, 200).toLowerCase())); }
      if (m === 'POST') return json(await createMeeting(env, user, await request.json().catch(() => null), new URL(request.url).origin));
    }
    const id = parts[1];
    if (!ID_RE.test(id)) return errorJson('not_found', 'That meeting does not exist.', 404);
    const sub = parts[2] || '';

    if (!sub && m === 'GET') {
      const mt = await getMeeting(env, id);
      if (!mayJoin(mt, user)) return errorJson('not_found', 'That meeting does not exist.', 404);
      return json({ ok: true, meeting: publicMeeting(mt, user), guestsEnabled: guestsOn(env) });
    }
    if (sub === 'guestinfo' && m === 'GET') return json(await guestInfo(env, id, new URL(request.url).searchParams.get('k') || ''));
    if (sub === 'guestlink' && m === 'POST') return json(await guestLink(env, user, id, new URL(request.url).origin));
    if (sub === 'join' && m === 'POST' && guestMode) return json(await joinGuest(env, id, await request.json().catch(() => ({})), clientIpOf(request), request.headers.get('X-Guest-Token') || ''));
    if (sub === 'join' && m === 'POST') return json(await join(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'sync' && m === 'POST') return json(await sync(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'event' && m === 'POST') return json(await postEvent(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'leave' && m === 'POST') return json(await leave(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'tracks' && m === 'POST') return json(await setTracks(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'sfu' && m === 'POST') return json(await sfuPass(env, user, id, parts.slice(3).join('/'), await request.json().catch(() => ({}))));
    if (sub === 'update' && m === 'POST') return json(await updateMeeting(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'rec') return await rec(env, user, id, parts.slice(3), request);
    if (sub === 'notes' && m === 'GET') return json(await notesOf(env, user, id));
    if (sub === 'pump' && m === 'POST') return json(await pump(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'ask' && m === 'POST') return json(await askAboutMeeting(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'action' && m === 'POST') return json(await markAction(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'brain' && m === 'POST') return json(await brainInMeeting(env, user, id, await request.json().catch(() => ({}))));
    return errorJson('not_found', 'Not found.', 404);
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------- ending a meeting

/** The meeting is over: stop the recording and queue the recording and the notes for processing. */
async function endMeeting(env: MeetEnv, id: string) {
  const m = await env.DB.prepare('SELECT status, rec_mode FROM hub_meetings WHERE id = ?').bind(id).first<{ status: string; rec_mode: string }>();
  if (!m || m.status === 'ended') return;
  const had = await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_meeting_chunks WHERE meeting_id = ?').bind(id).first<{ n: number }>();
  const recorded = (had?.n || 0) > 0;
  await env.DB.prepare('UPDATE hub_meeting_rec SET active = 0 WHERE meeting_id = ?').bind(id).run();
  await env.DB.prepare(`UPDATE hub_meetings SET status = 'ended', ended_at = ?, rec_state = ?, notes_status = ? WHERE id = ?`)
    .bind(nowIso(), recorded ? 'uploading' : 'none', recorded && m.rec_mode !== 'off' ? 'pending' : 'none', id).run();
  await env.DB.prepare('UPDATE hub_meeting_presence SET left_at = ? WHERE meeting_id = ? AND left_at = 0').bind(Date.now(), id).run();
}

/** A live meeting whose people have all stopped sending heartbeats (browsers closed without Leave) is over. The cron, pumping and the Meetings list all run it. */
const STALE_ROOM_MS = 90_000;
async function endStaleMeetings(env: MeetEnv) {
  const cutoff = Date.now() - STALE_ROOM_MS;
  const live = await env.DB.prepare(`SELECT id FROM hub_meetings WHERE status = 'live'`).all<{ id: string }>();
  let ended = 0;
  for (const r of live.results || []) {
    const p = await env.DB.prepare('SELECT MAX(seen) AS s FROM hub_meeting_presence WHERE meeting_id = ? AND left_at = 0 AND removed = 0').bind(r.id).first<{ s: number | null }>();
    if (!p?.s || p.s < cutoff) { await endMeeting(env, r.id); ended++; }
  }
  return ended;
}

async function endIfEmpty(env: MeetEnv, id: string) {
  const p = await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_meeting_presence WHERE meeting_id = ? AND left_at = 0 AND removed = 0 AND seen > ?').bind(id, Date.now() - GONE_MS).first<{ n: number }>();
  if (!p?.n) await endMeeting(env, id);
}

// ---------------------------------------------------------------- meetings

function publicMeeting(m: Meeting, user: { email: string }) {
  return {
    id: m.id, title: m.title, agenda: m.agenda, hostEmail: m.host_email, hostName: m.host_name, startsAt: m.starts_at, endsAt: m.ends_at,
    durationMin: m.duration_min, rec: m.rec_mode, access: m.access, status: m.status, locked: !!m.locked, spot: m.spot_pid,
    sharePolicy: m.share_policy, repeat: m.repeat, backupLink: m.backup_link, invitees: safeJson(m.invitees, []), mine: isHost(m, user.email),
    recState: m.rec_state, driveFileId: m.drive_file_id, notesStatus: m.notes_status, summary: m.summary, createdAt: m.created_at,
    startedAt: m.started_at, endedAt: m.ended_at, seriesId: m.series_id || '',
  };
}

/** Notes search: the title, the summary, the host, or anything said in the transcript. `p` is the bind slot for the query text. */
const notesHit = (p: string) => `(instr(lower(title), ${p}) > 0 OR instr(lower(summary), ${p}) > 0 OR instr(lower(host_name), ${p}) > 0 OR id IN (SELECT meeting_id FROM hub_meeting_lines WHERE instr(lower(text), ${p}) > 0))`;

function safeJson<T>(s: string, d: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
}

async function listMeetings(env: MeetEnv, user: { email: string; role: string }, scope: string, q = '') {
  await endStaleMeetings(env);
  const me = user.email.toLowerCase();
  // An address matches only as a whole quoted address in the JSON, so ann@ never finds a meeting that invited joann@.
  const mine = `(lower(host_email) = ?1 OR access IN ('staff','guests') OR instr(lower(invitees), '"' || ?1 || '"') > 0 OR instr(lower(cohosts), '"' || ?1 || '"') > 0)`;
  let sql: string;
  if (scope === 'recent') sql = `SELECT * FROM hub_meetings WHERE ${mine} AND status = 'ended' ORDER BY COALESCE(ended_at, created_at) DESC LIMIT 60`;
  else if (scope === 'notes') sql = `SELECT * FROM hub_meetings WHERE ${mine} AND status = 'ended' AND notes_status != 'none'${q ? ` AND ${notesHit('?2')}` : ''} ORDER BY COALESCE(ended_at, created_at) DESC LIMIT 100`;
  else sql = `SELECT * FROM hub_meetings WHERE ${mine} AND (status = 'live' OR (status = 'scheduled' AND (starts_at IS NULL AND created_at > ?2 OR starts_at > ?3))) ORDER BY COALESCE(starts_at, created_at) LIMIT 80`;
  const stmt = env.DB.prepare(sql);
  const rows =
    scope === 'notes' && q
      ? await stmt.bind(me, q).all<Meeting>()
      : scope === 'recent' || scope === 'notes'
        ? await stmt.bind(me).all<Meeting>()
        : await stmt.bind(me, new Date(Date.now() - 12 * 3600_000).toISOString(), new Date(Date.now() - 3600_000).toISOString()).all<Meeting>();
  const counts = await env.DB.prepare(
    `SELECT meeting_id, COUNT(*) AS n FROM hub_meeting_presence WHERE left_at = 0 AND removed = 0 AND seen > ? GROUP BY meeting_id`
  ).bind(Date.now() - GONE_MS).all<{ meeting_id: string; n: number }>();
  const inRoom = new Map((counts.results || []).map((c) => [c.meeting_id, c.n]));
  const found = scope === 'recent' || scope === 'notes' ? await withLedMeetings(env, user, scope, rows.results || [], scope === 'notes' ? q : '') : rows.results || [];
  // Action items per meeting, for the notes library.
  const actN = new Map<string, number>();
  if (scope === 'notes' && found.length) {
    const ids = found.map((r) => r.id);
    const a = await env.DB.prepare(`SELECT meeting_id, COUNT(*) AS n FROM hub_meeting_actions WHERE meeting_id IN (${ids.map(() => '?').join(',')}) GROUP BY meeting_id`).bind(...ids).all<{ meeting_id: string; n: number }>();
    for (const r of a.results || []) actN.set(r.meeting_id, r.n);
  }
  return { ok: true, meetings: found.map((r) => ({ ...publicMeeting(r, user), inRoom: inRoom.get(r.id) || 0, actionCount: actN.get(r.id) || 0 })) };
}

/** A team leader's notes list also holds the finished meetings that have someone from the team on the roster. Same rule as the notes page (mayReadNotes). */
async function withLedMeetings(env: MeetEnv, user: { email: string; role: string }, scope: 'recent' | 'notes', mine: Meeting[], q = ''): Promise<Meeting[]> {
  const led = await ledPeople(env, user.email);
  if (!led.size) return mine;
  const more = await env.DB.prepare(
    `SELECT * FROM hub_meetings WHERE status = 'ended'${scope === 'notes' ? ` AND notes_status != 'none'` : ''}${q ? ` AND ${notesHit('?1')}` : ''} ORDER BY COALESCE(ended_at, created_at) DESC LIMIT 400`
  ).bind(...(q ? [q] : [])).all<Meeting>();
  const have = new Set(mine.map((r) => r.id));
  const all = [...mine, ...(more.results || []).filter((r) => !have.has(r.id) && mayReadNotes(r, user, led))];
  all.sort((a, b) => (b.ended_at || b.created_at).localeCompare(a.ended_at || a.created_at));
  return all.slice(0, scope === 'recent' ? 60 : 100);
}

async function createMeeting(env: MeetEnv, user: { email: string; name: string }, b: Record<string, unknown> | null, origin = '') {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'bad_json', 'The request was not valid JSON.');
  const title = clean(b.title, 140) || 'Meeting';
  const id = hex(12);
  if (b.startsAt != null && b.startsAt !== '' && (typeof b.startsAt !== 'string' || Number.isNaN(Date.parse(b.startsAt)))) throw new HttpError(400, 'bad_start', 'The start time is not a valid date.');
  const startsAt = typeof b.startsAt === 'string' && !Number.isNaN(Date.parse(b.startsAt)) ? new Date(b.startsAt).toISOString() : null;
  if (startsAt && Date.parse(startsAt) < Date.now() - 5 * 60000) throw new HttpError(400, 'past', 'That start time has passed. Pick a later time.');
  const dur = Math.min(480, Math.max(10, Number(b.durationMin) || 60));
  const rec = ['off', 'notes', 'video'].includes(String(b.rec)) ? String(b.rec) : 'notes';
  const access = ['invited', 'staff', 'guests'].includes(String(b.access)) ? String(b.access) : startsAt ? 'invited' : 'staff';
  const rawInvitees = Array.isArray(b.invitees)
    ? (b.invitees as Array<Record<string, unknown>>).slice(0, 200).map((i) => ({ email: clean(i.email, 200).toLowerCase(), name: clean(i.name, 120), team: clean(i.team, 80), guest: !!i.guest })).filter((i) => i.email)
    : [];
  const badEmail = rawInvitees.find((i) => !/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(i.email));
  if (badEmail) throw new HttpError(400, 'bad_invitee', `${badEmail.email} is not an email address.`);
  const seenInv = new Set<string>([user.email.toLowerCase()]);
  const invitees = rawInvitees.filter((i) => (seenInv.has(i.email) ? false : (seenInv.add(i.email), true)));
  const repeat = ['weekly', 'biweekly', 'monthly'].includes(String(b.repeat)) ? String(b.repeat) : 'none';
  const withGuests = guestsOn(env) && invitees.some((i) => i.guest);
  const gkey = withGuests ? hex(16) : '';
  const endsAt = startsAt ? new Date(Date.parse(startsAt) + dur * 60000).toISOString() : null;
  // A booked meeting goes on the booker's Google Calendar first, so a refusal from Google leaves nothing half made.
  let eventId = '';
  let backup = '';
  const remind = b.remind === false ? 0 : 1;
  if (startsAt && b.calendar !== false) {
    const ev = await createEvent(env, user.email, {
      title, agenda: clean(b.agenda, 2000), roomUrl: `${origin}/meet/room/?m=${id}`, guestUrl: withGuests ? `${origin}/meet/g/?m=${id}&k=${gkey}` : '', startsAt, endsAt: endsAt as string,
      attendees: invitees.map((i) => i.email).filter((e) => e !== user.email.toLowerCase()), recording: rec, backupMeet: b.backup !== false, repeat,
    });
    eventId = ev.id;
    backup = ev.meetLink;
  }
  const insert = (rid: string, at: string | null, until: string | null) =>
    env.DB.prepare(
      `INSERT INTO hub_meetings (id, title, agenda, host_email, host_name, starts_at, ends_at, duration_min, rec_mode, access, invitees, status, created_at, repeat, series_id, calendar_event_id, backup_link, remind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`
    ).bind(rid, title, clean(b.agenda, 2000), user.email.toLowerCase(), user.name, at, until, dur, rec, access, JSON.stringify(invitees), nowIso(), repeat, repeat === 'none' ? '' : id, eventId, backup, remind);
  const rows = [insert(id, startsAt, endsAt)];
  if (startsAt && repeat !== 'none') {
    // The next few occurrences get their own rooms now; the reminder pass adds more as they come close.
    for (const at of occurrences(startsAt, repeat, 9).slice(1)) rows.push(insert(hex(12), at, new Date(Date.parse(at) + dur * 60000).toISOString()));
  }
  if (withGuests) rows.push(env.DB.prepare(`UPDATE hub_meetings SET access = 'guests' WHERE id = ?`).bind(id), env.DB.prepare('INSERT OR REPLACE INTO hub_meeting_guest (meeting_id, gkey) VALUES (?, ?)').bind(id, gkey));
  await env.DB.batch(rows);
  return { ok: true, meeting: publicMeeting(await getMeeting(env, id), user), calendar: !!eventId };
}

/** Which of these calendar event ids already belong to a Favor Meetings room. */
async function hubEventIds(env: MeetEnv, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const rows = await env.DB.prepare(`SELECT DISTINCT calendar_event_id AS id FROM hub_meetings WHERE calendar_event_id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<{ id: string }>();
    for (const r of rows.results || []) found.add(r.id);
  }
  return found;
}

/** The organizer's click: put a Favor room on an internal Zoom or Meet event and send the guests the updated invite. Nothing changes before this call. */
async function switchToFavor(env: MeetEnv, user: { email: string; name: string }, b: Record<string, unknown>, origin: string) {
  const eventId = clean(b.eventId, 200);
  if (!eventId) throw new HttpError(400, 'event', 'Pick a meeting to move.');
  const ev = await getEvent(env, user.email, eventId);
  if (!mayMove(ev, user.email)) throw new HttpError(403, 'organizer_only', 'Only the organizer can move an internal Zoom or Google Meet meeting that has not ended.');
  if ((await hubEventIds(env, [ev.id])).size) throw new HttpError(409, 'already', 'This meeting is already in Favor Meetings.');
  const id = hex(12);
  const startsAt = new Date(ev.start?.dateTime as string).toISOString();
  const endsAt = new Date(ev.end?.dateTime as string).toISOString();
  const dur = Math.max(10, Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60000));
  const me = user.email.toLowerCase();
  const invitees = (ev.attendees || []).filter((a) => !a.self && !a.resource && a.email && String(a.email).toLowerCase() !== me).slice(0, 200).map((a) => ({ email: String(a.email).toLowerCase(), name: clean(a.displayName, 120), team: '', guest: false }));
  await env.DB.prepare(
    `INSERT INTO hub_meetings (id, title, agenda, host_email, host_name, starts_at, ends_at, duration_min, rec_mode, access, invitees, status, created_at, repeat, series_id, calendar_event_id, backup_link, remind)
     VALUES (?, ?, '', ?, ?, ?, ?, ?, 'notes', 'invited', ?, 'scheduled', ?, 'none', '', ?, '', 0)`
  ).bind(id, clean(ev.summary, 140) || 'Meeting', me, user.name, startsAt, endsAt, dur, JSON.stringify(invitees), nowIso(), ev.id).run();
  try {
    await swapConferencing(env, user.email, ev, `${origin}/meet/room/?m=${id}`);
  } catch (e) {
    await env.DB.prepare('DELETE FROM hub_meetings WHERE id = ?').bind(id).run();
    throw e;
  }
  return { ok: true, id };
}

async function updateMeeting(env: MeetEnv, user: { email: string; role: string }, id: string, b: Record<string, unknown>) {
  const mt = await getMeeting(env, id);
  if (!isHost(mt, user.email) && user.role !== 'admin') throw new HttpError(403, 'host_only', 'Only the host can change this meeting.');
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof b.title === 'string') { sets.push('title = ?'); vals.push(clean(b.title, 140) || mt.title); }
  if (typeof b.agenda === 'string') { sets.push('agenda = ?'); vals.push(clean(b.agenda, 2000)); }
  if (['off', 'notes', 'video'].includes(String(b.rec))) { sets.push('rec_mode = ?'); vals.push(String(b.rec)); }
  if (['invited', 'staff', 'guests'].includes(String(b.access))) { sets.push('access = ?'); vals.push(String(b.access)); }
  if (b.status === 'cancelled') {
    sets.push(`status = 'cancelled'`);
    if (mt.calendar_event_id) {
      try {
        if (mt.series_id) {
          await deleteEvent(env, mt.host_email, mt.calendar_event_id);
          await env.DB.prepare(`UPDATE hub_meetings SET status = 'cancelled' WHERE series_id = ? AND status = 'scheduled' AND starts_at >= ?`).bind(mt.series_id, mt.starts_at || nowIso()).run();
        } else await deleteEvent(env, mt.host_email, mt.calendar_event_id);
      } catch (e) { if (user.email.toLowerCase() === mt.host_email.toLowerCase()) throw e; }
    }
  }
  if (typeof b.startsAt === 'string' && !Number.isNaN(Date.parse(b.startsAt)) && mt.starts_at) {
    const s0 = new Date(b.startsAt).toISOString();
    const e0 = new Date(Date.parse(s0) + mt.duration_min * 60000).toISOString();
    if (mt.series_id) throw new HttpError(400, 'series', 'A repeating meeting changes from Google Calendar, or cancel it and book it again.');
    if (mt.calendar_event_id) await patchEvent(env, mt.host_email, mt.calendar_event_id, { startsAt: s0, endsAt: e0 });
    sets.push('starts_at = ?', 'ends_at = ?');
    vals.push(s0, e0);
  }
  if (!sets.length) return { ok: true };
  await env.DB.prepare(`UPDATE hub_meetings SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  return { ok: true };
}

// ---------------------------------------------------------------- join and sync

async function join(env: MeetEnv, user: { email: string; name: string; role: string }, id: string, b: Record<string, unknown>) {
  const mt = await getMeeting(env, id);
  if (!mayJoin(mt, user as never)) throw new HttpError(404, 'not_found', 'That meeting does not exist.');
  if (mt.status === 'ended' && mt.ended_at && Date.now() - Date.parse(mt.ended_at) > 6 * 3600_000) throw new HttpError(410, 'ended', 'This meeting has ended.');
  const now = Date.now();
  const hostNow = isHost(mt, user.email);
  if (mt.locked && !hostNow) throw new HttpError(403, 'locked', 'The host locked this meeting.');
  const alive = await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_meeting_presence WHERE meeting_id = ? AND left_at = 0 AND removed = 0 AND seen > ?').bind(id, now - GONE_MS).first<{ n: number }>();
  if ((alive?.n || 0) >= MAX_PEOPLE) throw new HttpError(403, 'full', 'This meeting is full.');

  // The same person rejoining keeps their pid; their old SFU session is dropped by the SFU on its own.
  let pid = clean(b.pid, 12);
  let existing: Presence | null = null;
  if (pid) {
    existing = await env.DB.prepare('SELECT * FROM hub_meeting_presence WHERE meeting_id = ? AND pid = ?').bind(id, pid).first<Presence>();
    if (existing && (existing.email.toLowerCase() !== user.email.toLowerCase() || existing.removed)) {
      if (existing.removed) throw new HttpError(403, 'removed', 'The host removed you from this meeting.');
      existing = null;
      pid = '';
    }
  }
  if (!pid) {
    // One person on two devices gets two pids; a refreshed tab reuses the stored one.
    pid = hex(6);
  }
  const session = (await sfuCall(env, 'POST', '/sessions/new')) as { sessionId?: string };
  if (!session.sessionId) throw new HttpError(502, 'sfu_error', 'The meeting service did not answer. Try again.');
  const role = hostNow ? (mt.host_email.toLowerCase() === user.email.toLowerCase() ? 'host' : 'cohost') : 'staff';
  const name = clean(b.name, 80) || user.name;
  if (existing) {
    await env.DB.prepare('UPDATE hub_meeting_presence SET session_id = ?, tracks = ?, role = ?, seen = ?, left_at = 0, name = ? WHERE meeting_id = ? AND pid = ?')
      .bind(session.sessionId, '[]', existing.role === 'cohost' && role === 'staff' ? 'cohost' : role, now, name, id, pid).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO hub_meeting_presence (meeting_id, pid, email, name, role, session_id, tracks, mic, cam, joined_at, seen) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`
    ).bind(id, pid, user.email.toLowerCase(), name, role, session.sessionId, b.mic === false ? 0 : 1, b.cam === false ? 0 : 1, now, now).run();
  }
  if (mt.status !== 'live') await env.DB.prepare(`UPDATE hub_meetings SET status = 'live', started_at = COALESCE(started_at, ?), ended_at = NULL WHERE id = ?`).bind(nowIso(), id).run();
  const [ice, last] = await Promise.all([iceServers(env), env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM hub_meeting_events WHERE meeting_id = ?').bind(id).first<{ s: number }>()]);
  await addEvent(env, id, 'notice', pid, '', { a: 'joined', name });
  return { ok: true, pid, role, sessionId: session.sessionId, iceServers: ice, meeting: publicMeeting(await getMeeting(env, id), user), since: last?.s || 0, guestsEnabled: guestsOn(env) };
}

async function addEvent(env: MeetEnv, id: string, kind: string, from: string, to: string, body: unknown) {
  await env.DB.prepare('INSERT INTO hub_meeting_events (meeting_id, kind, from_pid, to_pid, body, ts) VALUES (?, ?, ?, ?, ?, ?)').bind(id, kind, from, to, JSON.stringify(body), Date.now()).run();
}

async function sync(env: MeetEnv, user: { email: string; name: string; role: string }, id: string, b: Record<string, unknown>) {
  const me = await getPresence(env, id, clean(b.pid, 12), user.email);
  const now = Date.now();
  const st = (b.me || {}) as Record<string, unknown>;
  const mt0 = await getMeeting(env, id);
  // Only write when something changed, or every four seconds as the heartbeat.
  const mic = st.mic === false ? 0 : 1;
  const cam = st.cam === false ? 0 : 1;
  const hand = st.hand ? 1 : 0;
  const sharing = st.sharing ? 1 : 0;
  const lvl = Math.max(0, Math.min(100, Number(st.lvl) || 0));
  const speaking = lvl > 12 && mic;
  const changed = mic !== me.mic || cam !== me.cam || hand !== me.hand || sharing !== me.sharing || speaking !== (me.speak_at > now - 1500) || Math.abs(lvl - me.lvl) > 15;
  if (changed || now - me.seen > 3500) {
    await env.DB.prepare('UPDATE hub_meeting_presence SET mic = ?, cam = ?, hand = ?, sharing = ?, lvl = ?, speak_at = ?, seen = ?, left_at = 0 WHERE meeting_id = ? AND pid = ?')
      .bind(mic, cam, hand, sharing, lvl, speaking ? now : me.speak_at, now, id, me.pid).run();
  }
  const tx = Number.isFinite(Number(b.tx)) ? Number(b.tx) : -1;
  const since = Number(b.since);
  const recent = Number.isFinite(since) && since >= 0
    ? await env.DB.prepare(`SELECT seq, kind, from_pid, to_pid, body, ts FROM hub_meeting_events WHERE meeting_id = ? AND seq > ? AND (to_pid = '' OR to_pid = ? OR from_pid = ?) ORDER BY seq LIMIT 200`).bind(id, since, me.pid, me.pid).all()
    : await env.DB.prepare(`SELECT seq, kind, from_pid, to_pid, body, ts FROM hub_meeting_events WHERE meeting_id = ? AND kind = 'chat' AND (to_pid = '' OR to_pid = ? OR from_pid = ?) ORDER BY seq DESC LIMIT 60`).bind(id, me.pid, me.pid).all();
  let events = (recent.results || []) as Array<{ seq: number; kind: string; from_pid: string; to_pid: string; body: string; ts: number }>;
  if (!(Number.isFinite(since) && since >= 0)) events = events.reverse();
  const people = await env.DB.prepare(
    `SELECT pid, name, role, session_id, tracks, mic, cam, hand, sharing, can_share, lvl, speak_at, waiting, joined_at, seen FROM hub_meeting_presence
      WHERE meeting_id = ? AND left_at = 0 AND removed = 0 AND seen > ? ORDER BY joined_at`
  ).bind(id, now - GONE_MS).all<Presence>();
  let list = people.results || [];
  // Hostless for a while: the person who has been here longest takes over the host controls.
  const hosts = list.filter((p) => p.role === 'host' || p.role === 'cohost');
  if (!hosts.length && list.length && mt0.status === 'live') {
    const first = list.find((p) => !p.waiting && p.role === 'staff');
    if (first && now - first.joined_at > 30_000) {
      await env.DB.prepare(`UPDATE hub_meeting_presence SET role = 'cohost' WHERE meeting_id = ? AND pid = ?`).bind(id, first.pid).run();
      await addEvent(env, id, 'notice', '', '', { a: 'acting', name: first.name, pid: first.pid });
      list = list.map((p) => (p.pid === first.pid ? { ...p, role: 'cohost' as const } : p));
    }
  }
  const myRole = (list.find((p) => p.pid === me.pid) || me).role;
  const mt = await getMeeting(env, id);
  const isGuest = me.role === 'guest';
  const lines = tx >= 0 && !isGuest ? ((await env.DB.prepare('SELECT n, t, who, text FROM hub_meeting_lines WHERE meeting_id = ? AND n > ? ORDER BY n LIMIT 60').bind(id, tx).all<{ n: number; t: number; who: string; text: string }>()).results || []) : [];
  const r = await env.DB.prepare('SELECT epoch, owner_pid, active, last_chunk, mode FROM hub_meeting_rec WHERE meeting_id = ?').bind(id).first<{ epoch: number; owner_pid: string; active: number; last_chunk: number; mode: string }>();
  return {
    ok: true,
    now,
    role: myRole,
    people: list.filter((p) => myRole === 'host' || myRole === 'cohost' || !p.waiting).map((p) => ({
      pid: p.pid, name: p.name, role: p.role, sessionId: p.session_id, tracks: safeJson(p.tracks, []), mic: !!p.mic, cam: !!p.cam, hand: !!p.hand, sharing: !!p.sharing,
      canShare: !!p.can_share, lvl: p.lvl, speaking: p.speak_at > now - 1500, speakAt: p.speak_at, waiting: !!p.waiting, joinedAt: p.joined_at,
    })),
    lines,
    me: { waiting: !!me.waiting },
    events: events.filter((e) => !isGuest || (e.kind !== 'brain' && !(e.kind === 'chat' && safeJson<{ ai?: boolean }>(e.body, {}).ai))).map((e) => ({ seq: e.seq, kind: e.kind, from: e.from_pid, to: e.to_pid, body: safeJson(e.body, {}), ts: e.ts })),
    meeting: { status: mt.status, locked: !!mt.locked, spot: mt.spot_pid, sharePolicy: mt.share_policy, rec: mt.rec_mode, title: mt.title },
    recording: r ? { epoch: r.epoch, owner: r.owner_pid, active: !!r.active, mode: r.mode, stale: !!r.active && now - r.last_chunk > REC_STALE_MS } : null,
  };
}

async function setTracks(env: MeetEnv, user: { email: string }, id: string, b: Record<string, unknown>) {
  const me = await getPresence(env, id, clean(b.pid, 12), user.email);
  const tracks = (Array.isArray(b.tracks) ? b.tracks : []).slice(0, 8).map((t) => {
    const o = t as Record<string, unknown>;
    return { name: clean(o.name, 60), kind: o.kind === 'audio' ? 'audio' : 'video', mid: clean(o.mid, 8), label: clean(o.label, 20) };
  });
  // A screen share is listed (and so can be pulled) only for a host, or for anyone while the host allows sharing and has not stopped them.
  const mt = await getMeeting(env, id);
  const mayShare = me.role === 'host' || me.role === 'cohost' || (mt.share_policy === 'all' && !!me.can_share);
  const listed = mayShare ? tracks : tracks.filter((t) => t.name !== 's');
  await env.DB.prepare('UPDATE hub_meeting_presence SET tracks = ?, seen = ? WHERE meeting_id = ? AND pid = ?').bind(JSON.stringify(listed), Date.now(), id, me.pid).run();
  return { ok: true, shared: mayShare };
}

async function leave(env: MeetEnv, user: { email: string }, id: string, b: Record<string, unknown>) {
  const me = await getPresence(env, id, clean(b.pid, 12), user.email).catch(() => null);
  if (!me) return { ok: true };
  await env.DB.prepare('UPDATE hub_meeting_presence SET left_at = ?, tracks = ? WHERE meeting_id = ? AND pid = ?').bind(Date.now(), '[]', id, me.pid).run();
  await addEvent(env, id, 'notice', me.pid, '', { a: 'left', name: me.name });
  await endIfEmpty(env, id);
  return { ok: true };
}

// ---------------------------------------------------------------- events and host commands

async function postEvent(env: MeetEnv, user: { email: string }, id: string, b: Record<string, unknown>) {
  const me = await getPresence(env, id, clean(b.pid, 12), user.email);
  const kind = String(b.kind);
  const to = clean(b.to, 12);
  if (kind === 'chat') {
    const body = (b.body || {}) as Record<string, unknown>;
    const text = clean(body.text, 2000);
    const file = body.file as Record<string, unknown> | undefined;
    if (!text && !file) throw new HttpError(400, 'empty', 'Write something first.');
    const f = file ? { name: clean(file.name, 160), url: clean(file.url, 600), type: clean(file.type, 20), by: clean(file.by, 80) } : undefined;
    await addEvent(env, id, 'chat', me.pid, to, { text, name: me.name, file: f, ai: !!body.ai });
    return { ok: true };
  }
  if (kind === 'brain') {
    // Staff put a Favor Brain answer on everyone's screen, or take it down. Only staff can post; the answer is the asker's to share.
    if (me.role === 'guest') throw new HttpError(403, 'staff_only', 'Favor Brain is for staff.');
    const body = (b.body || {}) as Record<string, unknown>;
    if (body.stop) { await addEvent(env, id, 'brain', me.pid, '', { stop: true, by: me.name }); return { ok: true }; }
    const packed = JSON.stringify({ q: clean(body.q, 200), md: clean(body.md, 6000), blocks: Array.isArray(body.blocks) ? body.blocks.slice(0, 6) : [], by: me.name });
    if (packed.length > 60000) throw new HttpError(413, 'too_big', 'That answer is too large to put on screen.');
    await env.DB.prepare('INSERT INTO hub_meeting_events (meeting_id, kind, from_pid, to_pid, body, ts) VALUES (?, ?, ?, ?, ?, ?)').bind(id, 'brain', me.pid, '', packed, Date.now()).run();
    return { ok: true };
  }
  if (kind === 'react') {
    await addEvent(env, id, 'react', me.pid, '', { e: clean((b.body as Record<string, unknown>)?.e, 8), name: me.name });
    return { ok: true };
  }
  if (kind === 'cmd') {
    const body = (b.body || {}) as Record<string, unknown>;
    const a = String(body.a);
    if (!COMMANDS.has(a)) throw new HttpError(400, 'bad_command', 'Unknown command.');
    const mt = await getMeeting(env, id);
    // Anyone may lower their own hand. Everything else is for hosts.
    if (a === 'lowerhand' && (!to || to === me.pid)) {
      await env.DB.prepare('UPDATE hub_meeting_presence SET hand = 0 WHERE meeting_id = ? AND pid = ?').bind(id, me.pid).run();
      return { ok: true };
    }
    if (me.role !== 'host' && me.role !== 'cohost') throw new HttpError(403, 'host_only', 'Only a host can do that.');
    const target = to ? await env.DB.prepare('SELECT * FROM hub_meeting_presence WHERE meeting_id = ? AND pid = ?').bind(id, to).first<Presence>() : null;
    if (to && !target) throw new HttpError(404, 'gone', 'That person already left.');
    if (target && target.role === 'host' && ['remove', 'mute', 'camoff', 'unhost'].includes(a) && me.role !== 'host') throw new HttpError(403, 'host_only', 'Only the host can do that to the host.');
    switch (a) {
      case 'spot': await env.DB.prepare('UPDATE hub_meetings SET spot_pid = ? WHERE id = ?').bind(to, id).run(); break;
      case 'unspot': await env.DB.prepare(`UPDATE hub_meetings SET spot_pid = '' WHERE id = ?`).bind(id).run(); break;
      case 'lock': await env.DB.prepare('UPDATE hub_meetings SET locked = 1 WHERE id = ?').bind(id).run(); break;
      case 'unlock': await env.DB.prepare('UPDATE hub_meetings SET locked = 0 WHERE id = ?').bind(id).run(); break;
      case 'sharepolicy': await env.DB.prepare('UPDATE hub_meetings SET share_policy = ? WHERE id = ?').bind(body.v === 'hosts' ? 'hosts' : 'all', id).run(); break;
      case 'end': await endMeeting(env, id); break;
      case 'lowerhand': if (target) await env.DB.prepare('UPDATE hub_meeting_presence SET hand = 0 WHERE meeting_id = ? AND pid = ?').bind(id, to).run(); break;
      case 'allowshare': if (target) await env.DB.prepare('UPDATE hub_meeting_presence SET can_share = ? WHERE meeting_id = ? AND pid = ?').bind(body.v === false ? 0 : 1, id, to).run(); break;
      case 'letin': if (target) await env.DB.prepare('UPDATE hub_meeting_presence SET waiting = 0 WHERE meeting_id = ? AND pid = ?').bind(id, to).run(); break;
      case 'makehost':
        if (target) {
          const list = emailsOf(mt.cohosts);
          if (!list.includes(target.email.toLowerCase())) list.push(target.email.toLowerCase());
          await env.DB.prepare('UPDATE hub_meetings SET cohosts = ? WHERE id = ?').bind(JSON.stringify(list), id).run();
          await env.DB.prepare(`UPDATE hub_meeting_presence SET role = 'cohost' WHERE meeting_id = ? AND pid = ?`).bind(id, to).run();
        }
        break;
      case 'unhost':
        if (target && target.role === 'cohost') {
          const list = emailsOf(mt.cohosts).filter((e) => e !== target.email.toLowerCase());
          await env.DB.prepare('UPDATE hub_meetings SET cohosts = ? WHERE id = ?').bind(JSON.stringify(list), id).run();
          await env.DB.prepare(`UPDATE hub_meeting_presence SET role = 'staff' WHERE meeting_id = ? AND pid = ?`).bind(id, to).run();
        }
        break;
      case 'remove':
        if (target) {
          await env.DB.prepare('UPDATE hub_meeting_presence SET removed = 1, tracks = ? WHERE meeting_id = ? AND pid = ?').bind('[]', id, to).run();
          // Cut their media at the SFU as well: close every track they publish.
          try {
            const mids = safeJson<Array<{ mid: string }>>(target.tracks, []).map((t) => ({ mid: t.mid })).filter((t) => t.mid);
            if (mids.length && target.session_id) await sfuCall(env, 'PUT', `/sessions/${target.session_id}/tracks/close`, { tracks: mids, force: true });
          } catch {
            /* their client leaves on the command anyway */
          }
        }
        break;
      default: break;
    }
    await addEvent(env, id, 'cmd', me.pid, a === 'spot' || a === 'unspot' || a === 'lock' || a === 'unlock' || a === 'sharepolicy' || a === 'end' || a === 'muteall' ? '' : to, { a, v: body.v, by: me.name, target: target?.name });
    return { ok: true };
  }
  throw new HttpError(400, 'bad_event', 'Unknown event.');
}

// ---------------------------------------------------------------- SFU pass-through

async function sfuPass(env: MeetEnv, user: { email: string }, id: string, op: string, b: Record<string, unknown>) {
  const me = await getPresence(env, id, clean(b.pid, 12), user.email);
  if (me.waiting) throw new HttpError(403, 'waiting', 'Wait for the host to let you in.');
  if (!me.session_id) throw new HttpError(400, 'no_session', 'Rejoin the meeting.');
  const sid = me.session_id;
  if (op === 'tracks/new') {
    const tracks = (Array.isArray(b.tracks) ? b.tracks : []).slice(0, 64) as Array<Record<string, unknown>>;
    const remote = tracks.filter((t) => t.location === 'remote');
    if (remote.length) {
      const ok = await env.DB.prepare('SELECT session_id, tracks FROM hub_meeting_presence WHERE meeting_id = ? AND left_at = 0 AND removed = 0 AND waiting = 0').bind(id).all<{ session_id: string; tracks: string }>();
      // A track can be pulled only if its owner is in this meeting and the roster lists it (a share the host did not allow never is).
      const allowed = new Map((ok.results || []).map((r) => [r.session_id, new Set(safeJson<Array<{ name: string }>>(r.tracks, []).map((t) => t.name))]));
      for (const t of remote) { const names = allowed.get(String(t.sessionId)); if (!names || !names.has(String(t.trackName))) throw new HttpError(403, 'not_here', 'That track is not available in this meeting.'); }
    }
    if (b.sessionDescription && me.waiting) throw new HttpError(403, 'waiting', 'Wait for the host to let you in.');
    const body: Record<string, unknown> = { tracks: tracks.map(trackOf) };
    if (b.sessionDescription) body.sessionDescription = b.sessionDescription;
    return await sfuCall(env, 'POST', `/sessions/${sid}/tracks/new`, body);
  }
  if (op === 'renegotiate') return await sfuCall(env, 'PUT', `/sessions/${sid}/renegotiate`, { sessionDescription: b.sessionDescription });
  if (op === 'tracks/update') return await sfuCall(env, 'PUT', `/sessions/${sid}/tracks/update`, { tracks: ((b.tracks as Array<Record<string, unknown>>) || []).slice(0, 64).map(trackOf) });
  if (op === 'tracks/close') {
    const body: Record<string, unknown> = { tracks: ((b.tracks as Array<Record<string, unknown>>) || []).slice(0, 64).map((t) => ({ mid: String(t.mid) })), force: b.force !== false };
    if (b.sessionDescription) body.sessionDescription = b.sessionDescription;
    return await sfuCall(env, 'PUT', `/sessions/${sid}/tracks/close`, body);
  }
  throw new HttpError(404, 'not_found', 'Not found.');
}

function trackOf(t: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = { location: t.location === 'remote' ? 'remote' : 'local' };
  for (const k of ['mid', 'trackName', 'sessionId', 'kind']) if (typeof t[k] === 'string') o[k] = String(t[k]).slice(0, 120);
  const s = t.simulcast as Record<string, unknown> | undefined;
  if (s) o.simulcast = { preferredRid: String(s.preferredRid || 'h').slice(0, 2), priorityOrdering: 'asciibetical', ridNotAvailable: 'asciibetical' };
  return o;
}

// ---------------------------------------------------------------- recording

async function rec(env: MeetEnv, user: { email: string }, id: string, sub: string[], request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pid = clean(url.searchParams.get('pid'), 12);
  const me = await getPresence(env, id, pid, user.email);
  const now = Date.now();
  const mt = await getMeeting(env, id);
  const hostish = me.role === 'host' || me.role === 'cohost';
  if (sub[0] === 'status' && request.method === 'GET') {
    const r = await env.DB.prepare('SELECT * FROM hub_meeting_rec WHERE meeting_id = ?').bind(id).first<{ epoch: number; owner_pid: string; active: number; last_chunk: number }>();
    return json({ ok: true, rec: r ? { ...r, now, stale: !!r.active && now - r.last_chunk > REC_STALE_MS } : null });
  }
  if (sub[0] === 'start' && request.method === 'POST') {
    if (!hostish) throw new HttpError(403, 'host_only', 'Only a host can start the recording.');
    if (mt.rec_mode === 'off') throw new HttpError(400, 'rec_off', 'Recording is off for this meeting.');
    await env.DB.prepare(`INSERT OR REPLACE INTO hub_meeting_rec (meeting_id, epoch, owner_pid, mode, active, last_chunk, started) VALUES (?, 1, ?, ?, 1, ?, ?)`).bind(id, pid, mt.rec_mode, now, now).run();
    await env.DB.prepare(`UPDATE hub_meetings SET rec_state = 'recording' WHERE id = ?`).bind(id).run();
    await addEvent(env, id, 'notice', pid, '', { a: 'rec-start', mode: mt.rec_mode });
    return json({ ok: true, epoch: 1, mode: mt.rec_mode });
  }
  if (sub[0] === 'stop' && request.method === 'POST') {
    if (!hostish) throw new HttpError(403, 'host_only', 'Only a host can stop the recording.');
    await env.DB.prepare('UPDATE hub_meeting_rec SET active = 0 WHERE meeting_id = ?').bind(id).run();
    await env.DB.prepare(`UPDATE hub_meetings SET rec_state = 'uploading' WHERE id = ?`).bind(id).run();
    await addEvent(env, id, 'notice', pid, '', { a: 'rec-stop' });
    return json({ ok: true });
  }
  if (sub[0] === 'claim' && request.method === 'POST') {
    const b = (await request.json().catch(() => ({}))) as { epoch?: number };
    // Any staff member in the room may take over a recording whose owner went quiet. One winner per epoch.
    const res = await env.DB.prepare('UPDATE hub_meeting_rec SET epoch = epoch + 1, owner_pid = ?, last_chunk = ? WHERE meeting_id = ? AND active = 1 AND epoch = ? AND ? - last_chunk > ?')
      .bind(pid, now, id, Number(b.epoch), now, REC_STALE_MS).run();
    if (res.meta.changes === 1) {
      await addEvent(env, id, 'notice', pid, '', { a: 'rec-takeover', name: me.name });
      return json({ ok: true, epoch: Number(b.epoch) + 1, mode: mt.rec_mode });
    }
    return json({ ok: false });
  }
  if (sub[0] === 'audio' && request.method === 'PUT') {
    const epoch = Number(sub[1]);
    const n = Number(sub[2]);
    if (!Number.isInteger(epoch) || !Number.isInteger(n) || epoch < 1 || n < 0 || n > 400) throw new HttpError(400, 'bad_chunk', 'Bad piece.');
    const r = await env.DB.prepare('SELECT epoch FROM hub_meeting_rec WHERE meeting_id = ?').bind(id).first<{ epoch: number }>();
    if (!r || r.epoch < epoch) throw new HttpError(403, 'not_owner', 'Another person is recording.');
    const data = await request.arrayBuffer();
    if (data.byteLength > 20 * 1024 * 1024) throw new HttpError(413, 'too_big', 'Piece too large.');
    const ext = (request.headers.get('x-ext') || 'webm') === 'mp4' ? 'mp4' : 'webm';
    await env.CLIPS.put(`meet/${id}/audio/${epoch}-${n}.${ext}`, data);
    const start = Number(request.headers.get('x-start')) || now;
    const end = Number(request.headers.get('x-end')) || now;
    await env.DB.prepare('INSERT OR REPLACE INTO hub_meeting_audio (meeting_id, epoch, n, start_ms, end_ms, bytes, ext) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, epoch, n, start, end, data.byteLength, ext).run();
    // Read the slice now, so captions and "what did I miss" are only seconds behind. A failure leaves the slice for the end-of-meeting pass.
    let lines = 0;
    try {
      lines = await transcribeRow(env, mt, { epoch, n, start_ms: start, ext, bytes: data.byteLength }, decodeURIComponent(request.headers.get('x-who') || ''));
    } catch (err) {
      console.warn('[meet] live read', id, err);
    }
    return json({ ok: true, lines });
  }
  if (sub[0] === 'chunk' && request.method === 'PUT') {
    const epoch = Number(sub[1]);
    const seq = Number(sub[2]);
    if (!Number.isInteger(epoch) || !Number.isInteger(seq) || epoch < 1 || seq < 0 || seq > 100000) throw new HttpError(400, 'bad_chunk', 'Bad chunk.');
    const r = await env.DB.prepare('SELECT epoch, owner_pid FROM hub_meeting_rec WHERE meeting_id = ?').bind(id).first<{ epoch: number; owner_pid: string }>();
    if (!r || r.epoch < epoch || (r.epoch === epoch && r.owner_pid !== pid)) throw new HttpError(403, 'not_owner', 'Another person is recording.');
    const data = await request.arrayBuffer();
    if (data.byteLength > 6 * 1024 * 1024) throw new HttpError(413, 'too_big', 'Chunk too large.');
    await env.CLIPS.put(`meet/${id}/${epoch}/${String(seq).padStart(6, '0')}.webm`, data);
    const t0 = Number(request.headers.get('x-t0')) || now;
    const t1 = Number(request.headers.get('x-t1')) || now;
    await env.DB.prepare('INSERT OR REPLACE INTO hub_meeting_chunks (meeting_id, epoch, seq, t0, t1, bytes) VALUES (?, ?, ?, ?, ?, ?)').bind(id, epoch, seq, t0, t1, data.byteLength).run();
    if (r.epoch === epoch) await env.DB.prepare('UPDATE hub_meeting_rec SET last_chunk = ? WHERE meeting_id = ?').bind(now, id).run();
    return json({ ok: true });
  }
  return errorJson('not_found', 'Not found.', 404);
}

// ---------------------------------------------------------------- recording to Drive, transcript and notes

async function notesOf(env: MeetEnv, user: { email: string; role: string }, id: string) {
  const m = await getMeeting(env, id);
  // The server decides who reads the notes: the people who may join, and the leader of a team with someone on the roster. Anyone else gets a 404.
  if (!mayJoin(m, user) && !mayReadNotes(m, user, await ledPeople(env, user.email))) throw new HttpError(404, 'not_found', 'That meeting does not exist.');
  const files = await env.DB.prepare(`SELECT file_id, file_name FROM hub_meeting_drive WHERE meeting_id = ? AND state = 'done' ORDER BY epoch`).bind(id).all<{ file_id: string; file_name: string }>();
  return {
    ok: true,
    meeting: publicMeeting(m, user),
    notes: safeJson(m.notes_json, {}),
    transcript: m.status === 'ended' && m.transcript && m.transcript !== '[]' ? safeJson(m.transcript, []) : ((await env.DB.prepare('SELECT t, who, text FROM hub_meeting_lines WHERE meeting_id = ? ORDER BY t, n').bind(id).all()).results || []),
    files: (files.results || []).map((f) => ({ id: f.file_id, name: f.file_name, url: `https://drive.google.com/file/d/${f.file_id}/view` })),
    actions: (await env.DB.prepare('SELECT idx, text, owner_name, owner_email, due, t, done FROM hub_meeting_actions WHERE meeting_id = ? ORDER BY idx').bind(id).all()).results || [],
    people: (await env.DB.prepare('SELECT lower(email) AS email, MIN(name) AS name FROM hub_meeting_presence WHERE meeting_id = ? GROUP BY lower(email) ORDER BY MIN(joined_at)').bind(id).all<{ email: string; name: string }>()).results || [],
    asked: await askedDuring(env, m),
  };
}

/** What people asked Favor Brain during the meeting and showed or posted, in time order. */
async function askedDuring(env: MeetEnv, m: Meeting) {
  const start = Date.parse(m.started_at || m.created_at) || 0;
  const rows = (await env.DB.prepare(`SELECT body, ts FROM hub_meeting_events WHERE meeting_id = ? AND kind = 'brain' ORDER BY seq LIMIT 60`).bind(m.id).all<{ body: string; ts: number }>()).results || [];
  return rows
    .map((r) => ({ b: safeJson<{ q?: string; by?: string }>(r.body, {}), ts: r.ts }))
    .filter((r) => r.b.q)
    .slice(0, 20)
    .map((r) => ({ t: Math.max(0, Math.round((r.ts - start) / 1000)), by: r.b.by || '', q: String(r.b.q).slice(0, 200) }));
}

/** A question about one finished meeting, answered from its transcript. */
async function askAboutMeeting(env: MeetEnv, user: { email: string; role: string }, id: string, b: Record<string, unknown>) {
  const m = await getMeeting(env, id);
  if (!mayJoin(m, user as never) && !mayReadNotes(m, user, await ledPeople(env, user.email))) throw new HttpError(404, 'not_found', 'That meeting does not exist.');
  const q = clean(b.q, 300);
  if (!q) throw new HttpError(400, 'bad_question', 'Type a question first.');
  const rows = (await env.DB.prepare('SELECT t, who, text FROM hub_meeting_lines WHERE meeting_id = ? ORDER BY t, n LIMIT 1500').bind(id).all<{ t: number; who: string; text: string }>()).results || [];
  if (!rows.length) return { ok: true, answer: 'This meeting has no transcript to read.', points: [] };
  const text = rows.map((l) => `[${stamp(l.t)}] ${l.who ? l.who + ': ' : ''}${l.text}`).join('\n').slice(-24000);
  const out = await chatJson<{ answer?: unknown; points?: unknown }>(env as never, 'You answer a question about one staff meeting from its transcript only. Return keys: answer (one to three plain sentences; say so when the transcript does not cover it) and points (array of at most 4 objects {t: seconds, text} citing where it was said). Do not invent names, numbers or dollar amounts. No em dashes.', `Meeting: ${m.title}\nQuestion: ${q}\n\nTranscript:\n${text}`, 700);
  const points = (Array.isArray(out.points) ? (out.points as Array<Record<string, unknown>>) : []).slice(0, 4).map((p) => ({ t: Math.max(0, Math.round(Number(p.t) || 0)), text: plain(p.text, 240) })).filter((p) => p.text);
  return { ok: true, answer: plain(out.answer, 600), points };
}

/** One unit of work for a finished meeting: a part of the recording to Drive, one sound piece to Whisper, or the notes. */
async function pump(env: MeetEnv, user: { email: string; role: string }, id: string, b: Record<string, unknown> = {}) {
  const m = await getMeeting(env, id);
  if (!mayJoin(m, user as never)) throw new HttpError(404, 'not_found', 'That meeting does not exist.');
  if (b.retry && m.status === 'ended' && m.notes_status === 'failed') {
    await env.DB.prepare(`UPDATE hub_meetings SET notes_status = 'pending' WHERE id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM hub_meeting_events WHERE meeting_id = ? AND kind = 'notice' AND body LIKE '%pump-error%'`).bind(id).run();
    m.notes_status = 'pending';
  }
  if (m.status === 'live') return { ok: true, done: true, state: 'live', progress: '' };
  const denv = env as MeetEnv & { MEET_DRIVE_FOLDER?: string };
  try {
    if (m.rec_state === 'uploading') {
      if (!denv.MEET_DRIVE_FOLDER) throw new Error('Drive folder not set');
      const r = await pumpDrive(denv, m);
      if (r.done) await env.DB.prepare(`UPDATE hub_meetings SET rec_state = 'stored' WHERE id = ?`).bind(id).run();
      return { ok: true, done: false, state: 'uploading', progress: r.progress };
    }
    if (m.notes_status === 'pending') {
      const t = await pumpTranscript(env, m);
      if (!t.done) return { ok: true, done: false, state: 'transcribing', progress: t.progress };
      const invitees = safeJson<Array<{ name?: string; email?: string }>>(m.invitees, []).map((i) => i.name || i.email || '');
      const people = (await env.DB.prepare('SELECT name FROM hub_meeting_presence WHERE meeting_id = ?').bind(id).all<{ name: string }>()).results || [];
      const names = [...new Set([...people.map((p) => p.name), ...invitees].filter(Boolean))];
      const notes = await makeNotes(env, m, names);
      if (notes) {
        await env.DB.prepare(`UPDATE hub_meetings SET notes_status = 'ready', summary = ?, notes_json = ?, title = CASE WHEN title IN ('Meeting', '') OR title LIKE '% meeting' THEN ? ELSE title END WHERE id = ?`)
          .bind(notes.summary, JSON.stringify({ decisions: notes.decisions, actions: notes.actions, chapters: notes.chapters } satisfies Omit<NotesOut, 'title' | 'summary'>), notes.title || m.title, id).run();
        // Each action item goes to its owner's Today when the talk named someone who was in the room, by first name when that is unambiguous.
        const roster = (await env.DB.prepare('SELECT DISTINCT name, email FROM hub_meeting_presence WHERE meeting_id = ?').bind(id).all<{ name: string; email: string }>()).results || [];
        const pick = (who: string) => {
          const w = who.trim().toLowerCase();
          if (!w) return null;
          const full = roster.filter((p) => p.name.toLowerCase() === w);
          if (full.length === 1) return full[0];
          const first = roster.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === w.split(/\s+/)[0]);
          return first.length === 1 ? first[0] : null;
        };
        await env.DB.prepare('DELETE FROM hub_meeting_actions WHERE meeting_id = ?').bind(id).run();
        await env.DB.batch(notes.actions.map((a, i) => { const o = pick(a.owner); return env.DB.prepare('INSERT INTO hub_meeting_actions (meeting_id, idx, text, owner_name, owner_email, due, t) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, i, a.text, o ? o.name : a.owner, o ? o.email.toLowerCase() : '', a.due, a.t); }));
      } else {
        await env.DB.prepare(`UPDATE hub_meetings SET notes_status = 'none', summary = 'Nobody spoke, so there are no notes.' WHERE id = ?`).bind(id).run();
      }
      return { ok: true, done: true, state: 'ready', progress: '' };
    }
    return { ok: true, done: true, state: m.rec_state === 'stored' ? 'stored' : 'idle', progress: '' };
  } catch (err) {
    console.error('[meet] pump', id, err);
    await env.DB.prepare(`INSERT INTO hub_meeting_events (meeting_id, kind, body, ts) VALUES (?, 'notice', ?, ?)`).bind(id, JSON.stringify({ a: 'pump-error', e: String(err instanceof Error ? err.message : err).slice(0, 200) }), Date.now()).run();
    // After a run of failures the notes stop retrying on their own and the notes page offers Try again.
    if (m.rec_state !== 'uploading' && m.notes_status === 'pending') {
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM hub_meeting_events WHERE meeting_id = ? AND kind = 'notice' AND body LIKE '%pump-error%'`).bind(id).first<{ n: number }>();
      if ((n?.n || 0) >= 8) await env.DB.prepare(`UPDATE hub_meetings SET notes_status = 'failed' WHERE id = ?`).bind(id).run();
    }
    return { ok: false, done: false, state: 'retry', progress: 'will retry' };
  }
}

/** The next finished meeting this person can see that still needs work. */
async function pumpNext(env: MeetEnv, user: { email: string; role: string }) {
  await endStaleMeetings(env);
  const me = user.email.toLowerCase();
  const row = await env.DB.prepare(
    `SELECT id FROM hub_meetings WHERE status = 'ended' AND (rec_state = 'uploading' OR notes_status = 'pending')
       AND (lower(host_email) = ? OR ? = 'admin' OR lower(invitees) LIKE '%' || ? || '%' OR access IN ('staff','guests'))
     ORDER BY ended_at LIMIT 1`
  ).bind(me, user.role, me).first<{ id: string }>();
  if (!row) return { ok: true, done: true, state: 'idle', progress: '' };
  return { ...(await pump(env, user, row.id)), id: row.id };
}

// ---------------------------------------------------------------- directory, repeats and reminders

async function directory(env: MeetEnv) {
  const rows = await env.DB.prepare(
    `SELECT email, name, title, team FROM meet_directory WHERE active = 1
     UNION SELECT lower(email), name, '' AS title, 'Other staff' AS team FROM hub_users WHERE blocked = 0 AND lower(email) NOT IN (SELECT email FROM meet_directory)
     ORDER BY name`
  ).all<{ email: string; name: string; title: string; team: string }>();
  return { ok: true, people: rows.results || [] };
}

/** Start times of a repeating meeting, Eastern wall clock kept the same across daylight saving. */
function occurrences(first: string, repeat: string, n: number): string[] {
  const parts = (iso: string) => {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
    const g = (t: string) => Number(f.find((x) => x.type === t)?.value);
    return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute') };
  };
  const base = parts(first);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(base.y, base.mo - 1, base.d, 12));
    if (repeat === 'monthly') d.setUTCMonth(d.getUTCMonth() + i);
    else d.setUTCDate(d.getUTCDate() + i * (repeat === 'biweekly' ? 14 : 7));
    // Find the instant whose Eastern wall clock is that date and time.
    const guess = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), base.h, base.mi);
    let t = guess;
    for (let k = 0; k < 3; k++) {
      const p = parts(new Date(t).toISOString());
      const want = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), base.h, base.mi);
      const got = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
      t += want - got;
    }
    out.push(new Date(t).toISOString());
  }
  return out;
}

/** Called every few minutes by the cron worker: reminder emails a day before and 15 minutes before, and more occurrences of repeating meetings. */
async function remind(env: MeetEnv, origin: string) {
  const now = Date.now();
  await endStaleMeetings(env);
  let sent = 0;
  const windows: Array<{ kind: 'day' | 'soon'; from: number; to: number }> = [
    { kind: 'day', from: now + 23.9 * 3600_000, to: now + 24.1 * 3600_000 },
    { kind: 'soon', from: now + 10 * 60_000, to: now + 16 * 60_000 },
  ];
  for (const w of windows) {
    const rows = await env.DB.prepare(`SELECT * FROM hub_meetings WHERE status = 'scheduled' AND remind = 1 AND starts_at BETWEEN ? AND ?`).bind(new Date(w.from).toISOString(), new Date(w.to).toISOString()).all<Meeting>();
    for (const mt of rows.results || []) {
      const done = await env.DB.prepare('SELECT 1 AS ok FROM hub_meeting_reminders WHERE meeting_id = ? AND kind = ?').bind(mt.id, w.kind).first();
      if (done) continue;
      await env.DB.prepare('INSERT OR IGNORE INTO hub_meeting_reminders (meeting_id, kind, sent_at) VALUES (?, ?, ?)').bind(mt.id, w.kind, now).run();
      const to = [...new Set([mt.host_email.toLowerCase(), ...emailsOf(mt.invitees)])];
      const gk = mt.access === 'guests' ? await keyOf(env, mt.id) : '';
      const guestSet = new Set(safeJson<Array<{ email?: string; guest?: boolean }>>(mt.invitees, []).filter((i) => i.guest).map((i) => String(i.email).toLowerCase()));
      for (const e of to) await sendReminder(env, [e], { title: mt.title, startsAt: mt.starts_at as string, roomUrl: guestSet.has(e) && gk ? `${origin}/meet/g/?m=${mt.id}&k=${gk}` : `${origin}/meet/room/?m=${mt.id}`, backup: mt.backup_link, rec: mt.rec_mode, kind: w.kind, host: mt.host_name || mt.host_email });
      sent += to.length;
    }
  }
  // Repeating meetings keep four occurrences ahead.
  const series = await env.DB.prepare(
    `SELECT series_id, MAX(starts_at) AS last, SUM(CASE WHEN starts_at > ? THEN 1 ELSE 0 END) AS ahead FROM hub_meetings WHERE series_id != '' AND status = 'scheduled' GROUP BY series_id HAVING ahead < 4`
  ).bind(new Date(now).toISOString()).all<{ series_id: string; last: string; ahead: number }>();
  let made = 0;
  for (const sr of series.results || []) {
    const t = await env.DB.prepare('SELECT * FROM hub_meetings WHERE id = ?').bind(sr.series_id).first<Meeting>();
    if (!t || !sr.last) continue;
    const next = occurrences(sr.last, t.repeat, 5).slice(1, 5 - Number(sr.ahead));
    for (const at of next) {
      await env.DB.prepare(
        `INSERT INTO hub_meetings (id, title, agenda, host_email, host_name, starts_at, ends_at, duration_min, rec_mode, access, invitees, status, created_at, repeat, series_id, calendar_event_id, backup_link, remind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`
      ).bind(hex(12), t.title, t.agenda, t.host_email, t.host_name, at, new Date(Date.parse(at) + t.duration_min * 60000).toISOString(), t.duration_min, t.rec_mode, t.access, t.invitees, nowIso(), t.repeat, t.series_id, t.calendar_event_id, t.backup_link, t.remind).run();
      made++;
    }
  }
  return { ok: true, sent, made };
}

// ---------------------------------------------------------------- Favor Brain in the call: what the meeting itself can answer

/** "What did I miss?" and "What have we agreed?" come from the live transcript. Anything else goes to the Favor Brain page route from the browser. */
async function brainInMeeting(env: MeetEnv, user: { email: string }, id: string, b: Record<string, unknown>) {
  const me = await getPresence(env, id, clean(b.pid, 12), user.email);
  if (me.role === 'guest') throw new HttpError(403, 'staff_only', 'Favor Brain is for staff.');
  const mt = await getMeeting(env, id);
  const kind = b.kind === 'agreed' || b.kind === 'open' || b.kind === 'owners' ? b.kind : 'missed';
  const started = Date.parse(mt.started_at || mt.created_at);
  const nowSec = Math.round((Date.now() - started) / 1000);
  const from = kind === 'missed' ? Math.max(0, Number.isFinite(Number(b.sinceSec)) && Number(b.sinceSec) >= 0 ? Number(b.sinceSec) : nowSec - 300) : 0;
  // The clock time (Eastern) of a point in the meeting, for the card heading.
  const clock = (sec: number) => new Date(started + sec * 1000).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const rows = (await env.DB.prepare('SELECT t, who, text FROM hub_meeting_lines WHERE meeting_id = ? AND t >= ? ORDER BY t, n LIMIT 600').bind(id, from).all<{ t: number; who: string; text: string }>()).results || [];
  if (!rows.length) {
    const md = kind === 'missed' ? 'Nothing has been said in that time, or the transcript has not caught up yet. It runs about 15 seconds behind.' : 'Nothing has been said yet that I can read, or the transcript has not caught up. It runs about 15 seconds behind.';
    return { ok: true, blocks: [{ type: 'text', md }], markdown: '' };
  }
  const text = rows.map((l) => `[${stamp(l.t)}] ${l.who ? l.who + ': ' : ''}${l.text}`).join('\n').slice(-20000);
  const PROMPTS: Record<string, string> = {
    missed: 'You catch a late or dropped person up on a staff meeting. Return keys: lead (one short sentence saying what the stretch was about) and points (array of at most 6 objects {t: seconds, text}, one plain sentence each, in order). Use only what the transcript says. Do not invent names, numbers or dollar amounts. No em dashes.',
    agreed: 'You list what a staff meeting has agreed so far. Return keys: lead (one short sentence) and points (array of at most 10 objects {t: seconds, text}, one plain sentence each: decisions, and tasks with the person named when the talk names them). Use only what the transcript says. Do not invent names, numbers or dollar amounts. No em dashes.',
    open: 'You list what a staff meeting has left open so far. Return keys: lead (one short sentence) and points (array of at most 10 objects {t: seconds, text}, one plain sentence each: questions raised with no answer yet, and items with no decision). Use only what the transcript says. Do not invent names, numbers or dollar amounts. No em dashes.',
    owners: 'You list who owns each task a staff meeting has named so far. Return keys: lead (one short sentence) and points (array of at most 10 objects {t: seconds, text}, one plain sentence each in the form "Name: task", using only names the transcript says). Use only what the transcript says. Do not invent names, numbers or dollar amounts. No em dashes.',
  };
  const out = await chatJson<{ lead?: unknown; points?: unknown }>(env as never, PROMPTS[kind], `Meeting: ${mt.title}\n\nTranscript (times in minutes and seconds):\n${text}`, 900);
  const pts = (Array.isArray(out.points) ? (out.points as Array<Record<string, unknown>>) : []).slice(0, 10).map((p) => ({ t: Math.max(0, Math.round(Number(p.t) || 0)), text: plain(p.text, 300) })).filter((p) => p.text);
  const lead = plain(out.lead, 200);
  const heading = kind === 'missed'
    ? (b.dropped ? `Since you dropped off at ${clock(from)}` : `Since ${clock(from)}`)
    : kind === 'agreed' ? 'Agreed so far' : kind === 'open' ? 'Still open' : 'Who owns what';
  const md = `${lead}\n\n${pts.map((p) => `- ${stamp(p.t)}  ${p.text}`).join('\n')}`.trim();
  const blocks: Array<Record<string, unknown>> = [{ type: 'text', md: lead || heading }];
  if (pts.length) blocks.push({ type: 'steps', title: heading, steps: pts.map((p) => ({ md: p.text, hint: stamp(p.t) })) });
  return { ok: true, blocks, markdown: md };
}

// ---------------------------------------------------------------- action items

async function myActions(env: MeetEnv, user: { email: string }) {
  const rows = await env.DB.prepare(
    `SELECT a.meeting_id, a.idx, a.text, a.due, a.t, a.done, m.title, m.started_at FROM hub_meeting_actions a JOIN hub_meetings m ON m.id = a.meeting_id
      WHERE a.owner_email = ? AND a.done = 0 ORDER BY m.started_at DESC LIMIT 60`
  ).bind(user.email.toLowerCase()).all();
  return { ok: true, actions: rows.results || [] };
}

async function markAction(env: MeetEnv, user: { email: string; role: string }, id: string, b: Record<string, unknown>) {
  const m = await getMeeting(env, id);
  if (!mayJoin(m, user as never)) throw new HttpError(404, 'not_found', 'That meeting does not exist.');
  const idx = Number(b.idx);
  const a = await env.DB.prepare('SELECT owner_email FROM hub_meeting_actions WHERE meeting_id = ? AND idx = ?').bind(id, idx).first<{ owner_email: string }>();
  if (!a) throw new HttpError(404, 'not_found', 'That action item is not there.');
  // The owner, a host of the meeting, or a hub admin ticks an item.
  if (a.owner_email !== user.email.toLowerCase() && !isHost(m, user.email) && user.role !== 'admin') throw new HttpError(403, 'owner_only', 'Only the owner or the host can tick this one.');
  await env.DB.prepare('UPDATE hub_meeting_actions SET done = ?, done_at = ? WHERE meeting_id = ? AND idx = ?').bind(b.done === false ? 0 : 1, b.done === false ? null : nowIso(), id, idx).run();
  return { ok: true };
}

// ---------------------------------------------------------------- guests (behind MEET_GUESTS)

const clientIpOf = (request: Request): string => request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || '0.0.0.0';

/** The token a guest's browser sends with every call after joining. Joining and the invitation page need none. */
export async function guestUser(request: Request, env: MeetEnv, params: Record<string, string | string[]>) {
  if (!guestsOn(env)) throw new HttpError(404, 'not_found', 'Not found.');
  const sub = ((params.path as string[]) || [])[2] || '';
  const token = request.headers.get('X-Guest-Token') || '';
  if (sub === 'join' || sub === 'guestinfo') return { email: 'guest:new', name: 'Guest', picture: '', role: 'staff' as const, via: 'guest' as never, kpi: false };
  if (!/^[0-9a-f]{32,64}$/.test(token)) throw new HttpError(401, 'signin', 'Rejoin the meeting from your link.');
  return { email: await guestEmail(token), name: 'Guest', picture: '', role: 'staff' as const, via: 'guest' as never, kpi: false };
}

async function keyOf(env: MeetEnv, id: string): Promise<string> {
  const r = await env.DB.prepare('SELECT gkey FROM hub_meeting_guest WHERE meeting_id = ?').bind(id).first<{ gkey: string }>();
  return r?.gkey || '';
}

const sameKey = (a: string, b: string): boolean => {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

/** What a guest sees on the invitation page. Nothing else about the meeting leaves the hub. */
async function guestInfo(env: MeetEnv, id: string, key: string) {
  if (!guestsOn(env)) throw new HttpError(404, 'not_found', 'Not found.');
  const m = await getMeeting(env, id);
  if (m.access !== 'guests' || !sameKey(await keyOf(env, id), key) || m.status === 'cancelled') throw new HttpError(404, 'not_found', 'That link does not work. Ask the host for a new one.');
  return { ok: true, title: m.title, host: m.host_name, rec: m.rec_mode, status: m.status, startsAt: m.starts_at, locked: !!m.locked };
}

/** The host asks for the link guests use. It also turns guest access on for the meeting. */
async function guestLink(env: MeetEnv, user: { email: string; role: string }, id: string, origin: string) {
  if (!guestsOn(env)) throw new HttpError(404, 'not_found', 'Guests are not switched on yet.');
  const m = await getMeeting(env, id);
  if (!isHost(m, user.email) && user.role !== 'admin') throw new HttpError(403, 'host_only', 'Only the host can make the guest link.');
  let key = await keyOf(env, id);
  if (!key) { key = hex(16); await env.DB.prepare('INSERT OR REPLACE INTO hub_meeting_guest (meeting_id, gkey) VALUES (?, ?)').bind(id, key).run(); }
  if (m.access !== 'guests') await env.DB.prepare(`UPDATE hub_meetings SET access = 'guests' WHERE id = ?`).bind(id).run();
  return { ok: true, url: `${origin}/meet/g/?m=${id}&k=${key}` };
}

async function joinGuest(env: MeetEnv, id: string, b: Record<string, unknown>, ip: string, token0: string) {
  if (!guestsOn(env)) throw new HttpError(404, 'not_found', 'Not found.');
  // A guest whose connection dropped comes back with the same token and pid, and gets a fresh SFU session.
  if (token0 && /^[0-9a-f]{32,64}$/.test(token0) && /^[0-9a-f]{12}$/.test(clean(b.pid, 12))) {
    const email0 = await guestEmail(token0);
    const row = await env.DB.prepare('SELECT * FROM hub_meeting_presence WHERE meeting_id = ? AND pid = ? AND email = ?').bind(id, clean(b.pid, 12), email0).first<Presence>();
    const mt = await getMeeting(env, id);
    if (row && !row.removed && mt.status !== 'ended') {
      const s0 = (await sfuCall(env, 'POST', '/sessions/new')) as { sessionId?: string };
      if (!s0.sessionId) throw new HttpError(502, 'sfu_error', 'The meeting service did not answer. Try again.');
      await env.DB.prepare('UPDATE hub_meeting_presence SET session_id = ?, tracks = ?, seen = ?, left_at = 0 WHERE meeting_id = ? AND pid = ?').bind(s0.sessionId, '[]', Date.now(), id, row.pid).run();
      const last0 = await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM hub_meeting_events WHERE meeting_id = ?').bind(id).first<{ s: number }>();
      return { ok: true, pid: row.pid, role: 'guest', token: token0, waiting: !!row.waiting, sessionId: s0.sessionId, iceServers: await iceServers(env), since: last0?.s || 0, meeting: { id: mt.id, title: mt.title, hostName: mt.host_name, rec: mt.rec_mode, status: mt.status, locked: !!mt.locked, spot: '', sharePolicy: mt.share_policy, backupLink: '', startedAt: mt.started_at, endedAt: null, invitees: [], mine: false } };
    }
  }
  // At most 12 tries a minute from one address, so a link cannot be guessed at or used to flood a room.
  const minute = Math.floor(Date.now() / 60000);
  const ipHash = (await sha(ip)).slice(0, 24);
  await env.DB.prepare('DELETE FROM hub_meeting_guest_rate WHERE minute < ?').bind(minute - 5).run();
  await env.DB.prepare('INSERT INTO hub_meeting_guest_rate (ip, minute, n) VALUES (?, ?, 1) ON CONFLICT(ip, minute) DO UPDATE SET n = n + 1').bind(ipHash, minute).run();
  const rate = await env.DB.prepare('SELECT n FROM hub_meeting_guest_rate WHERE ip = ? AND minute = ?').bind(ipHash, minute).first<{ n: number }>();
  if ((rate?.n || 0) > 12) throw new HttpError(429, 'slow_down', 'Too many tries. Wait a minute and use the link again.');
  const m = await getMeeting(env, id);
  if (m.access !== 'guests' || !sameKey(await keyOf(env, id), clean(b.k, 64)) || m.status === 'cancelled') throw new HttpError(404, 'not_found', 'That link does not work. Ask the host for a new one.');
  if (m.status === 'ended') throw new HttpError(410, 'ended', 'This meeting has ended.');
  if (m.starts_at && Date.now() < Date.parse(m.starts_at) - 30 * 60_000) throw new HttpError(403, 'early', 'This meeting has not started. Come back closer to the start time.');
  if (m.locked) throw new HttpError(403, 'locked', 'The host locked this meeting.');
  const name = clean(b.name, 60);
  if (name.length < 2) throw new HttpError(400, 'name', 'Type your name so the host knows who you are.');
  if (m.rec_mode !== 'off' && b.accepted !== true) throw new HttpError(400, 'consent', 'Accept the recording notice to join.');
  const alive = await env.DB.prepare(`SELECT COUNT(*) AS n FROM hub_meeting_presence WHERE meeting_id = ? AND role = 'guest' AND left_at = 0 AND removed = 0 AND seen > ?`).bind(id, Date.now() - GONE_MS).first<{ n: number }>();
  if ((alive?.n || 0) >= 20) throw new HttpError(403, 'full', 'This meeting has too many guests.');
  const token = hex(24);
  const email = await guestEmail(token);
  const pid = hex(6);
  const session = (await sfuCall(env, 'POST', '/sessions/new')) as { sessionId?: string };
  if (!session.sessionId) throw new HttpError(502, 'sfu_error', 'The meeting service did not answer. Try again.');
  const now = Date.now();
  // A guest waits until a host lets them in, and cannot share a screen unless the host allows it.
  await env.DB.prepare(`INSERT INTO hub_meeting_presence (meeting_id, pid, email, name, role, session_id, tracks, mic, cam, can_share, waiting, joined_at, seen) VALUES (?, ?, ?, ?, 'guest', ?, '[]', ?, ?, 0, 1, ?, ?)`)
    .bind(id, pid, email, name, session.sessionId, b.mic === false ? 0 : 1, b.cam === false ? 0 : 1, now, now).run();
  await addEvent(env, id, 'notice', pid, '', { a: 'waiting', name });
  const last = await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM hub_meeting_events WHERE meeting_id = ?').bind(id).first<{ s: number }>();
  return {
    ok: true, pid, role: 'guest', token, waiting: true, sessionId: session.sessionId, iceServers: await iceServers(env), since: last?.s || 0,
    meeting: { id: m.id, title: m.title, hostName: m.host_name, rec: m.rec_mode, status: m.status, locked: !!m.locked, spot: '', sharePolicy: m.share_policy, backupLink: '', startedAt: m.started_at, endedAt: null, invitees: [], mine: false },
  };
}
