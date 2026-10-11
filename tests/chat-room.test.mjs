// The favor-chat Worker's room rules: who is online, and who an event goes to. The Durable Object itself holds no data and is
// not run here; these are the pure rules it uses.
import assert from 'node:assert/strict';
import test from 'node:test';

const { isStale, pickTargets, presenceChanges, presenceOf, STALE_MS } = await import('../workers/favor-chat/src/room.js');

test('presence: online beats away, two tabs make one person, a gone person is absent', () => {
  assert.deepEqual(presenceOf([{ email: 'a@x.org', state: 'away' }, { email: 'a@x.org', state: 'online' }, { email: 'b@x.org', state: 'away' }]), { 'a@x.org': 'online', 'b@x.org': 'away' });
  assert.deepEqual(presenceOf([]), {});
  assert.deepEqual(presenceOf([{ email: '', state: 'online' }, null]), {});
});

test('presence changes name only the people whose state moved', () => {
  const before = { 'a@x.org': 'online', 'b@x.org': 'away' };
  const after = { 'a@x.org': 'online', 'b@x.org': 'online', 'c@x.org': 'away' };
  assert.deepEqual(presenceChanges(before, after), [{ user_id: 'b@x.org', presence: 'online' }, { user_id: 'c@x.org', presence: 'away' }]);
  assert.deepEqual(presenceChanges({ 'a@x.org': 'online' }, {}), [{ user_id: 'a@x.org', presence: 'off' }]);
  assert.deepEqual(presenceChanges(after, after), []);
});

test('an event goes only to the audience, ignoring case, and to everyone for "all"', () => {
  const s = [{ email: 'a@x.org' }, { email: 'b@x.org' }, { email: 'b@x.org' }, { email: 'c@x.org' }];
  assert.equal(pickTargets(s, ['B@x.org']).length, 2);
  assert.equal(pickTargets(s, []).length, 0);
  assert.equal(pickTargets(s, 'all').length, 4);
  assert.equal(pickTargets(s, undefined).length, 0);
});

test('the worker config binds ChatRoom, has no public address, and the Pages project binds it by script name', async () => {
  const fs = await import('node:fs');
  const w = fs.readFileSync('workers/favor-chat/wrangler.toml', 'utf8');
  assert.match(w, /class_name = "ChatRoom"/);
  assert.match(w, /workers_dev = false/);
  assert.doesNotMatch(w, /\[\[d1_databases\]\]/, 'the room never touches a database');
  const hub = fs.readFileSync('wrangler.toml', 'utf8');
  assert.match(hub, /name = "CHAT_ROOM"\r?\nclass_name = "ChatRoom"\r?\nscript_name = "favor-chat"/);
});

test('a socket with no ping, message or connect for 75 seconds is stale; a recent one is not', () => {
  const now = 1_000_000;
  assert.equal(STALE_MS, 75_000);
  assert.equal(isStale([now - 10_000, NaN, now - 200_000], now), false);
  assert.equal(isStale([NaN, NaN, now - 80_000], now), true);
  assert.equal(isStale([NaN, now - 5_000, now - 300_000], now), false);
  assert.equal(isStale([], now), true);
});
