// Online gifts: reading the designation from a partner's comment, the approval rules, the queue for the web view runner, writes
// staying OFF, the tester and the test-record limit, Fundraise Up matching, and the model only through the guard (stubbed here:
// no live AI call in any test).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fundFromAnswer, parseReference, readDesignation, rulesRead, wantsModel } from '../functions/_lib/online-gifts/read.ts';
import { approve, decideState, history, matchFru, overview, putSetting, queueDone, queued, SETTING_APPLY, SETTING_TEST_ONLY, TEST_RECORD } from '../functions/_lib/online-gifts/service.ts';
import { AiPaused } from '../functions/_lib/ai/guard.ts';
import { d1Of } from './support/lists-fixture.mjs';

const FUNDS = [
  ['79', 'Where Needed Most', 'Where Needed Most'], ['136', 'Trauma Counseling', 'Trauma Counseling'], ['198', 'Wells', 'Wells'], ['170', 'UG wells', 'Uganda Wells'],
  ['171', '25/26 Chad Wells Mtc', '2025/2026 Chad Wells Match'], ['137', 'Kotido HOP', 'Kotido House of Prayer'], ['157', 'PBS Chad', 'PBS Chad'], ['127', 'PBS', 'Portable Bible Schools'],
  ['102', 'Education', 'Education'], ['207', 'Widows and Orphans', 'Widows and Orphans'], ['112', 'E&Discp', 'Evangelism & Discipleship'],
].map(([id, code, name]) => ({ id, code, name }));
const web = (note, des = 'Where Needed Most') => `Online gift via favorintl.org | Designation: ${des}${note ? ` | Donor note: ${note}` : ''}`;

describe('reading the designation', () => {
  it('reads the fund a partner asked for in the giving form note over the dropdown', () => {
    const p = parseReference(web('Hello I would like to donate monthly to the trauma care ministry. Thank you'));
    assert.equal(p.source, 'website');
    assert.equal(p.formDesignation, 'Where Needed Most');
    const r = readDesignation(p, '79', FUNDS);
    assert.deepEqual([r.fundId, r.by], ['136', 'comment']);
  });

  it('names: Kotido from a request for a named ministry, Chad wells, Uganda wells, and Bible schools in Chad with a typo', () => {
    assert.equal(readDesignation(parseReference(web("Please designate this gift to Herbert's ministry in Kotido, Karamoja.")), '79', FUNDS).fundId, '137');
    assert.equal(readDesignation(parseReference('For the Chad wells, please.'), '79', FUNDS).fundId, '171');
    assert.equal(readDesignation(parseReference('Toward the wells in Uganda'), '79', FUNDS).fundId, '170');
    assert.equal(readDesignation(parseReference('to fund portable Bole schools and the school in Chad'), '79', FUNDS).fundId, '157');
  });

  it('a named fund wins over "where needed most" in the same comment', () => {
    const r = readDesignation(parseReference('Please use where needed most in Africa, especially for the widows and orphans'), '79', FUNDS);
    assert.equal(r.fundId, '207');
  });

  it('a prayer, a greeting or a tribute keeps the form designation and is not sent to the model', () => {
    for (const note of ['Jesus please bless my finances and my family', 'Hey Carole, I sent you a message. Be blessed!']) {
      const p = parseReference(web(note, 'Education'));
      assert.deepEqual([readDesignation(p, '102', FUNDS).fundId, readDesignation(p, '102', FUNDS).by], ['102', 'form']);
      assert.equal(wantsModel(p.note), false);
    }
    assert.equal(parseReference(web('In memory of a dear friend')).tribute, true);
  });

  it('only a comment that reads like a request for a fund goes to the model, and only a listed fund is taken from its answer', () => {
    assert.equal(wantsModel('Please put this toward the new clinic roof'), true);
    assert.equal(fundFromAnswer({ response: 'Trauma Counseling' }, FUNDS)?.id, '136');
    assert.equal(fundFromAnswer({ response: 'NONE' }, FUNDS), null);
    assert.equal(fundFromAnswer({ response: 'Something Invented' }, FUNDS), null);
    assert.deepEqual(rulesRead('', FUNDS), []);
  });
});

describe('what approval does', () => {
  const base = { inBlackbaud: true, from: '79', to: '136', splits: 1, record: '500', tester: false, applyOn: true, testOnly: [] };
  it('queues a change of fund only with writes on, one split, inside the test limit, and never for the tester outside the test record', () => {
    assert.equal(decideState(base).state, 'queued');
    assert.equal(decideState({ ...base, applyOn: false }).state, 'held');
    assert.equal(decideState({ ...base, testOnly: [TEST_RECORD] }).state, 'held');
    assert.equal(decideState({ ...base, testOnly: [TEST_RECORD], record: TEST_RECORD }).state, 'queued');
    assert.equal(decideState({ ...base, tester: true }).state, 'held');
    assert.equal(decideState({ ...base, tester: true, record: TEST_RECORD }).state, 'queued');
    assert.equal(decideState({ ...base, splits: 2 }).state, 'held');
    assert.equal(decideState({ ...base, to: '79' }).state, 'approved');
    assert.equal(decideState({ ...base, inBlackbaud: false }).state, 'noted');
  });

  it('matches an international gift to the one an admin entered by its payout amount and date', () => {
    const f = { id: 'D1', created: '2026-10-05T05:00:00Z', payout: 40.25, last: 'Sample' };
    const used = new Set();
    const m = matchFru(f, [{ id: '9', amt: 40.25, d: '2026-10-05', name: 'Pat Sample' }, { id: '10', amt: 40.25, d: '2026-10-30', name: 'Pat Sample' }], used);
    assert.equal(m.id, '9');
    assert.equal(matchFru(f, [{ id: '9', amt: 40.25, d: '2026-10-05', name: 'Pat Sample' }], used), null);
  });
});

function world({ ai } = {}) {
  const m = new DatabaseSync(':memory:');
  m.exec(`CREATE TABLE funds (id TEXT PRIMARY KEY, fund_id TEXT, fund_description TEXT, fund_inactive INTEGER DEFAULT 0);
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_lookup_id TEXT, first_name TEXT, last_name TEXT, organization_name TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_date TEXT, date_added TEXT, gift_amount REAL, gift_type TEXT, gift_payment_method TEXT, gift_comments TEXT, constituent_record_id TEXT, gift_splits TEXT, raw_json TEXT);`);
  for (const f of FUNDS) m.prepare('INSERT INTO funds (id, fund_id, fund_description) VALUES (?, ?, ?)').run(f.id, f.code, f.name);
  m.prepare("INSERT INTO constituents VALUES ('500', '9500', 'Pat', 'Sample', NULL), (?, '14907', 'Test', 'Record', NULL)").run(TEST_RECORD);
  const gift = (id, cid, ref, fund, type = 'Donation', raw = '{}') =>
    m.prepare('INSERT INTO gifts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, '2026-10-12T00:00:00', `2026-10-12T0${id.slice(-1)}:00:00`, 51.75, type, 'CreditCard', ref, cid, JSON.stringify([{ id: 's' + id, amount: { value: 51.75 }, fund_id: fund }]), raw);
  gift('9001', '500', web('for the trauma care ministry'), '79');
  gift('9002', '500', web(''), '79');
  gift('9003', TEST_RECORD, web('Please put this toward the Uganda wells'), '79');
  gift('9004', '500', web('Please put this toward the new kitchen roof'), '79');
  gift('9005', '500', 'DIAGNOSTIC recurring test (auto-deleted)', '79');
  const hub = new DatabaseSync(':memory:');
  hub.exec(fs.readFileSync(new URL('../db/online-gifts.sql', import.meta.url), 'utf8'));
  hub.exec('CREATE TABLE act_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);');
  const used = [];
  const deps = {
    db: d1Of(hub),
    mirror: async (sql, p = []) => {
      const n = [...sql.matchAll(/\?(\d+)/g)].map((x) => +x[1]);
      return m.prepare(sql).all(...(n.length ? p.slice(0, Math.max(...n)) : []));
    },
    ops: async (method, path) => {
      used.push(`${method} ${path}`);
      if (method !== 'GET') throw new Error('a test wrote to Blackbaud');
      return { ok: true, body: path.includes('approved=false') ? { giftbatches: [{ batch_number: 'GFT-1', batch_description: 'Installment payment transactions', number_of_gifts: 4, actual_amount: 120 }] } : { count: 0, giftbatches: [] } };
    },
    ai,
    now: () => new Date('2026-10-12T14:00:00Z'),
  };
  return { deps, hub, used };
}
const ME = { email: 'pam@favorintl.org', name: 'Pam Care', admin: false, tester: false };
const TESTER = { email: 'tester@favorintl.org', name: 'FavorOS Tester', admin: true, tester: true };

describe('the list and the approval flow', () => {
  it('lists the online gifts with comment, reading and waiting batches; the test record is hidden from staff; writes start off', async () => {
    const calls = [];
    const { deps } = world({ ai: { run: async () => { calls.push(1); return { response: 'NONE' }; } } });
    const ov = await overview(deps, ME, '2026-10-12');
    assert.deepEqual(ov.rows.map((r) => r.giftId).sort(), ['9001', '9002', '9004']);
    const r1 = ov.rows.find((r) => r.giftId === '9001');
    assert.deepEqual([r1.comment, r1.read.fundId, r1.currentFund, r1.source], ['for the trauma care ministry', '136', '79', 'website']);
    assert.equal(ov.batches.waiting.length, 1);
    assert.equal(ov.apply, false);
    assert.equal(ov.testLimit, TEST_RECORD);
    assert.equal(calls.length, 1, 'only the roof comment goes to the model');
    await overview(deps, ME, '2026-10-12');
    assert.equal(calls.length, 1, 'a comment goes to the model once');
  });

  it('a model call the guard holds leaves the rules reading in place', async () => {
    const { deps } = world({ ai: { run: async () => { throw new AiPaused('budget', 'online-gift-reading'); } } });
    const ov = await overview(deps, ME, '2026-10-12');
    assert.equal(ov.rows.find((r) => r.giftId === '9004').read.by, 'form');
  });

  it('approval with writes off records who approved and holds the change; nothing is queued and nothing writes to Blackbaud', async () => {
    const { deps, hub, used } = world();
    const res = await approve(deps, ME, [{ key: 're:9001', fundId: '136' }, { key: 're:9002', fundId: '79' }], '2026-10-12');
    assert.deepEqual(res.map((r) => r.state), ['held', 'approved']);
    assert.equal((await queued(deps.db)).length, 0);
    const row = hub.prepare("SELECT * FROM og_review WHERE gift_key = 're:9001'").get();
    assert.deepEqual([row.approved_by, row.from_fund, row.chosen_fund, row.read_by], ['pam@favorintl.org', '79', '136', 'comment']);
    assert.deepEqual((await history(deps.db, 're:9001')).map((h) => h.event), ['approved', 'held']);
    assert.ok(used.every((u) => u.startsWith('GET ')));
  });

  it('with writes on and the test limit, only the test record queues; the runner reports back and the log shows each step', async () => {
    const { deps } = world();
    await putSetting(deps.db, SETTING_APPLY, 'on', 'now');
    await putSetting(deps.db, SETTING_TEST_ONLY, TEST_RECORD, 'now');
    const res = await approve(deps, TESTER, [{ key: 're:9001', fundId: '136' }, { key: 're:9003', fundId: '170' }], '2026-10-12');
    assert.deepEqual(res.map((r) => r.state), ['held', 'queued']);
    const q = await queued(deps.db);
    assert.deepEqual(q.map((x) => [x.gift_id, x.from_fund, x.to_fund]), [['9003', '79', '170']]);
    await queueDone(deps, 're:9003', true, 'Saved and read back');
    await assert.rejects(() => queueDone(deps, 're:9003', true, 'again'));
    assert.deepEqual((await history(deps.db, 're:9003')).map((h) => h.event), ['approved', 'queued', 'applied']);
  });

  it('an unknown fund or a gift outside the list is refused', async () => {
    const { deps } = world();
    const res = await approve(deps, ME, [{ key: 're:9001', fundId: '999' }, { key: 're:1', fundId: '79' }], '2026-10-12');
    assert.deepEqual(res.map((r) => r.state), ['missing', 'missing']);
  });
});
