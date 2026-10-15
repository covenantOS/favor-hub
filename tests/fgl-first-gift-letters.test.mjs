// Run with: npm test (or node --test tests/fgl-first-gift-letters.test.mjs)
//
// First-gift letters (Gifts > First-gift letters) and the line between them and Receipts. A made-up mirror (the real column layout, in memory),
// a made-up Blackbaud waiting list (the sync worker's CSV) and a recording stand-in for the acknowledge route. Every name and amount is made
// up. Nothing here can reach Blackbaud or the live mirror.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';
import { memoryR2 } from './support/r2.mjs';

const C = await import('../functions/_lib/fgl/classify.ts');
const S = await import('../functions/_lib/fgl/store.ts');
const W = await import('../functions/_lib/fgl/wording.ts');
const H = await import('../functions/_lib/fgl/hold.ts');
const R = await import('../functions/_lib/receipts/store.ts');
const Rules = await import('../functions/_lib/receipts/rules.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');
const G = await import('../functions/_lib/fgl/gate.ts');

const realFetch = globalThis.fetch;
let mirror;
let hub;
let env;
let waitingCsv;
let acks;

const HEAD = ['QRECID', 'Gift ID', 'Gift Date', 'Gift Amount', 'Gift Type', 'Gift Constituency', 'Constituent ID', 'Name', 'Sort Name', 'Key Indicator', 'Deceased', 'Inactive?',
  'Primary Addressee', 'Primary Salutation', 'Solicit Code Description', 'Preferred Address Lines', 'Preferred City', 'Preferred State', 'Preferred ZIP', 'Preferred Country',
  'Preferred Send Mail To This Address', 'Fund Description', 'Soft Credit Recipient Sort Name'];

function row(id, cid, name, amount, o = {}) {
  const [first, last] = name.split(' ');
  return [id, `G-${id}`, o.date || '9/20/2026', amount, o.type || 'One-Time Gift', o.constituency || 'Individual', cid, name, `${last}, ${first}`, o.org ? 'Organization' : 'Individual', 'No', 'No',
    name, first, o.solicit || '', o.lines === undefined ? '12 Maple St' : o.lines, o.lines === '' ? '' : 'Tampa', 'FL', o.lines === '' ? '' : '33601', o.country || 'United States', 'Yes', 'General GIFT Program', o.soft || '']
    .map((v) => `"${String(v).replace(/"/g, '""')}"`)
    .join(',');
}
const csvOf = (rows) => [HEAD.map((h) => `"${h}"`).join(','), ...rows].join('\n');

function person(id, first, last, o = {}) {
  mirror.prepare('INSERT INTO constituents (id, constituent_type, first_name, last_name, organization_name, spouse_id, raw_json) VALUES (?,?,?,?,?,?,?)').run(
    id, o.org ? 'Organization' : 'Individual', o.org ? null : first, o.org ? null : last, o.org || null, o.spouse || null, JSON.stringify({ name: o.org || `${first} ${last}` }));
}
function gift(id, cid, amount, date, o = {}) {
  mirror.prepare('INSERT INTO gifts (id, gift_amount, gift_date, gift_type, constituent_record_id, gift_splits, soft_credits, acknowledgment_status) VALUES (?,?,?,?,?,?,?,?)').run(
    id, amount, date + 'T00:00:00', o.type || 'Donation', cid, JSON.stringify([{ id: id + '9', amount: { value: amount }, appeal_id: o.appeal || '2301', fund_id: '79' }]),
    o.soft ? JSON.stringify(o.soft.map((c) => ({ id: 'sc' + c, amount: { value: amount }, constituent_id: c }))) : null, o.ack || 'NotAcknowledged');
}

before(() => {
  mirror = new DatabaseSync(':memory:');
  mirror.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_type TEXT, first_name TEXT, last_name TEXT, organization_name TEXT, spouse_id TEXT, raw_json TEXT);
    CREATE TABLE constituent_codes (id TEXT PRIMARY KEY, constituent_record_id TEXT, code_description TEXT, raw_json TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_amount REAL, gift_date DATETIME, gift_type TEXT, constituent_record_id TEXT, gift_splits TEXT, soft_credits TEXT, acknowledgment_status TEXT);
    CREATE TABLE appeals (id TEXT PRIMARY KEY, appeal_id TEXT, appeal_category TEXT);
  `);
  mirror.prepare("INSERT INTO appeals VALUES ('2301', 'K254-GIFT', 'Acquisition'), ('2302', 'K254-FD', 'Acquisition'), ('2', 'GEN', 'Direct Mail Appeal')").run();
  person('8801', 'Lena', 'Dorn');
  person('8802', null, null, { org: 'Sample Giving Fund' });
  person('100', 'Ada', 'Brook');
  person('101', 'Ben', 'Cole', { spouse: '102' });
  person('102', 'Cara', 'Cole', { spouse: '101' });
  person('103', 'Dan', 'Hale');
  person('104', 'Eve', 'Marsh');
  person('105', 'Fay', 'Ivers');
  person('106', 'Gil', 'Nash');
  person('107', 'Hal', 'Stone');
  // 7001: the first gift of 8801, coded to an acquisition appeal.
  gift('7001', '8801', 25, '2026-09-20', { appeal: '2301' });
  // 7002 is 100's first gift (acknowledged long ago); 7003 is a second gift with an acquisition code: not a first gift.
  gift('7002', '100', 10, '2026-08-01', { appeal: '2301', ack: 'Acknowledged' });
  gift('7003', '100', 30, '2026-09-25', { appeal: '2301' });
  // 7004: 101 gave an acquisition gift, but spouse 102 gave in 2025: the household's first gift is not this one.
  gift('6000', '102', 100, '2025-03-01', { appeal: '2', ack: 'Acknowledged' });
  gift('7004', '101', 40, '2026-09-26', { appeal: '2301' });
  // 7005: the foundation's gift soft credited to 103, whose first credited gift it is.
  gift('7005', '8802', 500, '2026-09-27', { appeal: '2302', soft: ['103'] });
  // 7006: a first gift to a regular appeal: stays on Receipts.
  gift('7006', '104', 50, '2026-09-28', { appeal: '2' });
  // 7007 is a recurring schedule row coded to an acquisition appeal; 7008 is its first payment.
  gift('7007', '105', 15, '2026-09-01', { appeal: '2301', type: 'RecurringGift' });
  gift('7008', '105', 15, '2026-09-29', { appeal: '2301', type: 'RecurringGiftPayment' });
  // 7009: a first gift of $5 to a stranger: letter at $5 here, held 'Under $10' on Receipts if it were a regular gift.
  gift('7009', '106', 5, '2026-09-30', { appeal: '2301' });
  // 7010: acquisition first gift to a record with no address.
  gift('7010', '107', 20, '2026-09-30', { appeal: '2302' });
});

beforeEach(() => {
  hub = memoryD1();
  hub.exec(readFileSync(new URL('../db/receipts.sql', import.meta.url), 'utf8'));
  hub.exec(readFileSync(new URL('../db/first-gift-letters.sql', import.meta.url), 'utf8'));
  hub.exec('CREATE TABLE act_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)');
  env = { DB: hub, UPLOADS: memoryR2(), RECEIPTS_KEY: 'test', MIRROR_API_KEY: 'test', ASSETS: undefined };
  acks = [];
  waitingCsv = csvOf([
    row('7001', '8801', 'Lena Dorn', 25),
    row('7003', '100', 'Ada Brook', 30),
    row('7004', '101', 'Ben Cole', 40),
    row('7005', '8802', 'Sample Giving Fund', 500, { org: true, constituency: 'Foundation', soft: 'Hale, Dan' }),
    row('7006', '104', 'Eve Marsh', 50),
    row('7008', '105', 'Fay Ivers', 15, { type: 'Recurring Gift Payment' }),
    row('7009', '106', 'Gil Nash', 5),
    row('7010', '107', 'Hal Stone', 20, { lines: '' }),
  ]);
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : {};
    if (u.endsWith('/d1/query')) {
      readOnly(body.sql);
      return new Response(JSON.stringify(mirror.prepare(body.sql).all(...(body.params || []))), { status: 200 });
    }
    if (u.endsWith('/receipts/query')) return new Response(JSON.stringify({ ok: true, csv: waitingCsv }), { status: 200 });
    if (u.endsWith('/receipts/acknowledge')) {
      acks.push(body);
      return new Response(JSON.stringify({ ok: true, results: body.ids.map((id) => ({ id, ok: true, status: 200 })), stopped: '' }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ids = (list) => list.map((x) => x.id).sort();

describe('which gifts are acquisition first gifts', () => {
  it('keeps a first credited gift coded to an Acquisition appeal and drops the rest', async () => {
    const q = async (sql, params = []) => mirror.prepare(readOnly(sql)).all(...params);
    const got = await C.acquisitionFirstGifts(q, ['7001', '7003', '7004', '7005', '7006', '7007', '7008', '7009', '7010']);
    assert.deepEqual([...got.keys()].sort(), ['7001', '7005', '7008', '7009', '7010']);
    assert.deepEqual(got.get('7001').appeals, ['K254-GIFT']);
    assert.deepEqual(got.get('7005').credited, ['103'], 'a soft-credited gift is the first gift of the partner it names');
  });
  it('ignores ids that are not numbers and answers nothing for an empty list', async () => {
    const q = async () => {
      throw new Error('no read expected');
    };
    assert.equal((await C.acquisitionFirstGifts(q, [])).size, 0);
    assert.equal((await C.acquisitionFirstGifts(q, ['x; DROP', ''])).size, 0);
  });
});

describe('the First-gift letters list', () => {
  it('lists the letters and holds back a pass-through gift and records with no address', async () => {
    const v = await S.fglView(env, { days: 90, fresh: true });
    assert.deepEqual(ids(v.letters), ['7001', '7008', '7009']);
    assert.deepEqual(Object.fromEntries(v.held.map((h) => [h.id, h.key])), { 7005: 'pass_through', 7010: 'no_address' });
    assert.equal(v.receiptsKeep, 3, 'the second gift (7003), the household gift (7004) and the regular gift (7006) stay on Receipts');
    assert.ok(v.letters.every((l) => l.appeals.length));
  });
  it('gives a $5 first gift a letter, where Receipts holds a $5 gift under $10', async () => {
    const v = await S.fglView(env, { days: 90, fresh: true });
    assert.ok(v.letters.some((l) => l.id === '7009' && l.amount === 5));
    const g = Rules.giftsFromRows([]).length;
    assert.equal(g, 0);
    const five = { ...(await R.loadGifts(env, 90)).find((x) => x.id === '7009') };
    assert.equal(Rules.verdict(five).key, 'small');
    assert.equal(Rules.verdict(five, 0).letter, true);
  });
  it('shows the test user a made-up list and reads nothing', async () => {
    globalThis.fetch = async () => {
      throw new Error('a test user must not read Blackbaud or the mirror');
    };
    const v = await S.fglView(env, { days: 90, sample: true });
    assert.equal(v.sample, true);
    assert.ok(v.letters.length >= 8);
    const keys = new Set(v.held.map((h) => h.key));
    for (const k of ['organization', 'abroad', 'no_address', 'no_mail', 'deceased', 'inactive']) assert.ok(keys.has(k), `sample holds one for ${k}`);
  });
});

describe('Receipts and First-gift letters never share a gift', () => {
  it('holds every acquisition first gift off Receipts and keeps the rest', async () => {
    const r = await R.waitingView(env, 90, true);
    assert.deepEqual(ids(r.letters), ['7003', '7004', '7006'].sort());
    const heldKeys = Object.fromEntries(r.held.map((h) => [h.id, h.key]));
    for (const id of ['7001', '7005', '7008', '7009', '7010']) assert.equal(heldKeys[id], 'first_gift', `${id} is held for a first-gift letter`);
    assert.ok(r.held.filter((h) => h.key === 'first_gift').every((h) => h.canAdd === false), 'Receipts cannot add a first gift back');
  });
  it('splits the waiting list cleanly: every gift is a Receipts letter or a first-gift letter or held, once', async () => {
    const r = await R.waitingView(env, 90, true);
    const f = await S.fglView(env, { days: 90, fresh: true });
    const onReceipts = new Set(r.letters.map((x) => x.id));
    const onFirstGifts = new Set([...f.letters, ...f.held].map((x) => x.id));
    const waiting = ['7001', '7003', '7004', '7005', '7006', '7008', '7009', '7010'];
    for (const id of waiting) assert.notEqual(onReceipts.has(id), onFirstGifts.has(id), `${id} must be on exactly one of the two pages`);
    assert.equal(onReceipts.size + onFirstGifts.size, waiting.length);
  });
  it('a gift in an open first-gift print file leaves Receipts and shows as in the file; a thrown-away file gives it back', async () => {
    const f = await S.fglView(env, { days: 90, fresh: true });
    const { letters, appeals } = await S.lettersFor(env, ['7001'], 90, false);
    const batch = await S.makeBatch(env, { letters, letterDate: '2026-10-15', signer: 'carole', appeals, actor: 'Test', simulated: false });
    assert.equal(batch.count, 1);
    const open = await H.openFglGifts(env);
    assert.deepEqual([...open.keys()], ['7001']);
    const r = await R.waitingView(env, 90, true);
    assert.equal(r.held.find((h) => h.id === '7001').key, 'first_gift_file');
    const after = await S.fglView(env, { days: 90, fresh: true });
    assert.equal(after.letters.find((l) => l.id === '7001').batch.id, batch.id);
    // Receipts refuses to print it even when asked by id.
    const out = await R.lettersFor(env, ['7001', '7006'], [], 90);
    assert.deepEqual(out.letters.map((l) => l.giftId), ['7006']);
    assert.match(out.skipped.find((s) => s.id === '7001').why, /first-gift letters print file/);
    // A second file cannot hold the same gift.
    const again = await S.lettersFor(env, ['7001'], 90, false);
    assert.deepEqual(again.letters, []);
    assert.match(again.skipped[0].why, /already in a print file/);
    // Throw the file away: the gift is back on the first-gift list and still held off Receipts.
    hub.db.prepare("UPDATE fgl_batches SET status = 'cancelled'").run();
    assert.equal((await H.openFglGifts(env)).size, 0);
    assert.equal((await S.lettersFor(env, ['7001'], 90, false)).letters.length, 1);
    assert.equal((await R.waitingView(env, 90, true)).held.find((h) => h.id === '7001').key, 'first_gift');
    assert.ok(f);
  });
  it('a gift in an open receipts print file is not offered a first-gift letter', async () => {
    hub.db.prepare("INSERT INTO rcp_batches (id, kind, letter_date, appeal_code, count, pdf_key, letters, copy, status, created_at) VALUES ('rb1', 'new', '2026-10-14', 'Y26A-TY', 1, 'k', '[]', '{}', 'printing', '2026-10-14T10:00:00Z')").run();
    hub.db.prepare("INSERT INTO rcp_batch_gifts (batch_id, gift_id, state, updated_at) VALUES ('rb1', '7008', 'waiting', '2026-10-14T10:00:00Z')").run();
    const f = await S.fglView(env, { days: 90, fresh: true });
    assert.ok(!f.letters.some((l) => l.id === '7008'));
    assert.equal(f.held.find((h) => h.id === '7008').key, 'in_receipts');
    const out = await S.lettersFor(env, ['7008'], 90, false);
    assert.deepEqual(out.letters, []);
    assert.match(out.skipped[0].why, /receipts print file/);
  });
  it('keeps Receipts working when the mirror cannot be read', async () => {
    const f = globalThis.fetch;
    globalThis.fetch = async (url, init) => (String(url).endsWith('/d1/query') ? new Response('{}', { status: 500 }) : f(url, init));
    const holds = await H.fglHolds(env, ['7001']);
    assert.equal(holds.size, 0, 'open files still hold gifts back, the mirror failing holds none');
    const r = await R.waitingView(env, 90, true);
    assert.ok(r.letters.length > 0);
  });
});

describe('print files, marking and Undo', () => {
  it('makes one PDF with a page per partner and the wording and signer chosen', async () => {
    const { letters, appeals } = await S.lettersFor(env, ['7001', '7008', '7009'], 90, false);
    assert.deepEqual(appeals, ['K254-GIFT']);
    const b = await S.makeBatch(env, { letters, letterDate: '2026-10-15', signer: 'terry', appeals, actor: 'Test Support', simulated: false });
    assert.equal(b.count, 3);
    assert.equal(b.gifts, 3);
    assert.equal(b.amount, 45);
    assert.equal(b.signer, 'terry');
    const pdf = await env.UPLOADS.get(b.pdf_key);
    const bytes = new Uint8Array(await new Response(pdf.body).arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
    const docs = JSON.parse(b.letters);
    assert.equal(docs.length, 3);
    const d = docs.find((x) => x.addressLines[0] === 'Lena Dorn');
    assert.equal(d.signerName, 'Terry Goodman');
    assert.equal(d.greeting, 'Dear Lena Dorn,');
    assert.match(d.paragraphs[0], /first gift of \$25/);
    assert.equal(d.dateLine, 'October 15, 2026');
    assert.equal((await S.openFile(env)).id, b.id);
  });
  it('marks the gifts acknowledged through the receipts route, dated the letter date, 40 at a time at most', async () => {
    const { letters, appeals } = await S.lettersFor(env, ['7001', '7008'], 90, false);
    const b = await S.makeBatch(env, { letters, letterDate: '2026-10-15', signer: 'carole', appeals, actor: 'Test', simulated: false });
    const out = await S.markNext(env, await S.getBatch(env, b.id), 'Test', false);
    assert.deepEqual({ marked: out.marked, failed: out.failed, waiting: out.waiting }, { marked: 2, failed: 0, waiting: 0 });
    assert.equal(acks.length, 1);
    assert.deepEqual(acks[0], { batch: b.id, date: '2026-10-15', ids: ['7001', '7008'] });
    const done = await S.getBatch(env, b.id);
    assert.equal(done.status, 'done');
    assert.equal(done.marked_by, 'Test');
    assert.equal((await S.openFile(env)), null, 'the file is closed so the next one can be made');
  });
  it('does not mark a gift twice: a finished file sends nothing on a second press', async () => {
    const { letters, appeals } = await S.lettersFor(env, ['7001'], 90, false);
    const b = await S.makeBatch(env, { letters, letterDate: '2026-10-15', signer: 'carole', appeals, actor: 'Test', simulated: false });
    await S.markNext(env, b, 'Test', false);
    await S.markNext(env, await S.getBatch(env, b.id), 'Test', false);
    assert.equal(acks.length, 1);
  });
  it('leaves a gift Blackbaud turned down on the list to try again', async () => {
    const f = globalThis.fetch;
    globalThis.fetch = async (url, init) =>
      String(url).endsWith('/receipts/acknowledge')
        ? new Response(JSON.stringify({ ok: true, results: [{ id: '7001', ok: false, status: 400, detail: 'refused' }], stopped: '' }), { status: 200 })
        : f(url, init);
    const { letters, appeals } = await S.lettersFor(env, ['7001'], 90, false);
    const b = await S.makeBatch(env, { letters, letterDate: '2026-10-15', signer: 'carole', appeals, actor: 'Test', simulated: false });
    const out = await S.markNext(env, b, 'Test', false);
    assert.equal(out.failed, 1);
    assert.equal((await S.getBatch(env, b.id)).status, 'marking');
    assert.equal((await S.openFile(env)).id, b.id, 'still open until the failure is cleared');
  });
  it('simulates the mark for a test file and sends nothing to Blackbaud', async () => {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/receipts/acknowledge')) throw new Error('a test file must not call Blackbaud');
      throw new Error('unexpected ' + url);
    };
    const s = await S.lettersFor(env, ['sample1', 'sample2'], 90, true);
    const b = await S.makeBatch(env, { letters: s.letters, letterDate: '2026-10-15', signer: 'carole', appeals: s.appeals, actor: 'FavorOS Tester', simulated: true });
    assert.equal(b.simulated, 1);
    const out = await S.markNext(env, b, 'FavorOS Tester', false);
    assert.equal(out.marked, 2);
    assert.equal((await S.getBatch(env, b.id)).status, 'done');
  });
  it('lists past files newest first with the figures, and the summary names the signer', async () => {
    const { letters, appeals } = await S.lettersFor(env, ['7001'], 90, false);
    const b = await S.makeBatch(env, { letters, letterDate: '2026-10-15', signer: 'rachel', appeals, actor: 'Test', simulated: false });
    const list = await S.listBatches(env);
    assert.equal(list.length, 1);
    const sum = S.batchSummary(list[0]);
    assert.equal(sum.signerName, 'Rachel Cox');
    assert.deepEqual(sum.appeals, ['K254-GIFT']);
    assert.equal(sum.id, b.id);
  });
});

describe('the wording', () => {
  it('cleans a saved copy and falls back to the default', () => {
    assert.equal(W.cleanWording(null).text, W.DEFAULT_WORDING.text);
    const w = W.cleanWording({ text: 'Hello {amount} {bogus} {date}.\n\nSecond paragraph about {fund}.', closing: '  Blessings, ', greeting: 'first', signer: 'michael' });
    assert.equal(w.text, 'Hello {amount}  {date}.\n\nSecond paragraph about {fund}.');
    assert.equal(w.closing, 'Blessings,');
    assert.equal(w.greeting, 'first');
    assert.equal(w.signer, 'michael');
    assert.equal(W.cleanWording({ signer: 'nobody' }).signer, 'carole');
  });
  it('saves, keeps the old wording in the log, and uses it on the next file', async () => {
    await S.saveWording(env, { text: 'Thank you for {amount} on {date}, a gift to {fund}.', closing: 'Gratefully,', greeting: 'first', signer: 'rachel' }, 'Test');
    assert.equal((await S.getWording(env)).wording.signer, 'rachel');
    const { letters, appeals } = await S.lettersFor(env, ['7001'], 90, false);
    const b = await S.makeBatch(env, { letters, letterDate: '2026-10-15', signer: 'rachel', appeals, actor: 'Test', simulated: false });
    const d = JSON.parse(b.letters)[0];
    assert.equal(d.greeting, 'Dear Lena,');
    assert.equal(d.paragraphs[0], 'Thank you for $25 on Sep 20, a gift to General GIFT Program.');
    assert.equal(d.closing, 'Gratefully,');
    const log = hub.db.prepare("SELECT kind FROM rcp_log WHERE kind = 'fgl_wording'").all();
    assert.equal(log.length, 1);
  });
  it('the default wording follows the writing rules', () => {
    const all = `${W.DEFAULT_WORDING.text} ${W.DEFAULT_WORDING.closing}`;
    assert.ok(!/[—–]/.test(all), 'no dashes used as punctuation in the default wording');
    assert.ok(!/\bdonors?\b/i.test(all));
    assert.ok(/first gift of \{amount\}/.test(all));
  });
});

describe('who may open the page', () => {
  const sc = (role, all) => ({ scope: { role, all, email: 'x@favorintl.org', name: 'X', fid: null, team: '', fids: new Set() } });
  it('lets in admins, the Support Team and Partner Care', () => {
    for (const c of [sc('admin', true), sc('support', false), sc('partner_care', false), { scope: undefined }]) assert.doesNotThrow(() => G.requireFgl(c));
  });
  it('refuses directors, grants writers and the gate fallback scope', () => {
    for (const c of [sc('director', false), sc('grants', false), sc('admin', false)]) assert.throws(() => G.requireFgl(c), /First-gift letters are for/);
  });
});
