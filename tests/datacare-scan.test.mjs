// Data care scan and queue against a stand-in Blackbaud copy and hub database. Invented partners only; nothing touches Blackbaud.
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { runScan, easternDay } = await import('../functions/_lib/datacare/scan.ts');
const { summary, listFlags, listPairs, decidePair, queue, done, careFor } = await import('../functions/_lib/datacare/service.ts');

const MIRROR = `
CREATE TABLE constituents (id TEXT, constituent_lookup_id TEXT, constituent_type TEXT, first_name TEXT, last_name TEXT, organization_name TEXT, primary_address_id TEXT, spouse_id TEXT, inactive INTEGER DEFAULT 0, deceased INTEGER DEFAULT 0, no_valid_address INTEGER DEFAULT 0, date_added TEXT);
CREATE TABLE gifts (id TEXT, constituent_record_id TEXT, gift_amount REAL, gift_date TEXT);
CREATE TABLE addresses (id TEXT, constituent_record_id TEXT, address_lines TEXT, address_postal_code TEXT, formatted_address TEXT, is_primary INTEGER DEFAULT 1, do_not_mail INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0);
CREATE TABLE emails (id TEXT, constituent_record_id TEXT, email_address TEXT, is_primary INTEGER DEFAULT 1, is_inactive INTEGER DEFAULT 0);
CREATE TABLE constituent_relationships (constituent_id TEXT, relation_id TEXT, is_spouse INTEGER);
`;

const day = easternDay();
const recent = day.slice(0, 4) + '-01-15';

function build() {
  const mirror = new DatabaseSync(':memory:');
  mirror.exec(MIRROR);
  const c = mirror.prepare('INSERT INTO constituents (id, constituent_lookup_id, constituent_type, first_name, last_name, organization_name, primary_address_id, no_valid_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const g = mirror.prepare('INSERT INTO gifts VALUES (?, ?, ?, ?)');
  const a = mirror.prepare('INSERT INTO addresses (id, constituent_record_id, address_lines, address_postal_code, formatted_address, do_not_mail) VALUES (?, ?, ?, ?, ?, ?)');
  const e = mirror.prepare('INSERT INTO emails (id, constituent_record_id, email_address) VALUES (?, ?, ?)');
  // 1: gave, address marked Do not mail. 2: gave, address with no street. 3: gave, good address. 4: gave long ago.
  c.run('1', '101', 'Individual', 'Ada', 'Okafor', null, 'a1', 1);
  c.run('2', '102', 'Organization', null, null, 'Reed Foundation', 'a2', 1);
  c.run('3', '103', 'Individual', 'Bo', 'Reed', null, 'a3', 0);
  c.run('4', '104', 'Individual', 'Cy', 'Long', null, 'a4', 1);
  a.run('a1', '1', '12 Elm Street', '30301', '12 Elm Street\r\nAtlanta, GA  30301', 1);
  a.run('a2', '2', '', '', '', 0);
  a.run('a3', '3', '9 Oak Road', '30301', '9 Oak Road\r\nAtlanta, GA  30301', 0);
  a.run('a4', '4', '', '', '', 0);
  g.run('g1', '1', 100, recent);
  g.run('g2', '1', 50, recent);
  g.run('g3', '2', 2500, recent);
  g.run('g4', '3', 40, recent);
  g.run('g5', '4', 40, '2019-02-02');
  // Two records for one person on one email, and a couple on one email who are linked as spouses.
  c.run('10', '110', 'Individual', 'Gilford', 'Rogers', null, 'a10', 0);
  c.run('11', '111', 'Individual', 'Gil', 'Rogers', null, 'a11', 0);
  c.run('12', '112', 'Individual', 'Chris', 'Lema', null, 'a12', 0);
  c.run('13', '113', 'Individual', 'Melissa', 'Lema', null, 'a13', 0);
  c.run('14', '114', 'Individual', 'Ann', 'Young', null, 'a14', 0);
  c.run('15', '115', 'Individual', 'Ben', 'Hall', null, 'a15', 0);
  for (const [id, zip] of [['10', '30301'], ['11', '30301'], ['12', '30302'], ['13', '30302'], ['14', '30303'], ['15', '99999']]) a.run('a' + id, id, '1 Main', zip, '1 Main', 0);
  e.run('e10', '10', 'gil@example.org');
  e.run('e11', '11', 'GIL@example.org');
  e.run('e12', '12', 'lemas@example.org');
  e.run('e13', '13', 'lemas@example.org');
  e.run('e14', '14', 'office@church.example');
  e.run('e15', '15', 'office@church.example');
  mirror.prepare('INSERT INTO constituent_relationships VALUES (?, ?, 1)').run('12', '13');
  return mirror;
}

let mirror;
let realFetch;
let env;
beforeEach(() => {
  mirror = build();
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const { sql, params } = JSON.parse(init.body);
    return new Response(JSON.stringify(mirror.prepare(sql).all(...params)), { status: 200 });
  };
  const hub = memoryD1();
  hub.exec(readFileSync(new URL('../db/datacare.sql', import.meta.url), 'utf8'));
  env = { DB: hub, MIRROR_API_KEY: 'k', MIRROR_QUERY_URL: 'https://mirror.test/q' };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('the no-address list', () => {
  it('flags partners who gave this year and have no mailable address, with the reason', async () => {
    const s = await runScan(env);
    assert.equal(s.open, 2);
    assert.equal(s.gave, 2650);
    const { rows } = await listFlags(env, { state: 'open', offset: 0, limit: 20, search: '' });
    assert.deepEqual(rows.map((r) => [r.lookup, r.why, r.gave]), [['102', 'no_street', 2500], ['101', 'dnm', 150]]);
    assert.equal((await careFor(env, '1')).noAddress.why, 'dnm');
    assert.equal((await careFor(env, '3')).noAddress, null);
  });

  it('tags a partner fixed when an address appears, and keeps the date', async () => {
    await runScan(env);
    mirror.prepare("UPDATE addresses SET do_not_mail = 0 WHERE id = 'a1'").run();
    mirror.prepare("UPDATE constituents SET no_valid_address = 0 WHERE id = '1'").run();
    const s = await runScan(env);
    assert.equal(s.open, 1);
    assert.equal(s.fixedNow, 1);
    const { rows } = await listFlags(env, { state: 'fixed', offset: 0, limit: 20, search: '' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].lookup, '101');
    assert.equal(rows[0].fixedHow, 'Address now on file');
    assert.ok(rows[0].fixedAt);
    assert.equal((await summary(env)).noAddress.fixed, 1);
  });

  it('ends a flag when the record is marked deceased', async () => {
    await runScan(env);
    mirror.prepare("UPDATE constituents SET deceased = 1 WHERE id = '2'").run();
    await runScan(env);
    const { rows } = await listFlags(env, { state: 'fixed', offset: 0, limit: 20, search: '' });
    assert.equal(rows[0].fixedHow, 'Record marked deceased');
  });
});

describe('the duplicate list', () => {
  it('lists the same person twice, leaves out linked spouses and strangers on an office inbox', async () => {
    const s = await runScan(env);
    assert.equal(s.review, 1);
    const [p] = await listPairs(env, 'review');
    assert.equal(p.id, '10-11');
    assert.equal(p.a.name, 'Gilford Rogers');
    assert.match(p.why, /names match/);
  });

  it('keeps Not the same through a rebuild', async () => {
    await runScan(env);
    const who = { email: 'someone@favorintl.org', name: 'Someone', admin: true, agent: false };
    await decidePair(env, who, '10-11', { action: 'not_same' });
    await runScan(env);
    assert.equal((await listPairs(env, 'review')).length, 0);
    assert.equal((await listPairs(env, 'not_same')).length, 1);
    await decidePair(env, who, '10-11', { action: 'undo' });
    assert.equal((await listPairs(env, 'review')).length, 1);
  });
});

describe('the merge queue', () => {
  const who = { email: 'someone@favorintl.org', name: 'Someone', admin: true, agent: false };
  it('queues the choice, hands the runner the source and the target, and records the result', async () => {
    await runScan(env);
    await decidePair(env, who, '10-11', { action: 'merge', keep: 'b', picks: { name: 'other', contact: 'keep' } });
    const q = await queue(env);
    assert.equal(q.length, 1);
    assert.deepEqual([q[0].keepId, q[0].sourceId, q[0].keepLookup, q[0].sourceLookup], ['11', '10', '111', '110']);
    assert.equal(q[0].picks.name, 'other');
    await done(env, '10-11', true, 'Merged 110 into 111');
    assert.equal((await queue(env)).length, 0);
    assert.equal((await listPairs(env, 'done'))[0].state, 'merged');
    // A scan after the merge does not bring the pair back to review.
    await runScan(env);
    assert.equal((await listPairs(env, 'review')).length, 0);
  });

  it('refuses a merge from a test account and never queues it', async () => {
    await runScan(env);
    await assert.rejects(() => decidePair(env, { ...who, email: 'tester@favorintl.org' }, '10-11', { action: 'merge', keep: 'a' }), /test user/);
    assert.equal((await queue(env)).length, 0);
  });

  it('turns away a second decision on a pair already queued', async () => {
    await runScan(env);
    await decidePair(env, who, '10-11', { action: 'merge', keep: 'a' });
    await assert.rejects(() => decidePair(env, who, '10-11', { action: 'merge', keep: 'b' }), /not waiting/);
    await assert.rejects(() => decidePair(env, who, '10-11', { action: 'not_same' }), /already merged or waiting/);
  });
});

describe('name check', () => {
  it('lists a record whose name is not a person, apart from the address list', async () => {
    const { flagNameCheck } = await import('../functions/_lib/datacare/service.ts');
    await runScan(env);
    await flagNameCheck(env, { cid: '36742', lookup: '22919', name: 'Matthew 6:3' });
    const { rows } = await listFlags(env, { state: 'name', offset: 0, limit: 20, search: '' });
    assert.deepEqual(rows.map((r) => [r.lookup, r.why]), [['22919', 'name']]);
    assert.equal((await summary(env)).nameCheck, 1);
    assert.equal((await summary(env)).noAddress.open, 2);
    await runScan(env);
    assert.equal((await listFlags(env, { state: 'name', offset: 0, limit: 20, search: '' })).rows.length, 1);
  });
});
