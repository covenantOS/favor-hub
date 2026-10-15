// Move to Chat: the staff-only test, the first Chat message, and the route that checks both on the server. Invented people only;
// Chat and Gmail are stand-ins and nothing leaves the in-memory database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { staffOnly, threadPeople, historyText, chatWords } = await import('../functions/_lib/mail/tochat.ts');
const { handle, forgetCount } = await import('../functions/_lib/mail/route.ts');
const google = await import('../functions/_lib/hub/google.ts');

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const ADA = { email: 'ada@favorintl.org', name: 'Ada Admin', picture: '', role: 'admin', via: 'google', kpi: true };
const row = (email, name, role = 'staff', blocked = 0, pending = 0) => [email, { email, name, role, blocked, pending }];
const users = (...r) => new Map(r.map((x) => row(...x)));
const who = (email, name = '') => ({ email, name });

describe('the staff-only test', () => {
  const U = users(['ada@favorintl.org', 'Ada Admin', 'admin'], ['bo@favorintl.org', 'Bo Builder'], ['cy@favorintl.org', 'Cy Writer']);
  it('passes when everyone on the thread is active staff', () => {
    const v = staffOnly([who('bo@favorintl.org'), who('cy@favorintl.org', 'Cy')], 'ada@favorintl.org', U);
    assert.equal(v.ok, true);
    assert.deepEqual(v.people.map((p) => p.email).sort(), ['ada@favorintl.org', 'bo@favorintl.org', 'cy@favorintl.org']);
  });
  it('fails with one outside address, one blocked person, one pending person, or a field account', () => {
    assert.equal(staffOnly([who('bo@favorintl.org'), who('maya@example.org')], 'ada@favorintl.org', U).ok, false);
    assert.equal(staffOnly([who('bo@favorintl.org')], 'ada@favorintl.org', users(['ada@favorintl.org', 'Ada', 'admin'], ['bo@favorintl.org', 'Bo', 'staff', 1])).ok, false);
    assert.equal(staffOnly([who('bo@favorintl.org')], 'ada@favorintl.org', users(['ada@favorintl.org', 'Ada', 'admin'], ['bo@favorintl.org', 'Bo', 'staff', 0, 1])).ok, false);
    assert.equal(staffOnly([who('bo@favorintl.org')], 'ada@favorintl.org', users(['ada@favorintl.org', 'Ada', 'admin'], ['bo@favorintl.org', 'Bo', 'field'])).ok, false);
  });
  it('requires the viewer to be staff too, and at least one other person', () => {
    assert.equal(staffOnly([who('bo@favorintl.org')], 'ada@favorintl.org', users(['bo@favorintl.org', 'Bo'])).ok, false);
    assert.equal(staffOnly([], 'ada@favorintl.org', U).ok, false);
    assert.equal(staffOnly([who('ada@favorintl.org')], 'ada@favorintl.org', U).ok, false);
  });
  it('caps a group at nine people', () => {
    const many = Array.from({ length: 9 }, (_, i) => [`p${i}@favorintl.org`, 'P' + i]);
    const U9 = users(['ada@favorintl.org', 'Ada', 'admin'], ...many);
    assert.equal(staffOnly(many.map(([e]) => who(e)), 'ada@favorintl.org', U9).ok, false);
    assert.equal(staffOnly(many.slice(0, 8).map(([e]) => who(e)), 'ada@favorintl.org', U9).ok, true);
  });
  it('keeps the test users apart from real staff', () => {
    const UT = users(['tester@favorintl.org', 'Tester', 'admin'], ['tester2@favorintl.org', 'Tester Two', 'admin'], ['bo@favorintl.org', 'Bo']);
    assert.equal(staffOnly([who('tester2@favorintl.org')], 'tester@favorintl.org', UT).ok, true);
    assert.equal(staffOnly([who('bo@favorintl.org')], 'tester@favorintl.org', UT).ok, false);
    assert.equal(staffOnly([who('tester2@favorintl.org')], 'bo@favorintl.org', UT).ok, false);
    assert.equal(staffOnly([who('privacy-probe@favorintl.org')], 'bo@favorintl.org', users(['bo@favorintl.org', 'Bo'], ['privacy-probe@favorintl.org', 'Probe'])).ok, false);
  });
  it('reads people from From, To, Cc and Bcc and skips drafts', () => {
    const p = threadPeople([{ from: who('a@x.org', 'A'), to: [who('b@x.org')], cc: [who('C@x.org', 'C')] }, { draft: true, from: who('d@x.org') }]);
    assert.deepEqual(p.map((x) => x.email), ['a@x.org', 'b@x.org', 'c@x.org']);
  });
});

describe('the first Chat message', () => {
  it('starts with the subject, then each email as "Name, date: text"', () => {
    const t = historyText('Newsletter order', [{ name: 'Bo', date: '2026-10-13T15:00:00Z', text: 'Lead with the well.' }, { name: 'Ada', date: '2026-10-14T15:00:00Z', text: 'Agreed.' }]);
    assert.match(t, /^Moved from email: Newsletter order\n\nBo, Oct 13, 2026: Lead with the well\.\n\nAda, Oct 14, 2026: Agreed\.$/);
  });
  it('stays under the Chat limit of 4,000 characters and drops the oldest emails first', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ name: 'P' + i, date: '2026-10-1' + (i % 9) + 'T12:00:00Z', text: 'x'.repeat(1400) + i }));
    const t = historyText('Long', items);
    assert.ok(t.length <= 4000);
    assert.match(t, /earlier messages are in the email thread/);
    assert.ok(t.includes('P11,'));
    assert.ok(!t.includes('P0,'));
  });
  it('trims quoted mail and a signature, and defuses mention tokens', () => {
    const w = chatWords({ text: 'Sounds good.\n\n-- \nBo Builder\nFavor\n\nOn Tue, Oct 13, Ada wrote:\n> old words', html: '', snippet: '' });
    assert.equal(w, 'Sounds good.');
    assert.ok(!chatWords({ text: 'ping <@channel>', html: '', snippet: '' }).includes('<@'));
  });
});

// The route, against a mailbox of three invented staff and one outsider.
let d1;
let env;
let sent;
let pending;
const hdr = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
const msg = (id, tid, from, to, text, ms) => ({
  id, threadId: tid, labelIds: ['INBOX'], internalDate: String(ms), snippet: text,
  payload: { mimeType: 'text/plain', headers: hdr({ From: from, To: to, Subject: 'Team plan', 'Message-ID': `<${id}@x>` }), body: { data: b64u(text) } },
});
const threads = {
  teamaaaa: { id: 'teamaaaa', historyId: '1', messages: [msg('m1team01', 'teamaaaa', 'Bo Builder <bo@favorintl.org>', 'Ada Admin <ada@favorintl.org>', 'Draft plan is ready.', 1760000000000), msg('m2team02', 'teamaaaa', 'Ada Admin <ada@favorintl.org>', 'Bo Builder <bo@favorintl.org>, Cy Writer <cy@favorintl.org>', 'Thanks, adding Cy.\n\n-- \nAda', 1760003600000)] },
  mixedaaa: { id: 'mixedaaa', historyId: '1', messages: [msg('m1mixed1', 'mixedaaa', 'Bo Builder <bo@favorintl.org>', 'Ada Admin <ada@favorintl.org>, Maya <maya@example.org>', 'Hello all.', 1760000000000)] },
};
const fake = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  const p = u.pathname.replace('/gmail/v1/users/me', '');
  const J = (o, status = 200) => new Response(JSON.stringify(o), { status });
  if (p === '/settings/sendAs') return J({ sendAs: [{ isDefault: true, sendAsEmail: 'ada@favorintl.org', signature: '' }] });
  const tm = p.match(/^\/threads\/([^/]+)$/);
  if (tm) return threads[tm[1]] ? J(threads[tm[1]]) : J({ error: { code: 404, message: 'no' } }, 404);
  const mm = p.match(/^\/messages\/([^/]+)$/);
  if (mm && method === 'GET') return J({ id: mm[1], payload: { headers: hdr({ 'Message-ID': '<m2team02@x>' }) } });
  if (p === '/messages/send') {
    const raw = Buffer.from(body.raw, 'base64url').toString('utf8');
    const parts = raw
      .split(/--fos_[0-9a-f]+/)
      .map((chunk) => chunk.split('\r\n\r\n')[1] || '')
      .filter((b) => /^[A-Za-z0-9+/=\r\n]+$/.test(b.trim()))
      .map((b) => Buffer.from(b.replace(/\s+/g, ''), 'base64').toString('utf8'));
    sent.push({ ...body, raw: raw + ' ' + parts.join(' ') });
    return J({ id: 'm9', threadId: body.threadId });
  }
  return J({ error: { code: 404, message: 'no route ' + p } }, 404);
};
async function call(user, method, path, body) {
  const init = { method, headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const res = await handle({ request: new Request('https://dash.favorintl.org/api/mail/' + path, init), env, user, path: path.split('/').filter(Boolean), fetcher: fake, partners: async () => ({}), waitUntil: (p) => pending.push(p) });
  await Promise.allSettled(pending.splice(0));
  return { status: res.status, data: (res.headers.get('Content-Type') || '').includes('json') ? await res.json() : null };
}

describe('the Move to Chat route', () => {
  beforeEach(async () => {
    d1 = memoryD1();
    for (const f of ['db/google.sql', 'db/admin-home.sql', 'db/mail.sql', 'db/mail-cache.sql', 'db/favor-chat.sql', 'db/favor-chat2.sql', 'db/favor-chat-private.sql']) d1.exec(read(f));
    d1.exec("CREATE TABLE IF NOT EXISTS hub_users (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', picture TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'staff', blocked INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')");
    for (const [e, n, r] of [['ada@favorintl.org', 'Ada Admin', 'admin'], ['bo@favorintl.org', 'Bo Builder', 'staff'], ['cy@favorintl.org', 'Cy Writer', 'staff'], ['maya@example.org', 'Maya', 'staff']]) d1.db.prepare('INSERT INTO hub_users (email, name, role) VALUES (?, ?, ?)').run(e, n, r);
    d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('mail.enabled', 'staff', 't', 'n'), ('chat.enabled', 'group', 't', 'n'), ('chat.access', ?, 't', 'n')").run(JSON.stringify({ emails: ['bo@favorintl.org', 'cy@favorintl.org'], teams: [] }));
    d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('early_access', ?, 't', 'n')").run(JSON.stringify({ emails: ['bo@favorintl.org', 'cy@favorintl.org'], teams: [] }));
    env = { DB: d1, GOOGLE_TOKEN_KEY: 'ab'.repeat(32), GOOGLE_CLIENT_SECRET: 'x', GOOGLE_TOKEN_URL: 'https://oauth.test/token' };
    await d1.prepare('INSERT OR REPLACE INTO hub_google (email, refresh_enc, scopes, connected_at) VALUES (?, ?, ?, ?)').bind(ADA.email, await google.seal(env, 'refresh'), MODIFY, '2026-10-11T12:00:00.000Z').run();
    globalThis.fetch = async (url) => (String(url) === 'https://oauth.test/token' ? new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 }) : new Response('{}', { status: 404 }));
    sent = [];
    pending = [];
    forgetCount(ADA.email);
  });

  it('flags a staff-only thread when everyone may use Chat, and nothing else', async () => {
    const t = await call(ADA, 'GET', 'threads/teamaaaa');
    assert.equal(t.data.teamChat.ok, true);
    assert.deepEqual(t.data.teamChat.people.map((p) => p.email).sort(), ['ada@favorintl.org', 'bo@favorintl.org', 'cy@favorintl.org']);
    assert.equal((await call(ADA, 'GET', 'threads/mixedaaa')).data.teamChat.ok, false);
    d1.db.prepare("UPDATE hub_settings SET value = ? WHERE key = 'chat.access'").run(JSON.stringify({ emails: ['bo@favorintl.org'], teams: [] }));
    d1.db.prepare("INSERT OR REPLACE INTO hub_settings (key, value, updated_by, updated_at) VALUES ('early_access', ?, 't', 'n')").run(JSON.stringify({ emails: ['bo@favorintl.org'], teams: [] }));
    assert.equal((await call(ADA, 'GET', 'threads/teamaaaa')).data.teamChat.ok, false, 'Cy is not in the Chat group');
    d1.db.prepare("UPDATE hub_settings SET value = 'off' WHERE key = 'chat.enabled'").run();
    assert.equal((await call(ADA, 'GET', 'threads/teamaaaa')).data.teamChat.ok, false, 'Chat is off');
  });

  it('refuses on the server when the thread is not staff only, even if the page asks', async () => {
    const r = await call(ADA, 'POST', 'threads/mixedaaa/to-chat', { note: false });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'not_team');
    d1.db.prepare("UPDATE hub_users SET blocked = 1 WHERE email = 'cy@favorintl.org'").run();
    assert.equal((await call(ADA, 'POST', 'threads/teamaaaa/to-chat', {})).status, 403);
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM chat_channels WHERE kind IN ('dm', 'group')").get().n, 0);
  });

  it('opens a group with exactly those people, posts the history, pins it and remembers', async () => {
    const r = await call(ADA, 'POST', 'threads/teamaaaa/to-chat', { note: false });
    assert.equal(r.status, 200);
    assert.equal(r.data.pinned, true);
    assert.match(r.data.link, /\/chat\/\?c=dm_/);
    const members = d1.db.prepare('SELECT email FROM chat_members WHERE channel_id = ? ORDER BY email').all(r.data.channel).map((x) => x.email);
    assert.deepEqual(members, ['ada@favorintl.org', 'bo@favorintl.org', 'cy@favorintl.org']);
    const m = d1.db.prepare('SELECT * FROM chat_messages WHERE channel_id = ?').all(r.data.channel);
    assert.equal(m.length, 1);
    assert.match(m[0].body, /^Moved from email: Team plan\n\nBo Builder, .*: Draft plan is ready\.\n\nAda Admin, .*: Thanks, adding Cy\.$/);
    assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM chat_pins WHERE message_id = ?').get(m[0].id).n, 1);
    assert.equal(sent.length, 0, 'no note unless asked');
    const again = await call(ADA, 'POST', 'threads/teamaaaa/to-chat', {});
    assert.equal(again.data.already, true);
    assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get().n, 1);
    const t = await call(ADA, 'GET', 'threads/teamaaaa');
    assert.equal(t.data.teamChat.state, 'moved');
    assert.equal(t.data.teamChat.link, r.data.link);
  });

  it('sends the note into the thread only when asked', async () => {
    const r = await call(ADA, 'POST', 'threads/teamaaaa/to-chat', { note: true });
    assert.equal(r.data.noted, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].threadId, 'teamaaaa');
    assert.match(sent[0].raw, /I moved this conversation to FavorOS Chat:/);
    assert.match(sent[0].raw, /To: .*bo@favorintl\.org/);
  });

  it('can send the note after the move, and refuses it before', async () => {
    assert.equal((await call(ADA, 'POST', 'threads/teamaaaa/to-chat/note', {})).status, 409);
    await call(ADA, 'POST', 'threads/teamaaaa/to-chat', {});
    assert.equal((await call(ADA, 'POST', 'threads/teamaaaa/to-chat/note', {})).data.noted, true);
    assert.equal(sent.length, 1);
  });

  it('remembers a dismissed suggestion per thread', async () => {
    assert.equal((await call(ADA, 'GET', 'threads/teamaaaa')).data.teamChat.state, '');
    await call(ADA, 'POST', 'threads/teamaaaa/to-chat/dismiss', {});
    assert.equal((await call(ADA, 'GET', 'threads/teamaaaa')).data.teamChat.state, 'dismissed');
    assert.equal((await call(ADA, 'GET', 'threads/teamaaaa')).data.teamChat.ok, true);
  });
});

describe('the test users sample mailbox', () => {
  const T1 = { email: 'tester@favorintl.org', name: 'FavorOS Tester', picture: '', role: 'admin', via: 'google', kpi: true };
  beforeEach(() => {
    d1 = memoryD1();
    for (const f of ['db/google.sql', 'db/admin-home.sql', 'db/mail.sql', 'db/mail-cache.sql', 'db/favor-chat.sql', 'db/favor-chat2.sql', 'db/favor-chat-private.sql']) d1.exec(read(f));
    d1.exec("CREATE TABLE IF NOT EXISTS hub_users (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', picture TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'staff', blocked INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')");
    for (const [e, n] of [['tester@favorintl.org', 'FavorOS Tester'], ['tester2@favorintl.org', 'FavorOS Tester Two'], ['bo@favorintl.org', 'Bo Builder']]) d1.db.prepare("INSERT INTO hub_users (email, name, role) VALUES (?, ?, 'admin')").run(e, n);
    d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('mail.enabled', 'group', 't', 'n'), ('mail.access', ?, 't', 'n'), ('chat.enabled', 'group', 't', 'n')").run(JSON.stringify({ emails: ['tester@favorintl.org'], teams: [] }));
    d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('early_access', ?, 't', 'n')").run(JSON.stringify({ emails: ['tester@favorintl.org'], teams: [] }));
    env = { DB: d1 };
    pending = [];
  });
  const callSample = async (method, path, body) => {
    const init = { method, headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' } };
    if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
    const res = await handle({ request: new Request('https://dash.favorintl.org/api/mail/' + path, init), env, user: T1, path: path.split('/').filter(Boolean), waitUntil: (p) => pending.push(p) });
    await Promise.allSettled(pending.splice(0));
    return { status: res.status, data: await res.json() };
  };

  it('has a conversation between the two testers that can move to Chat, and a reply joins it', async () => {
    const t = await callSample('GET', 'threads/smp013');
    assert.equal(t.data.teamChat.ok, true);
    assert.equal(t.data.thread.messages.length, 3);
    const moved = await callSample('POST', 'threads/smp013/to-chat', { note: true });
    assert.equal(moved.status, 200);
    assert.equal(moved.data.noted, true);
    const after = await callSample('GET', 'threads/smp013');
    assert.equal(after.data.thread.messages.length, 4, 'the note joins the thread');
    assert.match(after.data.thread.messages[3].text || after.data.thread.messages[3].html, /moved this conversation to FavorOS Chat/);
    assert.equal(after.data.teamChat.state, 'moved');
    assert.deepEqual(d1.db.prepare("SELECT email FROM chat_members WHERE channel_id = ? ORDER BY email").all(moved.data.channel).map((x) => x.email), ['tester2@favorintl.org', 'tester@favorintl.org']);
  });

  it('does not offer a test conversation to a thread that includes a real person', async () => {
    const t = await callSample('GET', 'threads/smp003');
    assert.equal(t.data.teamChat.ok, false);
  });
});
