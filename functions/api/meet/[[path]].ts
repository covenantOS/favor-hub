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
import { errorJson, handleError, json, nowIso, HttpError } from '../../_lib/http';
import { makeNotes, pumpDrive, pumpTranscript, type NotesOut } from '../../_lib/meetdrive';
import {
  GONE_MS, ID_RE, MAX_PEOPLE, REC_STALE_MS, clean, emailsOf, getMeeting, getPresence, hex, iceServers, isHost, mayJoin, meetUser, sfuCall,
  type Meeting, type MeetEnv, type Presence,
} from '../../_lib/meet';

const COMMANDS = new Set(['mute', 'camoff', 'remove', 'spot', 'unspot', 'lock', 'unlock', 'makehost', 'unhost', 'muteall', 'sharepolicy', 'letin', 'end', 'lowerhand', 'allowshare']);

export const onRequest: PagesFunction<MeetEnv> = async ({ request, env, params }) => {
  try {
    const user = meetUser(request, env);
    const parts = ((params.path as string[]) || []).filter(Boolean);
    const m = request.method;
    if (parts[0] !== 'meetings') return errorJson('not_found', 'Not found.', 404);

    if (parts[1] === 'pump' && m === 'POST') return json(await pumpNext(env, user));
    if (parts.length === 1) {
      if (m === 'GET') return json(await listMeetings(env, user, new URL(request.url).searchParams.get('scope') || 'upcoming'));
      if (m === 'POST') return json(await createMeeting(env, user, await request.json().catch(() => ({}))));
    }
    const id = parts[1];
    if (!ID_RE.test(id)) return errorJson('not_found', 'That meeting does not exist.', 404);
    const sub = parts[2] || '';

    if (!sub && m === 'GET') {
      const mt = await getMeeting(env, id);
      if (!mayJoin(mt, user)) return errorJson('not_found', 'That meeting does not exist.', 404);
      return json({ ok: true, meeting: publicMeeting(mt, user) });
    }
    if (sub === 'join' && m === 'POST') return json(await join(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'sync' && m === 'POST') return json(await sync(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'event' && m === 'POST') return json(await postEvent(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'leave' && m === 'POST') return json(await leave(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'tracks' && m === 'POST') return json(await setTracks(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'sfu' && m === 'POST') return json(await sfuPass(env, user, id, parts.slice(3).join('/'), await request.json().catch(() => ({}))));
    if (sub === 'update' && m === 'POST') return json(await updateMeeting(env, user, id, await request.json().catch(() => ({}))));
    if (sub === 'rec') return await rec(env, user, id, parts.slice(3), request);
    if (sub === 'notes' && m === 'GET') return json(await notesOf(env, user, id));
    if (sub === 'pump' && m === 'POST') return json(await pump(env, user, id));
    return errorJson('not_found', 'Not found.', 404);
  } catch (err) {
    return handleError(err);
  }
};

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

async function endIfEmpty(env: MeetEnv, id: string) {
  const p = await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_meeting_presence WHERE meeting_id = ? AND left_at = 0 AND removed = 0 AND seen > ?').bind(id, Date.now() - GONE_MS).first<{ n: number }>();
  if (!p?.n) await endMeeting(env, id);
}

// ---------------------------------------------------------------- meetings

function publicMeeting(m: Meeting, user: { email: string }) {
  return {
    id: m.id, title: m.title, agenda: m.agenda, hostEmail: m.host_email, hostName: m.host_name, startsAt: m.starts_at, endsAt: m.ends_at,
    durationMin: m.duration_min, rec: m.rec_mode, access: m.access, status: m.status, locked: !!m.locked, spot: m.spot_pid,
    sharePolicy: m.share_policy, backupLink: m.backup_link, invitees: safeJson(m.invitees, []), mine: isHost(m, user.email),
    recState: m.rec_state, driveFileId: m.drive_file_id, notesStatus: m.notes_status, summary: m.summary, createdAt: m.created_at,
    startedAt: m.started_at, endedAt: m.ended_at,
  };
}

function safeJson<T>(s: string, d: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
}

async function listMeetings(env: MeetEnv, user: { email: string; role: string }, scope: string) {
  // A meeting whose room has been empty for a while is over.
  const cutoff = Date.now() - 2 * 60_000;
  const live = await env.DB.prepare(`SELECT id FROM hub_meetings WHERE status = 'live'`).all<{ id: string }>();
  for (const r of live.results || []) {
    const p = await env.DB.prepare('SELECT MAX(seen) AS s FROM hub_meeting_presence WHERE meeting_id = ? AND left_at = 0').bind(r.id).first<{ s: number | null }>();
    if (!p?.s || p.s < cutoff) await endMeeting(env, r.id);
  }
  const me = user.email.toLowerCase();
  const mine = `(lower(host_email) = ?1 OR access IN ('staff','guests') OR lower(invitees) LIKE '%' || ?1 || '%' OR lower(cohosts) LIKE '%' || ?1 || '%')`;
  let sql: string;
  if (scope === 'recent') sql = `SELECT * FROM hub_meetings WHERE ${mine} AND status = 'ended' ORDER BY COALESCE(ended_at, created_at) DESC LIMIT 60`;
  else if (scope === 'notes') sql = `SELECT * FROM hub_meetings WHERE ${mine} AND status = 'ended' AND notes_status != 'none' ORDER BY COALESCE(ended_at, created_at) DESC LIMIT 100`;
  else sql = `SELECT * FROM hub_meetings WHERE ${mine} AND (status = 'live' OR (status = 'scheduled' AND (starts_at IS NULL AND created_at > ?2 OR starts_at > ?3))) ORDER BY COALESCE(starts_at, created_at) LIMIT 80`;
  const q = env.DB.prepare(sql);
  const rows =
    scope === 'recent' || scope === 'notes'
      ? await q.bind(me).all<Meeting>()
      : await q.bind(me, new Date(Date.now() - 12 * 3600_000).toISOString(), new Date(Date.now() - 3600_000).toISOString()).all<Meeting>();
  const counts = await env.DB.prepare(
    `SELECT meeting_id, COUNT(*) AS n FROM hub_meeting_presence WHERE left_at = 0 AND removed = 0 AND seen > ? GROUP BY meeting_id`
  ).bind(Date.now() - GONE_MS).all<{ meeting_id: string; n: number }>();
  const inRoom = new Map((counts.results || []).map((c) => [c.meeting_id, c.n]));
  return { ok: true, meetings: (rows.results || []).map((r) => ({ ...publicMeeting(r, user), inRoom: inRoom.get(r.id) || 0 })) };
}

async function createMeeting(env: MeetEnv, user: { email: string; name: string }, b: Record<string, unknown>) {
  const title = clean(b.title, 140) || 'Meeting';
  const id = hex(12);
  const startsAt = typeof b.startsAt === 'string' && !Number.isNaN(Date.parse(b.startsAt)) ? new Date(b.startsAt).toISOString() : null;
  const dur = Math.min(480, Math.max(10, Number(b.durationMin) || 60));
  const rec = ['off', 'notes', 'video'].includes(String(b.rec)) ? String(b.rec) : 'notes';
  const access = ['invited', 'staff', 'guests'].includes(String(b.access)) ? String(b.access) : startsAt ? 'invited' : 'staff';
  const invitees = Array.isArray(b.invitees)
    ? (b.invitees as Array<Record<string, unknown>>).slice(0, 200).map((i) => ({ email: clean(i.email, 200).toLowerCase(), name: clean(i.name, 120), team: clean(i.team, 80), guest: !!i.guest })).filter((i) => i.email)
    : [];
  await env.DB.prepare(
    `INSERT INTO hub_meetings (id, title, agenda, host_email, host_name, starts_at, ends_at, duration_min, rec_mode, access, invitees, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`
  )
    .bind(id, title, clean(b.agenda, 2000), user.email.toLowerCase(), user.name, startsAt, startsAt ? new Date(Date.parse(startsAt) + dur * 60000).toISOString() : null, dur, rec, access, JSON.stringify(invitees), nowIso())
    .run();
  return { ok: true, meeting: publicMeeting(await getMeeting(env, id), user) };
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
  if (b.status === 'cancelled') { sets.push(`status = 'cancelled'`); }
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
  return { ok: true, pid, role, sessionId: session.sessionId, iceServers: ice, meeting: publicMeeting(await getMeeting(env, id), user), since: last?.s || 0 };
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
  const r = await env.DB.prepare('SELECT epoch, owner_pid, active, last_chunk, mode FROM hub_meeting_rec WHERE meeting_id = ?').bind(id).first<{ epoch: number; owner_pid: string; active: number; last_chunk: number; mode: string }>();
  return {
    ok: true,
    now,
    role: myRole,
    people: list.filter((p) => myRole === 'host' || myRole === 'cohost' || !p.waiting).map((p) => ({
      pid: p.pid, name: p.name, role: p.role, sessionId: p.session_id, tracks: safeJson(p.tracks, []), mic: !!p.mic, cam: !!p.cam, hand: !!p.hand, sharing: !!p.sharing,
      canShare: !!p.can_share, lvl: p.lvl, speaking: p.speak_at > now - 1500, speakAt: p.speak_at, waiting: !!p.waiting, joinedAt: p.joined_at,
    })),
    events: events.map((e) => ({ seq: e.seq, kind: e.kind, from: e.from_pid, to: e.to_pid, body: safeJson(e.body, {}), ts: e.ts })),
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
  await env.DB.prepare('UPDATE hub_meeting_presence SET tracks = ?, seen = ? WHERE meeting_id = ? AND pid = ?').bind(JSON.stringify(tracks), Date.now(), id, me.pid).run();
  return { ok: true };
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
  if (!me.session_id) throw new HttpError(400, 'no_session', 'Rejoin the meeting.');
  const sid = me.session_id;
  if (op === 'tracks/new') {
    const tracks = (Array.isArray(b.tracks) ? b.tracks : []).slice(0, 64) as Array<Record<string, unknown>>;
    const remote = tracks.filter((t) => t.location === 'remote');
    if (remote.length) {
      const ok = await env.DB.prepare('SELECT session_id FROM hub_meeting_presence WHERE meeting_id = ? AND left_at = 0 AND removed = 0 AND waiting = 0').bind(id).all<{ session_id: string }>();
      const allowed = new Set((ok.results || []).map((r) => r.session_id));
      for (const t of remote) if (!allowed.has(String(t.sessionId))) throw new HttpError(403, 'not_here', 'That person is not in this meeting.');
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
    return json({ ok: true });
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
  if (!mayJoin(m, user as never)) throw new HttpError(404, 'not_found', 'That meeting does not exist.');
  const files = await env.DB.prepare(`SELECT file_id, file_name FROM hub_meeting_drive WHERE meeting_id = ? AND state = 'done' ORDER BY epoch`).bind(id).all<{ file_id: string; file_name: string }>();
  return {
    ok: true,
    meeting: publicMeeting(m, user),
    notes: safeJson(m.notes_json, {}),
    transcript: safeJson(m.transcript, []),
    files: (files.results || []).map((f) => ({ id: f.file_id, name: f.file_name, url: `https://drive.google.com/file/d/${f.file_id}/view` })),
    people: (await env.DB.prepare('SELECT name, role FROM hub_meeting_presence WHERE meeting_id = ? ORDER BY joined_at').bind(id).all<{ name: string; role: string }>()).results || [],
  };
}

/** One unit of work for a finished meeting: a part of the recording to Drive, one sound piece to Whisper, or the notes. */
async function pump(env: MeetEnv, user: { email: string; role: string }, id: string) {
  const m = await getMeeting(env, id);
  if (!mayJoin(m, user as never)) throw new HttpError(404, 'not_found', 'That meeting does not exist.');
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
      } else {
        await env.DB.prepare(`UPDATE hub_meetings SET notes_status = 'none', summary = 'Nobody spoke, so there are no notes.' WHERE id = ?`).bind(id).run();
      }
      return { ok: true, done: true, state: 'ready', progress: '' };
    }
    return { ok: true, done: true, state: m.rec_state === 'stored' ? 'stored' : 'idle', progress: '' };
  } catch (err) {
    console.error('[meet] pump', id, err);
    await env.DB.prepare(`INSERT INTO hub_meeting_events (meeting_id, kind, body, ts) VALUES (?, 'notice', ?, ?)`).bind(id, JSON.stringify({ a: 'pump-error', e: String(err instanceof Error ? err.message : err).slice(0, 200) }), Date.now()).run();
    return { ok: false, done: false, state: 'retry', progress: 'will retry' };
  }
}

/** The next finished meeting this person can see that still needs work. */
async function pumpNext(env: MeetEnv, user: { email: string; role: string }) {
  const me = user.email.toLowerCase();
  const row = await env.DB.prepare(
    `SELECT id FROM hub_meetings WHERE status = 'ended' AND (rec_state = 'uploading' OR notes_status = 'pending')
       AND (lower(host_email) = ? OR ? = 'admin' OR lower(invitees) LIKE '%' || ? || '%' OR access IN ('staff','guests'))
     ORDER BY ended_at LIMIT 1`
  ).bind(me, user.role, me).first<{ id: string }>();
  if (!row) return { ok: true, done: true, state: 'idle', progress: '' };
  return { ...(await pump(env, user, row.id)), id: row.id };
}
