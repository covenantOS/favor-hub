// Run with: npm test
//
// The shared entity layer (functions/_lib/hub/entity.ts, functions/api/hub/entity.ts, the Chat entity card). Made-up people, an in-memory database
// and a stand-in for the partner mirror. Checks that every kind applies the reader's access: a partner needs the Work Center, a task needs
// Projects and its project, a meeting needs a seat in it, and a Chat card keeps only the name and the address.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { before, afterEach, describe, it } from 'node:test';
import { learnWorld, WILL, VIDEO, OUTSIDER, NOW } from './support/learn-world.mjs';
import './support/resolve-ts.mjs';

let E;
const realFetch = globalThis.fetch;
const run = (w, sql, ...a) => w.d1.db.prepare(sql).run(...a);
const req = (path, user) => new Request('https://dash.test' + path, { headers: { 'X-Hub-Email': user.email, 'X-Hub-Name': user.name, 'X-Hub-Via': 'google' } });
const access = (over = {}) => ({ admin: false, workCenter: false, chat: true, projects: true, ...over });

function mirrorWith(rows) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_lookup_id TEXT, deceased INTEGER DEFAULT 0, raw_json TEXT, organization_name TEXT, first_name TEXT, last_name TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, constituent_record_id TEXT, gift_amount REAL, gift_date TEXT, gift_type TEXT);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_to_date TEXT);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT, fundraiser_type TEXT, fundraiser_end_date TEXT, fundraiser_active INTEGER);
    CREATE TABLE addresses (id TEXT PRIMARY KEY, constituent_record_id TEXT, address_city TEXT, address_state TEXT, is_inactive INTEGER DEFAULT 0, is_primary INTEGER DEFAULT 1);
    CREATE TABLE funds (id TEXT PRIMARY KEY, fund_description TEXT);
    CREATE TABLE appeals (id TEXT PRIMARY KEY, appeal_id TEXT, appeal_description TEXT, appeal_category TEXT, appeal_start_date TEXT, appeal_inactive INTEGER DEFAULT 0, date_added TEXT);`);
  rows(db);
  globalThis.fetch = async (_url, init) => {
    const { sql, params } = JSON.parse(init.body);
    return new Response(JSON.stringify(db.prepare(sql).all(...(params || []))), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

before(async () => {
  E = await import('../functions/_lib/hub/entity.ts');
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('entity cards apply the reader\'s access', () => {
  it('a colleague card shows title and team, and offers Message only with Chat', async () => {
    const w = learnWorld();
    const a = await E.resolveEntity(w.env, req('/x', WILL), WILL, access(), 'person', VIDEO.email);
    assert.equal(a.title, 'Vic Video');
    assert.deepEqual(a.facts.map((f) => f.k), ['Team', 'Email']);
    assert.ok(a.acts.includes('message'));
    const noChat = await E.resolveEntity(w.env, req('/x', WILL), WILL, access({ chat: false }), 'person', 'Vic Video');
    assert.equal(noChat.id, VIDEO.email, 'found by name too');
    assert.ok(!noChat.acts.includes('message'));
    assert.equal(await E.resolveEntity(w.env, req('/x', WILL), WILL, access(), 'person', 'nobody@favorintl.org'), null);
  });

  it('a partner shows lifetime giving, last gift and holder to the Work Center, and only a name to anyone else', async () => {
    const w = learnWorld();
    mirrorWith((db) => {
      db.prepare("INSERT INTO constituents VALUES ('501', '9001', 0, ?, NULL, 'Pat', 'Giver')").run(JSON.stringify({ name: 'Pat Giver' }));
      db.prepare("INSERT INTO gifts VALUES ('g1', '501', 100, '2025-03-01T00:00:00', 'Donation'), ('g2', '501', 250, '2026-09-01T00:00:00', 'Donation'), ('g3', '501', 999, '2026-09-02T00:00:00', 'Pledge')").run();
      db.prepare("INSERT INTO assignments VALUES ('a1', '501', '77', NULL)").run();
      db.prepare("INSERT INTO fundraisers VALUES ('77', 'Rae', 'Holder', 'x', NULL, 1)").run();
      db.prepare("INSERT INTO addresses VALUES ('d1', '501', 'Tampa', 'FL', 0, 1)").run();
    });
    w.env.MIRROR_API_KEY = 'k';
    w.env.MIRROR_QUERY_URL = 'https://mirror.test/d1/query';
    const p = await E.resolveEntity(w.env, req('/x', WILL), WILL, access({ workCenter: true }), 'partner', '501');
    assert.equal(p.title, 'Pat Giver');
    assert.equal(p.sub, 'Tampa, FL');
    const facts = Object.fromEntries(p.facts.map((f) => [f.k, f.v]));
    assert.equal(facts['Lifetime giving'], '$350 in 2 gifts', 'the pledge is not a gift');
    assert.equal(facts['Last gift'], '$250 on Sep 1, 2026');
    assert.equal(facts['Held by'], 'Rae Holder');
    assert.equal(facts['Lookup ID'], '9001');
    const byLookup = await E.resolveEntity(w.env, req('/x', WILL), WILL, access({ workCenter: true }), 'partner', 'L9001');
    assert.equal(byLookup.id, '501', 'Lookup ID L9001 finds the same partner');
    const locked = await E.resolveEntity(w.env, req('/x', OUTSIDER), OUTSIDER, access({ workCenter: false }), 'partner', '501');
    assert.equal(locked.restricted, true);
    assert.deepEqual(locked.facts, []);
    assert.equal(locked.title, '');
  });

  it('a task shows to someone on it or in its project, and a hidden project stays hidden', async () => {
    const w = learnWorld();
    run(w, "INSERT INTO hub_projects (id, key, name, status, visibility, lead_email, created_by, created_at, updated_at) VALUES ('p1', 'SB', 'Spring Banquet', 'active', 'private', ?, ?, ?, ?)", WILL.email, WILL.email, NOW, NOW);
    run(w, "INSERT INTO hub_tasks (id, project_id, code, title, status, owner_email, due_date, created_by, created_at, updated_at) VALUES ('t1', 'p1', 'SB-0003', 'Book the room', 'open', ?, '2026-10-20', ?, ?, ?)", WILL.email, WILL.email, NOW, NOW);
    run(w, "INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('projects.enabled', 'staff', 't', ?)", NOW);
    const own = await E.resolveEntity(w.env, req('/x', WILL), WILL, access({ admin: true }), 'task', 'sb-0003');
    assert.equal(own.title, 'Book the room');
    assert.equal(own.id, 'SB-0003');
    assert.ok(own.facts.some((f) => f.k === 'Project' && f.v === 'Spring Banquet'));
    assert.ok(own.facts.some((f) => f.k === 'Owner' && f.v === 'Ada Admin'));
    assert.ok(own.url.includes('SB-0003') || own.url.includes('t1'));
    const other = await E.resolveEntity(w.env, req('/x', OUTSIDER), OUTSIDER, access(), 'task', 'SB-0003');
    assert.equal(other, null, 'a private project hides its tasks from people outside it');
    const off = await E.resolveEntity(w.env, req('/x', OUTSIDER), { ...OUTSIDER }, access({ projects: false }), 'task', 'SB-0003');
    assert.equal(off, null);
  });

  it('a request, a meeting and a clip resolve for the people who may open them', async () => {
    const w = learnWorld();
    const rid = 'req_abcdef123456';
    run(w, "INSERT INTO requests (id, title, body, surface, status, submitter_name, submitter_email, source, created_at, updated_at) VALUES (?, 'Hero video', 'x', 'website', 'inbox', 'Asker', 'asker@favorintl.org', 'form', ?, ?)", rid, NOW, NOW);
    const r = await E.resolveEntity(w.env, req('/x', VIDEO), VIDEO, access(), 'request', rid);
    assert.equal(r.title, 'Hero video');
    assert.equal(r.url, '/requests/?r=' + rid);
    const mid = 'ab'.repeat(12);
    run(w, "INSERT INTO hub_meetings (id, title, host_email, host_name, invitees, access, status, notes_status, created_at) VALUES (?, 'Staff sync', ?, 'Ada Admin', ?, 'invited', 'ended', 'ready', ?)", mid, WILL.email, JSON.stringify([{ email: VIDEO.email }]), NOW);
    const m = await E.resolveEntity(w.env, req('/x', VIDEO), VIDEO, access(), 'meeting', mid);
    assert.equal(m.title, 'Staff sync');
    assert.equal(m.url, '/meet/notes/?m=' + mid, 'an ended meeting with notes opens its notes');
    assert.equal(await E.resolveEntity(w.env, req('/x', OUTSIDER), OUTSIDER, access(), 'meeting', mid), null, 'a meeting the person was not invited to');
    const cid = 'cd'.repeat(16);
    run(w, "INSERT INTO hub_clips (id, owner_email, owner_name, title, status, mime, created_at, updated_at, duration_ms) VALUES (?, ?, 'Ada Admin', 'How to enter a gift', 'ready', 'video/webm', ?, ?, 95000)", cid, WILL.email, NOW, NOW);
    const c = await E.resolveEntity(w.env, req('/x', OUTSIDER), OUTSIDER, access(), 'clip', cid);
    assert.equal(c.title, 'How to enter a gift');
    assert.ok(c.facts.some((f) => f.k === 'Length' && f.v === '1:35'));
  });

  it('an unknown kind or an empty id resolves to nothing', async () => {
    const w = learnWorld();
    assert.equal(await E.resolveEntity(w.env, req('/x', WILL), WILL, access(), 'spaceship', '1'), null);
    assert.equal(await E.resolveEntity(w.env, req('/x', WILL), WILL, access(), 'person', ''), null);
  });
});
