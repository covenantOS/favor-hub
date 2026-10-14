// Meetings a FavorOS Tester hosts: seen by the test accounts and privacy probes alone, admins included, and always invited only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';
const { mayJoin, mayReadNotes, testMeetingHidden } = await import('../functions/_lib/meet.ts');

const m = (o) => ({ id: 'm1', title: 'MR-TEST', host_email: 'tester@favorintl.org', cohosts: '[]', invitees: '[]', access: 'staff', status: 'scheduled', ...o });
const admin = { email: 'will@favorintl.org', role: 'admin' };
const lead = { email: 'danny@favorintl.org', role: 'staff' };

test('a tester-hosted meeting is hidden from staff, team leads and admins', () => {
  const meet = m({});
  assert.equal(mayJoin(meet, admin), false);
  assert.equal(mayJoin(meet, lead), false);
  assert.equal(mayReadNotes({ ...meet, status: 'ended' }, lead, new Set(['tester@favorintl.org'])), false);
  assert.equal(mayReadNotes({ ...meet, status: 'ended' }, admin, new Set()), false);
  assert.equal(testMeetingHidden(meet, 'will@favorintl.org'), true);
});

test('testers and privacy probes still see it; staff meetings by real hosts are unchanged', () => {
  assert.equal(mayJoin(m({}), { email: 'tester2@favorintl.org', role: 'staff' }), true);
  assert.equal(testMeetingHidden(m({}), 'privacy-probe@favorintl.org'), false);
  assert.equal(mayJoin(m({ host_email: 'megan@favorintl.org' }), lead), true);
});

test('the database keeps a tester-hosted meeting invited only, on insert and on edit', () => {
  const d1 = memoryD1();
  d1.exec('CREATE TABLE hub_meetings (id TEXT PRIMARY KEY, host_email TEXT, access TEXT)');
  d1.exec(readFileSync(new URL('../db/meet-test-hosts.sql', import.meta.url), 'utf8'));
  d1.exec("INSERT INTO hub_meetings VALUES ('a', 'tester@favorintl.org', 'staff'), ('b', 'megan@favorintl.org', 'staff'), ('c0ffee01', 'tester@favorintl.org', 'staff')");
  d1.exec("UPDATE hub_meetings SET access = 'guests' WHERE id = 'a'");
  const rows = Object.fromEntries(d1.db.prepare('SELECT id, access FROM hub_meetings').all().map((r) => [r.id, r.access]));
  assert.deepEqual(rows, { a: 'invited', b: 'staff', c0ffee01: 'staff' });
});
