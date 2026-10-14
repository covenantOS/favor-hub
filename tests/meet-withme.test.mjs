// "Someone's with me": people sharing one device count as present, ride on the device's entry for new pages, stay out of the list
// an older page draws, and leave with the device. Real Meetings routes on an in-memory D1 with a fake SFU. Made-up people only.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { ADMIN, ADMIN2, call, world } from './support/chat-world.mjs';

const { route } = await import('../functions/_lib/meetroute.ts');
const drive = await import('../functions/_lib/meetdrive.ts');
const auto = await import('../functions/_lib/meetauto.ts');
const GEN = 'ch_general';

async function meet(w, user, method, path, body) {
  const request = new Request(`https://hub.test/api/meet/${path}`, {
    method,
    headers: { 'X-Hub-Email': user.email, 'X-Hub-Name': user.name, 'X-Hub-Role': user.role, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await route({ request, env: { ...w.env, MEET_FAKE_SFU: '1' }, params: { path: path.split('?')[0].split('/') }, waitUntil: () => undefined });
  return { status: res.status, data: await res.json() };
}

test('a person added on a device counts as present, shows on that device, and leaves with it', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const id = (await call(w, ADMIN, 'POST', `channels/${GEN}/meeting`)).data.id;
  const a = (await meet(w, ADMIN, 'POST', `meetings/${id}/join`, { name: 'Ada Admin', mic: true, cam: false })).data;
  const b = (await meet(w, ADMIN2, 'POST', `meetings/${id}/join`, { name: 'Bo Builder' })).data;

  const r = await meet(w, ADMIN, 'POST', `meetings/${id}/with`, { pid: a.pid, op: 'add', name: 'Cy Visitor' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.with.map((x) => x.name), ['Cy Visitor']);
  assert.equal(r.data.with[0].staff, false, 'a typed name is not a staff login');
  // The same name twice, or the device owner's own name, adds nobody.
  assert.equal((await meet(w, ADMIN, 'POST', `meetings/${id}/with`, { pid: a.pid, op: 'add', name: 'cy visitor' })).data.with.length, 1);
  assert.equal((await meet(w, ADMIN, 'POST', `meetings/${id}/with`, { pid: a.pid, op: 'add', name: 'Ada Admin' })).data.with.length, 1);
  // Someone else's pid is refused.
  assert.notEqual((await meet(w, ADMIN, 'POST', `meetings/${id}/with`, { pid: b.pid, op: 'add', name: 'Zed' })).status, 200);

  const s = (await meet(w, ADMIN2, 'POST', `meetings/${id}/sync`, { pid: b.pid, since: 0, me: { mic: true, cam: false } })).data;
  assert.equal(s.people.length, 2, 'the device list an older page draws has no extra tile');
  const ada = s.people.find((p) => p.pid === a.pid);
  assert.deepEqual(ada.with.map((x) => x.name), ['Cy Visitor']);
  assert.deepEqual(s.people.find((p) => p.pid === b.pid).with, []);
  assert.ok(s.events.some((e) => e.kind === 'notice' && e.body.a === 'with' && e.body.name === 'Cy Visitor'));
  // Counted as present: the huddle counts three, and the lobby list stays one entry per device.
  assert.equal((await call(w, ADMIN2, 'GET', `channels/${GEN}/huddle`)).data.huddle.people.length, 3);
  assert.equal((await meet(w, ADMIN2, 'GET', `meetings/${id}`)).data.people.length, 2);

  // Taken off, then added again and gone when the device leaves.
  const cy = ada.with[0].pid;
  assert.deepEqual((await meet(w, ADMIN, 'POST', `meetings/${id}/with`, { pid: a.pid, op: 'remove', who: cy })).data.with, []);
  await meet(w, ADMIN, 'POST', `meetings/${id}/with`, { pid: a.pid, op: 'add', name: 'Cy Visitor' });
  await meet(w, ADMIN, 'POST', `meetings/${id}/leave`, { pid: a.pid });
  assert.equal(w.d1.db.prepare(`SELECT COUNT(*) AS n FROM hub_meeting_presence WHERE meeting_id = ? AND with_pid != '' AND left_at = 0`).get(id).n, 0);
});

test('a host removing a device removes the people on it; a staff pick keeps its email, so the notes know them', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  w.d1.db.prepare(`INSERT INTO meet_directory (email, name, title, team, active, lead) VALUES ('cy@favorintl.org', 'Cy Staff', 'Staff', 'Care', 1, 0)`).run();
  const id = (await call(w, ADMIN, 'POST', `channels/${GEN}/meeting`)).data.id;
  const a = (await meet(w, ADMIN, 'POST', `meetings/${id}/join`, { name: 'Ada Admin' })).data;
  const b = (await meet(w, ADMIN2, 'POST', `meetings/${id}/join`, { name: 'Bo Builder' })).data;
  const r = await meet(w, ADMIN2, 'POST', `meetings/${id}/with`, { pid: b.pid, op: 'add', email: 'cy@favorintl.org' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.with[0].name, 'Cy Staff');
  assert.equal(r.data.with[0].staff, true);
  assert.equal(w.d1.db.prepare(`SELECT email FROM hub_meeting_presence WHERE meeting_id = ? AND with_pid = ?`).get(id, b.pid).email, 'cy@favorintl.org');
  // A made-up email is a typed name, never a login.
  const z = await meet(w, ADMIN2, 'POST', `meetings/${id}/with`, { pid: b.pid, op: 'add', name: 'Zed', email: 'zed@elsewhere.example' });
  assert.equal(z.data.with.find((x) => x.name === 'Zed').staff, false);
  const started = w.d1.db.prepare('SELECT started_at FROM hub_meetings WHERE id = ?').get(id).started_at;
  const shared = await drive.sharedDevices(w.env, { id, started_at: started });
  assert.deepEqual(shared.map((x) => [x.host, x.name]), [['Bo Builder', 'Cy Staff'], ['Bo Builder', 'Zed']]);
  const rm = await meet(w, ADMIN, 'POST', `meetings/${id}/event`, { pid: a.pid, kind: 'cmd', body: { a: 'remove' }, to: b.pid });
  assert.equal(rm.status, 200, JSON.stringify(rm.data));
  assert.equal(w.d1.db.prepare(`SELECT COUNT(*) AS n FROM hub_meeting_presence WHERE meeting_id = ? AND with_pid = ? AND removed = 0`).get(id, b.pid).n, 0);
});

test('the notes read a shared device as any of its people, and an owner of two names picks nobody', () => {
  const shared = [{ host: 'Crystal Hinton', name: 'Michael Hinton', from: 60, to: null }];
  assert.equal(drive.speakerLabel({ t: 30, who: 'Crystal Hinton', text: 'hi' }, shared), 'Crystal Hinton', 'before he was added');
  assert.equal(drive.speakerLabel({ t: 90, who: 'Crystal Hinton', text: 'hi' }, shared), 'Crystal Hinton or Michael Hinton (one device)');
  assert.equal(drive.speakerLabel({ t: 90, who: 'Crystal Hinton', text: 'hi', fixed: true }, shared), 'Crystal Hinton', 'a line fixed by hand keeps its name');
  assert.equal(drive.speakerLabel({ t: 90, who: 'Bo Builder', text: 'hi' }, shared), 'Bo Builder');
  assert.match(drive.SHARED_RULE(true), /Never guess/);
  assert.equal(drive.SHARED_RULE(false), '');
  const roster = [{ name: 'Crystal Hinton', email: 'c@favorintl.org' }, { name: 'Michael Hinton', email: 'm@favorintl.org' }];
  assert.equal(auto.pickPerson(roster, 'Crystal or Michael'), null);
  assert.equal(auto.pickPerson(roster, 'Michael').email, 'm@favorintl.org');
});
