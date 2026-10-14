// Run with: npm test
//
// Meeting files in Drive are shared by name with the people the notes rule allows (Will, 2026-10-14). Made-up people only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { audienceOf, syncFile } = await import('../functions/_lib/meetacl.ts');

const m = (over = {}) => ({
  host_email: 'host@favorintl.org',
  cohosts: JSON.stringify(['co@favorintl.org']),
  invitees: JSON.stringify([
    { email: 'inv@favorintl.org' },
    { email: 'guest@example.com', guest: true },
    { email: 'outside@gmail.com' },
    { email: 'c_abc@group.calendar.google.com' },
  ]),
  ...over,
});

describe('meeting file audience', () => {
  it('host and admins write; made hosts, staff invitees, attendees and leaders read', () => {
    const a = audienceOf(m(), ['Was@favorintl.org', 'guest:x'], ['lead@favorintl.org'], ['admin@favorintl.org', 'tester@favorintl.org']);
    assert.deepEqual(a.writers.sort(), ['admin@favorintl.org', 'host@favorintl.org']);
    assert.deepEqual(a.readers.sort(), ['co@favorintl.org', 'inv@favorintl.org', 'lead@favorintl.org', 'was@favorintl.org']);
  });
  it('blocked and inactive people get no grant in any role', () => {
    const a = audienceOf(m(), ['gone@favorintl.org', 'was@favorintl.org'], ['lead@favorintl.org'], ['admin@favorintl.org', 'oldadmin@favorintl.org'], ['Gone@favorintl.org', 'inv@favorintl.org', 'oldadmin@favorintl.org']);
    assert.deepEqual(a.writers.sort(), ['admin@favorintl.org', 'host@favorintl.org']);
    assert.deepEqual(a.readers.sort(), ['co@favorintl.org', 'lead@favorintl.org', 'was@favorintl.org']);
  });
  it('a test meeting goes to the admins only', () => {
    const a = audienceOf(m({ host_email: 'tester@favorintl.org' }), ['was@favorintl.org'], ['lead@favorintl.org'], ['admin@favorintl.org']);
    assert.deepEqual(a, { writers: ['admin@favorintl.org'], readers: [] });
  });
});

describe('syncFile', () => {
  it('adds missing people without email, drops strays and link grants, leaves drive grants and the service account', async () => {
    const calls = [];
    const perms = [
      { id: 'd1', type: 'domain', role: 'reader', permissionDetails: [{ inherited: false }] },
      { id: 'm1', type: 'user', role: 'organizer', emailAddress: 'manager@favorintl.org', permissionDetails: [{ inherited: true }] },
      { id: 's1', type: 'user', role: 'writer', emailAddress: 'sa@x.iam.gserviceaccount.com', permissionDetails: [{ inherited: false }] },
      { id: 'u1', type: 'user', role: 'reader', emailAddress: 'stray@favorintl.org', permissionDetails: [{ inherited: false }] },
      { id: 'u2', type: 'user', role: 'reader', emailAddress: 'host@favorintl.org', permissionDetails: [{ inherited: false }] },
    ];
    const fetchFn = async (url, init = {}) => {
      calls.push([init.method || 'GET', url, init.body || '']);
      if ((init.method || 'GET') === 'GET') return new Response(JSON.stringify({ permissions: perms }));
      return new Response('{}');
    };
    const r = await syncFile('t', 'F', { writers: ['host@favorintl.org'], readers: ['inv@favorintl.org'] }, 'sa@x.iam.gserviceaccount.com', fetchFn);
    assert.deepEqual({ added: r.added, changed: r.changed, removed: r.removed, closed: r.closed }, { added: 1, changed: 1, removed: 1, closed: 1 });
    const post = calls.find((c) => c[0] === 'POST');
    assert.match(post[1], /sendNotificationEmail=false/);
    assert.deepEqual(JSON.parse(post[2]), { type: 'user', role: 'reader', emailAddress: 'inv@favorintl.org' });
    assert.ok(!calls.some((c) => c[1].includes('/m1') || c[1].includes('/s1')));
  });
});

describe('syncFile removes people no longer allowed', () => {
  it('deletes a direct grant held by someone barred from the audience', async () => {
    const calls = [];
    const perms = [{ id: 'u9', type: 'user', role: 'reader', emailAddress: 'gone@favorintl.org', permissionDetails: [{ inherited: false }] }];
    const fetchFn = async (url, init = {}) => {
      calls.push([init.method || 'GET', url]);
      return new Response(JSON.stringify({ permissions: perms }));
    };
    const aud = audienceOf(m(), ['gone@favorintl.org'], [], [], ['gone@favorintl.org']);
    const r = await syncFile('t', 'F', aud, 'sa@x.iam.gserviceaccount.com', fetchFn);
    assert.equal(r.removed, 1);
    assert.ok(calls.some((c) => c[0] === 'DELETE' && c[1].includes('/u9')));
  });
});
