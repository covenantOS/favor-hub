// Run with: npm test
//
// Sending a meeting link again (meetings/:id/send) through the real route on an in-memory D1. Email and GoHighLevel are stand-ins
// on a fake fetch: nothing leaves the machine. Made-up people only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, beforeEach } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { route } = await import('../functions/_lib/meetroute.ts');
const { buildReminder } = await import('../functions/_lib/meetcal.ts');

const schema = readFileSync(new URL('../db/meetings.sql', import.meta.url), 'utf8') + readFileSync(new URL('../db/meetings-send.sql', import.meta.url), 'utf8');
const MID = 'a'.repeat(24);
const HOST = 'host@favorintl.org';
const soon = new Date(Date.now() + 3 * 86400_000).toISOString();

let sent;
function fakeFetch() {
  sent = { mail: [], texts: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : {};
    if (u.includes('api.resend.com')) { sent.mail.push(body); return new Response('{"id":"x"}', { status: 200 }); }
    if (u.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'c1' } }), { status: 200 });
    if (u.includes('/conversations/messages')) { sent.texts.push(body); return new Response('{}', { status: 200 }); }
    return new Response('{}', { status: 404 });
  };
}

async function world({ texts = 'off', status = 'scheduled' } = {}) {
  const d1 = memoryD1();
  d1.exec(schema);
  d1.exec(`CREATE TABLE hub_users (email TEXT PRIMARY KEY, name TEXT, blocked INTEGER DEFAULT 0, role TEXT); CREATE TABLE act_staff (email TEXT, team TEXT, active INTEGER)`);
  d1.exec(`CREATE TABLE hub_settings (key TEXT PRIMARY KEY, value TEXT, updated_by TEXT, updated_at TEXT)`);
  if (texts === 'on') await d1.prepare(`INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('meet.texts', 'on', 't', 't')`).run();
  await d1.prepare('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, 1)').bind('ann@favorintl.org', 'Ann Able', '', 'Marketing').run();
  await d1.prepare('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, 1)').bind('bob@favorintl.org', 'Bob Baker', '', 'Grants').run();
  await d1.prepare(`INSERT INTO hub_meetings (id, title, host_email, host_name, invitees, status, rec_mode, starts_at, ends_at, duration_min, created_at, access) VALUES (?, 'Plan', ?, 'Host Person', ?, ?, 'video', ?, ?, 30, ?, 'invited')`)
    .bind(MID, HOST, JSON.stringify([{ email: 'ann@favorintl.org', name: 'Ann Able' }]), status, soon, soon, soon).run();
  return { DB: d1, MEET_RELEASE: 'staff', MEET_FAKE_SFU: '1', RESEND_API_KEY: 'k', GHL_PIT: 'p', GHL_LOCATION: 'l', GHL_URL: 'https://ghl.test' };
}

async function call(env, who, path, { method = 'GET', body } = {}) {
  const user = typeof who === 'string' ? { email: who, role: 'staff' } : who;
  const request = new Request(`https://hub.test/api/meet/${path.join('/')}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'X-Hub-Email': user.email, 'X-Hub-Name': user.email.split('@')[0], 'X-Hub-Role': user.role, 'content-type': 'application/json' } });
  const res = await route({ request, env, params: { path } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const send = (env, who, body) => call(env, who, ['meetings', MID, 'send'], { method: 'POST', body });

describe('send the link again', () => {
  beforeEach(fakeFetch);

  it('the host sees everyone, an invitee sees only themselves, an outsider gets the not-invited answer', async () => {
    const env = await world();
    const h = await call(env, HOST, ['meetings', MID, 'send']);
    assert.equal(h.status, 200);
    assert.equal(h.body.mayAll, true);
    assert.deepEqual(h.body.people.map((p) => p.email).sort(), ['ann@favorintl.org', HOST]);
    const a = await call(env, 'ann@favorintl.org', ['meetings', MID, 'send']);
    assert.equal(a.body.mayAll, false);
    assert.deepEqual(a.body.people.map((p) => p.email), ['ann@favorintl.org']);
    const z = await call(env, 'zed@favorintl.org', ['meetings', MID, 'send']);
    assert.equal(z.status, 403);
  });

  it('emails the picked people with the note, and skips a repeat inside a minute', async () => {
    const env = await world();
    const r = await send(env, HOST, { to: 'all', via: ['email'], note: 'Room changed' });
    assert.equal(r.body.sent, 1);
    assert.deepEqual(sent.mail[0].to, ['ann@favorintl.org']);
    assert.match(sent.mail[0].subject, /^Meeting link: Plan/);
    assert.match(sent.mail[0].text, /host: Room changed/);
    const again = await send(env, HOST, { to: ['ann@favorintl.org'], via: ['email'] });
    assert.equal(again.body.sent, 0);
    assert.equal(again.body.results[0].detail, 'Sent less than a minute ago.');
  });

  it('an invitee can send only to themselves', async () => {
    const env = await world();
    const r = await send(env, 'ann@favorintl.org', { to: [HOST], via: ['email'] });
    assert.equal(r.status, 400);
    const me = await send(env, 'ann@favorintl.org', { to: ['ann@favorintl.org'], via: ['email'] });
    assert.equal(me.body.sent, 1);
  });

  it('texts stay off until the setting is on, and never go to a person without a number', async () => {
    const off = await world();
    await call(off, 'ann@favorintl.org', ['meetings', 'myphone'], { method: 'POST', body: { phone: '404 555 0100' } });
    const r = await send(off, HOST, { to: ['ann@favorintl.org'], via: ['text'] });
    assert.equal(r.body.results[0].detail, 'Meeting texts are off.');
    assert.equal(sent.texts.length, 0);

    const on = await world({ texts: 'on' });
    const before = await send(on, HOST, { to: ['ann@favorintl.org'], via: ['text'] });
    assert.equal(before.body.results[0].detail, 'No mobile number.');
    const saved = await call(on, 'ann@favorintl.org', ['meetings', 'myphone'], { method: 'POST', body: { phone: '404 555 0100' } });
    assert.equal(saved.body.phone, '(***) ***-0100');
    const st = await call(on, HOST, ['meetings', MID, 'send']);
    assert.ok(!JSON.stringify(st.body).includes('4045550100'), 'the sheet never carries a full number');
    const t = await send(on, HOST, { to: ['ann@favorintl.org'], via: ['text'] });
    assert.equal(t.body.sent, 1);
    assert.match(sent.texts[0].message, /Plan, .* ET\. Join: https:\/\/hub\.test\/meet\/room\/\?m=/);
  });

  it('the host adds a Favor person by name and sends them the link in one step', async () => {
    const env = await world();
    const r = await send(env, HOST, { add: { to: 'Bob Baker' }, to: [], via: ['email'] });
    assert.equal(r.body.sent, 1);
    assert.deepEqual(sent.mail[0].to, ['bob@favorintl.org']);
    const st = await call(env, HOST, ['meetings', MID, 'send']);
    assert.ok(st.body.people.some((p) => p.email === 'bob@favorintl.org'));
  });

  it('an outside address is refused while guests are off', async () => {
    const env = await world();
    const r = await send(env, HOST, { add: { to: 'someone@example.org' }, to: [], via: ['email'] });
    assert.equal(r.status, 400);
    assert.equal(sent.mail.length, 0);
  });

  it('an ended meeting sends nothing', async () => {
    const env = await world({ status: 'ended' });
    const r = await send(env, HOST, { to: 'all', via: ['email'] });
    assert.equal(r.status, 400);
  });

  it('a live meeting sends a Join now email', async () => {
    const env = await world({ status: 'live' });
    await send(env, HOST, { to: 'all', via: ['email'] });
    assert.match(sent.mail[0].subject, /^Join now: Plan/);
  });
});

describe('reminder wording', () => {
  it('the soon reminder names the lead time set in Admin', () => {
    const r = buildReminder({ title: 'T', startsAt: soon, roomUrl: 'https://x', backup: '', rec: 'off', kind: 'soon', host: 'H', leadMin: 30 });
    assert.equal(r.subject, 'Starting in 30 minutes: T');
  });
  it('a cancellation has no Join button', () => {
    const r = buildReminder({ title: 'T', startsAt: soon, roomUrl: 'https://x/room', backup: 'https://meet', rec: 'off', kind: 'cancelled', host: 'H' });
    assert.match(r.subject, /^Cancelled: T/);
    assert.ok(!r.html.includes('https://x/room'));
    assert.ok(!r.text.includes('https://meet'));
  });
});
