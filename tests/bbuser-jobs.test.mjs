// Run with: npm test
//
// Blackbaud user requests (add, change access, deactivate): saved by an admin, claimed one at a time by the desktop automation, reported
// back as checked, done or failed. A real SQLite copy of the hub tables stands in for D1. Made-up people only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const bj = await import('../functions/_lib/work/bbuser-jobs.ts');
const bu = await import('../functions/_lib/work/bbusers.ts');
const read = (f) => readFileSync(new URL(`../db/${f}`, import.meta.url), 'utf8');

let db, env;
const admin = { actor: 'Test Admin', email: 'admin@example.org' };

function fakeD1(d) {
  const stmt = (sql, args = []) => ({
    args,
    sql,
    bind: (...a) => stmt(sql, a),
    first: async () => d.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: d.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(d.prepare(sql).run(...args).changes) } }),
  });
  return { prepare: (sql) => stmt(sql) };
}
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: 'u' + i, name: `User ${i}`, email: `user${i}@example.org`, active: i !== 7, admin: [], access: { renxt: 'User' } }));

beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  db.exec(read('work.sql'));
  db.exec(read('admin-home.sql'));
  db.exec(read('bbusers-jobs.sql'));
  env = { DB: fakeD1(db) };
  await bu.saveUsers(env, { users: people(10), reported: 10 });
});

const add = (over = {}) => ({ kind: 'add', email: 'new.person@example.org', first: 'New', last: 'Person', preset: 'normal', ...over });

describe('Blackbaud user requests', () => {
  it('saves an add with the normal user set spelled out, and writes the audit log', async () => {
    const j = await bj.createJob(env, admin, add());
    assert.equal(j.state, 'queued');
    const p = JSON.parse(j.payload);
    assert.deepEqual(p.access.roles, { fundraising: 'View Only', analysis: 'View Only', marketing: 'View Only' });
    assert.deepEqual(p.access.groups, ['Query', 'View Only Everything']);
    assert.equal(p.access.solutionAdmin, false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hub_audit WHERE area = 'bbusers'").get().n, 1);
  });

  it('refuses a bad name, a bad email, an unknown role or group, and an empty grant', async () => {
    await assert.rejects(() => bj.createJob(env, admin, add({ first: '' })), /first and last name/);
    await assert.rejects(() => bj.createJob(env, admin, add({ email: 'nope' })), /email address/);
    await assert.rejects(() => bj.createJob(env, admin, add({ preset: undefined, access: { roles: { fundraising: 'God mode' } } })), /no role called/);
    await assert.rejects(() => bj.createJob(env, admin, add({ preset: undefined, access: { roles: {}, groups: ['Everything'] } })), /not a database view security group/);
    await assert.rejects(() => bj.createJob(env, admin, add({ preset: undefined, access: { roles: {}, groups: [] } })), /at least one role/);
    await assert.rejects(() => bj.createJob(env, admin, add({ preset: 'boss' })), /Normal user or Solution admin/);
  });

  it('accepts a solution admin and a custom set, matching names in any case', async () => {
    const a = await bj.createJob(env, admin, add({ preset: 'solution_admin' }));
    assert.equal(JSON.parse(a.payload).access.solutionAdmin, true);
    const b = await bj.createJob(env, admin, add({ email: 'two@example.org', preset: undefined, access: { roles: { events: 'update' }, groups: ['query', 'Export'] } }));
    assert.deepEqual(JSON.parse(b.payload).access, { solutionAdmin: false, roles: { events: 'Update' }, groups: ['Query', 'Export'] });
  });

  it('refuses an add for a listed email, active or not, and a change for an unlisted or inactive one', async () => {
    await assert.rejects(() => bj.createJob(env, admin, add({ email: 'USER1@example.org' })), /already has a Blackbaud login/);
    await assert.rejects(() => bj.createJob(env, admin, add({ email: 'user7@example.org' })), /inactive Blackbaud login/);
    await assert.rejects(() => bj.createJob(env, admin, { kind: 'deactivate', email: 'ghost@example.org' }), /No Blackbaud login has that email/);
    await assert.rejects(() => bj.createJob(env, admin, { kind: 'deactivate', email: 'user7@example.org' }), /already inactive/);
  });

  it('never lets an admin change their own login, and holds one open request per person and kind', async () => {
    await bu.saveUsers(env, { users: people(9).concat([{ id: 'me', name: 'Me', email: 'admin@example.org', active: true, access: { renxt: 'Admin' } }]), reported: 10 });
    await assert.rejects(() => bj.createJob(env, admin, { kind: 'deactivate', email: 'ADMIN@example.org' }), /another admin/);
    await bj.createJob(env, admin, { kind: 'deactivate', email: 'user2@example.org' });
    await assert.rejects(() => bj.createJob(env, admin, { kind: 'deactivate', email: 'user2@example.org' }), /already an open request/);
    const ok = await bj.createJob(env, admin, { kind: 'access', email: 'user2@example.org', preset: 'normal' });
    assert.equal(ok.kind, 'access');
  });

  it('hands out the oldest request, one at a time, and the report ends it', async () => {
    const a = await bj.createJob(env, admin, { kind: 'deactivate', email: 'user1@example.org' });
    db.prepare('UPDATE bb_user_jobs SET requested_at = ? WHERE id = ?').run('2026-10-11T10:00:00.000Z', a.id);
    const b = await bj.createJob(env, admin, { kind: 'deactivate', email: 'user2@example.org' });
    const first = await bj.claimJob(env);
    assert.equal(first.id, a.id);
    assert.equal(first.state, 'running');
    assert.equal(await bj.claimJob(env), null, 'nothing goes out while one runs');
    const done = await bj.reportJob(env, admin, { id: a.id, state: 'done', result: 'Read back: inactive.' });
    assert.equal(done.id, a.id);
    const second = await bj.claimJob(env);
    assert.equal(second.id, b.id);
    await assert.rejects(() => bj.reportJob(env, admin, { id: a.id, state: 'done' }), /not running/);
    await assert.rejects(() => bj.reportJob(env, admin, { id: b.id, state: 'maybe' }), /checked, done or failed/);
  });

  it('a checked request waits for a run that may apply, and only that run takes it back', async () => {
    const a = await bj.createJob(env, admin, add());
    await bj.claimJob(env);
    await bj.reportJob(env, admin, { id: a.id, state: 'checked', result: 'Stopped before Send invitation. Nothing changed.' });
    assert.equal(await bj.claimJob(env), null);
    const again = await bj.claimJob(env, { takeChecked: true });
    assert.equal(again.id, a.id);
    assert.equal(again.attempts, 2);
  });

  it('cancels only a request the desktop has not started', async () => {
    const a = await bj.createJob(env, admin, add());
    await bj.cancelJob(env, admin, a.id);
    assert.equal(db.prepare('SELECT state FROM bb_user_jobs WHERE id = ?').get(a.id).state, 'cancelled');
    await assert.rejects(() => bj.cancelJob(env, admin, a.id), /finished/);
    const b = await bj.createJob(env, admin, add({ email: 'b@example.org' }));
    await bj.claimJob(env);
    await assert.rejects(() => bj.cancelJob(env, admin, b.id), /running it now/);
    await assert.rejects(() => bj.cancelJob(env, admin, 'nope'), /No such request/);
  });

  it('hands a stalled request back, and fails it after three tries', async () => {
    const a = await bj.createJob(env, admin, add());
    for (let i = 1; i <= 3; i++) {
      const got = await bj.claimJob(env);
      assert.equal(got.id, a.id);
      assert.equal(got.attempts, i);
      db.prepare("UPDATE bb_user_jobs SET claimed_at = '2026-10-11T00:00:00.000Z' WHERE id = ?").run(a.id);
    }
    assert.equal(await bj.claimJob(env), null);
    const row = db.prepare('SELECT state, result FROM bb_user_jobs WHERE id = ?').get(a.id);
    assert.equal(row.state, 'failed');
    assert.match(row.result, /three times/);
  });

  it('lists newest first with plain status words', async () => {
    await bj.createJob(env, admin, add());
    const list = await bj.listJobs(env);
    assert.equal(list.length, 1);
    assert.equal(bj.statusWords(list[0].state), 'Waiting for the desktop');
  });
});
