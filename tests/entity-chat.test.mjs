// Run with: npm test
//
// Send to Chat: a page or an entity goes into a message as a card the server builds. The sender needs access to what they send, the card keeps
// only a name, one line and an address, and a clip or a meeting keeps its own card. Made-up people, in-memory database.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { ADMIN, ADMIN2, call, world } from './support/chat-world.mjs';

const GEN = 'ch_general';

async function boot() {
  const w = world();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  return w;
}

test('a page is sent as an entity card with its title and a same-site address', async () => {
  const w = await boot();
  const sent = await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: 'Look at this', attachments: [{ type: 'page', url: '/work/', title: 'Work Center' }] });
  assert.equal(sent.status, 200);
  const a = sent.data.message.attachments[0];
  assert.equal(a.type, 'entity');
  assert.equal(a.kind, 'page');
  assert.equal(a.title, 'Work Center');
  assert.equal(a.url, '/work/');
});

test('a page address that leaves the site is dropped', async () => {
  const w = await boot();
  for (const url of ['https://evil.example/x', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)']) {
    const sent = await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: 'x', attachments: [{ type: 'page', url, title: 'Nope' }] });
    assert.deepEqual(sent.data.message.attachments, [], url);
  }
});

test('a colleague is sent as a card with the name from the staff list, not from the client', async () => {
  const w = await boot();
  w.d1.db.prepare("INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, 'Bo Builder', 'Builder', 'Marketing', 1)").run(ADMIN2.email);
  const sent = await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: '', attachments: [{ type: 'entity', kind: 'person', id: ADMIN2.email, title: 'Forged Name', url: 'https://evil.example' }] });
  const a = sent.data.message.attachments[0];
  assert.equal(a.kind, 'person');
  assert.equal(a.title, 'Bo Builder');
  assert.equal(a.url, '', 'a person card has no address');
});

test('an entity the sender cannot read is not attached', async () => {
  const w = await boot();
  const sent = await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: 'x', attachments: [{ type: 'entity', kind: 'task', id: 'ZZ-9999' }, { type: 'entity', kind: 'spaceship', id: '1' }] });
  assert.deepEqual(sent.data.message.attachments, []);
});

test('a clip sent as an entity keeps the clip card', async () => {
  const w = await boot();
  const cid = 'ef'.repeat(16);
  w.d1.db.prepare("INSERT INTO hub_clips (id, owner_email, owner_name, title, status, mime, created_at, updated_at) VALUES (?, ?, 'Ada Admin', 'A clip', 'ready', 'video/webm', ?, ?)").run(cid, ADMIN.email, '2026-10-11T12:00:00.000Z', '2026-10-11T12:00:00.000Z');
  const sent = await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: '', attachments: [{ type: 'entity', kind: 'clip', id: cid }] });
  assert.equal(sent.data.message.attachments[0].type, 'clip');
  assert.equal(sent.data.message.attachments[0].title, 'A clip');
});
