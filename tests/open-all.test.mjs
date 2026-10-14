// 2026-10-14: features opened to staff, meetings that default to invited, quiet hours and gift notices in Chat.
// In-memory D1 and made-up people only; nothing reaches the live database, a phone or an inbox.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { ADMIN, ADMIN2, STAFF, world } from './support/chat-world.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const { route } = await import('../functions/_lib/meetroute.ts');
const quiet = await import('../functions/_lib/quiet.ts');
const gifts = await import('../functions/_lib/chat/gifts.ts');
const { parseMentions } = await import('../functions/_lib/chat/text.ts');
const { mayJoin } = await import('../functions/_lib/meet.ts');

async function meet(w, user, method, path, body) {
  const request = new Request(`https://hub.test/api/meet/${path}`, {
    method,
    headers: { 'X-Hub-Email': user.email, 'X-Hub-Name': user.name, 'X-Hub-Role': user.role, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await route({ request, env: { ...w.env, MEET_FAKE_SFU: '1', MEET_RELEASE: 'staff' }, params: { path: path.split('?')[0].split('/') }, waitUntil: () => {} });
  return { status: res.status, data: await res.json() };
}
const ids = (r) => (r.data.meetings || r.data.items || []).map((m) => m.id);

test('a meeting made without a choice is invited-only, and a staff member lists and joins only their own', async () => {
  const w = world();
  const instant = await meet(w, ADMIN, 'POST', 'meetings', { title: 'Instant' });
  assert.equal(instant.status, 200, JSON.stringify(instant.data));
  const iid = instant.data.meeting.id;
  assert.equal(w.d1.db.prepare('SELECT access FROM hub_meetings WHERE id = ?').get(iid).access, 'invited');
  const later = await meet(w, ADMIN, 'POST', 'meetings', { title: 'Later', startsAt: new Date(Date.now() + 86400000).toISOString(), calendar: false });
  const lid = later.data.meeting.id;
  assert.notEqual(w.d1.db.prepare('SELECT access FROM hub_meetings WHERE id = ?').get(lid).access, 'staff');
  const mine = await meet(w, ADMIN, 'POST', 'meetings', { title: 'With Dee', startsAt: new Date(Date.now() + 86400000).toISOString(), calendar: false, invitees: [{ email: STAFF.email, name: STAFF.name }] });
  const open = await meet(w, ADMIN2, 'POST', 'meetings', { title: 'All hands', access: 'staff', startsAt: new Date(Date.now() + 86400000).toISOString(), calendar: false });

  const up = await meet(w, STAFF, 'GET', 'meetings?scope=upcoming');
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const seen = ids(up);
  assert.ok(seen.includes(mine.data.meeting.id), 'her own invitation shows');
  for (const other of [iid, lid, open.data.meeting.id]) assert.ok(!seen.includes(other), 'nobody else’s meeting is listed');
  const notes = await meet(w, STAFF, 'GET', 'meetings?scope=recent');
  assert.deepEqual(ids(notes), []);

  const row = (id) => w.d1.db.prepare('SELECT * FROM hub_meetings WHERE id = ?').get(id);
  assert.equal(mayJoin(row(iid), STAFF), false, 'an uninvited staff member cannot join an instant meeting');
  assert.equal(mayJoin({ ...row(lid), access: 'guests' }, STAFF), false, 'a guest link never opens the room to uninvited staff');
  assert.equal(mayJoin(row(open.data.meeting.id), STAFF), true, 'a meeting the host opened to all staff stays open');
});

test('quiet hours: 8 PM to 7 AM local by default, weekends optional, off when turned off', () => {
  const p = { ...quiet.QUIET_DEFAULT, tz: 'America/New_York' };
  assert.equal(quiet.inQuiet(p, new Date('2026-10-14T01:30:00Z')), true, '9:30 PM Eastern');
  assert.equal(quiet.inQuiet(p, new Date('2026-10-14T10:59:00Z')), true, '6:59 AM Eastern');
  assert.equal(quiet.inQuiet(p, new Date('2026-10-14T11:00:00Z')), false, '7 AM Eastern');
  assert.equal(quiet.inQuiet({ ...p, tz: 'America/Los_Angeles' }, new Date('2026-10-14T01:30:00Z')), false, '6:30 PM Pacific');
  assert.equal(quiet.inQuiet({ ...p, on: false }, new Date('2026-10-14T01:30:00Z')), false);
  assert.equal(quiet.inQuiet({ ...p, weekends: true }, new Date('2026-10-17T16:00:00Z')), true, 'Saturday noon');
  assert.equal(quiet.inQuiet(p, new Date('2026-10-17T16:00:00Z')), false);
});

test('a push in quiet hours is held, then one summary email and one push go out when quiet hours end; admins’ @here is urgent', async () => {
  const w = world();
  w.d1.exec(read('db/quiet-hours.sql'));
  const { pushToPeople } = await import('../functions/_lib/push.ts');
  const env = { ...w.env, VAPID_JWK: '{}' };
  const night = new Date('2026-10-14T02:00:00Z');
  assert.equal(await pushToPeople(env, [STAFF.email], { title: 'Ada Admin', body: 'hello', url: '/chat/' }, fetch, { now: night, messageId: 7 }), 0);
  assert.equal(w.d1.db.prepare('SELECT COUNT(*) AS n FROM hub_quiet_held WHERE email = ? AND sent_at IS NULL').get(STAFF.email).n, 1);
  const mail = [];
  const push = [];
  const deps = { sendMail: async (to, m) => (mail.push({ to, ...m }), true), push: async (to, p) => (push.push({ to, ...p }), 1) };
  assert.equal((await quiet.deliverHeld(env, deps, night)).people, 0, 'nothing goes out while still quiet');
  await quiet.deliverHeld(env, deps, new Date('2026-10-14T11:05:00Z'));
  assert.equal(mail.length, 1);
  assert.equal(push.length, 1);
  assert.match(mail[0].subject, /quiet hours/);
  await quiet.deliverHeld(env, deps, new Date('2026-10-14T11:10:00Z'));
  assert.equal(mail.length, 1, 'the summary goes once');
  // A person who turned quiet hours off is never held.
  await quiet.saveQuiet(env, STAFF.email, { on: false });
  assert.deepEqual([...(await quiet.quietNow(env, [STAFF.email], night))], []);
  assert.equal(parseMentions('<@here> server down').here, true);
  assert.equal(parseMentions('<@channel> hi').here, false);
});

test('gift notices: a gift of $5,000 or more posts once to the channel with partner, amount, fund, credit and date', async () => {
  const w = world();
  w.d1.exec(read('db/gift-notices.sql'));
  w.d1.db.prepare(`INSERT INTO chat_channels (id, kind, name, topic, created_by, created_at, last_at) VALUES ('ch_test_gifts', 'private', 'test-gifts', '', ?, ?, ?)`).run(ADMIN.email, '2026-10-14T12:00:00Z', '2026-10-14T12:00:00Z');
  const q = async (sql) => {
    if (sql.includes('FROM gifts')) return [{ id: '900001', cid: '555', amount: 7500, gdate: '2026-10-14', splits: '[{"fund_id":"79"}]', credits: '[{"constituent_id":"31646"}]' }];
    if (sql.includes('FROM constituents')) return [{ id: '555', name: 'Pat Example' }];
    if (sql.includes('FROM funds')) return [{ id: '79', name: 'Where Needed Most' }];
    if (sql.includes('FROM fundraisers')) return [{ id: '31646', name: 'Sam Sample' }];
    return [];
  };
  const now = new Date('2026-10-14T15:00:00Z');
  const r = await gifts.runGiftNotices(w.env, { q, channelId: 'ch_test_gifts', now });
  assert.equal(r.posted, 1);
  const body = w.d1.db.prepare(`SELECT body, email FROM chat_messages WHERE channel_id = 'ch_test_gifts'`).get();
  assert.equal(body.email, 'gifts');
  for (const bit of ['$7,500', '<~p:555|Pat Example>', 'Where Needed Most', 'Sam Sample', 'Oct 14, 2026']) assert.ok(body.body.includes(bit), bit);
  assert.ok(!/donor/i.test(body.body));
  assert.equal((await gifts.runGiftNotices(w.env, { q, channelId: 'ch_test_gifts', now })).posted, 0, 'deduped by gift id');
  const members = await gifts.giftMembers(w.env);
  for (const e of gifts.GIFT_LEADERS) assert.ok(members.includes(e));
});
