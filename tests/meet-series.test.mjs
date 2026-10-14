// Run with: npm test
// Repeating meetings (meetseries.ts through the Meetings route): one Google series event with RRULE and EXDATE, one-off changes
// as Google instances, "this and following" as a split with UNTIL, cancels at each scope, the agenda carried forward, and the
// scheduling assistant, conflicts, templates and booking pages. Google Calendar and email are stand-ins on a fake fetch.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, beforeEach } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { route } = await import('../functions/_lib/meetroute.ts');
const google = await import('../functions/_lib/hub/google.ts');
const seriesMod = await import('../functions/_lib/meetseries.ts');
const sched = await import('../functions/_lib/meetsched.ts');
const bookMod = await import('../functions/_lib/meetbook.ts');
const { onRequest: bookRoute } = await import('../functions/api/book/[[path]].ts');
const { onRequestPost } = await import('../functions/api/hub/day-move.ts');

const HOST = 'host@favorintl.org';
const CAL = 'https://cal.test';
const EVENTS = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy';
let calls, nextId, busyFor, mails;

function fakeFetch() {
  calls = []; mails = []; nextId = 1; busyFor = {};
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), method = init.method || 'GET';
    const body = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : null;
    calls.push({ u, method, body });
    if (u.startsWith('https://oauth.test/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    if (u === `${CAL}/freeBusy`) return new Response(JSON.stringify({ calendars: Object.fromEntries(body.items.map((i) => [i.id, { busy: busyFor[i.id] || [] }])) }), { status: 200 });
    if (u.startsWith(`${CAL}/calendars/primary/events?`) && method === 'POST') return new Response(JSON.stringify({ id: 'gev' + nextId++ }), { status: 200 });
    if (u.startsWith(`${CAL}/calendars/primary/events/`) && (method === 'PATCH' || method === 'DELETE')) return method === 'DELETE' ? new Response(null, { status: 204 }) : new Response('{}', { status: 200 });
    if (u.includes('api.resend.com')) { mails.push(JSON.parse(init.body)); return new Response('{"id":"m"}', { status: 200 }); }
    return new Response('{}', { status: 404 });
  };
}

async function world() {
  const d1 = memoryD1();
  for (const f of ['meetings.sql', 'meetings-auto.sql', 'meetings-scheduling.sql']) d1.exec(readFileSync(new URL(`../db/${f}`, import.meta.url), 'utf8'));
  d1.exec('CREATE TABLE IF NOT EXISTS hub_users (email TEXT PRIMARY KEY, name TEXT, blocked INTEGER DEFAULT 0, role TEXT)');
  d1.exec('CREATE TABLE IF NOT EXISTS hub_google (email TEXT PRIMARY KEY, refresh_enc TEXT, scopes TEXT, connected_at TEXT, last_used TEXT)');
  d1.exec('CREATE TABLE IF NOT EXISTS meet_directory (email TEXT, name TEXT, title TEXT, team TEXT, lead INTEGER DEFAULT 0, active INTEGER DEFAULT 1)');
  const env = { DB: d1, GOOGLE_TOKEN_KEY: 'ab'.repeat(32), GOOGLE_CLIENT_SECRET: 'x', GOOGLE_TOKEN_URL: 'https://oauth.test/token', RESEND_API_KEY: 'k', MEET_RELEASE: 'staff', MEET_CAL_URL: CAL };
  await d1.prepare('INSERT INTO hub_google (email, refresh_enc, scopes, connected_at) VALUES (?, ?, ?, ?)').bind(HOST, await google.seal(env, 'r1'), EVENTS, 'x').run();
  return env;
}

const call = async (env, method, path, body, who = HOST, role = 'admin') => {
  const request = new Request(`https://hub.test/api/meet/${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'X-Hub-Email': who, 'X-Hub-Name': 'Host Person', 'X-Hub-Role': role, 'content-type': 'application/json' } });
  const res = await route({ request, env, params: { path: path.split('?')[0].split('/') } });
  return { status: res.status, body: await res.json() };
};
const rows = async (env, sid) => (await env.DB.prepare(`SELECT * FROM hub_meetings WHERE series_id = ? ORDER BY orig_start`).bind(sid).all()).results;
const series = async (env, sid) => env.DB.prepare('SELECT * FROM hub_meeting_series WHERE id = ?').bind(sid).first();

// Next Tuesday 10:00 Eastern, at least 2 days out.
function nextTue() {
  const d = new Date(Date.now() + 2 * 86400_000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  for (const off of [4, 5]) { const t = Date.UTC(y, m, day, 10 + off, 0); if (new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }) === '10') return new Date(t).toISOString(); }
  throw new Error('no tue');
}

async function book(env, recur, extra = {}) {
  const r = await call(env, 'POST', 'meetings', { title: 'Team sync', startsAt: nextTue(), durationMin: 30, recur, invitees: [{ email: 'ann@favorintl.org', name: 'Ann' }], agenda: 'Updates', ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.seriesId;
}

describe('repeating meetings', () => {
  beforeEach(fakeFetch);

  it('a weekly series is one Google event with an RRULE and the series link; rows are made ahead', async () => {
    const env = await world();
    const sid = await book(env, { freq: 'weekly', interval: 1, byDay: [2, 4], end: { kind: 'never' } });
    const inserts = calls.filter((c) => c.method === 'POST' && c.u.startsWith(`${CAL}/calendars/primary/events?`));
    assert.equal(inserts.length, 1, 'one Google event for the whole series');
    assert.deepEqual(inserts[0].body.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TU,TH']);
    assert.match(inserts[0].body.description, new RegExp(`/meet/s/\\?id=${sid}`));
    const rs = await rows(env, sid);
    assert.ok(rs.length >= 16 && rs.length <= 20, `about 60 days of Tue and Thu, got ${rs.length}`);
    assert.equal(rs[0].id, sid, 'the first meeting carries the series id');
    assert.ok(rs.every((r) => r.calendar_event_id === 'gev1'));
    // The cron pass makes nothing new now and keeps it idempotent.
    const again = await seriesMod.seriesPass(env);
    assert.equal(again.made, 0);
  });

  it('this one: patches Google instance, detaches the row, leaves the others', async () => {
    const env = await world();
    const sid = await book(env, { freq: 'weekly', interval: 1, byDay: [], end: { kind: 'count', count: 6 } });
    const rs = await rows(env, sid);
    assert.equal(rs.length, 6);
    const second = rs[1];
    const newStart = new Date(Date.parse(second.starts_at) + 3600_000).toISOString();
    const r = await call(env, 'POST', `meetings/${second.id}/update`, { scope: 'this', startsAt: newStart });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const patch = calls.find((c) => c.method === 'PATCH');
    const stamp = new Date(second.orig_start).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    assert.ok(patch.u.includes(`/events/gev1_${stamp}?sendUpdates=all`), patch.u);
    const after = await rows(env, sid);
    assert.equal(after[1].starts_at, newStart);
    assert.equal(after[1].detached, 1);
    assert.equal(after[2].starts_at, rs[2].starts_at);
    assert.equal(calls.filter((c) => c.method === 'POST' && c.u.includes('/events?')).length, 1, 'never a second event');
  });

  it('cancel this one adds an EXDATE and deletes only the Google instance', async () => {
    const env = await world();
    const sid = await book(env, { freq: 'weekly', interval: 1, byDay: [], end: { kind: 'count', count: 4 } });
    const rs = await rows(env, sid);
    const r = await call(env, 'POST', `meetings/${rs[2].id}/update`, { scope: 'this', status: 'cancelled' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const del = calls.find((c) => c.method === 'DELETE');
    assert.match(del.u, /\/events\/gev1_\d{8}T\d{6}Z\?sendUpdates=all$/);
    const s = await series(env, sid);
    assert.deepEqual(JSON.parse(s.exdates), [rs[2].orig_start]);
    assert.deepEqual(seriesMod.recurrenceOf(s)[1].startsWith('EXDATE:'), true);
    const after = await rows(env, sid);
    assert.equal(after[2].status, 'cancelled');
    assert.equal(after.filter((x) => x.status === 'scheduled').length, 3);
    await seriesMod.seriesPass(env);
    assert.equal((await rows(env, sid)).length, 4, 'the cancelled date is not made again');
  });

  it('this and following: the old series gets UNTIL, a new repeating event starts here, rows keep their ids', async () => {
    const env = await world();
    const sid = await book(env, { freq: 'weekly', interval: 1, byDay: [], end: { kind: 'count', count: 6 } });
    const rs = await rows(env, sid);
    const third = rs[2];
    const later = new Date(Date.parse(third.starts_at) + 2 * 3600_000).toISOString();
    const r = await call(env, 'POST', `meetings/${third.id}/update`, { scope: 'following', startsAt: later, title: 'Team sync (new time)' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.seriesId, third.id);
    const old = await series(env, sid);
    assert.equal(JSON.parse(old.rule).end.kind, 'until');
    const patch = calls.find((c) => c.method === 'PATCH' && c.u.includes('/events/gev1?'));
    assert.match(patch.body.recurrence[0], /UNTIL=/);
    const insert = calls.filter((c) => c.method === 'POST' && c.u.includes('/events?'))[1];
    assert.equal(insert.body.recurrence[0], 'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=4');
    assert.equal(insert.body.summary, 'Team sync (new time)');
    const a = await rows(env, sid), b = await rows(env, third.id);
    assert.equal(a.length, 2);
    assert.equal(b.length, 4);
    assert.equal(b[0].id, third.id);
    assert.equal(b[0].starts_at, later);
    assert.ok(b.every((x) => x.calendar_event_id === 'gev2' && x.title === 'Team sync (new time)'));
    const page = await call(env, 'GET', `meetings/series/${third.id}`);
    assert.equal(page.status, 200);
    assert.equal(page.body.upcoming.length, 6, 'the series page shows both halves');
  });

  it('all: a new time moves every upcoming meeting and patches the series event, ids kept', async () => {
    const env = await world();
    const sid = await book(env, { freq: 'weekly', interval: 1, byDay: [], end: { kind: 'count', count: 5 } });
    const rs = await rows(env, sid);
    const wed = new Date(Date.parse(rs[1].starts_at) + 86400_000 + 3600_000).toISOString(); // a day later, an hour later
    const r = await call(env, 'POST', `meetings/${rs[1].id}/update`, { scope: 'all', startsAt: wed });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = await rows(env, sid);
    assert.deepEqual(after.map((x) => x.id), rs.map((x) => x.id));
    assert.equal(after[1].starts_at, wed);
    assert.equal(new Date(after[0].starts_at).getUTCDay(), 3, 'Wednesday now');
    const patch = calls.find((c) => c.method === 'PATCH' && c.u.includes('/events/gev1?'));
    assert.equal(patch.body.recurrence[0], 'RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=5');
  });

  it('cancel all deletes the series event once and cancels every scheduled meeting', async () => {
    const env = await world();
    const sid = await book(env, { freq: 'daily', interval: 1, byDay: [], end: { kind: 'count', count: 3 } });
    const rs = await rows(env, sid);
    const r = await call(env, 'POST', `meetings/${rs[1].id}/update`, { scope: 'all', status: 'cancelled' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(calls.filter((c) => c.method === 'DELETE').length, 1);
    assert.match(calls.find((c) => c.method === 'DELETE').u, /\/events\/gev1\?/);
    assert.ok((await rows(env, sid)).every((x) => x.status === 'cancelled'));
    assert.equal((await series(env, sid)).status, 'cancelled');
  });

  it('without a calendar, changes go out as emails with a calendar file', async () => {
    const env = await world();
    const sid = await book(env, { freq: 'weekly', interval: 1, byDay: [], end: { kind: 'count', count: 3 } }, { calendar: false });
    const rs = await rows(env, sid);
    await call(env, 'POST', `meetings/${rs[1].id}/update`, { scope: 'this', status: 'cancelled' });
    const m = mails.find((x) => x.to.includes('ann@favorintl.org'));
    assert.ok(m, 'Ann hears about it');
    assert.match(m.subject, /^Cancelled/);
    const ics = Buffer.from(m.attachments[0].content, 'base64').toString('utf8');
    assert.match(ics, /METHOD:CANCEL/);
    assert.match(ics, new RegExp(`UID:${rs[1].id}@favoros`));
  });

  it('the next agenda carries the open action items from the last meeting', async () => {
    const env = await world();
    const sid = await book(env, { freq: 'daily', interval: 1, byDay: [], end: { kind: 'count', count: 3 } });
    const rs = await rows(env, sid);
    await env.DB.prepare(`UPDATE hub_meetings SET status = 'ended', notes_status = 'ready', starts_at = ? WHERE id = ?`).bind(new Date(Date.now() - 86400_000).toISOString(), rs[0].id).run();
    await env.DB.prepare(`UPDATE hub_meetings SET starts_at = ? WHERE id = ?`).bind(new Date(Date.now() + 3600_000).toISOString(), rs[1].id).run();
    await env.DB.prepare('INSERT INTO hub_meeting_actions (meeting_id, idx, text, owner_name, owner_email, due, t, done) VALUES (?, 0, ?, ?, ?, ?, 0, 0), (?, 1, ?, ?, ?, ?, 0, 1)')
      .bind(rs[0].id, 'Send the budget', 'Ann', 'ann@favorintl.org', '', rs[0].id, 'Done thing', 'Ann', 'ann@favorintl.org', '').run();
    const n = await seriesMod.carryForward(env);
    assert.equal(n, 1);
    const next = await env.DB.prepare('SELECT agenda, carried FROM hub_meetings WHERE id = ?').bind(rs[1].id).first();
    assert.match(next.agenda, /^Updates\n\nOpen from .+:\n- Send the budget \(Ann\)$/);
    assert.equal(next.carried, 1);
  });
});

describe('scheduling assistant', () => {
  beforeEach(fakeFetch);

  it('suggests times inside everyone’s hours, around busy blocks and the buffer, in each zone', () => {
    const day = Date.UTC(2026, 9, 20); // Tue Oct 20
    const people = [
      { email: 'a@x', tz: 'America/New_York', dayStart: 540, dayEnd: 1020, workDays: [1, 2, 3, 4, 5], busy: [{ start: '2026-10-20T13:00:00Z', end: '2026-10-20T15:00:00Z' }] },
      { email: 'k@x', tz: 'Africa/Kampala', dayStart: 540, dayEnd: 1020, workDays: [1, 2, 3, 4, 5], busy: [] },
    ];
    const slots = sched.suggest(people, { durationMin: 30, from: day, to: day + 86400_000, bufferMin: 10, now: day - 86400_000 });
    // Kampala 9 to 5 is 06:00 to 14:00 UTC, Eastern 9 to 5 is 13:00 to 21:00 UTC, and a is busy 13:00 to 15:00: nothing fits both.
    assert.equal(slots.filter((s) => s.free.length === 2).length, 0);
    assert.ok(slots.length > 0, 'partial times come back with who misses');
    assert.ok(slots.every((s) => s.busy.length + s.outside.length > 0));
    // Without the busy block, 13:00 to 13:30 UTC (9:00 Eastern, 4:00 PM Kampala) fits both.
    const open = sched.suggest(people.map((p) => ({ ...p, busy: [] })), { durationMin: 30, from: day, to: day + 86400_000, now: day - 86400_000 });
    assert.ok(open.some((s) => s.start === '2026-10-20T13:00:00.000Z' && s.free.length === 2), JSON.stringify(open.slice(0, 3)));
    assert.ok(slots.every((s) => s.local['k@x'] && s.local['a@x']));
  });

  it('conflicts name FavorOS meetings and Google busy times; a test person without Google shows FavorOS meetings only', async () => {
    const env = await world();
    const sid = await book(env, { freq: 'daily', interval: 1, byDay: [], end: { kind: 'count', count: 2 } });
    const rs = await rows(env, sid);
    busyFor['bob@favorintl.org'] = [{ start: rs[0].starts_at, end: rs[0].ends_at }];
    const r = await call(env, 'POST', 'meetings/conflicts', { startsAt: rs[0].starts_at, endsAt: rs[0].ends_at, emails: ['ann@favorintl.org', 'bob@favorintl.org', 'cat@favorintl.org'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const why = Object.fromEntries(r.body.conflicts.map((c) => [c.email, c.why]));
    assert.equal(why['ann@favorintl.org'], 'meeting');
    assert.equal(why['bob@favorintl.org'], 'busy');
    assert.equal(why['cat@favorintl.org'], undefined);
    const a = await call(env, 'POST', 'meetings/assist', { emails: ['ann@favorintl.org'], durationMin: 30 });
    assert.equal(a.status, 200);
    assert.ok(a.body.slots.length > 0);
    assert.ok(a.body.slots.every((s) => !rs.some((m) => Date.parse(m.starts_at) < Date.parse(s.end) && Date.parse(m.ends_at) > Date.parse(s.start)) || s.free.length < 2));
  });

  it('templates save and list; working hours save', async () => {
    const env = await world();
    const t = await call(env, 'POST', 'meetings/templates', { name: 'RDD weekly', title: 'RDD weekly', agenda: 'Pipeline', rule: { freq: 'weekly', interval: 1, byDay: [1], end: { kind: 'never' } }, team: 'Development (RDD)', driveFolder: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn' });
    assert.equal(t.status, 200, JSON.stringify(t.body));
    const l = await call(env, 'GET', 'meetings/templates');
    assert.equal(l.body.templates[0].driveFolder, '1AbCdEfGhIjKlMn');
    assert.equal(l.body.templates[0].rule.freq, 'weekly');
    const other = await call(env, 'GET', 'meetings/templates', null, 'x@favorintl.org');
    assert.equal(other.body.templates.length, 0, 'not shared');
    const p = await call(env, 'POST', 'meetings/prefs', { tz: 'Africa/Kampala', dayStart: 480, dayEnd: 960, workDays: [1, 2, 3, 4, 5], bufferMin: 10 });
    assert.equal(p.body.prefs.tz, 'Africa/Kampala');
  });
});

describe('booking pages', () => {
  beforeEach(fakeFetch);
  const pub = async (env, method, path, body) => {
    const request = new Request(`https://hub.test/api/book/${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' } });
    const res = await bookRoute({ request, env, params: { path: path.split('?')[0].split('/') } });
    return { status: res.status, body: await res.json() };
  };

  it('a partner books an open time; the owner gets a hold, the partner a confirmation with a calendar file; cancel and move work', async () => {
    const env = await world();
    const all = { days: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [[0, 1440]]])) };
    const saved = await call(env, 'POST', 'meetings/booking/types', { title: 'Partner call', durationMin: 30, avail: all, noticeMin: 60, bufferMin: 15, questions: [{ q: 'What would you like to talk about?', required: true }] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const { handle, slug } = saved.body;
    assert.equal(handle, 'host');
    const page = await pub(env, 'GET', `page?u=${handle}`);
    assert.equal(page.body.types[0].title, 'Partner call');
    assert.equal(page.body.types[0].id, undefined, 'no private fields');
    const slots = await pub(env, 'GET', `slots?u=${handle}&t=${slug}&days=3`);
    assert.ok(slots.body.slots.length > 10);
    const at = slots.body.slots[4];
    const missing = await pub(env, 'POST', 'book', { u: handle, t: slug, startsAt: at, name: 'Pat Partner', email: 'pat@example.com', answers: [] });
    assert.equal(missing.status, 400);
    const ok = await pub(env, 'POST', 'book', { u: handle, t: slug, startsAt: at, name: 'Pat Partner', email: 'pat@example.com', answers: ['Visiting Uganda'], tz: 'America/Chicago' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const hold = calls.find((c) => c.method === 'POST' && c.u.includes('/events?sendUpdates=none'));
    assert.equal(hold.body.attendees, undefined, 'Google sends the partner nothing');
    const conf = mails.find((m) => m.to.includes('pat@example.com'));
    assert.match(Buffer.from(conf.attachments[0].content, 'base64').toString('utf8'), /METHOD:REQUEST/);
    assert.ok(mails.some((m) => m.to.includes(HOST)), 'the owner hears about it');
    const again = await pub(env, 'POST', 'book', { u: handle, t: slug, startsAt: at, name: 'Other', email: 'o@example.com', answers: ['x'] });
    assert.equal(again.status, 409, 'the time is taken');
    const after = await pub(env, 'GET', `slots?u=${handle}&t=${slug}&days=3`);
    assert.ok(!after.body.slots.includes(at));
    const nearby = after.body.slots.filter((s) => Math.abs(Date.parse(s) - Date.parse(at)) < 45 * 60000);
    assert.equal(nearby.length, 0, 'the buffer keeps 15 minutes clear on both sides');
    const key = new URL(ok.body.manageUrl).searchParams.get('k');
    const id = ok.body.booking.id;
    const g = await pub(env, 'GET', `manage?b=${id}&k=${key}`);
    assert.equal(g.body.booking.name, 'Pat Partner');
    const bad = await pub(env, 'GET', `manage?b=${id}&k=${'0'.repeat(32)}`);
    assert.equal(bad.status, 404);
    const to = after.body.slots[after.body.slots.length - 1];
    const mv = await pub(env, 'POST', 'manage', { b: id, k: key, action: 'move', startsAt: to });
    assert.equal(mv.status, 200, JSON.stringify(mv.body));
    const m = await env.DB.prepare('SELECT starts_at FROM hub_meetings WHERE id = (SELECT meeting_id FROM hub_bookings WHERE id = ?)').bind(id).first();
    assert.equal(m.starts_at, to);
    const cx = await pub(env, 'POST', 'manage', { b: id, k: key, action: 'cancel' });
    assert.equal(cx.status, 200);
    const st = await env.DB.prepare('SELECT status FROM hub_meetings WHERE id = (SELECT meeting_id FROM hub_bookings WHERE id = ?)').bind(id).first();
    assert.equal(st.status, 'cancelled');
  });

  it('a staff-only type is hidden from the public, and a test owner books only test addresses', async () => {
    const env = await world();
    await call(env, 'POST', 'meetings/booking/types', { title: 'Staff 1:1', audience: 'staff' });
    const page = await pub(env, 'GET', 'page?u=host');
    assert.equal(page.status, 404);
    const t = await call(env, 'POST', 'meetings/booking/types', { title: 'Test call', avail: { days: { 0: [[0, 1440]], 1: [[0, 1440]], 2: [[0, 1440]], 3: [[0, 1440]], 4: [[0, 1440]], 5: [[0, 1440]], 6: [[0, 1440]] } }, noticeMin: 0 }, 'tester@favorintl.org');
    const s = await pub(env, 'GET', `slots?u=${t.body.handle}&t=${t.body.slug}&days=2`);
    const r = await pub(env, 'POST', 'book', { u: t.body.handle, t: t.body.slug, startsAt: s.body.slots[2], name: 'Real Person', email: 'someone@favorintl.org' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'test_only');
  });
});

describe('Move to FavorOS for a whole series', () => {
  let gcalls;
  const master = (self) => ({
    id: 'zoomser', summary: 'Ops weekly', description: 'Join Zoom https://zoom.us/j/99', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE', 'EXDATE;TZID=America/New_York:' + exDay() + 'T090000'],
    start: { dateTime: '2026-09-02T09:00:00-04:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-09-02T09:30:00-04:00' },
    organizer: self ? { email: HOST, self: true } : { email: 'org@favorintl.org', displayName: 'Org Person' },
    attendees: [{ email: HOST, self: true }, { email: 'ann@favorintl.org', displayName: 'Ann' }],
  });
  function exDay() { const d = new Date(Date.now() + 14 * 86400_000); while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ''); }
  const inst = { id: 'zoomser_20261021T130000Z', recurringEventId: 'zoomser', status: 'confirmed', summary: 'Ops weekly', start: { dateTime: new Date(Date.now() + 3 * 86400_000).toISOString() }, end: { dateTime: new Date(Date.now() + 3 * 86400_000 + 1800_000).toISOString() }, originalStartTime: { dateTime: new Date(Date.now() + 3 * 86400_000).toISOString() }, organizer: { email: HOST, self: true }, attendees: [] };
  function fake(self) {
    gcalls = [];
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url), method = init.method || 'GET';
      gcalls.push({ u, method, body: typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : null });
      if (u.startsWith('https://oauth.test/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      if (/\/events\/zoomser\/instances/.test(u)) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (/\/events\/zoomser_/.test(u) && method === 'GET') return new Response(JSON.stringify({ ...inst, organizer: master(self).organizer }), { status: 200 });
      if (/\/events\/zoomser(\?|$)/.test(u) && method === 'GET') return new Response(JSON.stringify(master(self)), { status: 200 });
      if (/\/events\/zoomser\?/.test(u) && method === 'PATCH') return new Response('{}', { status: 200 });
      if (/\/events\?/.test(u) && method === 'POST') return new Response(JSON.stringify({ id: 'newser' }), { status: 200 });
      if (u.includes('api.resend.com')) return new Response('{"id":"m"}', { status: 200 });
      return new Response('{}', { status: 404 });
    };
  }
  const post = async (env, body) => {
    const request = new Request('https://hub.test/api/hub/day-move', { method: 'POST', body: JSON.stringify(body), headers: { 'X-Hub-Email': HOST, 'X-Hub-Name': 'Host Person', 'content-type': 'application/json' } });
    const res = await onRequestPost({ request, env });
    return { status: res.status, body: await res.json() };
  };

  it('the organizer: one PATCH on the Google series, the FavorOS series keeps the rule and skipped date', async () => {
    fake(true);
    const env = await world();
    const r = await post(env, { eventId: inst.id, series: true, emailInvitees: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.series, true);
    const patches = gcalls.filter((c) => c.method === 'PATCH');
    assert.equal(patches.length, 1);
    assert.match(patches[0].u, /\/events\/zoomser\?conferenceDataVersion=1&sendUpdates=none/);
    assert.match(patches[0].body.location, new RegExp(`/meet/s/[?]id=${r.body.seriesId}`));
    assert.ok(!patches[0].body.description.includes('zoom.us'));
    assert.equal(gcalls.filter((c) => c.method === 'POST' && c.u.includes('/events?')).length, 0, 'no second event');
    const s = await series(env, r.body.seriesId);
    assert.equal(s.calendar_event_id, 'zoomser');
    assert.equal(JSON.parse(s.rule).byDay[0], 3);
    assert.equal(JSON.parse(s.exdates).length, 1);
    const rs = await rows(env, r.body.seriesId);
    assert.ok(rs.length >= 4 && rs.every((x) => Date.parse(x.starts_at) > Date.now() - 86400_000));
    assert.ok(!rs.some((x) => x.orig_start === JSON.parse(s.exdates)[0]), 'the skipped Wednesday has no meeting');
    const again = await post(env, { eventId: inst.id, series: true });
    assert.equal(again.status, 409);
  });

  it('not the organizer: a new repeating event on the mover’s calendar with the organizer invited', async () => {
    fake(false);
    const env = await world();
    const r = await post(env, { eventId: inst.id, series: true, emailInvitees: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.created, true);
    assert.equal(r.body.organizer.email, 'org@favorintl.org');
    const ins = gcalls.find((c) => c.method === 'POST' && c.u.includes('/events?'));
    assert.match(ins.body.recurrence[0], /^RRULE:FREQ=WEEKLY;BYDAY=WE/);
    assert.ok(ins.body.attendees.some((a) => a.email === 'org@favorintl.org'));
    assert.equal(gcalls.filter((c) => c.method === 'PATCH').length, 0);
  });
});
