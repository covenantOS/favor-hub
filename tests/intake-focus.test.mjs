// Hold focus time on a request that lives in Projects. The owner of the card holds the time on their own Google calendar (stubbed here),
// with no guests; the owner is whoever the card shows, including after the card is handed to someone else in the task panel. A test
// account is refused with a plain message and nothing reaches Google. Made-up people only; the live database is never touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { DESIGN, OUTSIDER, T, VIDEO, WILL, ic, iw, pc, rows } from './support/intake-world.mjs';
import { call } from './support/request-world.mjs';

async function connect(w, email) {
  const google = await import('../functions/_lib/hub/google.ts');
  w.d1.exec('CREATE TABLE IF NOT EXISTS hub_google (email TEXT PRIMARY KEY, refresh_enc TEXT, scopes TEXT, connected_at TEXT, last_used TEXT)');
  w.d1.db.prepare('INSERT OR REPLACE INTO hub_google (email, refresh_enc, scopes, connected_at) VALUES (?, ?, ?, ?)').run(email, await google.seal(w.env, 'r-' + email), 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy', 'x');
}

function stubGoogle(calls) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ u, init });
    if (u.startsWith('https://oauth.test')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    if (u.includes('/freeBusy')) return Response.json({ calendars: {} });
    if (u.includes('/events') && init.method === 'POST') return Response.json({ id: 'evt' + calls.length });
    if (u.includes('/events/') && init.method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json({});
  };
  return () => {
    globalThis.fetch = realFetch;
  };
}

test('the owner of a Projects request holds focus time, also after the card is handed to someone else', async () => {
  const w = iw();
  const calls = [];
  const restore = stubGoogle(calls);
  try {
    Object.assign(w.env, { GOOGLE_TOKEN_KEY: 'ab'.repeat(32), GOOGLE_CLIENT_SECRET: 'x', GOOGLE_TOKEN_URL: 'https://oauth.test/token', MEET_CAL_URL: 'https://cal.test' });
    await connect(w, DESIGN.email);
    await connect(w, VIDEO.email);
    const sent = await ic(w, OUTSIDER, 'POST', 'submit', { text: 'Design a flyer for the banquet' });
    const id = sent.data.request.id;
    assert.equal((await ic(w, DESIGN, 'POST', `r/${id}/accept`, {})).status, 200);
    const later = new Date(Date.now() + 86400000).toISOString();

    // The owner who accepted holds the time; the post carries no guests.
    const first = await call(w, DESIGN, 'POST', `${id}/focus`, { start: later, minutes: 60 });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    const post = calls.find((c) => c.init.method === 'POST' && c.u.includes('/events'));
    assert.ok(post.u.includes('sendUpdates=none'));
    assert.equal(JSON.parse(post.init.body).attendees, undefined);
    assert.ok(JSON.parse(post.init.body).description.includes('/projects/?r=' + id), 'the event links to the request in Projects');
    assert.equal((await call(w, VIDEO, 'POST', `${id}/focus`, { start: later, minutes: 60 })).status, 403, 'someone who does not own it cannot');

    // The card is handed to another person in the task panel. The panel shows the button to the new owner, so the hold must work for them.
    const card = rows(w, 'SELECT id FROM hub_tasks WHERE request_id = ?', id)[0].id;
    assert.equal((await pc(w, WILL, 'PATCH', `tasks/${card}`, { owner_email: VIDEO.email })).status, 200);
    const second = await call(w, VIDEO, 'POST', `${id}/focus`, { start: later, minutes: 30 });
    assert.equal(second.status, 200, JSON.stringify(second.data));
    assert.equal((await call(w, DESIGN, 'POST', `${id}/focus`, { start: later, minutes: 30 })).status, 403, 'the first owner no longer holds it');
    const slots = await call(w, VIDEO, 'GET', `${id}/focus?minutes=60`);
    assert.equal(slots.status, 200);
    assert.ok(slots.data.slots.length > 0 && slots.data.slots.length <= 3);
    // The hold can be taken off by the person whose calendar it is.
    assert.equal((await call(w, VIDEO, 'DELETE', `${id}/focus/${second.data.hold.id}`)).status, 200);
  } finally {
    restore();
  }
});

test('a test account is told it has no calendar and nothing is sent to Google', async () => {
  const w = iw();
  const calls = [];
  const restore = stubGoogle(calls);
  try {
    const sent = await ic(w, T, 'POST', 'submit', { text: 'Add a test banner to the website' });
    const id = sent.data.request.id;
    assert.equal((await ic(w, T, 'POST', `r/${id}/accept`, {})).status, 200);
    const r = await call(w, T, 'POST', `${id}/focus`, { start: new Date(Date.now() + 86400000).toISOString(), minutes: 60 });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'test_user');
    assert.match(r.data.message, /no calendar/);
    assert.equal(calls.filter((c) => c.u.includes('/events')).length, 0, 'no calendar event was written');
    assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_focus_holds')[0].n, 0);
  } finally {
    restore();
  }
});

test('the test-user guard lets a focus request reach its own plain answer', async () => {
  const { testerWriteBlocked } = await import('../functions/_lib/testuser.ts');
  assert.equal(testerWriteBlocked('tester@favorintl.org', 'POST', '/api/requests/req_abc123/focus'), false, 'the route itself answers "no calendar" and writes nothing');
  assert.equal(testerWriteBlocked('tester@favorintl.org', 'DELETE', '/api/requests/req_abc123/focus/fcs_1'), false);
  assert.equal(testerWriteBlocked('tester@favorintl.org', 'POST', '/api/requests/req_abc123/comments'), true, 'other request writes stay blocked');
  assert.equal(testerWriteBlocked('tester@favorintl.org', 'POST', '/api/requests/req_abc123/send'), true);
  void WILL;
});
