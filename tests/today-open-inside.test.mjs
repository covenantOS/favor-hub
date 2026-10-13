// Run with: npm test
//
// Today opens places inside FavorOS (2026-10-11). Checks the pieces the page leans on, with made-up people and a Google stand-in:
//   todaysEvents  every event on the calendar today, with what it is held on (Zoom, Meet, Teams, a phone call, no link)
//   day-move      Move to FavorOS: a FavorOS meeting with the same people; the calendar event is left alone unless the person
//                 confirmed the link, and then only the notes gain one line and nobody is emailed
//   day-file      a Shared with you file is served only when the person's own Google connection can see it
//   day route     events carry the FavorOS room they already have, and rooms that are not on the calendar still show
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const KEY = 'ab'.repeat(32);
let google;
let move;
let file;
let day;
let d1;
let env;
let calls;
let events;
let driveOk;

const asUser = (path, init = {}, email = 'ada@favorintl.org') => new Request('https://dash.test' + path, { ...init, headers: { 'X-Hub-Email': email, 'X-Hub-Name': 'Ada', 'X-Hub-Via': 'google', 'content-type': 'application/json' } });
const iso = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const ev = (over = {}) => ({ id: 'ev1', summary: 'Partner call', status: 'confirmed', start: { dateTime: iso(1) }, end: { dateTime: iso(2) }, organizer: { email: 'ada@favorintl.org', self: true }, attendees: [{ email: 'ada@favorintl.org', self: true }, { email: 'bo@example.org', displayName: 'Bo Guest' }, { email: 'cy@favorintl.org' }], description: 'Agenda here', hangoutLink: 'https://meet.google.com/abc-defg-hij', htmlLink: 'https://calendar.test/ev1', ...over });

before(async () => {
  google = await import('../functions/_lib/hub/google.ts');
  move = await import('../functions/api/hub/day-move.ts');
  file = await import('../functions/api/hub/day-file.ts');
  day = await import('../functions/api/hub/day.ts');
});

beforeEach(async () => {
  d1 = memoryD1();
  d1.exec(readFileSync(new URL('../db/google.sql', import.meta.url), 'utf8'));
  d1.exec(readFileSync(new URL('../db/meetings.sql', import.meta.url), 'utf8'));
  env = { DB: d1, GOOGLE_TOKEN_KEY: KEY, GOOGLE_CLIENT_SECRET: 'x', GOOGLE_TOKEN_URL: 'https://oauth.test/token' };
  const scopes = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.metadata.readonly';
  await d1.prepare('INSERT INTO hub_google (email, refresh_enc, scopes, connected_at, last_used) VALUES (?, ?, ?, ?, ?)').bind('ada@favorintl.org', await google.seal(env, 'refresh'), scopes, 'x', 'x').run();
  calls = [];
  events = [ev()];
  driveOk = true;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? String(init.body) : '' });
    if (u === 'https://oauth.test/token') return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    if (u.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events/')) {
      const id = decodeURIComponent(u.split('/events/')[1].split('?')[0]);
      const found = events.find((e) => e.id === id);
      if (!found) return new Response('{}', { status: 404 });
      if (init.method === 'PATCH') return new Response(JSON.stringify(found), { status: 200 });
      return new Response(JSON.stringify(found), { status: 200 });
    }
    if (u.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events?')) return new Response(JSON.stringify({ items: events }), { status: 200 });
    if (u.startsWith('https://www.googleapis.com/drive/v3/files/')) return new Response(JSON.stringify({ id: 'x', thumbnailLink: 'https://thumb.test/p=s220' }), { status: driveOk ? 200 : 404 });
    if (u.startsWith('https://thumb.test/')) return new Response('png', { status: 200, headers: { 'Content-Type': 'image/png' } });
    return new Response('{}', { status: 404 });
  };
});

describe('todaysEvents', () => {
  it('names what each event is held on, and keeps the ones with no link', async () => {
    events = [
      ev({ id: 'a', hangoutLink: undefined, location: 'https://us02web.zoom.us/j/123' }),
      ev({ id: 'b' }),
      ev({ id: 'c', hangoutLink: undefined, location: 'https://teams.microsoft.com/l/meetup-join/xyz' }),
      ev({ id: 'd', hangoutLink: undefined, location: '+1 (555) 010-2000' }),
      ev({ id: 'e', hangoutLink: undefined, location: 'Room 4' }),
      ev({ id: 'f', hangoutLink: undefined, start: { date: '2026-10-11' }, end: { date: '2026-10-12' } }),
      ev({ id: 'g', status: 'cancelled' }),
    ];
    const list = await google.todaysEvents('tok');
    assert.deepEqual(list.map((e) => [e.id, e.source]), [['a', 'Zoom'], ['b', 'Google Meet'], ['c', 'Microsoft Teams'], ['d', 'Phone call'], ['e', 'No link'], ['f', 'No link']]);
    assert.equal(list[0].meet, 'https://us02web.zoom.us/j/123');
    assert.equal(list[3].phone, '+1 (555) 010-2000');
    assert.equal(list[5].allDay, true);
  });

  it('reads a FavorOS room from the event and whether the person may edit it', async () => {
    events = [
      ev({ id: 'r', hangoutLink: undefined, location: 'https://dash.favorintl.org/meet/room/?m=abc123def456' }),
      ev({ id: 'o', organizer: { email: 'dee@favorintl.org' }, attendees: [{ email: 'ada@favorintl.org', self: true, responseStatus: 'declined' }, { email: 'dee@favorintl.org' }] }),
      ev({ id: 'm', organizer: { email: 'dee@favorintl.org' }, guestsCanModify: true, attendees: [{ email: 'ada@favorintl.org', self: true }, { email: 'dee@favorintl.org' }] }),
    ];
    const [r, o, m] = await google.todaysEvents('tok');
    assert.equal(r.hub, 'abc123def456');
    assert.equal(r.source, 'Favor Meetings');
    assert.equal(o.canEdit, false);
    assert.equal(o.declined, true);
    assert.equal(m.canEdit, true);
  });
});

const post = (body) => move.onRequestPost({ request: asUser('/api/hub/day-move', { method: 'POST', body: JSON.stringify(body) }), env });
const patches = () => calls.filter((c) => c.method === 'PATCH');

describe('Move to FavorOS', () => {
  it('makes the meeting with the same people and leaves the calendar event alone', async () => {
    const res = await post({ eventId: 'ev1' });
    const d = await res.json();
    assert.equal(res.status, 200);
    assert.equal(d.linked, false);
    assert.equal(patches().length, 0);
    const row = d1.db.prepare('SELECT * FROM hub_meetings WHERE id = ?').get(d.id);
    assert.equal(row.title, 'Partner call');
    assert.equal(row.host_email, 'ada@favorintl.org');
    assert.equal(row.rec_mode, 'off');
    assert.equal(row.remind, 0);
    assert.equal(row.calendar_event_id, 'ext:ev1');
    assert.deepEqual(JSON.parse(row.invitees).map((i) => i.email), ['bo@example.org', 'cy@favorintl.org']);
    assert.equal(Date.parse(row.starts_at), Date.parse(events[0].start.dateTime));
  });

  it('adds one line to the notes only when the person confirmed it, and sends no email', async () => {
    const d = await (await post({ eventId: 'ev1', writeLink: true })).json();
    assert.equal(d.linked, true);
    assert.equal(patches().length, 1);
    const p = patches()[0];
    assert.match(p.url, /sendUpdates=none/);
    const body = JSON.parse(p.body);
    assert.deepEqual(Object.keys(body), ['description']);
    assert.ok(body.description.startsWith('Agenda here\n\nJoin in FavorOS: https://dash.test/meet/room/?m=' + d.id));
    assert.equal(d1.db.prepare('SELECT calendar_event_id AS c FROM hub_meetings WHERE id = ?').get(d.id).c, 'ev1');
  });

  it('says so and keeps the meeting when Google refuses the notes', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => (init.method === 'PATCH' ? new Response('{}', { status: 403 }) : real(url, init));
    const d = await (await post({ eventId: 'ev1', writeLink: true })).json();
    assert.equal(d.ok, true);
    assert.equal(d.linked, false);
    assert.match(d.linkError, /untouched/);
    assert.equal(d1.db.prepare('SELECT calendar_event_id AS c FROM hub_meetings WHERE id = ?').get(d.id).c, 'ext:ev1');
  });

  it('emails each invitee but the mover once when the box was checked, staff the room and others the guest link', async () => {
    d1.exec(readFileSync(new URL('../db/move-invite.sql', import.meta.url), 'utf8'));
    d1.exec(`CREATE TABLE IF NOT EXISTS hub_users (email TEXT PRIMARY KEY, name TEXT, blocked INTEGER NOT NULL DEFAULT 0)`);
    d1.db.prepare(`INSERT OR IGNORE INTO hub_users (email, name) VALUES ('cy@favorintl.org', 'Cy')`).run();
    const sent = [];
    env.MAIL_HOOK = (m) => (sent.push(m), true);
    env.MEET_GUESTS = 'on';
    const d = await (await post({ eventId: 'ev1', emailInvitees: true })).json();
    assert.equal(d.emailed, 2);
    assert.deepEqual(sent.map((m) => m.to).sort(), ['bo@example.org', 'cy@favorintl.org']);
    assert.ok(sent.find((m) => m.to === 'cy@favorintl.org').html.includes('/meet/room/?m=' + d.id));
    assert.ok(sent.find((m) => m.to === 'bo@example.org').html.includes('/meet/g/?m=' + d.id));
    assert.ok(sent.every((m) => m.replyTo === 'ada@favorintl.org'));
    assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM hub_meeting_invite_log').get().n, 2);
  });

  it('sends no email when the box was not checked', async () => {
    const sent = [];
    env.MAIL_HOOK = (m) => (sent.push(m), true);
    const d = await (await post({ eventId: 'ev1' })).json();
    assert.equal(d.emailed, 0);
    assert.equal(sent.length, 0);
  });

  it('moves an event only once', async () => {
    const first = await (await post({ eventId: 'ev1' })).json();
    const again = await post({ eventId: 'ev1' });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).id, first.id);
  });

  it('refuses an all-day event, a meeting that has ended and a missing event', async () => {
    events = [ev({ id: 'allday', start: { date: '2026-10-11' }, end: { date: '2026-10-12' } }), ev({ id: 'over', start: { dateTime: iso(-3) }, end: { dateTime: iso(-2) } })];
    assert.equal((await post({ eventId: 'allday' })).status, 400);
    assert.equal((await post({ eventId: 'over' })).status, 400);
    assert.equal((await post({ eventId: 'nope' })).status, 404);
    assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM hub_meetings').get().n, 0);
  });

  it('asks for calendar edit permission before writing the link', async () => {
    d1.db.prepare('UPDATE hub_google SET scopes = ?').run('https://www.googleapis.com/auth/calendar.events.readonly');
    const res = await post({ eventId: 'ev1', writeLink: true });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'consent');
    assert.equal(patches().length, 0);
    assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM hub_meetings').get().n, 0);
  });
});

describe('Shared with you files', () => {
  const get = (q, who = 'ada@favorintl.org') => file.onRequestGet({ request: asUser('/api/hub/day-file' + q, {}, who), env });
  it('answers 404 when the person cannot see the file', async () => {
    driveOk = false;
    assert.equal((await get('?id=abcdefghijk1&v=content')).status, 404);
  });
  it('rejects an id that is not a Drive id', async () => {
    assert.equal((await get('?id=../x&v=content')).status, 404);
  });
  it('falls back to the picture Drive draws for the person when FavorOS cannot read the file', async () => {
    const res = await get('?id=abcdefghijk1&v=thumb&s=1200');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'image/png');
    assert.ok(calls.some((c) => c.url === 'https://thumb.test/p=s1200'));
  });
});

describe('the Today route', () => {
  const MIRROR = { MIRROR_API_KEY: 'k', MIRROR_QUERY_URL: 'https://mirror.test/q' };
  it('marks events that already have a room and lists rooms that are not on the calendar', async () => {
    d1.db.prepare(`INSERT INTO hub_meetings (id, title, host_email, host_name, starts_at, ends_at, status, created_at, invitees, calendar_event_id) VALUES ('m1', 'Moved one', 'ada@favorintl.org', 'Ada', ?, ?, 'scheduled', 'x', '[]', 'ext:ev1')`).run(iso(1), iso(2));
    d1.db.prepare(`INSERT INTO hub_meetings (id, title, host_email, host_name, starts_at, ends_at, status, created_at, invitees) VALUES ('m2', 'Off calendar', 'cy@favorintl.org', 'Cy', ?, ?, 'scheduled', 'x', '[{"email":"ada@favorintl.org"}]')`).run(new Date(Date.parse(google.easternDay().start) + 3600e3).toISOString(), new Date(Date.parse(google.easternDay().start) + 7200e3).toISOString());
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => (String(url).startsWith('https://mirror.test') ? new Response(JSON.stringify({ rows: [] }), { status: 200 }) : String(url).includes('gmail') ? new Response('{}', { status: 200 }) : real(url, init));
    const res = await day.onRequestGet({ request: asUser('/api/hub/day'), env: { ...env, ...MIRROR } });
    const d = await res.json();
    const list = d.google.events;
    assert.equal(list.find((e) => e.id === 'ev1').hub, 'm1');
    assert.ok(list.some((e) => e.hub === 'm2' && e.provider === 'favor' && e.source === 'Favor Meetings'));
    assert.equal(d.google.mayWrite, true);
  });
});
