// Run with: npm test
//
// Full editing in the Work Center: field checks, conflicts, repeats, and the service paths for edit, bulk edit, new with a follow-up,
// complete and schedule next, duplicate, move, delete, notes, attachments and opportunities, each with its Undo. A real SQLite copy of
// db/work.sql stands in for D1, a script stands in for the upkeep route, and a stub answers the mirror. Made-up ids only: the
// repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const fields = await import('../functions/_lib/actions/fields.ts');
const completion = await import('../functions/_lib/actions/completion.ts');
const outbox = await import('../functions/_lib/actions/outbox.ts');
const svc = await import('../functions/_lib/work/service.ts');
const edit = await import('../functions/_lib/work/edit.ts');

const SCHEMA = readFileSync(new URL('../db/work.sql', import.meta.url), 'utf8');
const CODES = fields.FALLBACK_CODES;
const TODAY = '2026-10-09';

function fakeD1(db) {
  const stmt = (sql, args = []) => ({
    args,
    sql,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try {
        for (const s of list) db.prepare(s.sql).run(...(s.args || []));
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return [];
    },
  };
}

// ------------------------------------------------------------------ pure checks
describe('field checks', () => {
  it('turns a person\'s fields into the body Blackbaud takes', () => {
    const r = fields.checkFields({ summary: '  Called  back ', category: 'phone call', date: '2026-10-12', start_time: '09:30', end_time: '10:00', priority: 'high', location: 'residence', fundraisers: ['10', '10', '11'] }, CODES, TODAY);
    assert.deepEqual(r.errors, []);
    assert.equal(r.body.summary, 'Called back');
    assert.equal(r.body.category, 'Phone call');
    assert.equal(r.body.date, '2026-10-12T00:00:00');
    assert.equal(r.body.priority, 'High');
    assert.equal(r.body.location, 'Residence');
    assert.deepEqual(r.body.fundraisers, ['10', '11']);
  });
  it('refuses what Blackbaud would refuse, in plain words', () => {
    assert.match(fields.checkFields({ category: 'Fax' }, CODES, TODAY).errors[0], /category/);
    assert.match(fields.checkFields({ start_time: '9am' }, CODES, TODAY).errors[0], /09:30/);
    assert.match(fields.checkFields({ start_time: '10:00', end_time: '09:00' }, CODES, TODAY).errors[0], /end time/);
    assert.match(fields.checkFields({ completed_date: '2026-12-01' }, CODES, TODAY).errors[0], /future/);
    assert.match(fields.checkFields({ summary: 'x'.repeat(256) }, CODES, TODAY).errors[0], /255/);
  });
  it('an empty optional field clears it; status and completed stay in step', () => {
    const r = fields.checkFields({ location: '', outcome: '', status: 'Completed' }, CODES, TODAY);
    assert.equal(r.body.location, null);
    assert.equal(r.body.outcome, null);
    assert.equal(r.body.completed, true);
    assert.equal(r.body.completed_date, TODAY + 'T00:00:00');
    const reopen = fields.checkFields({ completed: false }, CODES, TODAY);
    assert.equal(reopen.body.status, 'Open');
  });
  it('a new action gets a date and Normal priority', () => {
    const r = fields.checkFields({ category: 'Email' }, CODES, TODAY, { create: true });
    assert.equal(r.body.date, TODAY + 'T00:00:00');
    assert.equal(r.body.priority, 'Normal');
    assert.match(fields.checkFields({}, CODES, TODAY, { create: true }).errors[0], /category/);
  });
  it('a conflict is a field someone else changed to something new', () => {
    const current = { summary: 'Changed by Jo', date: '2026-10-01T00:00:00', fundraisers: ['2', '1'] };
    assert.deepEqual(fields.conflicts(current, { summary: 'Old', date: '2026-10-01' }, { summary: 'Mine', date: '2026-10-05T00:00:00' }), ['summary']);
    assert.deepEqual(fields.conflicts(current, { fundraisers: ['1', '2'] }, { fundraisers: ['3'] }), []);
    // the other person already made the same change: no conflict
    assert.deepEqual(fields.conflicts(current, { summary: 'Old' }, { summary: 'Changed by Jo' }), []);
  });
  it('smart defaults: a logged contact is today, a task is due out by its kind, the holder owns it', () => {
    const d = fields.defaultsFor({ today: TODAY, category: 'Task/Other', holders: ['55'], me: '66', holderType: 'CED Action', myType: 'RDD Action' });
    assert.equal(d.completed, false);
    assert.equal(d.date, '2026-10-16');
    assert.deepEqual(d.fundraisers, ['55']);
    assert.equal(d.type, 'CED Action');
    const c = fields.defaultsFor({ today: TODAY, category: 'Phone call', me: '66', myType: 'RDD Action' });
    assert.equal(c.date, TODAY);
    assert.equal(c.direction, 'Outbound');
    assert.deepEqual(c.fundraisers, ['66']);
  });
  it('repeats: weeks, months that keep the day or fall back to the last, and an end', () => {
    assert.equal(fields.nextDue('2026-10-09', { every: 2, unit: 'week' }), '2026-10-23');
    assert.equal(fields.nextDue('2026-01-31', { every: 1, unit: 'month' }), '2026-02-28');
    assert.equal(fields.nextDue('2026-10-15', { every: 3, unit: 'month' }), '2027-01-15');
    assert.equal(fields.recurAfter({ every: 1, unit: 'week', left: 0 }, '2026-10-16'), null);
    assert.equal(fields.recurAfter({ every: 1, unit: 'week', left: 2 }, '2026-10-16').left, 1);
    assert.equal(fields.recurAfter({ every: 1, unit: 'week', until: '2026-10-10' }, '2026-10-16'), null);
    assert.equal(fields.checkRecur({ every: 0, unit: 'week' }), null);
    assert.deepEqual(fields.checkRecur({ every: '2', unit: 'month', left: '' }), { every: 2, unit: 'month', until: null, left: null });
  });
  it('opportunity fields: money as { value }, fundraisers as records, a name required on create', () => {
    const r = fields.checkOpp({ name: 'Year-end ask', status: 'planned', ask_amount: '$25,000', expected_date: '2026-12-15', fundraisers: ['10'] }, CODES, { create: true });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.body.ask_amount, { value: 25000 });
    assert.equal(r.body.status, 'Planned');
    assert.deepEqual(r.body.fundraisers, [{ constituent_id: '10' }]);
    assert.match(fields.checkOpp({}, CODES, { create: true }).errors[0], /name/);
    assert.match(fields.checkOpp({ ask_amount: '-5' }, CODES).errors[0], /Amounts/);
  });
});

describe('undo steps for the new kinds of change', () => {
  it('a tag is removed from its action, a delete returns as a copy, a call carries its own way back', () => {
    assert.deepEqual(completion.undoStep({ op: 'tag', action_id: '5', bb_id: '77', before: null }).body.__call, { method: 'DELETE', path: '/constituent/v1/actions/customfields/77?action=5' });
    const back = completion.undoStep({ op: 'delete', action_id: '5', bb_id: null, before: { __restore: { constituent_id: '100', category: 'Email' } } });
    assert.equal(back.op, 'create');
    assert.equal(back.body.constituent_id, '100');
    const note = completion.undoStep({ op: 'call', action_id: '5', bb_id: '901', before: { __call: { method: 'DELETE', path: '/constituent/v1/actions/notes/{id}' } } });
    assert.equal(note.body.__call.path, '/constituent/v1/actions/notes/901');
    assert.equal(completion.undoStep({ op: 'call', action_id: '5', bb_id: null, before: { __call: { method: 'DELETE', path: '/x/{id}' } } }), null);
  });
  it('fillDep puts the new id where a row asked for it', () => {
    assert.deepEqual(outbox.fillDep({ opportunity_id: '__dep__', list: ['__dep__'] }, '42'), { opportunity_id: '42', list: ['42'] });
    assert.equal(outbox.fillDep('/opportunity/v1/opportunities/{dep}', '42'), '/opportunity/v1/opportunities/42');
    assert.deepEqual(outbox.requestFor({ op: 'call', action_id: '5', payload: JSON.stringify({ __call: { method: 'patch', path: '/a/1' } }) }), { method: 'PATCH', path: '/a/1' });
  });
});

// ------------------------------------------------------------------ the service, end to end against stand-ins
let db;
let calls;
let script;
let ctx;
let live; // the stand-in Blackbaud's actions, by id
let mirrorActions; // the stand-in mirror's actions, by id
let realFetch;
let nextId;

function newCtx() {
  const repo = {
    async send(list) {
      calls.push(list);
      const results = [];
      for (const c of list) {
        const r = script(c);
        if (r === 'stop') break;
        results.push(r);
      }
      return { results, wait: results.length ? undefined : 'Blackbaud did not answer.', callsToday: 10 };
    },
    async refreshMirror(ids, tags) {
      return { ok: true, runId: 'r', maxCalls: ids.length * (tags ? 2 : 1) };
    },
    async synced() {
      return '2026-10-09T09:00:00Z';
    },
    async modifiedOf() {
      return new Map();
    },
  };
  return { env: { DB: fakeD1(db), MIRROR_API_KEY: 'k', MIRROR_QUERY_URL: 'https://mirror.test/d1/query' }, repo, actor: 'Pat Smith', email: 'pat@example.org' };
}

// Blackbaud stand-in: GET, PATCH, POST and DELETE on actions, notes, tags, attachments and opportunities.
function bbScript(c) {
  const m = c.path.match(/^\/constituent\/v1\/actions\/(\d+)$/);
  if (c.method === 'GET' && c.path.includes('last_modified')) return { ok: true, status: 200, body: { count: 0, value: [] } };
  if (c.method === 'GET' && c.path.startsWith('/constituent/v1/actiontypes')) return { ok: true, status: 200, body: { value: CODES.types } };
  if (c.method === 'GET' && c.path.includes('/customfields/categories')) return { ok: true, status: 200, body: { value: [] } };
  if (c.method === 'GET' && m) return live[m[1]] ? { ok: true, status: 200, body: { ...live[m[1]] } } : { ok: false, status: 404, body: null };
  if (c.method === 'GET' && /\/actions\/\d+\/notes$/.test(c.path)) return { ok: true, status: 200, body: { value: [{ id: '31', type: 'Note (general)', summary: 'Old note', text: 'Was here', date: { y: 2026, m: 10, d: 1 } }] } };
  if (c.method === 'GET') return { ok: true, status: 200, body: { value: [] } };
  if (c.method === 'PATCH' && m) {
    if (!live[m[1]]) return { ok: false, status: 404, body: null };
    Object.assign(live[m[1]], c.body);
    return { ok: true, status: 200, body: {} };
  }
  if (c.method === 'POST' && c.path === '/constituent/v1/actions') {
    const id = String(nextId++);
    live[id] = { id, ...c.body };
    return { ok: true, status: 200, body: { id } };
  }
  if (c.method === 'DELETE' && m) {
    delete live[m[1]];
    return { ok: true, status: 200, body: {} };
  }
  if (c.method === 'POST') return { ok: true, status: 200, body: { id: String(nextId++) } };
  return { ok: true, status: 200, body: {} };
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  calls = [];
  nextId = 8000;
  script = bbScript;
  live = {
    '500': { id: '500', constituent_id: '100', category: 'Task/Other', type: 'RDD Action', summary: 'Call about the year-end gift', description: 'First line', date: '2026-10-01T00:00:00', completed: false, status: 'Open', fundraisers: ['10'], priority: 'Normal' },
    '501': { id: '501', constituent_id: '100', category: 'Phone call', type: 'RDD Action', summary: 'Second', date: '2026-10-02T00:00:00', completed: false, status: 'Open', fundraisers: ['10'], priority: 'Normal' },
  };
  mirrorActions = JSON.parse(JSON.stringify(live));
  ctx = newCtx();
  // The mirror stand-in answers the few shapes edit.ts asks for.
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://mirror.test')) return realFetch(url, init);
    const { sql, params } = JSON.parse(init.body);
    let rows = [];
    if (/FROM constituents WHERE id = \?1/.test(sql)) rows = [{ t: 'Individual', f: 'Ann', l: 'Partner', p: null, o: null, d: 0 }];
    else if (/FROM actions a LEFT JOIN action_tags/.test(sql)) rows = mirrorActions[params[0]] ? [{ raw: JSON.stringify(mirrorActions[params[0]]), synced: '2026-10-09 09:00:00', tags: null }] : [];
    else if (/FROM actions a LEFT JOIN constituents c/.test(sql)) rows = JSON.parse(params[0]).filter((id) => mirrorActions[id]).map((id) => ({ id, raw: JSON.stringify(mirrorActions[id]), mod: '2026-10-09T05:00:00', partner: 'Ann Partner' }));
    else if (/FROM opportunities WHERE id = \?1/.test(sql)) rows = params[0] === '900' ? [{ raw: JSON.stringify({ id: '900', constituent_id: '100', name: 'Year-end', status: 'Planned', ask_amount: { value: 1000 }, date_modified: '2026-10-01T00:00:00' }) }] : [];
    else if (/json_extract\(raw_json, '\$\.completed'\) = 1/.test(sql)) rows = JSON.parse(params[0]).filter((id) => mirrorActions[id] && mirrorActions[id].completed).map((id) => ({ id, due: String(mirrorActions[id].date).slice(0, 10) }));
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const sent = () => calls.flat().filter((c) => c.method !== 'GET');
async function runAll(id) {
  for (let i = 0; i < 10; i++) {
    const r = await svc.runBatch(ctx, id);
    if (!r.left) return r;
  }
  throw new Error('batch never finished');
}

describe('edit one action', () => {
  it('reads it live, sends only what changed, and Undo puts the old values back', async () => {
    const out = await svc.createBatch(ctx, { op: 'edit', ids: ['500'], set: { summary: 'Call about the year-end gift', priority: 'High', location: 'Residence', date: '2026-10-20' }, seen: { priority: 'Normal', location: '', date: '2026-10-01' }, req: 'r1' });
    assert.ok(out.batch.id);
    await runAll(out.batch.id);
    const patch = sent().find((c) => c.method === 'PATCH');
    assert.deepEqual(patch.body, { priority: 'High', location: 'Residence', date: '2026-10-20T00:00:00' });
    assert.equal(live['500'].priority, 'High');
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    assert.equal(live['500'].priority, 'Normal');
    assert.equal(live['500'].location, null);
    assert.equal(live['500'].date, '2026-10-01T00:00:00');
  });
  it('stops when someone changed the same field in Blackbaud after the person opened it', async () => {
    live['500'].summary = 'Changed by Jo in Blackbaud';
    const out = await svc.createBatch(ctx, { op: 'edit', ids: ['500'], set: { summary: 'Mine' }, seen: { summary: 'Call about the year-end gift' }, req: 'r2' });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'conflict');
    assert.deepEqual(out.conflict.fields, ['summary']);
    assert.equal(sent().length, 0);
  });
  it('adds and removes tags of any category, and Undo removes a tag it added', async () => {
    const out = await svc.createBatch(ctx, { op: 'edit', ids: ['500'], set: {}, tags: { add: [{ category: 'Number of Referrals', value: '3' }], remove: [{ id: '44', category: 'Texted' }] }, req: 'r3' });
    await runAll(out.batch.id);
    const tag = sent().find((c) => c.path === '/constituent/v1/actions/customfields' && c.body && c.body.category);
    assert.deepEqual([tag.body.category, tag.body.value, tag.body.parent_id], ['Number of Referrals', 3, '500']);
    assert.ok(sent().some((c) => c.method === 'DELETE' && c.path === '/constituent/v1/actions/customfields/44?action=500'));
    calls = [];
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    assert.ok(sent().some((c) => c.method === 'DELETE' && /customfields\/\d+\?action=500$/.test(c.path)));
  });
});

describe('edit many at once', () => {
  it('sets the same fields on each, skips what already matches, adds a line with the day and the person', async () => {
    mirrorActions['501'].priority = 'High';
    const out = await svc.createBatch(ctx, { op: 'bulk_edit', ids: ['500', '501'], set: { priority: 'High', type: 'PC Action' }, line: 'Moved to Partner Care', req: 'r4' });
    await runAll(out.batch.id);
    const patches = sent().filter((c) => c.method === 'PATCH');
    assert.equal(patches.length, 2);
    assert.deepEqual(Object.keys(patches.find((p) => p.path.endsWith('/501')).body).sort(), ['description', 'type']);
    assert.match(String(live['500'].description), /First line\nMoved to Partner Care \(Oct \d+, 2026, Pat Smith\)/);
  });
});

describe('new actions, follow-ups and repeats', () => {
  it('a new action with a tag and a follow-up: the tag goes on the new action, the follow-up is open', async () => {
    const out = await svc.createBatch(ctx, { op: 'new', cids: ['100'], set: { category: 'Phone call', type: 'RDD Action', summary: 'Thanked for the gift', completed: true, fundraisers: ['10'] }, tags: { add: [{ category: 'Thanked' }] }, next: { category: 'Task/Other', summary: 'Send the report', date: '2026-10-30' }, req: 'r5' });
    await runAll(out.batch.id);
    const creates = sent().filter((c) => c.path === '/constituent/v1/actions');
    assert.equal(creates.length, 2);
    assert.equal(creates[0].body.completed, true);
    assert.equal(creates[1].body.completed, false);
    assert.equal(creates[1].body.status, 'Open');
    const tag = sent().find((c) => c.path === '/constituent/v1/actions/customfields' && c.body && c.body.category);
    assert.equal(tag.body.parent_id, '8000');
  });
  it('a repeat: completing the action makes the next one in the same batch, and that one repeats too', async () => {
    const out = await svc.createBatch(ctx, { op: 'new', cids: ['100'], set: { category: 'Task/Other', summary: 'Monthly call', date: '2026-10-20', completed: false }, recur: { every: 1, unit: 'month', left: 2 }, req: 'r6' });
    await runAll(out.batch.id);
    const rec = db.prepare('SELECT * FROM act_recur').get();
    assert.equal(rec.action_id, '8000');
    calls = [];
    const done = await svc.createBatch(ctx, { op: 'edit', ids: ['8000'], set: { completed: true }, req: 'r7' });
    await runAll(done.batch.id);
    const next = sent().find((c) => c.path === '/constituent/v1/actions' && c.method === 'POST');
    assert.ok(next, 'the next one was made');
    assert.equal(next.body.date, '2026-11-20T00:00:00');
    assert.equal(next.body.summary, 'Monthly call');
    const rows = db.prepare('SELECT action_id, active, rule FROM act_recur ORDER BY created_at').all();
    assert.equal(rows.find((r) => r.action_id === '8000').active, 0);
    assert.equal(JSON.parse(rows.find((r) => r.action_id !== '8000').rule).left, 1);
  });
  it('a repeat completed in Blackbaud itself still makes its next one on the freshness pass', async () => {
    db.prepare("INSERT INTO act_recur (action_id, cid, rule, template, active, created_at) VALUES ('501', '100', ?, ?, 1, 'x')").run(JSON.stringify({ every: 2, unit: 'week' }), JSON.stringify({ category: 'Phone call', summary: 'Check in', fundraisers: ['10'] }));
    mirrorActions['501'].completed = true;
    mirrorActions['501'].date = '2099-01-01T00:00:00';
    const made = await svc.repeatsDoneElsewhere(ctx);
    assert.equal(made, 1);
    const next = sent().find((c) => c.path === '/constituent/v1/actions');
    assert.equal(next.body.date, '2099-01-15T00:00:00');
  });
  it('complete and schedule next: one PATCH, one open action with the same partner and fundraiser', async () => {
    const out = await svc.createBatch(ctx, { op: 'complete_next', ids: ['500'], complete: { outcome: 'Successful' }, next: { date: '2026-11-02', summary: 'Visit in person', category: 'Meeting' }, req: 'r8' });
    await runAll(out.batch.id);
    assert.equal(live['500'].completed, true);
    assert.equal(live['500'].outcome, 'Successful');
    const next = live['8000'];
    assert.equal(next.constituent_id, '100');
    assert.deepEqual(next.fundraisers, ['10']);
    assert.equal(next.category, 'Meeting');
    assert.equal(next.completed, false);
  });
});

describe('duplicate, move, delete', () => {
  it('move: the copy goes first, the original only after it, and Undo brings the original back', async () => {
    const out = await svc.createBatch(ctx, { op: 'move', ids: ['501'], to: '200', req: 'r9' });
    await runAll(out.batch.id);
    const order = sent().map((c) => c.method + ' ' + c.path);
    assert.deepEqual(order.slice(0, 2), ['POST /constituent/v1/actions', 'DELETE /constituent/v1/actions/501']);
    assert.equal(live['8000'].constituent_id, '200');
    assert.equal(live['501'], undefined);
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    assert.equal(live['8000'], undefined);
    const back = Object.values(live).find((a) => a.summary === 'Second' && a.constituent_id === '100');
    assert.ok(back, 'the original came back on its partner');
  });
  it('move: a refused copy never removes the original', async () => {
    script = (c) => (c.method === 'POST' && c.path === '/constituent/v1/actions' ? { ok: false, status: 400, body: [{ message: 'no' }] } : bbScript(c));
    const out = await svc.createBatch(ctx, { op: 'move', ids: ['501'], to: '200', req: 'r10' });
    for (let i = 0; i < 4; i++) await svc.runBatch(ctx, out.batch.id);
    await svc.retryBatch(ctx, out.batch.id).catch(() => undefined);
    assert.ok(live['501'], 'the original is still there');
    assert.ok(!sent().some((c) => c.method === 'DELETE'));
  });
  it('duplicate to two partners makes two copies', async () => {
    const out = await svc.createBatch(ctx, { op: 'duplicate', ids: ['500'], cids: ['100', '300'], req: 'r11' });
    await runAll(out.batch.id);
    const creates = sent().filter((c) => c.path === '/constituent/v1/actions');
    assert.deepEqual(creates.map((c) => c.body.constituent_id).sort(), ['100', '300']);
  });
  it('delete, then Undo makes a copy with the same fields', async () => {
    const out = await svc.createBatch(ctx, { op: 'delete', ids: ['500'], req: 'r12' });
    await runAll(out.batch.id);
    assert.equal(live['500'], undefined);
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    const back = Object.values(live).find((a) => a.summary === 'Call about the year-end gift');
    assert.equal(back.constituent_id, '100');
    assert.equal(back.description, 'First line');
  });
});

describe('notes, attachments, opportunities', () => {
  it('a note is added, and Undo removes the note it added', async () => {
    const out = await svc.createBatch(ctx, { op: 'note', ids: ['500'], note: { summary: 'Prefers mornings', text: 'Call before 10' }, req: 'r13' });
    await runAll(out.batch.id);
    const add = sent().find((c) => c.path === '/constituent/v1/actions/notes');
    assert.equal(add.body.parent_id, '500');
    assert.equal(add.body.type, 'RDD Note');
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    assert.ok(sent().some((c) => c.method === 'DELETE' && /\/actions\/notes\/\d+$/.test(c.path)));
  });
  it('a removed note comes back on Undo', async () => {
    const out = await svc.createBatch(ctx, { op: 'note', ids: ['500'], note: { id: '31', remove: true }, req: 'r14' });
    await runAll(out.batch.id);
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    const back = sent().filter((c) => c.method === 'POST' && c.path === '/constituent/v1/actions/notes').pop();
    assert.equal(back.body.summary, 'Old note');
  });
  it('a link attachment needs an https address', async () => {
    await assert.rejects(() => svc.createBatch(ctx, { op: 'attach', ids: ['500'], attach: { url: 'javascript:alert(1)' }, req: 'r15' }), /https/);
    const out = await svc.createBatch(ctx, { op: 'attach', ids: ['500'], attach: { url: 'https://drive.google.com/x', name: 'Proposal' }, req: 'r16' });
    await runAll(out.batch.id);
    const a = sent().find((c) => c.path === '/constituent/v1/actions/attachments');
    assert.deepEqual([a.body.type, a.body.name, a.body.parent_id], ['Link', 'Proposal', '500']);
  });
  it('a new opportunity links the action it was made from, and the hub keeps its copy until the mirror has it', async () => {
    const out = await svc.createBatch(ctx, { op: 'opp_new', cid: '100', ids: ['500'], opp: { name: 'Year-end ask', status: 'Planned', ask_amount: '5000', fundraisers: ['10'] }, req: 'r17' });
    await runAll(out.batch.id);
    const post = sent().find((c) => c.path === '/opportunity/v1/opportunities');
    assert.equal(post.body.constituent_id, '100');
    assert.equal(post.body.__opp, undefined, 'markers never reach Blackbaud');
    const link = sent().find((c) => c.method === 'PATCH' && c.path === '/constituent/v1/actions/500');
    assert.equal(link.body.opportunity_id, String(nextId - 1));
    const shadow = db.prepare('SELECT * FROM act_opps').get();
    assert.equal(JSON.parse(shadow.raw).name, 'Year-end ask');
  });
  it('an opportunity edit keeps the old values for Undo', async () => {
    const out = await svc.createBatch(ctx, { op: 'opp_edit', opp_id: '900', opp: { status: 'Awarded - Closed', funded_amount: '1000' }, req: 'r18' });
    await runAll(out.batch.id);
    const undo = await svc.undoBatch(ctx, out.batch.id);
    await runAll(undo.batch.id);
    const back = sent().filter((c) => c.method === 'PATCH' && c.path === '/opportunity/v1/opportunities/900').pop();
    assert.equal(back.body.status, 'Planned');
    assert.deepEqual(back.body.funded_amount, { value: 0 });
  });
});

describe('saved views', () => {
  it('each person has their own, and one opens first', async () => {
    await edit.saveView(ctx.env, 'pat@example.org', { name: 'My past due', spec: { tab: 'open', f: { due: 'past' } }, default: true });
    const list = await edit.saveView(ctx.env, 'pat@example.org', { name: 'Thank-yous', spec: { tab: 'ty' } });
    assert.equal(list.length, 2);
    assert.equal(list.find((v) => v.default).name, 'My past due');
    assert.equal((await edit.listViews(ctx.env, 'jo@example.org')).length, 0);
    const left = await edit.deleteView(ctx.env, 'jo@example.org', list[0].id);
    assert.equal(left.length, 0, 'another person cannot delete it');
    assert.equal((await edit.listViews(ctx.env, 'pat@example.org')).length, 2);
  });
});
