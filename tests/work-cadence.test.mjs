// Run with: npm test
//
// Partner Care cadence: the rule engine for each of the five rules, the do-not flags, the three print lists, the mirror reads against
// an in-memory copy of the mirror's tables, and the step write (call, left a message, text) against stand-ins for Blackbaud and the hub
// database. Every name, id and amount is made up: the repository is public. Nothing here touches Partner Care's rules; the tests read
// them back from the Partner Care manual's wording.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const cad = await import('../functions/_lib/work/cadence.ts');
const csvc = await import('../functions/_lib/work/cadence-svc.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');
const fields = await import('../functions/_lib/actions/fields.ts');

const TODAY = '2026-10-10';
const SCHEMA = ['work.sql', 'work-gifts.sql', 'work-reminders.sql', 'work-cadence.sql'].map((f) => readFileSync(new URL('../db/' + f, import.meta.url), 'utf8')).join('\n');
const day = (n) => new Date(Date.parse(TODAY + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const g = (d, amt = 40, rec = true) => ({ d, amt, rec });

describe('classify: the pattern from gift dates', () => {
  it('monthly, quarterly, twice a year and annual by the median gap', () => {
    assert.equal(cad.classify([g('2026-07-15'), g('2026-08-15'), g('2026-09-15')], TODAY).rule, 'monthly');
    assert.equal(cad.classify([g('2026-01-10'), g('2026-04-10'), g('2026-07-10'), g('2026-10-02')], TODAY).rule, 'quarterly');
    assert.equal(cad.classify([g('2025-04-01'), g('2025-10-01'), g('2026-04-01')], TODAY).rule, 'semi');
    assert.equal(cad.classify([g('2024-10-12'), g('2025-10-12')], TODAY).rule, 'annual');
  });
  it('two gifts in one month count once, and a one-time gift has no pattern', () => {
    assert.equal(cad.classify([g('2026-10-02', 50, false)], TODAY), null);
    assert.equal(cad.classify([g('2026-09-02'), g('2026-09-20'), g('2026-10-02')], TODAY), null);
  });
  it('a partner whose last gift is older than the rule\'s span has lapsed', () => {
    assert.equal(cad.classify([g('2026-01-15'), g('2026-02-15'), g('2026-03-15')], TODAY), null);
    assert.equal(cad.classify([g('2022-10-12'), g('2023-10-12')], TODAY), null);
  });
  it('annual needs two gifts, monthly three', () => {
    assert.equal(cad.classify([g('2026-08-15'), g('2026-09-15')], TODAY), null);
  });
});

const person = { cid: '1', name: 'Mo Monthly', kind: 'Individual', place: 'Tampa, FL' };
const full = { phone: '(555) 010-0001', callOk: true, hasPhone: true, email: 'mo@example.org', emailOk: true, mailOk: true, hasAddress: true };
const names = { 600: 'Pat Care', 601: 'Quinn Care' };

describe('candidate and finish: each rule as the manual states it', () => {
  it('first-time partner with a number: a call at once; no number: a card', () => {
    const c = cad.candidate('1', [], { date: '2026-10-08', amount: 50, n: 1 }, {}, TODAY);
    assert.equal(c.rule, 'first');
    const row = cad.finish(c, person, full, {}, ['600'], names, TODAY);
    assert.deepEqual(row.steps.map((s) => s.k), ['call']);
    assert.equal(row.line, 'Gave a number. Call at once.');
    assert.equal(row.over, 2);
    const none = cad.finish(c, person, { ...full, phone: null, hasPhone: false, callOk: false }, {}, ['600'], names, TODAY);
    assert.deepEqual(none.steps.map((s) => s.k), ['card']);
    assert.equal(none.line, 'No number given. Send a card.');
  });
  it('a first-time partner leaves once the call is on record, and a message left does not count', () => {
    const c = cad.candidate('1', [], { date: '2026-10-08', amount: 50, n: 1 }, { call: '2026-10-09' }, TODAY);
    assert.equal(cad.finish(c, person, full, { call: '2026-10-09' }, ['600'], names, TODAY), null);
    const before = cad.candidate('1', [], { date: '2026-10-08', amount: 50, n: 1 }, { call: '2026-10-01' }, TODAY);
    assert.equal(cad.finish(before, person, full, { call: '2026-10-01' }, ['600'], names, TODAY).steps.length, 1);
  });
  it('a first gift older than 30 days is no longer a first-time call', () => {
    assert.equal(cad.candidate('1', [], { date: '2026-08-01', amount: 50, n: 1 }, {}, TODAY), null);
  });
  it('monthly under $1,000: a call and a card every three months', () => {
    const gifts = [g('2026-07-15'), g('2026-08-15'), g('2026-09-15')];
    const contacts = { call: '2026-06-01', card: '2026-09-20' };
    const c = cad.candidate('1', gifts, null, contacts, TODAY);
    assert.equal(c.rule, 'monthly');
    const row = cad.finish(c, person, full, contacts, ['600'], names, TODAY);
    assert.deepEqual(row.steps.map((s) => s.k), ['call']);
    assert.equal(row.due, '2026-08-30');
    assert.equal(row.over, 41);
    assert.equal(row.pattern, '$40 a month since 2026');
    const both = cad.candidate('1', gifts, null, { call: '2026-06-01', card: '2026-06-01' }, TODAY);
    const row2 = cad.finish(both, person, full, { call: '2026-06-01', card: '2026-06-01' }, ['600'], names, TODAY);
    assert.deepEqual(row2.steps.map((s) => s.k), ['call', 'card']);
    assert.equal(row2.steps[0].state, 'next');
  });
  it('a monthly partner at $1,000 or more is not on the list', () => {
    assert.equal(cad.candidate('1', [g('2026-07-15', 1000), g('2026-08-15', 1000), g('2026-09-15', 1000)], null, {}, TODAY), null);
  });
  it('a monthly partner contacted inside three months is not due', () => {
    const gifts = [g('2026-07-15'), g('2026-08-15'), g('2026-09-15')];
    assert.equal(cad.candidate('1', gifts, null, { call: '2026-09-01', card: '2026-09-01' }, TODAY), null);
  });
  it('quarterly: thanked each time they give, by a call, card or email after the gift', () => {
    const gifts = [g('2026-01-10', 300, false), g('2026-04-10', 300, false), g('2026-07-10', 300, false), g('2026-10-02', 300, false)];
    const c = cad.candidate('1', gifts, null, {}, TODAY);
    assert.equal(c.rule, 'quarterly');
    const row = cad.finish(c, person, full, {}, ['600'], names, TODAY);
    assert.deepEqual(row.steps.map((s) => s.k), ['call', 'email', 'card']);
    assert.equal(row.need, 'any');
    assert.equal(row.over, 8);
    assert.equal(cad.candidate('1', gifts, null, { card: '2026-10-05' }, TODAY), null);
    assert.ok(cad.candidate('1', gifts, null, { card: '2026-09-25' }, TODAY), 'a card before the gift does not thank it');
  });
  it('twice a year: a card and a call', () => {
    const c = cad.candidate('1', [g('2025-04-01', 150, false), g('2025-10-01', 150, false), g('2026-04-01', 150, false)], null, {}, TODAY);
    assert.equal(c.rule, 'semi');
    assert.deepEqual(cad.finish(c, person, full, {}, ['600'], names, TODAY).steps.map((s) => s.k), ['call', 'card']);
  });
  it('annual: a call, a text, an email and a card, in that order, the next one green', () => {
    const contacts = { call: '2025-10-20' };
    const c = cad.candidate('1', [g('2024-10-12', 150, false), g('2025-10-12', 150, false)], null, contacts, TODAY);
    assert.equal(c.rule, 'annual');
    const row = cad.finish(c, person, full, contacts, ['600'], names, TODAY);
    // The call was made 355 days ago, so it falls due in 10 days: it shows as coming up, and the next step is the text.
    assert.deepEqual(row.steps.map((s) => s.k), ['call', 'text', 'email', 'card']);
    assert.equal(row.steps.find((s) => s.state === 'next').k, 'text');
    assert.equal(row.last.what, 'Call');
  });
  it('a step with no phone, email or address, or a do-not flag, stays on the row switched off with the reason', () => {
    const contacts = {};
    const c = cad.candidate('1', [g('2024-10-12', 150, false), g('2025-10-12', 150, false)], null, contacts, TODAY);
    const row = cad.finish(c, person, { phone: '(555) 010-0001', hasPhone: true, callOk: false, email: null, emailOk: false, mailOk: false, hasAddress: true }, contacts, ['600'], names, TODAY);
    const off = Object.fromEntries(row.steps.map((s) => [s.k, s.off]));
    assert.deepEqual(off, { call: 'Do not call', text: 'Do not call', email: 'No email address', card: 'Do not mail' });
    assert.equal(row.steps.find((s) => s.state === 'next').k, 'call');
    assert.equal(row.phone, null);
  });
  it('a partner with two holders carries both', () => {
    const c = cad.candidate('1', [], { date: '2026-10-08', amount: 50, n: 1 }, {}, TODAY);
    assert.deepEqual(cad.finish(c, person, full, {}, ['600', '601'], names, TODAY).holderNames, ['Pat Care', 'Quinn Care']);
  });
});

describe('the three lists', () => {
  it('splits the partners who are due into even thirds, longest wait first', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ over: i + 1, name: 'P' + i }));
    rows.push({ over: -3, name: 'Later' });
    const l = cad.splitLists(rows);
    assert.deepEqual(l.friday.map((r) => r.over), [7, 6, 5]);
    assert.deepEqual(l.saturday.map((r) => r.over), [4, 3, 2]);
    assert.deepEqual(l.sunday.map((r) => r.over), [1]);
    assert.equal(cad.splitLists([]).friday.length, 0);
  });
});

describe('overlay: a step saved in the hub clears at once', () => {
  const row = (extra = {}) => ({ cid: '1', name: 'A', rule: 'monthly', need: 'all', holders: ['600'], over: 3, steps: [{ k: 'call', state: 'next', off: null }, { k: 'card', state: 'todo', off: null }], ...extra });
  it('drops the step done and moves the green to the next one; the last step takes the row away', () => {
    const one = csvc.overlay([row()], [{ cid: '1', step: 'call', outcome: 'done' }]);
    assert.deepEqual(one[0].steps.map((s) => [s.k, s.state]), [['card', 'next']]);
    assert.equal(csvc.overlay([row()], [{ cid: '1', step: 'call', outcome: 'done' }, { cid: '1', step: 'card', outcome: 'done' }]).length, 0);
  });
  it('a message left changes nothing; any one step finishes a quarterly row', () => {
    assert.equal(csvc.overlay([row()], [{ cid: '1', step: 'call', outcome: 'left' }])[0].steps.length, 2);
    assert.equal(csvc.overlay([row({ rule: 'quarterly', need: 'any', steps: [{ k: 'call', state: 'next', off: null }, { k: 'email', state: 'todo', off: null }] })], [{ cid: '1', step: 'email', outcome: 'done' }]).length, 0);
  });
});

/* ------------------------------------------------------------------ the mirror and the service against stand-ins */

let mirror;
const q = async (sql, params = []) => {
  readOnly(sql);
  return mirror.prepare(sql).all(...params);
};
function fakeD1(db) {
  const stmt = (sql, args = []) => ({
    args, sql,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try { for (const s of list) db.prepare(s.sql).run(...(s.args || [])); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      return [];
    },
  };
}
const gift = (id, cid, amount, date, type = 'Donation') => mirror.prepare('INSERT INTO gifts (id, gift_amount, gift_date, gift_type, gift_status, constituent_record_id) VALUES (?,?,?,?,?,?)').run(id, amount, date + 'T00:00:00', type, 'Active', cid);
const touch = (id, cid, d, cat, tx = 0, outcome) => {
  mirror.prepare('INSERT INTO actions (id, action_date_due, action_completed_date, action_category, constituent_record_id, raw_json) VALUES (?,?,?,?,?,?)').run(id, d + 'T00:00:00', d + 'T00:00:00', cat, cid, JSON.stringify({ completed: true, outcome }));
  mirror.prepare('INSERT INTO action_tags (id, texted) VALUES (?,?)').run(id, tx);
};

function buildMirror() {
  mirror = new DatabaseSync(':memory:');
  mirror.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_type TEXT, first_name TEXT, last_name TEXT, deceased INTEGER DEFAULT 0, inactive INTEGER DEFAULT 0, raw_json TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_amount REAL, gift_date TEXT, gift_type TEXT, gift_status TEXT, constituent_record_id TEXT);
    CREATE TABLE actions (id TEXT PRIMARY KEY, action_date_due TEXT, action_completed_date TEXT, action_category TEXT, constituent_record_id TEXT, raw_json TEXT);
    CREATE TABLE action_tags (id TEXT PRIMARY KEY, texted INTEGER DEFAULT 0);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_to_date TEXT);
    CREATE TABLE phones (id TEXT PRIMARY KEY, constituent_record_id TEXT, phone_number TEXT, is_primary INTEGER DEFAULT 1, do_not_call INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0);
    CREATE TABLE emails (id TEXT PRIMARY KEY, constituent_record_id TEXT, email_address TEXT, is_primary INTEGER DEFAULT 1, do_not_email INTEGER DEFAULT 0, is_inactive INTEGER DEFAULT 0);
    CREATE TABLE addresses (id TEXT PRIMARY KEY, constituent_record_id TEXT, address_lines TEXT, do_not_mail INTEGER DEFAULT 0, is_primary INTEGER DEFAULT 1, is_inactive INTEGER DEFAULT 0);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT);
    INSERT INTO fundraisers VALUES ('600', 'Pat', 'Care'), ('601', 'Quinn', 'Care');
  `);
  const names2 = ['Mo Monthly', 'Fran First', 'Noah NoPhone', 'Quinn Quarterly', 'Sam Semi', 'Ann Annual', 'Bill Big', 'Rex Director', 'Lou Lapsed', 'Dee DoNotCall', 'Dora Deceased', 'Olive OneGift', 'Gus Unreachable'];
  names2.forEach((n, i) => {
    const id = String(i + 1);
    mirror.prepare('INSERT INTO constituents (id, constituent_type, first_name, last_name, deceased, raw_json) VALUES (?,?,?,?,?,?)').run(id, 'Individual', n.split(' ')[0], n.split(' ')[1], n === 'Dora Deceased' ? 1 : 0, JSON.stringify({ name: n, address: { city: 'Tampa', state: 'FL' } }));
    mirror.prepare('INSERT INTO assignments VALUES (?,?,?,?,?)').run('pc' + id, id, '600', 'Partner Care', null);
    if (id === '13') return;
    if (id !== '3') mirror.prepare('INSERT INTO phones (id, constituent_record_id, phone_number, do_not_call) VALUES (?,?,?,?)').run('ph' + id, id, '(555) 010-00' + String(id).padStart(2, '0'), n === 'Dee DoNotCall' ? 1 : 0);
    mirror.prepare('INSERT INTO emails (id, constituent_record_id, email_address) VALUES (?,?,?)').run('em' + id, id, `p${id}@example.org`);
    mirror.prepare('INSERT INTO addresses (id, constituent_record_id, address_lines) VALUES (?,?,?)').run('ad' + id, id, '1 Test Way');
  });
  mirror.prepare('INSERT INTO assignments VALUES (?,?,?,?,?)').run('pc2b', '2', '601', 'Partner Care', null);
  mirror.prepare('INSERT INTO assignments VALUES (?,?,?,?,?)').run('rd8', '8', '501', 'Regional Development Director (RDD)', null);
  // 1 Mo: monthly $40, call last June, card last month
  ['2026-07-15', '2026-08-15', '2026-09-15'].forEach((d, i) => gift('m' + i, '1', 40, d, 'RecurringGiftPayment'));
  touch('c1', '1', '2026-06-01', 'Phone call'); touch('c2', '1', '2026-09-20', 'Mailing');
  gift('f2', '2', 50, '2026-10-08'); gift('f3', '3', 25, '2026-10-09');
  [['q1', '2026-01-10'], ['q2', '2026-04-10'], ['q3', '2026-07-10'], ['q4', '2026-10-02']].forEach(([id, d]) => gift(id, '4', 300, d));
  [['s1', '2025-04-01'], ['s2', '2025-10-01'], ['s3', '2026-04-01']].forEach(([id, d]) => gift(id, '5', 150, d));
  gift('a1', '6', 150, '2024-10-12'); gift('a2', '6', 150, '2025-10-12');
  ['2026-07-15', '2026-08-15', '2026-09-15'].forEach((d, i) => { gift('b' + i, '7', 1500, d, 'RecurringGiftPayment'); gift('r' + i, '8', 40, d, 'RecurringGiftPayment'); gift('d' + i, '10', 40, d, 'RecurringGiftPayment'); gift('x' + i, '11', 40, d, 'RecurringGiftPayment'); });
  ['2026-01-15', '2026-02-15', '2026-03-15'].forEach((d, i) => gift('l' + i, '9', 40, d, 'RecurringGiftPayment'));
  gift('o1', '12', 100, '2026-09-01');
  ['2026-07-15', '2026-08-15', '2026-09-15'].forEach((d, i) => gift('u' + i, '13', 40, d, 'RecurringGiftPayment'));
}

describe('loadCadence against the mirror', () => {
  before(buildMirror);
  it('lists each partner with a rule, in order of how long they have waited, and leaves out the rest', async () => {
    const rows = await cad.loadCadence({ DB: null }, q, { today: TODAY, names });
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    assert.deepEqual(Object.keys(by).sort(), ['Ann Annual', 'Dee DoNotCall', 'Fran First', 'Gus Unreachable', 'Mo Monthly', 'Noah NoPhone', 'Quinn Quarterly', 'Sam Semi']);
    assert.equal(by['Gus Unreachable'].blocked, true);
    assert.equal(by['Mo Monthly'].blocked, false);
    assert.equal(by['Fran First'].rule, 'first');
    assert.deepEqual(by['Fran First'].steps.map((s) => s.k), ['call']);
    assert.deepEqual(by['Fran First'].holders.sort(), ['600', '601']);
    assert.deepEqual(by['Noah NoPhone'].steps.map((s) => s.k), ['card']);
    assert.deepEqual(by['Mo Monthly'].steps.map((s) => s.k), ['call']);
    assert.equal(by['Quinn Quarterly'].rule, 'quarterly');
    assert.equal(by['Sam Semi'].rule, 'semi');
    assert.equal(by['Ann Annual'].rule, 'annual');
    assert.equal(by['Dee DoNotCall'].steps.find((s) => s.k === 'call').off, 'Do not call');
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].over >= rows[i].over, 'longest wait first');
  });
  it('a partner a director holds, a deceased partner, a $1,500 monthly partner and a lapsed one are not listed', async () => {
    const rows = await cad.loadCadence({ DB: null }, q, { today: TODAY, names });
    for (const n of ['Rex Director', 'Dora Deceased', 'Bill Big', 'Lou Lapsed', 'Olive OneGift']) assert.ok(!rows.some((r) => r.name === n), n);
  });
  it('a left message (unsuccessful call) does not count as the call, a text counts as a text', async () => {
    touch('c9', '2', '2026-10-09', 'Phone call', 0, 'Unsuccessful');
    let rows = await cad.loadCadence({ DB: null }, q, { today: TODAY, names });
    assert.ok(rows.some((r) => r.name === 'Fran First'), 'still due after an unsuccessful call');
    touch('c10', '2', '2026-10-09', 'Phone call', 0, 'Successful');
    rows = await cad.loadCadence({ DB: null }, q, { today: TODAY, names });
    assert.ok(!rows.some((r) => r.name === 'Fran First'), 'done after a successful call');
    touch('c11', '6', '2026-10-09', 'Phone call', 1);
    rows = await cad.loadCadence({ DB: null }, q, { today: TODAY, names });
    assert.ok(!rows.find((r) => r.name === 'Ann Annual').steps.some((s) => s.k === 'text'));
  });
});

describe('the mirror SQL passes the endpoint\'s refusal rule', () => {
  it('has none of the words the mirror refuses', () => {
    for (const s of [cad.GIFTS_SQL, cad.FIRST_SQL, cad.FIRST_AMOUNT_SQL, cad.HOLDS_SQL, cad.CONTACTS_SQL, cad.FACTS_SQL, cad.PHONES_SQL, cad.EMAILS_SQL, cad.ADDRESSES_SQL]) assert.doesNotThrow(() => readOnly(s));
  });
});

/* ------------------------------------------------------------------ pressing a step */
let hub;
let calls;
let live;
let nextId;
let realFetch;
let ctx;
const CODES = fields.FALLBACK_CODES;

function newCtx() {
  const repo = {
    async send(list) {
      calls.push(list);
      const results = list.map((c) => {
        if (c.method === 'GET' && c.path.startsWith('/constituent/v1/actiontypes')) return { ok: true, status: 200, body: { value: CODES.types } };
        if (c.method === 'GET' && c.path.includes('/customfields/categories')) return { ok: true, status: 200, body: { value: [] } };
        if (c.method === 'GET') return { ok: true, status: 200, body: { count: 0, value: [] } };
        if (c.method === 'POST' && c.path === '/constituent/v1/actions') { const id = String(nextId++); live[id] = { id, ...c.body }; return { ok: true, status: 200, body: { id } }; }
        return { ok: true, status: 200, body: { id: String(nextId++) } };
      });
      return { results, callsToday: 10 };
    },
    async refreshMirror(ids, tags) { return { ok: true, runId: 'r', maxCalls: ids.length * (tags ? 2 : 1) }; },
    async synced() { return '2026-10-10T09:00:00Z'; },
    async modifiedOf() { return new Map(); },
  };
  return { env: { DB: fakeD1(hub), MIRROR_API_KEY: 'k', MIRROR_QUERY_URL: 'https://mirror.test/d1/query' }, repo, actor: 'Pat Care', email: 'pat@example.org' };
}

describe('pressing a step', () => {
  beforeEach(() => {
    buildMirror();
    hub = new DatabaseSync(':memory:');
    hub.exec(SCHEMA);
    calls = [];
    live = {};
    nextId = 9000;
    ctx = newCtx();
    realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://mirror.test')) return realFetch(url, init);
      const { sql, params } = JSON.parse(init.body);
      let rows;
      if (/FROM constituents WHERE id = \?1/.test(sql)) rows = [{ t: 'Individual', f: 'Ann', l: 'Partner', p: null, o: null, d: 0 }];
      else if (/json_extract\(raw_json, '\$\.completed'\) = 1/.test(sql) && /id IN/.test(sql) && !/constituent_record_id/.test(sql)) rows = [];
      else rows = mirror.prepare(sql).all(...params);
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const created = () => calls.flat().filter((c) => c.method === 'POST' && c.path === '/constituent/v1/actions');
  async function run(id) {
    const svc = await import('../functions/_lib/work/service.ts');
    for (let i = 0; i < 10; i++) { const r = await svc.runBatch(ctx, id); if (!r.left) return r; }
  }

  it('lists the due partners and clears a row the moment its last step is saved', async () => {
    const first = await csvc.cadenceResponse(ctx, 'all');
    assert.equal(first.rows.find((r) => r.name === 'Mo Monthly').steps.length, 1);
    assert.equal(first.stats.first, 2);
    assert.equal(first.unreachable, 1);
    assert.ok(!first.rows.some((r) => r.name === 'Gus Unreachable'), 'a partner nobody can reach is left off the list');
    assert.equal(first.stats.quarterly, 1);
    const out = await csvc.stepCadence(ctx, { cid: '1', step: 'call', outcome: 'talked', line: 'Glad to hear from her', req: 'r1' });
    assert.ok(out.batch.id);
    await run(out.batch.id);
    const c = created();
    assert.equal(c.length, 1);
    assert.equal(c[0].body.category, 'Phone call');
    assert.equal(c[0].body.completed, true);
    assert.equal(c[0].body.outcome, 'Successful');
    assert.equal(c[0].body.summary, 'Called (Monthly partner)');
    assert.deepEqual(c[0].body.fundraisers, ['600']);
    const after = await csvc.cadenceResponse(ctx, 'all');
    assert.ok(!after.rows.some((r) => r.cid === '1'), 'Mo leaves the list');
    assert.equal(after.stats.week, 1);
  });
  it('left a message logs an unsuccessful call, keeps the row and sets a reminder for the next workday', async () => {
    const out = await csvc.stepCadence(ctx, { cid: '2', step: 'call', outcome: 'left', req: 'r2' });
    await run(out.batch.id);
    assert.equal(created()[0].body.outcome, 'Unsuccessful');
    assert.equal(created()[0].body.summary, 'Left a message (First-time partner)');
    const after = await csvc.cadenceResponse(ctx, 'all');
    assert.ok(after.rows.some((r) => r.cid === '2'), 'still due');
    assert.equal(after.stats.week, 0);
    const rem = hub.prepare("SELECT kind, cid, state FROM act_reminders").all();
    assert.deepEqual(rem.map((r) => [r.kind, r.cid, r.state]), [['cadence', '2', 'open']]);
    const done = hub.prepare('SELECT outcome, remind_on FROM act_cadence_done').all();
    assert.deepEqual(done.map((d) => [d.outcome, d.remind_on]), [['left', '2026-10-11']]);
  });
  it('undoing a left message takes its reminder out of the bell', async () => {
    const rem = await import('../functions/_lib/work/remind.ts');
    const out = await csvc.stepCadence(ctx, { cid: '2', step: 'call', outcome: 'left', req: 'ru1' });
    await run(out.batch.id);
    assert.equal((await rem.listReminders(ctx.env, 'pat@example.org')).rows.length, 1);
    hub.prepare("UPDATE act_batches SET state = 'undone' WHERE id = ?").run(out.batch.id);
    assert.equal((await rem.listReminders(ctx.env, 'pat@example.org')).rows.length, 0);
  });
  it('a text is a completed call with the Texted tag', async () => {
    const out = await csvc.stepCadence(ctx, { cid: '6', step: 'text', req: 'r3' });
    await run(out.batch.id);
    assert.equal(created()[0].body.category, 'Phone call');
    const tag = calls.flat().find((c) => c.path === '/constituent/v1/actions/customfields' && c.body && c.body.category);
    assert.equal(tag.body.category, 'Texted');
  });
  it('refuses a step the rule does not list, a step that is switched off, a partner not due and a message left on a card', async () => {
    await assert.rejects(csvc.stepCadence(ctx, { cid: '1', step: 'email', req: 'r4' }), /not a step/);
    await assert.rejects(csvc.stepCadence(ctx, { cid: '10', step: 'call', req: 'r5' }), /Do not call/);
    await assert.rejects(csvc.stepCadence(ctx, { cid: '9', step: 'call', req: 'r6' }), /not due/);
    await assert.rejects(csvc.stepCadence(ctx, { cid: '6', step: 'card', outcome: 'left', req: 'r7' }), /call/);
    assert.equal(created().length, 0);
  });
  it('a role test may press any step on its one test record', async () => {
    const t = { ...ctx, testCid: '1' };
    const out = await csvc.stepCadence(t, { cid: '1', step: 'email', req: 'rt1' });
    await run(out.batch.id);
    assert.equal(created()[0].body.category, 'Email');
  });
  it('a press repeated with the same req saves one contact', async () => {
    const a = await csvc.stepCadence(ctx, { cid: '1', step: 'call', req: 'same' });
    const b = await csvc.stepCadence(ctx, { cid: '1', step: 'call', req: 'same' }).catch((e) => e);
    await run(a.batch.id);
    assert.equal(created().length, 1);
    assert.equal(hub.prepare('SELECT COUNT(*) n FROM act_cadence_done').get().n, 1);
    assert.ok(b);
  });
  it('an undone step puts the row back', async () => {
    const out = await csvc.stepCadence(ctx, { cid: '1', step: 'call', req: 'u1' });
    await run(out.batch.id);
    assert.ok(!(await csvc.cadenceResponse(ctx, 'all')).rows.some((r) => r.cid === '1'));
    hub.prepare("UPDATE act_batches SET state = 'undone' WHERE id = ?").run(out.batch.id);
    assert.ok((await csvc.cadenceResponse(ctx, 'all')).rows.some((r) => r.cid === '1'));
  });
  it('only Partner Care and admins read the tab', async () => {
    const dir = { ...ctx, scope: { role: 'director', fid: '501', fids: new Set(['501']), all: false, email: 'a@b.c', name: 'A', team: 'RDD' } };
    await assert.rejects(csvc.cadenceResponse(dir, ''), /Partner Care/);
    await assert.rejects(csvc.stepCadence(dir, { cid: '1', step: 'call' }), /Partner Care/);
  });
  it('Mine is the default for a Partner Care person, All shows the whole team', async () => {
    const pc = { ...ctx, scope: { role: 'partner_care', fid: '601', fids: new Set(['600', '601']), all: false, email: 'q@b.c', name: 'Quinn', team: 'Partner Care' } };
    const mine = await csvc.cadenceResponse(pc, '');
    assert.equal(mine.owner, '601');
    assert.deepEqual([...new Set(mine.rows.flatMap((r) => r.holders))].sort(), ['600', '601']);
    assert.ok(mine.rows.every((r) => r.holders.includes('601')));
    assert.ok(mine.rows.length < (await csvc.cadenceResponse(pc, 'all')).rows.length);
  });
});
