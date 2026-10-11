// Huddles and meeting presence through the real Meetings and Chat routes on an in-memory D1 with a fake SFU: who counts as in the
// room, an iPhone going to the background, the last person leaving, and a huddle whose people all vanished without Leave.
// Made-up people only; the live database is never touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { ADMIN, ADMIN2, call, world } from './support/chat-world.mjs';

const { route } = await import('../functions/_lib/meetroute.ts');
const GEN = 'ch_general';

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

const huddleNews = (w) => w.events.filter((e) => e.event.type === 'huddle').map((e) => e.event.huddle);

test('a huddle counts people by heartbeat, an iPhone in the background drops out, and the last Leave ends it', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const id = (await call(w, ADMIN, 'POST', `channels/${GEN}/meeting`)).data.id;
  w.events.length = 0;
  const a = await meet(w, ADMIN, 'POST', `meetings/${id}/join`, { name: 'Ada Admin', mic: true, cam: false });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(huddleNews(w).at(-1).people.length, 1, 'joining tells the channel');
  const b = await meet(w, ADMIN2, 'POST', `meetings/${id}/join`, { name: 'Bo Builder' });
  assert.equal(huddleNews(w).at(-1).people.length, 2);
  const seen = await meet(w, ADMIN2, 'GET', `meetings/${id}`);
  assert.deepEqual(seen.data.people.map((p) => p.pid).sort(), [a.data.pid, b.data.pid].sort(), 'the meeting lists who is in the room with their pid');

  // Ada's iPhone goes to the background: she is out of the count at once, and the room stays open for Bo.
  await meet(w, ADMIN, 'POST', `meetings/${id}/leave`, { pid: a.data.pid, away: true });
  assert.equal((await call(w, ADMIN2, 'GET', `channels/${GEN}/huddle`)).data.huddle.people.length, 1);
  // She comes back: her next heartbeat puts her back in.
  await meet(w, ADMIN, 'POST', `meetings/${id}/sync`, { pid: a.data.pid, since: 0, me: { mic: true, cam: false } });
  assert.equal((await call(w, ADMIN2, 'GET', `channels/${GEN}/huddle`)).data.huddle.people.length, 2);

  // Both leave (the page sends Leave twice on close, once from pagehide and once from beforeunload): the huddle ends once.
  await meet(w, ADMIN, 'POST', `meetings/${id}/leave`, { pid: a.data.pid });
  await meet(w, ADMIN, 'POST', `meetings/${id}/leave`, { pid: a.data.pid });
  assert.equal(w.d1.db.prepare(`SELECT COUNT(*) AS n FROM hub_meeting_events WHERE meeting_id = ? AND body LIKE '%"left"%'`).get(id).n, 1, 'one left notice');
  w.events.length = 0;
  await meet(w, ADMIN2, 'POST', `meetings/${id}/leave`, { pid: b.data.pid });
  assert.equal(w.d1.db.prepare('SELECT status FROM hub_meetings WHERE id = ?').get(id).status, 'ended');
  assert.equal(huddleNews(w).at(-1), null, 'the channel hears the huddle is over');
  assert.equal((await call(w, ADMIN, 'GET', `channels/${GEN}/huddle`)).data.huddle, null);
});

test('everyone closed the tab without Leave: the huddle ends 30 seconds after the last heartbeat, a booked meeting waits 90', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const huddle = (await call(w, ADMIN, 'POST', `channels/${GEN}/meeting`)).data.id;
  await meet(w, ADMIN, 'POST', `meetings/${huddle}/join`, { name: 'Ada Admin' });
  const booked = (await meet(w, ADMIN, 'POST', 'meetings', { title: 'Planning', access: 'staff', rec: 'off' })).data.meeting.id;
  await meet(w, ADMIN, 'POST', `meetings/${booked}/join`, { name: 'Ada Admin' });
  const ago = Date.now() - 31_000;
  w.d1.db.prepare('UPDATE hub_meeting_presence SET seen = ?').run(ago);
  // Before anything closes the rows, every count already reads zero.
  const list = (await meet(w, ADMIN, 'GET', 'meetings?scope=upcoming')).data.meetings;
  assert.equal(w.d1.db.prepare('SELECT status FROM hub_meetings WHERE id = ?').get(huddle).status, 'ended', 'the huddle is closed');
  assert.equal(w.d1.db.prepare('SELECT status FROM hub_meetings WHERE id = ?').get(booked).status, 'live', 'the booked meeting waits');
  assert.equal(list.find((m) => m.id === booked).inRoom, 0, 'and reads nobody in the room');
  w.d1.exec((await import('node:fs')).readFileSync(new URL('../db/receipts.sql', import.meta.url), 'utf8'));
  const { navCounts } = await import('../functions/_lib/hub/today.ts');
  const counts = await navCounts(w.env, ADMIN, { meetings: true });
  assert.equal(counts.meetingsNow, 0, 'the Meetings badge counts rooms with someone in them');
});
