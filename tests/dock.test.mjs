// The floating dock: the server numbers it reads, and the rules its scripts keep (hidden on Chat, Brain and phones; panel code lazy).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { ADMIN, ADMIN2, STAFF, call, world } from './support/chat-world.mjs';

test('dock numbers: a direct message counts as one to read for the other person and for nobody else', async () => {
  const w = world();
  assert.equal((await call(w, null, 'GET', 'dock')).status, 401);
  assert.equal((await call(w, STAFF, 'GET', 'dock')).status, 403);
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  const dm = (await call(w, ADMIN, 'POST', 'conversations', { members: [ADMIN2.email] })).data.channel.id;
  await call(w, ADMIN, 'POST', `channels/${dm}/messages`, { body: 'Can you look at the Smith file?' });
  const theirs = (await call(w, ADMIN2, 'GET', 'dock')).data;
  assert.equal(theirs.me, ADMIN2.email);
  const row = theirs.channels.find((c) => c.id === dm);
  assert.equal(row.kind, 'dm');
  assert.equal(row.mentions, 1);
  assert.ok(theirs.users[ADMIN.email].name);
  assert.equal((await call(w, ADMIN, 'GET', 'dock')).data.channels.find((c) => c.id === dm).mentions, 0);
  await call(w, ADMIN2, 'POST', `channels/${dm}/read`, { upTo: 999999 });
  assert.equal((await call(w, ADMIN2, 'GET', 'dock')).data.channels.find((c) => c.id === dm).mentions, 0);
});

test('the dock scripts hide on Chat, Brain and phones, and load the panel code on first open', () => {
  const s = fs.readFileSync('public/js/dock.js', 'utf8');
  assert.match(s, /p !== 'chat' && p !== 'brain'/);
  assert.match(s, /min-width: 861px/);
  assert.match(s, /has-chat/);
  assert.match(s, /sessionStorage/);
  assert.match(s, /function loadPanel/);
  assert.doesNotMatch(s, /dock-panel\.js[^']*'\s*\)\s*;?\s*$/m);
  const layout = fs.readFileSync('src/layouts/App.astro', 'utf8');
  assert.match(layout, /\/js\/dock\.js/);
  assert.doesNotMatch(layout, /dock-panel\.js/, 'the panel code is not in the page');
  // Measured with LF line ends: a Windows checkout (CRLF) adds a byte a line and must not fail the cap.
  assert.ok(Buffer.byteLength(s.replace(/\r\n/g, '\n')) < 24000, 'the always-on part stays small');
  assert.match(fs.readFileSync('src/scripts/tours.ts', 'utf8'), /id: 'dock',[\s\S]*?added: '2026-10-12'/);
});
