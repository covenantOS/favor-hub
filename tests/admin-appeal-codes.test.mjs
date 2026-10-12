// Run with: npm test
//
// Appeal codes: the scheme (prefix, year, month character, suffix), the checks against the D1 copy, and the create call to favorintl.org's
// guarded appeals route against stand-ins. The tests never create a real appeal. Every code and name is made up.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const ac = await import('../functions/_lib/admin/appealcodes.ts');
const cr = await import('../functions/_lib/admin/coderequests.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');

const SCHEMA = ['work.sql', 'admin-home.sql', 'bb-code-requests.sql'].map((f) => readFileSync(new URL('../db/' + f, import.meta.url), 'utf8')).join('\n');

describe('the scheme', () => {
  it('month characters run 1 to 9 then A, B, C', () => {
    assert.equal(ac.monthChar(1), '1');
    assert.equal(ac.monthChar(9), '9');
    assert.equal(ac.monthChar(10), 'A');
    assert.equal(ac.monthChar(12), 'C');
  });
  it('a newsletter takes EMW and the week of the send day, rounded up', () => {
    assert.equal(ac.weekOf(1), 1);
    assert.equal(ac.weekOf(7), 1);
    assert.equal(ac.weekOf(8), 2);
    assert.equal(ac.weekOf(30), 5);
    const b = ac.build({ letter: 'N', date: '2026-10-21', suffix: '' });
    assert.equal(b.code, 'N26A-EMW3');
    assert.equal(b.category, 'Digital Newsletter');
    assert.equal(b.description, 'Digital Newsletters, Oct 2026, Week 3, Email Newsletter');
    assert.equal(ac.build({ letter: 'n', date: '2026-09-30', suffix: 'emw', title: 'Land in Her Name' }).description, 'Digital Newsletters, Sep 2026, Week 5, Email Newsletter, Land in Her Name');
  });
  it('a letter takes its audience suffix and the monthly online twin ends in -WS', () => {
    const b = ac.build({ letter: 'L', date: '2026-11-01', suffix: 'ad' });
    assert.equal(b.code, 'L26B-AD');
    assert.equal(b.category, 'Direct Mail Appeal');
    assert.equal(ac.onlineTwin(b).code, 'L26B-WS');
    assert.match(ac.onlineTwin(b).description, /\(online\)$/);
  });
  it('a kind with no usual suffix asks for one, and a description can be written by hand', () => {
    assert.throws(() => ac.build({ letter: 'M', date: '2026-10-01', suffix: '' }), /Write the suffix/);
    const b = ac.build({ letter: 'M', date: '2026-10-01', suffix: 'cwyt', description: 'Gift after a video' });
    assert.equal(b.code, 'M26A-CWYT');
    assert.equal(b.description, 'Gift after a video');
  });
  it('refuses an unknown kind, a bad date, a long suffix and a long description', () => {
    assert.throws(() => ac.build({ letter: 'Z', date: '2026-10-01', suffix: 'A' }), /kind/);
    assert.throws(() => ac.build({ letter: 'L', date: 'soon', suffix: 'AD' }), /date/);
    assert.throws(() => ac.build({ letter: 'L', date: '2026-10-01', suffix: 'ABCDEFGHIJKLMNOPQRS' }), /does not fit/);
    assert.throws(() => ac.build({ letter: 'L', date: '2026-10-01', suffix: 'AD', description: 'x'.repeat(256) }), /255/);
  });
  it('the mirror SQL has none of the words the endpoint refuses', () => {
    for (const s of [ac.RECENT_SQL, ac.CATEGORIES_SQL, ac.EXISTS_SQL, ac.SAMPLE_SQL]) assert.doesNotThrow(() => readOnly(s));
  });
});

let hub;
let mirror;
let posted;
let realFetch;
let env;
function fakeD1(db) {
  const stmt = (sql, args = []) => ({
    args, sql,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return { prepare: (sql) => stmt(sql), batch: async () => [] };
}

describe('creating appeals', () => {
  beforeEach(() => {
    hub = new DatabaseSync(':memory:');
    hub.exec(SCHEMA);
    mirror = new DatabaseSync(':memory:');
    mirror.exec(`CREATE TABLE appeals (id TEXT PRIMARY KEY, appeal_id TEXT, appeal_description TEXT, appeal_category TEXT, appeal_start_date TEXT, appeal_inactive INTEGER DEFAULT 0, date_added TEXT);
      INSERT INTO appeals VALUES ('900', 'N26A-EMW1', 'Digital Newsletters, Oct 2026, Week 1, Email Newsletter', 'Digital Newsletter', '2026-10-07T00:00:00', 0, '2026-10-01T10:00:00');
      INSERT INTO appeals VALUES ('901', 'L26A-AD', 'Direct Mail Appeal, Oct 2026', 'Direct Mail Appeal', '2026-10-01T00:00:00', 0, '2026-09-20T10:00:00');`);
    env = { DB: fakeD1(hub), BLACKBAUD_SETUP_KEY: 'k', BLACKBAUD_OPS_URL: 'https://site.test/api/blackbaud/ops', MIRROR_API_KEY: 'm', MIRROR_QUERY_URL: 'https://mirror.test/q' };
    posted = [];
    realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.startsWith('https://mirror.test')) {
        const { sql, params } = JSON.parse(init.body);
        return new Response(JSON.stringify(mirror.prepare(sql).all(...params)), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(url, init);
    };
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const route = (over = {}) => async (url, init) => {
    posted.push({ url, init });
    if (init.method === 'GET') return new Response(JSON.stringify({ ok: true, record: { appeal_category_id: 2110 } }), { status: 200 });
    const b = JSON.parse(init.body);
    if (over.fail) return new Response(JSON.stringify({ ok: false, message: 'No' }), { status: 500 });
    return new Response(JSON.stringify({ ok: true, id: '5000', appeal_id: b.appeal_id }), { status: 200 });
  };

  it('lists the newest appeals and the categories from the copy', async () => {
    const o = await ac.appealsOverview(env);
    assert.equal(o.recent[0].code, 'N26A-EMW1');
    assert.deepEqual(o.categories.map((c) => c.category).sort(), ['Digital Newsletter', 'Direct Mail Appeal']);
    assert.ok(o.prefixes.length >= 10);
  });

  it('creates the appeal with the category id read from an existing one, keeps that id, and audits it', async () => {
    const out = await ac.createAppeals(env, 'will@example.org', { draft: { letter: 'N', date: '2026-10-28', suffix: '' } }, route());
    assert.equal(out.created.length, 1);
    assert.equal(out.created[0].ok, true);
    assert.equal(out.created[0].code, 'N26A-EMW4');
    const post = posted.find((p) => p.init.method === 'POST');
    assert.equal(post.url, 'https://site.test/api/blackbaud/appeals');
    assert.equal(post.init.headers['X-Setup-Key'], 'k');
    const body = JSON.parse(post.init.body);
    assert.deepEqual(body, { appeal_id: 'N26A-EMW4', description: 'Digital Newsletters, Oct 2026, Week 4, Email Newsletter', start_date: '2026-10-28', appeal_category_id: 2110 });
    assert.equal(hub.prepare("SELECT value FROM act_settings WHERE key = 'appeal_cat:digital newsletter'").get().value, '2110');
    assert.equal(hub.prepare("SELECT area, key, note FROM hub_audit").get().key, 'N26A-EMW4');
    assert.match(out.wiring.join(' '), /\?src=n26a-emw4/);
    // the second create reads no category
    posted.length = 0;
    await ac.createAppeals(env, 'will@example.org', { draft: { letter: 'N', date: '2026-11-04', suffix: '' } }, route());
    assert.equal(posted.filter((p) => p.init.method === 'GET').length, 0);
  });

  it('a letter with the online twin creates two appeals and says how the giving form reaches the -WS code', async () => {
    mirror.prepare("INSERT INTO appeals VALUES ('902', 'L26B-OLD', 'x', 'Direct Mail Appeal', '2026-11-01T00:00:00', 0, '2026-09-21T10:00:00')").run();
    const out = await ac.createAppeals(env, 'will@example.org', { draft: { letter: 'L', date: '2026-11-01', suffix: 'AD', title: 'November appeal' }, online: true }, route());
    assert.deepEqual(out.created.map((c) => c.code), ['L26B-AD', 'L26B-WS']);
    assert.match(out.wiring.join(' '), /L26B-WS/);
    assert.equal(hub.prepare('SELECT COUNT(*) n FROM hub_audit').get().n, 2);
  });

  it('refuses a code that already exists before it calls Blackbaud', async () => {
    await assert.rejects(ac.createAppeals(env, 'will@example.org', { draft: { letter: 'N', date: '2026-10-07', suffix: 'EMW1' } }, route()), /already exists/);
    assert.equal(posted.length, 0);
    assert.deepEqual(await ac.existing(env, ['n26a-emw1', 'L99A-AD']), ['N26A-EMW1']);
  });

  it('reports a Blackbaud failure on the code and does not audit it', async () => {
    const out = await ac.createAppeals(env, 'will@example.org', { draft: { letter: 'N', date: '2026-10-28', suffix: '' } }, route({ fail: true }));
    assert.equal(out.created[0].ok, false);
    assert.match(out.created[0].error, /No/);
    assert.equal(hub.prepare('SELECT COUNT(*) n FROM hub_audit').get().n, 0);
  });

  it('sends no category when Blackbaud holds none to copy, and says so', async () => {
    const out = await ac.createAppeals(env, 'will@example.org', { draft: { letter: 'R', date: '2026-10-01', suffix: 'WS' } }, route());
    const body = JSON.parse(posted.find((p) => p.init.method === 'POST').init.body);
    assert.equal('appeal_category_id' in body, false);
    assert.match(out.wiring.join(' '), /no category called Reactivation/);
  });

  it('waits when the connection is not set up', async () => {
    delete env.BLACKBAUD_SETUP_KEY;
    await assert.rejects(ac.createAppeals(env, 'will@example.org', { draft: { letter: 'N', date: '2026-10-28', suffix: '' } }, route()), /not set up/);
  });
});

describe('fund and campaign requests', () => {
  beforeEach(() => { hub = new DatabaseSync(':memory:'); hub.exec(SCHEMA); env = { DB: fakeD1(hub) }; });
  it('adds, lists and closes a request, and refuses a duplicate', async () => {
    const r = await cr.addRequest(env, 'will@example.org', { kind: 'fund', code: 'WATER-27', description: 'Water wells 2027', category: 'Water', start_date: '2027-01-01' });
    assert.equal(r.state, 'open');
    await assert.rejects(cr.addRequest(env, 'will@example.org', { kind: 'fund', code: 'water-27', description: 'again' }), /already waiting/);
    assert.equal((await cr.listRequests(env)).length, 1);
    await cr.closeRequest(env, 'tech@example.org', r.id, 'done');
    const list = await cr.listRequests(env);
    assert.equal(list[0].state, 'done');
    await assert.rejects(cr.closeRequest(env, 'tech@example.org', r.id, 'done'), /closed or gone/);
    assert.equal(hub.prepare('SELECT COUNT(*) n FROM hub_audit').get().n, 2);
  });
  it('refuses a missing code, description or kind and a bad date', async () => {
    await assert.rejects(cr.addRequest(env, 'w', { kind: 'gift', code: 'A', description: 'B' }), /fund or campaign/);
    await assert.rejects(cr.addRequest(env, 'w', { kind: 'fund', code: '', description: 'B' }), /Write the code/);
    await assert.rejects(cr.addRequest(env, 'w', { kind: 'fund', code: 'A', description: '' }), /Write the description/);
    await assert.rejects(cr.addRequest(env, 'w', { kind: 'fund', code: 'A', description: 'B', start_date: 'soon' }), /start date/);
  });
});
