// Ring huddles, the recording default and the recording guard, through the real Chat and Meetings routes on an in-memory D1 with a
// fake SFU and a fake chat room. Made-up people only; the live database is never touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';
import { ADMIN, ADMIN2, ADMIN3, call, world } from './support/chat-world.mjs';

const { route } = await import('../functions/_lib/meetroute.ts');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

function ringWorld(opts) {
  const w = world(opts);
  w.d1.exec(read('db/meetings-ring.sql'));
  w.d1.exec(read('db/quiet-hours.sql'));
  w.d1.exec(read('db/cron-runs.sql'));
  // Quiet hours default to 8 PM to 7 AM Eastern, so a test that rings someone would fail at night. Every test person starts with them off;
  // the quiet-hours test turns them on for one person.
  for (const email of [ADMIN.email, ADMIN2.email, ADMIN3.email, 'tester@favorintl.org', 'tester2@favorintl.org']) w.d1.db.prepare(`INSERT INTO hub_quiet (email, on_quiet, start_min, end_min, weekends, tz, updated_at) VALUES (?, 0, 1200, 420, 0, 'America/New_York', '2026-10-14')`).run(email);
  return w;
}

async function meet(w, user, method, path, body) {
  const pending = [];
  const request = new Request(`https://hub.test/api/meet/${path}`, {
    method,
    headers: { 'X-Hub-Email': user.email, 'X-Hub-Name': user.name, 'X-Hub-Role': user.role, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await route({ request, env: { ...w.env, MEET_FAKE_SFU: '1' }, params: { path: path.split('?')[0].split('/') }, waitUntil: (p) => pending.push(p) });
  await Promise.allSettled(pending);
  return { status: res.status, data: await res.json() };
}

const sent = (w, type, to) => w.events.filter((e) => e.event.type === type && (!to || e.audience.includes(to.email)));
const dmBetween = (w, a, b) => w.d1.db.prepare(`SELECT c.id FROM chat_channels c WHERE c.kind = 'dm' AND EXISTS (SELECT 1 FROM chat_members m WHERE m.channel_id = c.id AND m.email = ?) AND EXISTS (SELECT 1 FROM chat_members m WHERE m.channel_id = c.id AND m.email = ?)`).get(a.email, b.email);
const lastMsg = (w, ch) => ({ ...w.d1.db.prepare('SELECT email, body FROM chat_messages WHERE channel_id = ? ORDER BY id DESC LIMIT 1').get(ch) });

test('Huddle on a person rings them on every tab, Join stops the ring everywhere and tells the caller', async () => {
  const w = ringWorld();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  w.events.length = 0;
  const r = await call(w, ADMIN, 'POST', 'ring', { to: [ADMIN2.email] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.url, /^\/meet\/room\/\?m=[0-9a-f]{24}$/);
  assert.equal(r.data.rings.length, 1);
  assert.equal(r.data.rings[0].state, 'ringing');
  const ring = sent(w, 'ring', ADMIN2).at(-1).event.ring;
  assert.equal(ring.fromName, 'Ada Admin');
  assert.ok(ring.left > 25000 && ring.left <= 30000, 'rings for 30 seconds');
  const mt = w.d1.db.prepare('SELECT access, rec_mode, invitees FROM hub_meetings WHERE id = ?').get(r.data.id);
  assert.equal(mt.access, 'invited', 'a huddle room is invited only');
  assert.equal(mt.rec_mode, 'video', 'no saved default records video');
  assert.ok(JSON.parse(mt.invitees).some((i) => i.email === ADMIN2.email));
  // A page that opens mid-ring sees it.
  assert.equal((await call(w, ADMIN2, 'GET', 'ring')).data.rings.length, 1);
  // Only the person rung answers.
  assert.equal((await call(w, ADMIN3, 'POST', `ring/${ring.id}`, { action: 'join' })).status, 404);
  w.events.length = 0;
  const j = await call(w, ADMIN2, 'POST', `ring/${ring.id}`, { action: 'join' });
  assert.equal(j.data.state, 'joined');
  assert.equal(sent(w, 'ring_end', ADMIN2).length, 1, 'every tab of the person rung stops ringing');
  assert.equal(sent(w, 'ring_state', ADMIN).at(-1).event.state, 'joined');
  assert.equal((await call(w, ADMIN2, 'GET', 'ring')).data.rings.length, 0);
  // The caller's room sees the answer in its sync.
  const a = await meet(w, ADMIN, 'POST', `meetings/${r.data.id}/join`, { name: 'Ada Admin' });
  const s = await meet(w, ADMIN, 'POST', `meetings/${r.data.id}/sync`, { pid: a.data.pid, since: 0, me: {} });
  assert.equal(s.data.rings[0].state, 'joined');
});

test('Decline with a message posts it in the direct message; no answer leaves a missed huddle note', async () => {
  const w = ringWorld();
  for (const u of [ADMIN, ADMIN2, ADMIN3]) await call(w, u, 'GET', 'boot');
  const r = await call(w, ADMIN, 'POST', 'ring', { to: [ADMIN2.email, ADMIN3.email] });
  assert.equal(r.data.rings.length, 2, 'a group huddle rings everyone');
  const toBo = r.data.rings.find((x) => x.to === ADMIN2.email).id;
  const toCy = r.data.rings.find((x) => x.to === ADMIN3.email).id;
  await call(w, ADMIN2, 'POST', `ring/${toBo}`, { action: 'decline', note: 'In a meeting, I will call you after' });
  const dm = dmBetween(w, ADMIN, ADMIN2);
  assert.deepEqual(lastMsg(w, dm.id), { email: ADMIN2.email, body: 'In a meeting, I will call you after' });
  // Too early for a timeout.
  assert.equal((await call(w, ADMIN, 'POST', `ring/${toCy}`, { action: 'timeout' })).status, 409);
  w.d1.db.prepare('UPDATE hub_meet_rings SET ends_at = ? WHERE id = ?').run(Date.now() - 1, toCy);
  await call(w, ADMIN3, 'GET', 'ring');
  const dm2 = dmBetween(w, ADMIN, ADMIN3);
  assert.deepEqual(lastMsg(w, dm2.id), { email: ADMIN.email, body: 'Missed huddle.' });
  assert.equal(w.d1.db.prepare('SELECT state, why FROM hub_meet_rings WHERE id = ?').get(toCy).state, 'missed');
});

test('quiet hours: no ring, a missed huddle note instead; hanging up stops the ring', async () => {
  const w = ringWorld();
  for (const u of [ADMIN, ADMIN2, ADMIN3]) await call(w, u, 'GET', 'boot');
  // Bo's quiet hours cover the whole day.
  w.d1.db.prepare(`INSERT OR REPLACE INTO hub_quiet (email, on_quiet, start_min, end_min, weekends, tz, updated_at) VALUES (?, 1, 0, 1439, 0, 'America/New_York', '2026-10-14')`).run(ADMIN2.email);
  w.events.length = 0;
  const r = await call(w, ADMIN, 'POST', 'ring', { to: [ADMIN2.email] });
  assert.equal(r.data.rings[0].state, 'missed');
  assert.equal(r.data.rings[0].why, 'quiet');
  assert.equal(sent(w, 'ring', ADMIN2).length, 0, 'nothing rings');
  assert.match(lastMsg(w, dmBetween(w, ADMIN, ADMIN2).id).body, /quiet hours/);
  // Cy is rung, then Ada leaves the room before Cy answers.
  const r2 = await call(w, ADMIN, 'POST', 'ring', { to: [ADMIN3.email] });
  const a = await meet(w, ADMIN, 'POST', `meetings/${r2.data.id}/join`, { name: 'Ada Admin' });
  await meet(w, ADMIN, 'POST', `meetings/${r2.data.id}/leave`, { pid: a.data.pid });
  assert.equal(w.d1.db.prepare('SELECT state FROM hub_meet_rings WHERE id = ?').get(r2.data.rings[0].id).state, 'missed');
});

test('the test accounts ring only each other, and a public channel never rings', async () => {
  const w = ringWorld();
  const T1 = { email: 'tester@favorintl.org', name: 'FavorOS Tester', picture: '', role: 'admin', via: 'tester', kpi: true };
  const T2 = { email: 'tester2@favorintl.org', name: 'FavorOS Tester Two', picture: '', role: 'admin', via: 'tester', kpi: true };
  for (const t of [T1, T2]) w.d1.db.prepare(`INSERT INTO hub_users (email, name, role, created_at, updated_at) VALUES (?, ?, 'admin', 'x', 'x')`).run(t.email, t.name);
  for (const u of [ADMIN, T1, T2]) await call(w, u, 'GET', 'boot');
  assert.equal((await call(w, T1, 'POST', 'ring', { to: [ADMIN.email] })).status, 400, 'a tester cannot ring staff');
  assert.equal((await call(w, ADMIN, 'POST', 'ring', { to: [T1.email] })).status, 400, 'staff cannot ring a tester');
  assert.equal((await call(w, T1, 'POST', 'ring', { to: [T2.email] })).data.rings[0].state, 'ringing');
  assert.equal((await call(w, ADMIN, 'POST', 'ring', { channel: 'ch_general' })).status, 400);
});

test('each person sets a recording default; a host changes it in the call; a restart keeps the earlier pieces', async () => {
  const w = ringWorld();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  assert.equal((await meet(w, ADMIN, 'GET', 'meetings/myrec')).data.rec, 'video');
  assert.equal((await meet(w, ADMIN, 'POST', 'meetings/myrec', { rec: 'bogus' })).status, 400);
  assert.equal((await meet(w, ADMIN, 'POST', 'meetings/myrec', { rec: 'notes' })).data.rec, 'notes');
  const made = await meet(w, ADMIN, 'POST', 'meetings', { title: 'Plan', calendar: false, notify: false });
  assert.equal(made.data.meeting.rec, 'notes', 'a new meeting takes the default');
  const hud = await call(w, ADMIN, 'POST', 'ring', { to: [ADMIN2.email] });
  assert.equal(w.d1.db.prepare('SELECT rec_mode FROM hub_meetings WHERE id = ?').get(hud.data.id).rec_mode, 'notes', 'so does a huddle');
  const id = made.data.meeting.id;
  const a = await meet(w, ADMIN, 'POST', `meetings/${id}/join`, { name: 'Ada Admin' });
  const b = await meet(w, ADMIN2, 'POST', `meetings/${id}/join`, { name: 'Bo Builder' });
  const s1 = await meet(w, ADMIN, 'POST', `meetings/${id}/rec/start?pid=${a.data.pid}`, {});
  assert.equal(s1.data.epoch, 1);
  // Bo is not a host (as staff he is refused).
  assert.ok((await meet(w, { ...ADMIN2, role: 'staff' }, 'POST', `meetings/${id}/recmode`, { rec: 'video', pid: b.data.pid })).status >= 400);
  const ch = await meet(w, ADMIN, 'POST', `meetings/${id}/recmode`, { rec: 'video', pid: a.data.pid });
  assert.equal(ch.data.rec, 'video');
  assert.equal(w.d1.db.prepare('SELECT active FROM hub_meeting_rec WHERE meeting_id = ?').get(id).active, 0, 'the running recording stops');
  assert.ok(w.d1.db.prepare(`SELECT 1 FROM hub_meeting_events WHERE meeting_id = ? AND body LIKE '%rec-mode%'`).get(id), 'the room is told');
  const s2 = await meet(w, ADMIN, 'POST', `meetings/${id}/rec/start?pid=${a.data.pid}`, {});
  assert.equal(s2.data.epoch, 2, 'a new epoch, never epoch 1 again');
  // A second host's browser starting at the same moment stands by.
  w.d1.db.prepare(`UPDATE hub_meeting_presence SET role = 'cohost' WHERE pid = ?`).run(b.data.pid);
  const s3 = await meet(w, ADMIN2, 'POST', `meetings/${id}/rec/start?pid=${b.data.pid}`, {});
  assert.equal(s3.data.already, true);
});

test('a meeting set to record that records nothing raises the alert for the morning email, once', async () => {
  const w = ringWorld();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const id = (await meet(w, ADMIN, 'POST', 'meetings', { title: 'Reporting', calendar: false, notify: false, rec: 'video' })).data.meeting.id;
  const a = await meet(w, ADMIN, 'POST', `meetings/${id}/join`, { name: 'Ada Admin' });
  await meet(w, ADMIN2, 'POST', `meetings/${id}/join`, { name: 'Bo Builder' });
  assert.equal((await meet(w, ADMIN, 'POST', `meetings/${id}/recmiss`, {})).data.missing, false, 'not before 20 seconds');
  w.d1.db.prepare('UPDATE hub_meeting_presence SET joined_at = joined_at - 30000 WHERE meeting_id = ?').run(id);
  assert.equal((await meet(w, ADMIN, 'POST', `meetings/${id}/recmiss`, {})).data.missing, true);
  await meet(w, ADMIN, 'POST', `meetings/${id}/recmiss`, {});
  const row = w.d1.db.prepare(`SELECT * FROM hub_cron_runs WHERE job = 'meet-recording'`).get();
  assert.match(row.last_error, /Reporting .* recorded nothing/);
  assert.equal(row.fails, 1, 'one alert per meeting');
  assert.equal(w.d1.db.prepare(`SELECT COUNT(*) AS n FROM hub_meeting_events WHERE meeting_id = ? AND body LIKE '%rec-missing%'`).get(id).n, 1);
  assert.ok(a.data.pid);
});

test('with no host in the room, the staff member there longest starts the booked recording; a guest never does', async () => {
  const w = ringWorld();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const id = (await meet(w, ADMIN, 'POST', 'meetings', { title: 'Weekly', calendar: false, notify: false, rec: 'video', invitees: [{ email: ADMIN2.email, name: 'Bo' }] })).data.meeting.id;
  const b = await meet(w, ADMIN2, 'POST', `meetings/${id}/join`, { name: 'Bo Builder' });
  assert.equal(b.data.role, 'staff');
  const s = await meet(w, ADMIN2, 'POST', `meetings/${id}/rec/start?pid=${b.data.pid}`, {});
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(s.data.epoch, 1);
  // Once the host is in the room, starting is the hosts' again.
  await meet(w, ADMIN2, 'POST', `meetings/${id}/rec/stop?pid=${b.data.pid}`, {}).catch(() => null);
  await meet(w, ADMIN, 'POST', `meetings/${id}/join`, { name: 'Ada Admin' });
  w.d1.db.prepare('UPDATE hub_meeting_rec SET active = 0 WHERE meeting_id = ?').run(id);
  assert.equal((await meet(w, ADMIN2, 'POST', `meetings/${id}/rec/start?pid=${b.data.pid}`, {})).status, 403);
});
