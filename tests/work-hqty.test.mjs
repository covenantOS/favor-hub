// Run with: npm test
//
// The HQTY letters desk (functions/_lib/work/hqty.ts) against an in-memory copy of the mirror's tables in their real column layout and
// an in-memory hub database. Every name, id and amount is made up: the repository is public. The mirror query function refuses the
// same statement text the live mirror endpoint refuses.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const H = await import('../functions/_lib/work/hqty.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');
const L = await import('../functions/_lib/work/letters.ts');

const TODAY = '2026-10-15';
let mirror;
let hub;
const q = async (sql, params = []) => {
  readOnly(sql);
  return mirror.prepare(sql).all(...params);
};

function party(id, o) {
  mirror.prepare('INSERT INTO constituents (id, constituent_type, first_name, last_name, preferred_name, organization_name, title, spouse_first_name, spouse_last_name, inactive, deceased, raw_json) VALUES (?,?,?,?,?,?,?,?,?,0,?,?)').run(
    id, o.kind || 'Individual', o.first || null, o.last || null, o.preferred || null, o.org || null, o.title || null, o.sfirst || null, o.slast || null, o.deceased ? 1 : 0, JSON.stringify({ name: o.name || o.org || `${o.first} ${o.last}`, address: { city: o.city || 'Tampa', state: 'FL' } }));
}
function addr(id, cid, o = {}) {
  mirror.prepare('INSERT INTO addresses (id, constituent_record_id, address_lines, address_city, address_state, address_postal_code, address_country, do_not_mail, is_primary, is_inactive) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    id, cid, o.lines ?? '1 Main St', o.city ?? 'Tampa', 'FL', o.zip ?? '33606', 'United States', o.dnm ? 1 : 0, 1, o.inactive ? 1 : 0);
}
function gift(id, cid, amount, date, o = {}) {
  mirror.prepare('INSERT INTO gifts (id, gift_amount, gift_date, gift_type, gift_status, constituent_record_id, gift_splits, soft_credits, gift_payment_method) VALUES (?,?,?,?,?,?,?,?,?)').run(
    id, amount, date + 'T00:00:00', o.type || 'Donation', o.status || 'Active', cid, JSON.stringify([{ id: id + '9', amount: { value: amount }, fund_id: o.fund || '79' }]), o.soft ? JSON.stringify(o.soft.map((c) => ({ id: 'sc' + c, amount: { value: amount }, constituent_id: c }))) : null, 'PersonalCheck');
}
function hqtyAction(id, cid, date) {
  mirror.prepare('INSERT INTO actions (id, action_date_due, action_category, action_type, constituent_record_id, raw_json) VALUES (?,?,?,?,?,?)').run(id, date + 'T00:00:00', 'Mailing', 'RESERVED (HQTY Letter)', cid, JSON.stringify({ completed: true }));
}

const ctxFor = (role = 'support') => ({
  env: { DB: hub },
  repo: { synced: async () => '2026-10-15T09:03:00Z' },
  actor: 'Test Support',
  email: 'support@favorintl.org',
  scope: { role, email: 'support@favorintl.org', name: 'Test Support', fid: '501', team: 'Support', all: role === 'admin', fids: new Set(['501']) },
});

before(() => {
  mirror = new DatabaseSync(':memory:');
  mirror.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_type TEXT, first_name TEXT, last_name TEXT, preferred_name TEXT, organization_name TEXT, title TEXT,
      spouse_first_name TEXT, spouse_last_name TEXT, spouse_id TEXT, inactive INTEGER DEFAULT 0, deceased INTEGER DEFAULT 0, raw_json TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_amount REAL, gift_date DATETIME, gift_type TEXT, gift_status TEXT, gift_splits TEXT, constituent_record_id TEXT, soft_credits TEXT, gift_payment_method TEXT);
    CREATE TABLE addresses (id TEXT PRIMARY KEY, constituent_record_id TEXT, address_lines TEXT, address_city TEXT, address_state TEXT, address_postal_code TEXT, address_country TEXT,
      do_not_mail INTEGER DEFAULT 0, is_primary INTEGER DEFAULT 1, is_inactive INTEGER DEFAULT 0);
    CREATE TABLE actions (id TEXT PRIMARY KEY, action_date_due DATETIME, action_category TEXT, action_type TEXT, constituent_record_id TEXT, raw_json TEXT);
    CREATE TABLE funds (id TEXT PRIMARY KEY, fund_description TEXT);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, constituent_record_id TEXT, assignment_fundraiser_id TEXT, assignment_type TEXT, assignment_to_date DATETIME);
    CREATE TABLE fundraisers (id TEXT PRIMARY KEY, fundraiser_first_name TEXT, fundraiser_last_name TEXT, fundraiser_type TEXT, fundraiser_end_date DATETIME, fundraiser_active INTEGER);
  `);
  mirror.prepare('INSERT INTO fundraisers (id, fundraiser_first_name, fundraiser_last_name, fundraiser_type, fundraiser_active) VALUES (?,?,?,?,1)').run('77', 'Dana', 'Ruiz', 'Regional Development Director (RDD)');
  mirror.prepare("INSERT INTO assignments (id, constituent_record_id, assignment_fundraiser_id, assignment_type, assignment_to_date) VALUES ('as1', '1', '77', 'Regional Development Director (RDD)', NULL)").run();
  mirror.prepare('INSERT INTO funds (id, fund_description) VALUES (?,?)').run('79', 'Water wells, South Sudan');
  party('1', { first: 'Daniel', last: 'Ellison', sfirst: 'Margaret', slast: 'Ellison' });
  addr('a1', '1');
  party('2', { kind: 'Organization', org: 'The Whitcomb Family Foundation', city: 'Naples' });
  addr('a2', '2', { lines: '2100 Fifth Ave S', city: 'Naples' });
  party('3', { first: 'Raymond', last: 'Holt' });
  addr('a3', '3', { dnm: 1 });
  party('4', { first: 'Joyce', last: 'Park' });
  party('5', { first: 'Sam', last: 'Giver' });
  party('6', { first: 'Ann', last: 'Late', deceased: true });
  addr('a6', '6');
  // October: a plain gift, a soft-credited gift (to the foundation), a gift to a record with a do-not-mail address, one with no address.
  gift('100', '1', 5000, '2026-10-14');
  gift('101', '5', 10000, '2026-10-12', { soft: ['2'] });
  gift('102', '3', 7500, '2026-10-13');
  gift('103', '4', 5500, '2026-10-13');
  // Under the line, the wrong type and a voided gift never show.
  gift('104', '1', 4999.99, '2026-10-14');
  gift('105', '1', 9000, '2026-10-14', { type: 'RecurringGift' });
  gift('106', '1', 9000, '2026-10-14', { status: 'Deleted' });
  // An earlier gift with a letter logged after it, and one logged before it.
  gift('90', '1', 6000, '2026-08-20');
  hqtyAction('a90', '1', '2026-08-25');
  gift('91', '4', 6000, '2026-08-20');
  hqtyAction('a91', '4', '2026-08-01');
  gift('92', '6', 6000, '2026-03-02');
  hub = memoryD1();
  hub.exec(`
    CREATE TABLE act_hqty (gift_id TEXT PRIMARY KEY, cid TEXT NOT NULL, state TEXT NOT NULL, why TEXT, printed_at TEXT, signed_at TEXT, mailed_at TEXT, batch_id TEXT, by_name TEXT NOT NULL, by_email TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE act_batches (id TEXT PRIMARY KEY, state TEXT);
    CREATE TABLE act_outbox (id TEXT PRIMARY KEY, batch_id TEXT, op TEXT, bb_id TEXT);
    CREATE TABLE act_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE act_staff (email TEXT PRIMARY KEY, team TEXT, active INTEGER, bb_fundraiser_id TEXT, name TEXT);
    CREATE TABLE act_hqty_signer (gift_id TEXT PRIMARY KEY, signer TEXT NOT NULL, by_name TEXT NOT NULL, by_email TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
});

describe('the list', () => {
  it('shows gifts of $5,000 and up, newest first, and leaves the rest out', async () => {
    const { shaped } = await H.loadHqty({ DB: hub }, q, { today: TODAY });
    assert.deepEqual(shaped.rows.map((r) => r.giftId), ['100', '103', '102', '101', '91', '90']);
  });
  it('sends a soft-credited gift to the credited partner and names the giver', async () => {
    const { shaped } = await H.loadHqty({ DB: hub }, q, { today: TODAY });
    const r = shaped.rows.find((x) => x.giftId === '101');
    assert.equal(r.cid, '2');
    assert.equal(r.partner.name, 'The Whitcomb Family Foundation');
    assert.equal(r.through, 'Sam Giver');
    assert.equal(r.address, '2100 Fifth Ave S, Naples, FL 33606');
  });
  it('flags a missing address and a do-not-mail address, and leaves a deceased household off the desk', async () => {
    const { shaped } = await H.loadHqty({ DB: hub }, q, { today: TODAY });
    const by = Object.fromEntries(shaped.rows.map((r) => [r.giftId, r.flags]));
    assert.deepEqual(by['103'], ['No mailing address']);
    assert.deepEqual(by['102'], ['Do not mail']);
    assert.equal(by['92'], undefined);
    assert.equal(shaped.stats.leftOff, 1);
    assert.deepEqual(by['100'], []);
  });
  it('counts a gift as written when an HQTY action sits on the partner on or after the gift, and not before it', async () => {
    const { shaped } = await H.loadHqty({ DB: hub }, q, { today: TODAY });
    const by = Object.fromEntries(shaped.rows.map((r) => [r.giftId, r]));
    assert.equal(by['90'].state, 'mailed');
    assert.equal(by['90'].source, 'blackbaud');
    assert.equal(by['90'].actionId, 'a90');
    assert.equal(by['91'].state, 'write');
    assert.equal(by['100'].state, 'write');
  });
  it('counts the stat band: this and last month To write, older ones as earlier gifts', async () => {
    const { shaped } = await H.loadHqty({ DB: hub }, q, { today: TODAY });
    assert.deepEqual(shaped.stats, { write: 4, printed: 0, signed: 0, mailedMonth: 0, earlier: 1, total: 6, leftOff: 1 });
  });
});

describe('the steps', () => {
  it('moves a gift to printed, signed and back, and stops a mailed letter from being reset', async () => {
    const ctx = ctxFor();
    await H.hqtyStep(ctx, { ids: ['100'], to: 'printed' }, q);
    let { shaped } = await H.loadHqty(ctx.env, q, { today: TODAY });
    assert.equal(shaped.rows.find((r) => r.giftId === '100').state, 'printed');
    assert.equal(shaped.stats.printed, 1);
    await H.hqtyStep(ctx, { ids: ['100'], to: 'signed' }, q);
    ({ shaped } = await H.loadHqty(ctx.env, q, { today: TODAY }));
    assert.equal(shaped.rows.find((r) => r.giftId === '100').state, 'signed');
    const back = await H.hqtyStep(ctx, { ids: ['100'], to: 'reset' }, q);
    assert.deepEqual(back.done, ['100']);
    ({ shaped } = await H.loadHqty(ctx.env, q, { today: TODAY }));
    assert.equal(shaped.rows.find((r) => r.giftId === '100').state, 'write');
    const blocked = await H.hqtyStep(ctx, { ids: ['90'], to: 'reset' }, q);
    assert.equal(blocked.skipped.length, 1);
  });
  it('needs a reason for Cannot send and keeps it', async () => {
    const ctx = ctxFor();
    await assert.rejects(H.hqtyStep(ctx, { ids: ['102'], to: 'cannot' }, q), /why the letter cannot be sent/);
    await H.hqtyStep(ctx, { ids: ['102'], to: 'cannot', why: 'Returned mail' }, q);
    const { shaped } = await H.loadHqty(ctx.env, q, { today: TODAY });
    const r = shaped.rows.find((x) => x.giftId === '102');
    assert.equal(r.state, 'cannot');
    assert.equal(r.why, 'Returned mail');
  });
  it('refuses Mark mailed until the letter is printed, and refuses a gift Blackbaud already holds a letter for', async () => {
    const ctx = ctxFor();
    const a = await H.hqtyStep(ctx, { ids: ['103'], to: 'mailed' }, q);
    assert.equal(a.skipped[0].why, 'Print the letter first.');
    assert.equal(a.batch, null);
    const b = await H.hqtyStep(ctx, { ids: ['90'], to: 'mailed' }, q);
    assert.match(b.skipped[0].why, /Blackbaud already holds/);
  });
  it('treats a mailed row whose batch was undone as signed', async () => {
    const ctx = ctxFor();
    hub.exec("INSERT INTO act_batches (id, state) VALUES ('b1', 'undone')");
    hub.exec("INSERT INTO act_hqty (gift_id, cid, state, mailed_at, batch_id, by_name, by_email, created_at, updated_at) VALUES ('101', '2', 'mailed', '2026-10-15T10:00:00Z', 'b1', 'x', 'x', 'n', 'n')");
    const { shaped } = await H.loadHqty(ctx.env, q, { today: TODAY });
    assert.equal(shaped.rows.find((r) => r.giftId === '101').state, 'signed');
    hub.exec("UPDATE act_batches SET state = 'done' WHERE id = 'b1'");
    hub.exec("INSERT INTO act_outbox (id, batch_id, op, bb_id) VALUES ('o1', 'b1', 'create', '126188')");
    const again = await H.loadHqty(ctx.env, q, { today: TODAY });
    const r = again.shaped.rows.find((x) => x.giftId === '101');
    assert.equal(r.state, 'mailed');
    assert.equal(r.actionId, '126188');
    assert.equal(again.shaped.stats.mailedMonth, 1);
  });
  it('keeps the desk to the Support Team and admins, and to gifts of $5,000 and up', async () => {
    await assert.rejects(H.hqtyStep(ctxFor('director'), { ids: ['100'], to: 'printed' }, q), /Support Team/);
    await assert.rejects(H.hqtyStep(ctxFor(), { ids: ['104'], to: 'printed' }, q), /not a gift of \$5,000/);
  });
});

describe('the month text', () => {
  it('saves one text per month and reads it back for that month and the months after', async () => {
    const ctx = ctxFor();
    await H.saveMonthText(ctx, '2026-10', 'Thank you for {amount} on {date} to {fund}. We pray for you.');
    const out = await H.hqtyResponse(ctx, q);
    assert.equal(out.text.saved, true);
    assert.match(out.text.body, /^Thank you for \{amount\}/);
    const docs = H.lettersFor((await H.loadHqty(ctx.env, q, { today: TODAY })).raw, out.rows.filter((r) => r.giftId === '100'), TODAY);
    assert.equal(docs[0].paragraphs[0], 'Thank you for $5,000 on Oct 14 to Water wells, South Sudan. We pray for you.');
    await assert.rejects(H.saveMonthText(ctx, '2026-13', 'long enough text here.'), /Pick a month/);
    await assert.rejects(H.saveMonthText(ctx, '2026-10', 'short'), /at least a sentence/);
  });
});

describe('who signs', () => {
  it('picks the signer from the row, else the partner RDD, else the last chosen', () => {
    assert.equal(L.effectiveSigner('michael', 'Dana Ruiz', ''), 'michael');
    assert.equal(L.effectiveSigner('', 'Dana Ruiz', 'terry'), 'rdd');
    assert.equal(L.effectiveSigner('rdd', '', 'carole'), 'carole');
    assert.equal(L.effectiveSigner('', '', 'rachel'), 'rachel');
    assert.equal(L.effectiveSigner('', '', ''), '');
    assert.equal(L.effectiveSigner('rdd', '', ''), '');
  });
  it('prints the roster name and title, and the RDD by name', () => {
    assert.deepEqual(L.signerBlock('terry', ''), { name: 'Terry Goodman', title: 'Uganda/SS Director' });
    assert.deepEqual(L.signerBlock('carole', ''), { name: 'Carole Ward', title: 'Founder' });
    assert.deepEqual(L.signerBlock('rdd', 'Dana Ruiz'), { name: 'Dana Ruiz', title: 'Regional Development Director' });
    assert.deepEqual(L.signerBlock('', ''), { name: '', title: '' });
  });
  it('defaults each row to the partner RDD when there is one', async () => {
    const { shaped } = await H.loadHqty({ DB: hub }, q, { today: TODAY });
    const by = Object.fromEntries(shaped.rows.map((r) => [r.giftId, r]));
    assert.equal(by['100'].signer, 'rdd');
    assert.equal(by['100'].signerName, 'Dana Ruiz');
    assert.equal(by['100'].picked, false);
    assert.equal(by['102'].signer, '');
  });
  it('sets a signer for one gift or several, and the last named signer becomes the default', async () => {
    const ctx = ctxFor();
    const one = await H.setSigner(ctx, { ids: ['103'], signer: 'michael' }, q);
    assert.deepEqual(one.done, ['103']);
    assert.deepEqual(one.resolved['103'], { signer: 'michael', signerName: 'Michael Hinton', signerTitle: 'Deputy Director of Operations & Administrative', picked: true });
    const { shaped } = await H.loadHqty(ctx.env, q, { today: TODAY });
    const by = Object.fromEntries(shaped.rows.map((r) => [r.giftId, r]));
    assert.equal(by['103'].signerName, 'Michael Hinton');
    assert.equal(by['103'].picked, true);
    assert.equal(by['102'].signer, 'michael');
    assert.equal(by['102'].picked, false);
    const bulk = await H.setSigner(ctx, { ids: ['100', '103'], signer: 'terry' }, q);
    assert.deepEqual(bulk.done, ['100', '103']);
    assert.equal(bulk.resolved['100'].signerName, 'Terry Goodman');
    const again = await H.loadHqty(ctx.env, q, { today: TODAY });
    assert.equal(again.shaped.rows.find((r) => r.giftId === '100').signerName, 'Terry Goodman');
  });
  it('refuses the RDD choice on a partner with no RDD, and refuses a letter already printed or mailed', async () => {
    const ctx = ctxFor();
    const none = await H.setSigner(ctx, { ids: ['103'], signer: 'rdd' }, q);
    assert.match(none.skipped[0].why, /no Regional Development Director/);
    await H.hqtyStep(ctx, { ids: ['103'], to: 'printed' }, q);
    const printed = await H.setSigner(ctx, { ids: ['103'], signer: 'carole' }, q);
    assert.match(printed.skipped[0].why, /printed or signed/);
    const mailed = await H.setSigner(ctx, { ids: ['101'], signer: 'carole' }, q);
    assert.match(mailed.skipped[0].why, /mailed/);
    await assert.rejects(H.setSigner(ctx, { ids: ['100'], signer: 'nobody' }, q), /Pick who signs/);
  });
  it('prints the signer on the letter', async () => {
    const { raw, shaped } = await H.loadHqty({ DB: hub }, q, { today: TODAY });
    const rows = shaped.rows.filter((r) => r.giftId === '100');
    const [doc] = H.lettersFor(raw, rows, TODAY);
    assert.equal(doc.signerName, 'Terry Goodman');
    assert.equal(doc.signerTitle, 'Uganda/SS Director');
  });
});
