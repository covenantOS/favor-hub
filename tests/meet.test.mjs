import test from 'node:test';
import assert from 'node:assert/strict';
import './support/resolve-ts.mjs';

const { emailsOf, isHost, mayJoin, ID_RE, PID_RE } = await import('../functions/_lib/meet.ts');

const m = (over = {}) => ({ id: 'a'.repeat(24), status: 'scheduled', access: 'invited', host_email: 'Host@favorintl.org', cohosts: '["co@favorintl.org"]', invitees: '[{"email":"Ann@favorintl.org","name":"Ann"}]', ...over });
const u = (email, role = 'staff') => ({ email, name: email, role });

test('ids are 24 hex, pids 12 hex', () => {
  assert.ok(ID_RE.test('0123456789abcdef01234567'));
  assert.ok(!ID_RE.test('0123456789abcdef0123456'));
  assert.ok(PID_RE.test('0123456789ab'));
});

test('emailsOf reads strings and objects and ignores junk', () => {
  assert.deepEqual(emailsOf('["A@x.org", {"email":"B@x.org"}, 5, {}]'), ['a@x.org', 'b@x.org']);
  assert.deepEqual(emailsOf('not json'), []);
});

test('the host and a made host are hosts, ignoring case', () => {
  assert.ok(isHost(m(), 'host@favorintl.org'));
  assert.ok(isHost(m(), 'CO@favorintl.org'));
  assert.ok(!isHost(m(), 'ann@favorintl.org'));
});

test('an invited meeting opens to invitees, hosts and admins only', () => {
  assert.ok(mayJoin(m(), u('ann@favorintl.org')));
  assert.ok(mayJoin(m(), u('host@favorintl.org')));
  assert.ok(mayJoin(m(), u('will@favorintl.org', 'admin')));
  assert.ok(!mayJoin(m(), u('zed@favorintl.org')));
});

test('a staff meeting opens to any signed-in staff, a cancelled one to nobody', () => {
  assert.ok(mayJoin(m({ access: 'staff' }), u('zed@favorintl.org')));
  assert.ok(!mayJoin(m({ access: 'staff', status: 'cancelled' }), u('zed@favorintl.org', 'admin')));
});

test('a person not on the list is refused with not_invited, never "does not exist"', async () => {
  const { refuseJoin } = await import('../functions/_lib/meet.ts');
  const e = refuseJoin({ status: 'scheduled', host_name: 'Pat Host', host_email: 'pat@favorintl.org' });
  assert.equal(e.status, 403);
  assert.equal(e.code, 'not_invited');
  assert.match(e.message, /Ask Pat Host to add you/);
  assert.equal(refuseJoin({ status: 'cancelled', host_name: '', host_email: 'x@favorintl.org' }).status, 404);
});

test('a moved meeting is open to signed-in staff and has a guest key', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../functions/api/hub/day-move.ts', import.meta.url), 'utf8');
  assert.match(src, /'off', 'guests', \?, 'scheduled'/);
  assert.match(src, /ensureGuestUrl\(env as any, await getMeeting\(env as any, id\)/);
  const { mayJoin } = await import('../functions/_lib/meet.ts');
  assert.ok(mayJoin({ status: 'scheduled', access: 'guests', host_email: 'h@favorintl.org', invitees: '[]', cohosts: '[]' }, { email: 'zed@favorintl.org', role: 'staff' }));
});
