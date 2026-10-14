// Run with: npm test
//
// Move to FavorOS (/api/hub/day-move) when the mover is not the organizer: a new event goes on the mover's calendar with the same
// people and Google invites them; the result says so; the organizer can be told. Google and email are stand-ins on a fake fetch.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, beforeEach } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { onRequestPost } = await import('../functions/api/hub/day-move.ts');
const google = await import('../functions/_lib/hub/google.ts');

const MOVER = 'mover@favorintl.org';
const EVENTS = 'https://www.googleapis.com/auth/calendar.events';
const start = new Date(Date.now() + 2 * 3600_000).toISOString();
const end = new Date(Date.now() + 3 * 3600_000).toISOString();

let calls, event, createOk;
function fakeFetch() {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), method = init.method || 'GET';
    calls.push({ u, method, body: init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : null });
    if (u.startsWith('https://oauth.test/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    if (u.includes('/events/') && method === 'GET') return new Response(JSON.stringify(event), { status: 200 });
    if (u.includes('/events/') && method === 'PATCH') return new Response('{}', { status: event.organizer.self ? 200 : 403 });
    if (/\/events\?/.test(u) && method === 'POST') return createOk ? new Response(JSON.stringify({ id: 'newev1' }), { status: 200 }) : new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 400 });
    if (u.includes('api.resend.com')) return new Response('{"id":"m"}', { status: 200 });
    return new Response('{}', { status: 404 });
  };
}

async function world(scopes = EVENTS) {
  const d1 = memoryD1();
  d1.exec(readFileSync(new URL('../db/meetings.sql', import.meta.url), 'utf8'));
  d1.exec('CREATE TABLE hub_users (email TEXT PRIMARY KEY, name TEXT, blocked INTEGER DEFAULT 0, role TEXT)');
  d1.exec('CREATE TABLE hub_google (email TEXT PRIMARY KEY, refresh_enc TEXT, scopes TEXT, connected_at TEXT, last_used TEXT)');
  const env = { DB: d1, GOOGLE_TOKEN_KEY: 'ab'.repeat(32), GOOGLE_CLIENT_SECRET: 'x', GOOGLE_TOKEN_URL: 'https://oauth.test/token', RESEND_API_KEY: 'k', MEET_RELEASE: 'staff' };
  await d1.prepare('INSERT INTO hub_google (email, refresh_enc, scopes, connected_at) VALUES (?, ?, ?, ?)').bind(MOVER, await google.seal(env, 'r-' + Math.random()), scopes, 'x').run();
  return env;
}
const post = async (env, body) => {
  const request = new Request('https://hub.test/api/hub/day-move', { method: 'POST', body: JSON.stringify(body), headers: { 'X-Hub-Email': MOVER, 'X-Hub-Name': 'Mover', 'content-type': 'application/json' } });
  const res = await onRequestPost({ request, env });
  return { status: res.status, body: await res.json() };
};

describe('Move to FavorOS', () => {
  beforeEach(() => {
    fakeFetch();
    createOk = true;
    event = {
      id: 'ev1_20261014T140000Z', recurringEventId: 'ev1', status: 'confirmed', summary: 'Ops', description: 'Zoom https://zoom.us/j/1',
      start: { dateTime: start, timeZone: 'America/New_York' }, end: { dateTime: end },
      organizer: { email: 'org@favorintl.org', displayName: 'Org Person' },
      attendees: [{ email: MOVER, self: true }, { email: 'a@favorintl.org' }, { email: 'ops-team@favorintl.org' }, { email: 'room@resource.calendar.google.com', resource: true }],
    };
  });

  it('a mover who is not the organizer gets a new event with the same people, invited by Google', async () => {
    const env = await world();
    const r = await post(env, { eventId: event.id, emailInvitees: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.created, true);
    assert.equal(r.body.linked, false);
    assert.equal(r.body.series, true);
    assert.equal(r.body.organizer.email, 'org@favorintl.org');
    const create = calls.find((c) => /\/events\?sendUpdates=all/.test(c.u) && c.method === 'POST');
    assert.ok(create, 'the new event asks Google to send invitations');
    assert.deepEqual(create.body.attendees.map((a) => a.email).sort(), ['a@favorintl.org', 'ops-team@favorintl.org', 'org@favorintl.org']);
    assert.match(create.body.description, /^Join in FavorOS: https:\/\/hub\.test\/meet\/room\/\?m=[0-9a-f]{24}/);
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0, 'the organizer event is never touched');
    assert.equal(calls.filter((c) => c.u.includes('resend')).length, 0, 'no second invite from FavorOS');
    const row = await env.DB.prepare('SELECT calendar_event_id FROM hub_meetings WHERE id = ?').bind(r.body.id).first();
    assert.equal(row.calendar_event_id, 'newev1');

    const told = await post(env, { tellOrganizer: r.body.id });
    assert.equal(told.body.ok, true);
    const mail = calls.filter((c) => c.u.includes('resend'));
    assert.deepEqual(mail[0].body.to, ['org@favorintl.org']);
    assert.match(mail[0].body.text, /original calendar event still exists/);
  });

  it('Google refusing the new event is said out loud', async () => {
    const env = await world();
    createOk = false;
    const r = await post(env, { eventId: event.id, emailInvitees: true });
    assert.equal(r.body.created, false);
    assert.match(r.body.linkError, /on no calendar/);
  });

  it('without calendar edit permission nothing is made and the person is asked to allow it', async () => {
    const env = await world('https://www.googleapis.com/auth/calendar.readonly');
    const r = await post(env, { eventId: event.id, emailInvitees: true });
    assert.equal(r.status, 409);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_meetings').first();
    assert.equal(n.n, 0);
  });

  it('the organizer moving keeps one event: the link is written onto it', async () => {
    const env = await world();
    event.organizer = { email: MOVER, self: true };
    const r = await post(env, { eventId: event.id, emailInvitees: false });
    assert.equal(r.body.linked, true);
    assert.equal(r.body.created, false);
    assert.equal(calls.filter((c) => /\/events\?/.test(c.u) && c.method === 'POST').length, 0);
  });
});
