// Privacy canaries: rows owned by the FavorOS Tester that no one else may see, each carrying the word PRVCNRY in every field a
// leak could show (titles, agendas, summaries, transcript lines, message bodies, partner names). The privacy check
// (functions/_lib/privacy/probe.ts) reads every list, search, feed and by-id route as a made-up staff member and a made-up field
// member and fails when PRVCNRY appears in any answer. Rows marked PRVOPEN are the opposite: a staff member must see them, so a
// check that quietly stopped reading anything fails too.
//
// The ids are fixed so the check can ask for each row by id. Seeding is safe to repeat (INSERT OR IGNORE plus a date refresh).
// Every row belongs to the tester, whom no staff list, count or notice includes; none of it reaches a real person.
import { TESTER_EMAIL, TESTER_NAME } from '../testuser';

export const CANARY = 'PRVCNRY';
export const OPEN_MARK = 'PRVOPEN';

/** Made-up people the probe signs in as. Neither address exists, so no session or Google account can ever be one of them. */
export const PROBE_STAFF = 'privacy-probe@favorintl.org';
export const PROBE_FIELD = 'privacy-probe@favourafrica.org';
/** An outside address on the canary rows (a stand-in partner). example.test never receives mail. */
export const PROBE_OTHER = 'privacy-other@example.test';

export const IDS = {
  meetPrivate: 'c0ffee0000000000000000a1', // upcoming, invited only, nobody real invited
  meetEnded: 'c0ffee0000000000000000a2', // finished, private, notes ready
  meetGuest: 'c0ffee0000000000000000a3', // upcoming, guest link made (access guests)
  meetStaffGuest: 'c0ffee0000000000000000a4', // finished, booked open to all staff, then a guest link was sent: notes close
  meetOpen: 'c0ffee0000000000000000a5', // finished, open to all staff: staff read it (PRVOPEN)
  guestKey: 'c0ffee00c0ffee00c0ffee00c0ffee00',
  series: 'c0ffee0000000000000000b9',
  bookingType: 'c0ffee00000000b1',
  booking: 'c0ffee00000000b2',
  chPrivate: 'ch_prvcnry_private',
  chDm: 'ch_prvcnry_dm',
  chProbe: 'ch_prvcnry_probe', // a private channel with the tester and both probes, where the links and the tester-only note sit
  scheduled: 'sch_prvcnry_1',
  reminder: 'wcr_prvcnry_1',
  project: 'prj_prvcnry',
  projectKey: 'PRVCNRY',
  task: 'tsk_prvcnry_1',
  taskLoose: 'tsk_prvcnry_2',
  clip: 'c0ffee00c0ffee00c0ffee00c0ffee01',
  clipPrivate: 'c0ffee00c0ffee00c0ffee00c0ffee02', // level Private: only the tester and admins
  clipPublic: 'c0ffee00c0ffee00c0ffee00c0ffee03', // level Public: everybody reads it, signed in or not (PRVOPEN)
  brainThread: 'bt_prvcnry_1',
} as const;

/** Message ids are numbers the table hands out; the check finds them by body. */
export const MESSAGE_MARKS = {
  privateChannel: `${CANARY} message in a private channel`,
  dm: `${CANARY} direct message`,
  onlyTester: `${CANARY} note only the tester sees`,
  meetingLink: 'Meeting link for the privacy check',
  taskLink: 'Task link for the privacy check',
} as const;

type Stmt = [string, unknown[]];

/** The statements that set the canaries up. Pure, so a test can run them on its in-memory database and the seed route on D1. */
export function canaryStatements(now = Date.now()): Stmt[] {
  const iso = (ms: number) => new Date(ms).toISOString();
  const at = iso(now);
  const soon = iso(now + 2 * 86400_000);
  const soonEnd = iso(now + 2 * 86400_000 + 30 * 60_000);
  const past = iso(now - 2 * 86400_000);
  const pastEnd = iso(now - 2 * 86400_000 + 30 * 60_000);
  const other = JSON.stringify([{ email: PROBE_OTHER, name: `${CANARY} Invitee`, team: 'Partner', guest: true }]);
  const lines = (tag: string) => JSON.stringify([{ t: 3, who: TESTER_NAME, text: `${tag} transcript line` }]);
  const notes = (tag: string) => JSON.stringify({ decisions: [{ text: `${tag} decision` }], actions: [{ text: `${tag} action`, owner: TESTER_NAME }] });
  const meeting = (id: string, o: { title: string; access: string; status: string; start: string; end: string; summary?: string; notes?: string; series?: string; invitees?: string }): Stmt => [
    `INSERT INTO hub_meetings (id, title, agenda, host_email, host_name, starts_at, ends_at, duration_min, rec_mode, access, invitees, status, remind, created_at, started_at, ended_at, notes_status, summary, notes_json, transcript, series_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 30, 'notes', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET invitees = excluded.invitees, transcript = excluded.transcript, starts_at = excluded.starts_at, ends_at = excluded.ends_at, started_at = excluded.started_at, ended_at = excluded.ended_at, status = excluded.status, access = excluded.access, remind = 0`,
    [id, o.title, `${o.title} agenda`, TESTER_EMAIL, TESTER_NAME, o.start, o.end, o.access, o.invitees ?? other, o.status, at,
      o.status === 'ended' ? o.start : null, o.status === 'ended' ? o.end : null, o.summary ? 'ready' : 'none', o.summary || '', o.notes || '{}', o.summary ? lines(o.summary.startsWith(OPEN_MARK) ? OPEN_MARK : CANARY) : '', o.series || ''],
  ];
  const s: Stmt[] = [
    meeting(IDS.meetPrivate, { title: `${CANARY} private meeting`, access: 'invited', status: 'scheduled', start: soon, end: soonEnd }),
    meeting(IDS.meetEnded, { title: `${CANARY} finished meeting`, access: 'invited', status: 'ended', start: past, end: pastEnd, summary: `${CANARY} summary`, notes: notes(CANARY) }),
    meeting(IDS.meetGuest, { title: `${CANARY} guest link meeting`, access: 'guests', status: 'scheduled', start: soon, end: soonEnd }),
    meeting(IDS.meetStaffGuest, { title: `${CANARY} all staff then guest link`, access: 'guests', status: 'ended', start: past, end: pastEnd, summary: `${CANARY} closed summary`, notes: notes(CANARY) }),
    meeting(IDS.meetOpen, { title: `${OPEN_MARK} open meeting`, access: 'staff', status: 'ended', start: past, end: pastEnd, summary: `${OPEN_MARK} summary`, notes: notes(OPEN_MARK), invitees: '[]' }),
    ['INSERT OR IGNORE INTO hub_meeting_guest (meeting_id, gkey) VALUES (?, ?)', [IDS.meetGuest, IDS.guestKey]],
    ...[IDS.meetEnded, IDS.meetStaffGuest].map((id): Stmt => [`INSERT OR IGNORE INTO hub_meeting_lines (meeting_id, n, t, who, text) VALUES (?, 1, 3, ?, ?)`, [id, TESTER_NAME, `${CANARY} transcript line`]]),
    [`INSERT OR IGNORE INTO hub_meeting_lines (meeting_id, n, t, who, text) VALUES (?, 1, 3, ?, ?)`, [IDS.meetOpen, TESTER_NAME, `${OPEN_MARK} transcript line`]],
    ...[IDS.meetEnded, IDS.meetStaffGuest].map((id): Stmt => [`INSERT OR IGNORE INTO hub_meeting_actions (meeting_id, idx, text, owner_name, owner_email, due, t, done) VALUES (?, 0, ?, ?, ?, '', 3, 0)`, [id, `${CANARY} action item`, TESTER_NAME, TESTER_EMAIL]]),
    // A booking page and a partner's booking on the tester's private meeting.
    [`INSERT OR IGNORE INTO hub_booking_types (id, owner_email, owner_name, handle, slug, title, about, duration_min, audience, avail, tz, buffer_min, travel_min, notice_min, horizon_days, max_per_day, step_min, questions, location, place, rec_mode, active, created_at, updated_at)
      VALUES (?, ?, ?, 'tester', 'privacy-check', 'Privacy check call', '', 30, 'partners', '{"days":{}}', 'America/New_York', 0, 0, 0, 30, 4, 30, '[{"q":"Why","required":false}]', 'video', '', 'off', 1, ?, ?)`, [IDS.bookingType, TESTER_EMAIL, TESTER_NAME, at, at]],
    [`INSERT INTO hub_bookings (id, type_id, meeting_id, owner_email, name, email, phone, answers, starts_at, ends_at, tz, status, manage_hash, ip, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'America/New_York', 'booked', 'none', '', ?, ?)
      ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = 'booked'`,
      [IDS.booking, IDS.bookingType, IDS.meetGuest, TESTER_EMAIL, `${CANARY} Partner`, PROBE_OTHER, JSON.stringify([{ q: 'Why', a: `${CANARY} answer` }]), soon, soonEnd, at, at]],
    // Chat: a private channel and a direct message with only the tester and the stand-in, a note only the tester sees in a
    // channel with the probes, a scheduled message, and links to the private meeting and task posted where the probes read.
    [`INSERT OR IGNORE INTO chat_channels (id, kind, name, topic, dm_key, created_by, created_at, last_at) VALUES (?, 'private', 'prvcnry-private', ?, NULL, ?, ?, ?)`, [IDS.chPrivate, `${CANARY} topic`, TESTER_EMAIL, at, at]],
    [`INSERT OR IGNORE INTO chat_channels (id, kind, name, topic, dm_key, created_by, created_at, last_at) VALUES (?, 'dm', '', '', ?, ?, ?, ?)`, [IDS.chDm, [PROBE_OTHER, TESTER_EMAIL].sort().join(','), TESTER_EMAIL, at, at]],
    [`INSERT OR IGNORE INTO chat_channels (id, kind, name, topic, dm_key, created_by, created_at, last_at) VALUES (?, 'private', 'prvcnry-probe', '', NULL, ?, ?, ?)`, [IDS.chProbe, TESTER_EMAIL, at, at]],
    // Muted, so Chat email never writes to these made-up addresses (none of them is a hub account, which Chat email also needs).
    ...[[IDS.chPrivate, TESTER_EMAIL], [IDS.chDm, TESTER_EMAIL], [IDS.chDm, PROBE_OTHER], [IDS.chProbe, TESTER_EMAIL], [IDS.chProbe, PROBE_STAFF], [IDS.chProbe, PROBE_FIELD]].map(([c, e]): Stmt => [`INSERT OR IGNORE INTO chat_members (channel_id, email, role, muted, joined_at) VALUES (?, ?, 'member', 1, ?)`, [c, e, at]]),
    ...([[IDS.chPrivate, MESSAGE_MARKS.privateChannel, '[]', null], [IDS.chDm, MESSAGE_MARKS.dm, '[]', null], [IDS.chProbe, MESSAGE_MARKS.onlyTester, '[]', TESTER_EMAIL],
      [IDS.chProbe, MESSAGE_MARKS.meetingLink, JSON.stringify([{ type: 'meeting', id: IDS.meetEnded }]), null],
      [IDS.chProbe, MESSAGE_MARKS.taskLink, JSON.stringify([{ type: 'task', id: IDS.task }]), null]] as Array<[string, string, string, string | null]>).map(([c, body, att, vis]): Stmt => [
      `INSERT INTO chat_messages (channel_id, thread_id, email, body, attachments, created_at, visible_to) SELECT ?, NULL, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE channel_id = ? AND body = ?)`,
      [c, TESTER_EMAIL, body, att, at, vis, c, body],
    ]),
    [`INSERT OR IGNORE INTO chat_scheduled (id, email, channel_id, thread_id, body, kind, send_at, status, created_at) VALUES (?, ?, ?, NULL, ?, 'send', '2099-01-01T12:00:00.000Z', 'waiting', ?)`, [IDS.scheduled, TESTER_EMAIL, IDS.chPrivate, `${CANARY} scheduled message`, at]],
    // A reminder for the tester only.
    [`INSERT OR IGNORE INTO act_reminders (id, owner, kind, title, note, due_at, state, source, created_at) VALUES (?, ?, 'message', ?, ?, '2099-01-01T12:00:00.000Z', 'open', 'manual', ?)`, [IDS.reminder, TESTER_EMAIL, `${CANARY} reminder`, `${CANARY} reminder note`, at]],
    // A members-only project with a task, and a task of the tester's own outside any project.
    [`INSERT OR IGNORE INTO hub_projects (id, key, name, description, team, lead_email, visibility, status, color, next_num, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, '', ?, 'members', 'active', 'leaf', 2, ?, ?, ?)`,
      [IDS.project, IDS.projectKey, `${CANARY} project`, `${CANARY} project description`, TESTER_EMAIL, TESTER_EMAIL, at, at]],
    [`INSERT OR IGNORE INTO hub_project_members (project_id, email, role, added_at) VALUES (?, ?, 'lead', ?)`, [IDS.project, TESTER_EMAIL, at]],
    [`INSERT OR IGNORE INTO hub_tasks (id, project_id, code, title, description, status, priority, owner_email, sort, meeting_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', 'normal', ?, 0, ?, ?, ?, ?)`,
      [IDS.task, IDS.project, `${IDS.projectKey}-1`, `${CANARY} task`, `${CANARY} task description`, TESTER_EMAIL, IDS.meetEnded, TESTER_EMAIL, at, at]],
    [`INSERT OR IGNORE INTO hub_tasks (id, project_id, title, description, status, priority, owner_email, sort, created_by, created_at, updated_at) VALUES (?, NULL, ?, ?, 'open', 'normal', ?, 0, ?, ?, ?)`,
      [IDS.taskLoose, `${CANARY} personal task`, `${CANARY} personal task description`, TESTER_EMAIL, TESTER_EMAIL, at, at]],
    // A clip the tester has not shared.
    [`INSERT OR IGNORE INTO hub_clips (id, owner_email, owner_name, title, status, share, mime, size_bytes, duration_ms, created_at, updated_at, summary) VALUES (?, ?, ?, ?, 'ready', 0, 'video/webm', 0, 1000, ?, ?, ?)`,
      [IDS.clip, TESTER_EMAIL, TESTER_NAME, `${CANARY} clip`, at, at, `${CANARY} clip summary`]],
    // A clip set to Private, and one set to Everybody (PRVOPEN: staff, field and signed-out callers must read it).
    [`INSERT OR IGNORE INTO hub_clips (id, owner_email, owner_name, title, status, share, staff_link, access, mime, size_bytes, duration_ms, created_at, updated_at, summary) VALUES (?, ?, ?, ?, 'ready', 0, 0, 'private', 'video/webm', 0, 1000, ?, ?, ?)`,
      [IDS.clipPrivate, TESTER_EMAIL, TESTER_NAME, `${CANARY} private clip`, at, at, `${CANARY} private clip summary`]],
    [`INSERT OR IGNORE INTO hub_clips (id, owner_email, owner_name, title, status, share, staff_link, access, mime, size_bytes, duration_ms, created_at, updated_at, summary) VALUES (?, ?, ?, ?, 'ready', 1, 1, 'public', 'video/webm', 0, 1000, ?, ?, ?)`,
      [IDS.clipPublic, TESTER_EMAIL, TESTER_NAME, `${OPEN_MARK} public clip`, at, at, `${OPEN_MARK} public clip summary`]],
    // A Favor Brain conversation.
    [`INSERT OR IGNORE INTO brain_threads (id, email, title, pinned, made_at, changed_at) VALUES (?, ?, ?, 0, ?, ?)`, [IDS.brainThread, TESTER_EMAIL, `${CANARY} brain thread`, at, at]],
    [`INSERT INTO brain_turns (thread_id, n, question, answer_json, at) SELECT ?, 1, ?, '{}', ? WHERE NOT EXISTS (SELECT 1 FROM brain_turns WHERE thread_id = ?)`, [IDS.brainThread, `${CANARY} brain question`, at, IDS.brainThread]],
  ];
  return s;
}

export interface CanaryDb {
  prepare(sql: string): { bind(...a: unknown[]): { run(): Promise<unknown> } };
}

/** Writes the canaries. A statement whose table this database does not have is skipped, so a test can seed only the parts it built. */
export async function seedCanaries(db: CanaryDb, now = Date.now()): Promise<{ ran: number; skipped: number }> {
  let ran = 0, skipped = 0;
  for (const [sql, params] of canaryStatements(now)) {
    try {
      await db.prepare(sql).bind(...params).run();
      ran++;
    } catch (err) {
      if (/no such table|no such column/i.test(String((err as Error)?.message || err))) skipped++;
      else throw err;
    }
  }
  return { ran, skipped };
}
