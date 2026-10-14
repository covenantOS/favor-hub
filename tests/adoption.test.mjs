// Run with: npm test
// Adoption tracker: page logging (one write per person, day and area per ten minutes, never for files or API calls) and the admin
// numbers. Made-up people only; the database is an in-memory copy.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

let U, A, db, env;
before(async () => {
  db = memoryD1();
  db.exec(`CREATE TABLE hub_users (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', picture TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'staff', blocked INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', sign_ins INTEGER NOT NULL DEFAULT 0, first_seen TEXT, last_seen TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE hub_sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen TEXT NOT NULL);
    CREATE TABLE hub_auth_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', event TEXT NOT NULL);`);
  db.exec(readFileSync(new URL('../db/adoption.sql', import.meta.url), 'utf8'));
  db.exec(`CREATE TABLE meet_directory (email TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', team TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, lead INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE act_staff (email TEXT, name TEXT, team TEXT, active INTEGER);
    CREATE TABLE mcp_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, email TEXT NOT NULL, tool TEXT NOT NULL);
    CREATE TABLE brain_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, email TEXT NOT NULL, name TEXT, source TEXT NOT NULL DEFAULT 'brain', rating TEXT, comment TEXT, question TEXT, page TEXT, status TEXT NOT NULL DEFAULT 'new');
    CREATE TABLE hub_tasks (id TEXT PRIMARY KEY, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE hub_task_events (id TEXT PRIMARY KEY, actor_email TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE hub_meeting_presence (meeting_id TEXT, pid TEXT, email TEXT, role TEXT, joined_at INTEGER);
    CREATE TABLE act_events (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor_email TEXT NOT NULL, kind TEXT NOT NULL);
    CREATE TABLE ge_event (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, actor TEXT NOT NULL, kind TEXT);`);
  env = { DB: db };
  U = await import('../functions/_lib/hub/usage.ts');
  A = await import('../functions/_lib/admin/adoption.ts');
});

describe('page logging', () => {
  it('names the area from the first path segment and skips files and API calls', () => {
    assert.equal(U.usageArea('GET', '/'), 'today');
    assert.equal(U.usageArea('GET', '/work/gifts/'), 'work');
    assert.equal(U.usageArea('GET', '/Brain'), 'brain');
    assert.equal(U.usageArea('GET', '/api/tasks'), '');
    assert.equal(U.usageArea('GET', '/images/logo.png'), '');
    assert.equal(U.usageArea('POST', '/work/'), '');
    assert.equal(U.usageArea('GET', '/login/'), '');
  });

  it('writes once per ten minutes and adds to the day', async () => {
    U.resetUsageGuard();
    const pending = [];
    const ctx = { env, waitUntil: (p) => pending.push(p) };
    const user = { email: 'Ada@favorintl.org', via: 'google' };
    U.noteUse(ctx, user, 'GET', '/work/');
    U.noteUse(ctx, user, 'GET', '/work/gifts/');
    U.noteUse(ctx, user, 'GET', '/brain/');
    U.noteUse(ctx, { email: 'x@favorintl.org', via: 'agent' }, 'GET', '/work/');
    await Promise.all(pending);
    assert.equal(pending.length, 2);
    const rows = db.db.prepare('SELECT email, area, n FROM hub_usage ORDER BY area').all();
    assert.deepEqual(rows.map((r) => [r.email, r.area, r.n]), [['ada@favorintl.org', 'brain', 1], ['ada@favorintl.org', 'work', 1]]);
    assert.ok(U.shouldWrite('ada@favorintl.org', U.easternDay(), 'work', Date.now() + 11 * 60 * 1000));
    await U.writeUse(env, 'ada@favorintl.org', U.easternDay(), 'work', new Date().toISOString());
    assert.equal(db.db.prepare("SELECT n FROM hub_usage WHERE area = 'work'").get().n, 2);
  });

  it('a failed write never throws into the request', () => {
    U.resetUsageGuard();
    const bad = { DB: { prepare: () => { throw new Error('no such table: hub_usage'); } } };
    assert.doesNotThrow(() => U.noteUse({ env: bad, waitUntil: () => {} }, { email: 'a@favorintl.org', via: 'google' }, 'GET', '/work/'));
  });
});

describe('admin numbers', () => {
  it('keeps each compound SELECT within what D1 allows', () => {
    for (const q of A.traceDaysSql('-4 hours')) assert.ok(q.split(' UNION ').length <= 4);
  });

  it('counts people, leaves out testers, blocked accounts and the admin, and lists who never signed in', async () => {
    const now = new Date();
    db.exec('DELETE FROM hub_usage');
    const iso = (d) => new Date(now.getTime() - d * 86400000).toISOString();
    const dirRow = (e, n, t) => db.exec(`INSERT INTO meet_directory (email, name, team, active) VALUES ('${e}', '${n}', '${t}', 1)`);
    dirRow('will@favorintl.org', 'Will', 'Marketing');
    dirRow('ada@favorintl.org', 'Ada', 'Support Team');
    dirRow('bo@favorintl.org', 'Bo', 'Support Team');
    dirRow('cy@favorintl.org', 'Cy', 'Grants');
    dirRow('di@favorintl.org', 'Di', 'Grants');
    const user = (e, blocked, signs, seen) => db.exec(`INSERT INTO hub_users (email, name, blocked, sign_ins, first_seen, last_seen, created_at, updated_at) VALUES ('${e}', '', ${blocked}, ${signs}, ${seen ? `'${seen}'` : 'NULL'}, ${seen ? `'${seen}'` : 'NULL'}, 'x', 'x')`);
    user('will@favorintl.org', 0, 5, iso(0));
    user('ada@favorintl.org', 0, 3, iso(1));
    user('bo@favorintl.org', 0, 1, iso(20));
    user('di@favorintl.org', 1, 0, null);
    user('tester@favorintl.org', 0, 9, iso(0));
    db.exec(`INSERT INTO mcp_audit (at, email, tool) VALUES ('${iso(2)}', 'ada@favorintl.org', 'ask'), ('${iso(3)}', 'ada@favorintl.org', 'ask')`);
    db.exec(`INSERT INTO brain_feedback (at, email, name, rating, comment, question) VALUES ('${iso(2)}', 'ada@favorintl.org', 'Ada', 'up', 'Good', 'Who gave?'), ('${iso(2)}', 'tester@favorintl.org', 'T', 'up', '', '')`);
    db.exec(`INSERT INTO ge_event (at, actor, kind) VALUES ('${iso(1)}', 'Ada', 'photo_added')`);
    db.exec(`INSERT INTO hub_usage (email, day, area, n, first_at, last_at) VALUES ('ada@favorintl.org', '${A.dayMinus(U.easternDay(now), 1)}', 'work', 4, '${iso(1)}', '${iso(1)}')`);
    const o = await A.overview(env, 'will@favorintl.org', now);
    assert.equal(o.summary.withAccount, 3, 'ada, bo, cy; not will, not blocked di');
    assert.equal(o.summary.signedInEver, 2);
    assert.equal(o.summary.neverSignedIn, 1);
    assert.deepEqual(o.never.map((p) => p.email), ['cy@favorintl.org']);
    assert.equal(o.summary.active7, 1);
    assert.equal(o.summary.active30, 2);
    assert.equal(o.weekly.length, 8);
    const ada = o.people.find((p) => p.email === 'ada@favorintl.org');
    assert.equal(ada.brain, 2);
    assert.equal(ada.feedback, 1);
    assert.equal(ada.gifts, 1);
    assert.deepEqual(ada.areas, [{ area: 'work', n: 4 }]);
    assert.ok(ada.activeDays30 >= 2);
    assert.equal(o.people.find((p) => p.email === 'will@favorintl.org').you, true);
    assert.equal(o.people.some((p) => /tester/.test(p.email)), false);
    assert.equal(o.feedback.length, 1);
    const log = await A.personLog(env, 'ada@favorintl.org', now);
    assert.ok(log.days.length >= 2 && log.feedback.length === 1);
  });
});
