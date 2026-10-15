// Access groups (functions/_lib/access.ts): Chat, Mail and Learn open to chosen people and teams. Made-up people only.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { ADMIN, ADMIN2, STAFF, call, world } from './support/chat-world.mjs';
import { learnWorld, call as learnCall, GRANTS, HR } from './support/learn-world.mjs';

const access = await import('../functions/_lib/access.ts');
const { mayUseMail } = await import('../functions/_lib/mail/route.ts');
const { changeSetting } = await import('../functions/_lib/admin/settings.ts');
const { learnAccess } = await import('../functions/_lib/learn/today.ts');

const NOW = '2026-10-14T12:00:00.000Z';
const OTHER = { email: 'eli@favorintl.org', name: 'Eli Other', picture: '', role: 'staff', via: 'google', kpi: true };
const set = (w, key, value) => w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES (?, ?, 'test', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, NOW);

function chatWorld(access) {
  const w = world({ mode: 'group' });
  w.d1.db.prepare('INSERT INTO hub_users (email, name, picture, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(OTHER.email, OTHER.name, '', 'staff', NOW, NOW);
  for (const [u, team] of [[STAFF, 'Operations'], [OTHER, 'Grants'], [ADMIN, 'Leadership']]) {
    w.d1.db.prepare('INSERT OR REPLACE INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, 1)').run(u.email, u.name, 'Staff', team);
  }
  set(w, 'chat.access', JSON.stringify(access));
  set(w, 'early_access', JSON.stringify(access));
  return w;
}

test('the stored list reads leniently and saves strictly', () => {
  assert.deepEqual(access.parseAccess('not json'), { emails: [], teams: [] });
  assert.deepEqual(access.parseAccess('{"emails":["B@favorintl.org","a@favorintl.org","a@favorintl.org","nope"],"teams":["Ops","Ops"]}'), { emails: ['a@favorintl.org', 'b@favorintl.org'], teams: ['Ops'] });
  assert.equal(access.cleanAccess('{"emails":["nope"]}').ok, false);
  assert.equal(access.cleanAccess('garbage').ok, false);
  assert.equal(access.cleanAccess('').value, '{"emails":[],"teams":[]}');
  assert.equal(access.cleanAccess({ emails: ['A@favorintl.org'], teams: [' Grants '] }).value, '{"emails":["a@favorintl.org"],"teams":["Grants"]}');
});

test('the old values still work: admins, staff and off', () => {
  assert.equal(access.allowedBy('admins', null, ADMIN), true);
  assert.equal(access.allowedBy('admins', null, STAFF), false);
  assert.equal(access.allowedBy('staff', null, STAFF), true);
  assert.equal(access.allowedBy('off', null, ADMIN), false);
  assert.equal(access.allowedBy('group', new Set(), ADMIN), true, 'admins always keep it');
  assert.equal(access.allowedBy('group', new Set([STAFF.email]), STAFF), true);
  assert.equal(access.allowedBy('group', new Set(), STAFF), false);
  assert.equal(access.allowedBy('group', new Set([STAFF.email]), { ...STAFF, via: 'agent' }), false);
  assert.equal(access.allowedBy('group', new Set(), { ...STAFF, email: 'privacy-probe@favorintl.org' }), true, 'the privacy check personas');
});

test('Chat in group mode: a named person and a named team get in, everyone else gets a 403', async () => {
  const w = chatWorld({ emails: [STAFF.email], teams: ['Grants'] });
  assert.equal((await call(w, STAFF, 'GET', 'boot')).status, 200, 'named by email');
  assert.equal((await call(w, OTHER, 'GET', 'boot')).status, 200, 'in the Grants team');
  assert.equal((await call(w, ADMIN2, 'GET', 'boot')).status, 200, 'admin');
  set(w, 'chat.access', JSON.stringify({ emails: [], teams: ['Operations'] }));
  set(w, 'early_access', JSON.stringify({ emails: [], teams: ['Operations'] }));
  assert.equal((await call(w, OTHER, 'GET', 'boot')).status, 403);
  assert.equal((await call(w, OTHER, 'GET', 'dock')).status, 403);
  assert.equal((await call(w, OTHER, 'GET', 'inbox')).status, 403);
  assert.equal((await call(w, OTHER, 'GET', 'search?q=hi')).status, 403);
  assert.equal((await call(w, OTHER, 'POST', 'conversations', { members: [ADMIN.email] })).status, 403);
  assert.equal((await call(w, STAFF, 'GET', 'boot')).status, 200, 'the Operations team');
});

test('people outside Chat are not in the pickers, cannot be added to a conversation, and are not notified', async () => {
  const w = chatWorld({ emails: [STAFF.email], teams: [] });
  const boot = (await call(w, ADMIN, 'GET', 'boot')).data;
  assert.ok(boot.users[STAFF.email], 'a member is in the picker');
  assert.equal(boot.users[OTHER.email], undefined, 'an outsider is not');
  // A direct message to an outsider drops them: the conversation is with the sender alone.
  const dm = await call(w, ADMIN, 'POST', 'conversations', { members: [OTHER.email] });
  assert.deepEqual(dm.data.channel.members.sort(), [ADMIN.email]);
  // A group with a member and an outsider keeps only the member.
  const grp = await call(w, ADMIN, 'POST', 'conversations', { members: [STAFF.email, OTHER.email] });
  assert.deepEqual(grp.data.channel.members.sort(), [ADMIN.email, STAFF.email].sort());
  // A person who lost access earlier stays a member of an old channel, hears nothing, and their rows stay stored.
  w.d1.db.prepare("INSERT INTO chat_members (channel_id, email, role, joined_at) VALUES ('ch_general', ?, 'member', ?)").run(OTHER.email, NOW);
  await call(w, ADMIN, 'GET', 'boot');
  const sent = await call(w, ADMIN, 'POST', 'channels/ch_general/messages', { body: `hello <@${OTHER.email}> and <@${STAFF.email}>` });
  assert.equal(sent.status, 200);
  const told = w.d1.db.prepare('SELECT email FROM chat_mentions WHERE message_id = ?').all(sent.data.message.id).map((r) => r.email);
  assert.ok(!told.includes(OTHER.email), 'the outsider has no bell entry');
  assert.equal(w.d1.db.prepare('SELECT COUNT(*) AS n FROM chat_members WHERE email = ?').get(OTHER.email).n >= 1, true, 'their membership is not deleted');
});

test('Chat email and push skip people outside the group', async () => {
  const w = chatWorld({ emails: [STAFF.email], teams: [] });
  assert.deepEqual(await access.allowedAmong(w.env, 'chat', [STAFF.email, OTHER.email, ADMIN.email]), [STAFF.email, ADMIN.email]);
  assert.deepEqual(await access.allowedAmong(w.env, 'mail', [STAFF.email, ADMIN.email]), [ADMIN.email], 'mail is still admins only');
  set(w, 'chat.enabled', 'staff');
  assert.equal((await access.allowedAmong(w.env, 'chat', [OTHER.email])).length, 1);
});

test('Mail in group mode', async () => {
  const members = new Set([STAFF.email]);
  assert.equal(mayUseMail('group', STAFF, members), true);
  assert.equal(mayUseMail('group', OTHER, members), false);
  assert.equal(mayUseMail('group', ADMIN, members), true);
  assert.equal(mayUseMail('group', { ...STAFF, via: 'script' }, members), false);
  assert.equal(mayUseMail('staff', OTHER), true);
});

test('Learn in group mode: only the group and admins, assigned courses included', async () => {
  const w = learnWorld({ learn: 'group' });
  set(w, 'learn.access', JSON.stringify({ emails: [], teams: ['Grants'] }));
  assert.equal((await learnAccess(w.env, GRANTS)).learn, true, 'the Grants team');
  assert.equal((await learnAccess(w.env, HR)).learn, false, 'HR in Operations is outside the group');
  const r = await learnCall(w, HR, 'GET', 'home');
  assert.equal(r.status, 403);
  assert.equal((await learnCall(w, GRANTS, 'GET', 'home')).status, 200);
  // An assignment to someone outside the group makes no Projects task and no notice.
  assert.deepEqual(await access.allowedAmong(w.env, 'learn', [HR.email, GRANTS.email]), [GRANTS.email]);
});

test('Learn keeps reaching assigned people when the mode is still admins', async () => {
  const w = learnWorld({ learn: 'admins' });
  assert.deepEqual(await access.keepAllowed(w.env, 'learn', [HR.email, GRANTS.email]), [HR.email, GRANTS.email]);
  set(w, 'learn.enabled', 'group');
  set(w, 'learn.access', JSON.stringify({ emails: [GRANTS.email], teams: [] }));
  assert.deepEqual(await access.keepAllowed(w.env, 'learn', [HR.email, GRANTS.email]), [GRANTS.email]);
});

test('saving a list goes through the settings registry and is audited', async () => {
  const w = chatWorld({ emails: [], teams: [] });
  const v = await changeSetting(w.env, ADMIN.email, 'chat.access', { emails: ['A@favorintl.org'], teams: ['Grants'] });
  assert.equal(v.value, '{"emails":["a@favorintl.org"],"teams":["Grants"]}');
  await assert.rejects(changeSetting(w.env, ADMIN.email, 'chat.access', '{"emails":["nope"]}'));
  const g = await changeSetting(w.env, ADMIN.email, 'mail.enabled', 'group');
  assert.equal(g.value, 'group');
  await assert.rejects(changeSetting(w.env, ADMIN.email, 'learn.enabled', 'everyone'));
});
