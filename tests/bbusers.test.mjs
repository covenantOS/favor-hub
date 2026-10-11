// Run with: npm test
//
// Blackbaud users, read only: the desktop job's rows are cleaned, kept as one read, and counted. Made-up people only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const bu = await import('../functions/_lib/work/bbusers.ts');
const SCHEMA = readFileSync(new URL('../db/work.sql', import.meta.url), 'utf8');

function env() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const stmt = (sql, args = []) => ({ args, sql, bind: (...a) => stmt(sql, a), first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }) });
  return { DB: { prepare: (sql) => stmt(sql) } };
}
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: 'u' + i, name: 'User ' + i, email: `user${i}@example.org`, active: i % 3 !== 0, admin: i === 1 ? ['Organization'] : [], access: { renxt: i % 2 ? 'Admin' : 'User', bbms: i === 1 ? 'Admin' : '', junk: 'x' } }));

describe('Blackbaud users read', () => {
  it('cleans the rows, drops unknown products and repeats, and counts active users', async () => {
    const e = env();
    const dirty = rows(6).concat([{ id: 'u1', name: 'Repeat', email: 'r@example.org' }, { name: '', email: '' }]);
    const snap = await bu.saveUsers(e, { users: dirty, reported: 6 });
    assert.equal(snap.users.length, 6);
    assert.deepEqual(Object.keys(snap.users[1].access).sort(), ['bbms', 'renxt']);
    const got = await bu.loadUsers(e);
    assert.equal(got.users.length, 6);
    const s = bu.summarize(got.users);
    assert.deepEqual([s.total, s.active, s.inactive], [6, 4, 2]);
  });
  it('refuses a list too short to be the users page, so a failed read never replaces a good one', async () => {
    const e = env();
    await bu.saveUsers(e, { users: rows(8), reported: 8 });
    await assert.rejects(() => bu.saveUsers(e, { users: rows(2), reported: 2 }), (x) => x.status === 400);
    await assert.rejects(() => bu.saveUsers(e, { users: 'nope' }), (x) => x.status === 400);
    assert.equal((await bu.loadUsers(e)).users.length, 8);
  });
  it('nothing read yet is null', async () => {
    assert.equal(await bu.loadUsers(env()), null);
  });
});
