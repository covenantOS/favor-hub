// Online gifts: reading the designation from a partner's comment, the approval rules, the queue for the web view runner, writes
// staying OFF, the tester and the test-record limit, Fundraise Up matching, and the model only through the guard (stubbed here:
// no live AI call in any test).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fundFromAnswer, parseReference, readDesignation, rulesRead, wantsModel } from '../functions/_lib/online-gifts/read.ts';
import { approve, checkHealth, decideState, fetchFru, history, keepFund, matchFru, num, overview, putSetting, queueDone, queued, SETTING_APPLY, SETTING_TEST_ONLY, TEST_RECORD } from '../functions/_lib/online-gifts/service.ts';
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

function world({ ai, fruList } = {}) {
  const m = new DatabaseSync(':memory:');
  m.exec(`CREATE TABLE funds (id TEXT PRIMARY KEY, fund_id TEXT, fund_description TEXT, fund_inactive INTEGER DEFAULT 0);
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_lookup_id TEXT, first_name TEXT, last_name TEXT, organization_name TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_date TEXT, date_added TEXT, gift_amount REAL, gift_type TEXT, gift_payment_method TEXT, gift_comments TEXT, constituent_record_id TEXT, gift_splits TEXT, raw_json TEXT);
    CREATE TABLE og_flags (flag_key TEXT PRIMARY KEY, kind TEXT, gift_id TEXT, fru_id TEXT, batch_id TEXT, batch_number TEXT, constituent_id TEXT, partner TEXT, amount REAL, gift_date TEXT, current_fund TEXT, wanted_fund TEXT, words TEXT, detail TEXT, first_seen TEXT, last_seen TEXT, resolved_at TEXT, resolved_by TEXT, resolution TEXT);
    CREATE TABLE fru_matches (fru_id TEXT PRIMARY KEY, created_at TEXT, supporter TEXT, amount_usd REAL, payout REAL, currency TEXT, amount REAL, designation_id TEXT, designation_name TEXT, recurring INTEGER, comment TEXT, gift_id TEXT, match_how TEXT, matched_at TEXT, checked_at TEXT);
    CREATE TABLE og_check_status (check_name TEXT PRIMARY KEY, last_run TEXT, last_ok TEXT, last_error TEXT, last_error_at TEXT, detail TEXT);`);
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
    fru: fruList ? async () => fruList : undefined,
    now: () => new Date('2026-10-12T14:00:00Z'),
  };
  return { deps, hub, used, m };
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
    // The mirror still holds the old fund; the applied change is the gift's fund, so changing it back queues again.
    const after = (await overview(deps, TESTER, '2026-10-12')).rows.find((r) => r.giftId === '9003');
    assert.equal(after.currentFund, '170');
    const back = await approve(deps, TESTER, [{ key: 're:9003', fundId: '79' }], '2026-10-12');
    assert.deepEqual(back.map((r) => r.state), ['queued']);
    assert.deepEqual((await queued(deps.db)).map((x) => [x.from_fund, x.to_fund]), [['170', '79']]);
  });

  it('an unknown fund or a gift outside the list is refused', async () => {
    const { deps } = world();
    const res = await approve(deps, ME, [{ key: 're:9001', fundId: '999' }, { key: 're:1', fundId: '79' }], '2026-10-12');
    assert.deepEqual(res.map((r) => r.state), ['missing', 'missing']);
  });
});

describe('Fundraise Up amounts and matching', () => {
  it('reads amounts that carry thousands commas', async () => {
    assert.equal(num('1,987.15'), 1987.15);
    assert.equal(num('12'), 12);
    assert.equal(num(undefined), 0);
    assert.equal(num('n/a'), 0);
    const body = { data: [{ id: 'd1', created_at: '2026-10-08T10:00:00Z', status: 'succeeded', amount: '2,000.00', currency: 'usd', amount_in_default_currency: '1,987.15', payout: { amount_in_default_currency: '1,950.10' }, supporter: { first_name: 'Ann', last_name: 'Tester' }, designation: { name: 'Wells' } }], has_more: false };
    const list = await fetchFru('key', '2026-10-01', async () => ({ ok: true, json: async () => body }));
    assert.deepEqual([list[0].usd, list[0].payout], [1987.15, 1950.1]);
  });

  it('matches the gross USD amount or the payout, three days before to 21 days after, last name preferred', () => {
    const f = { id: 'D2', created: '2026-10-05T05:00:00Z', usd: 1987.15, payout: 1950.1, last: 'Tester' };
    assert.equal(matchFru(f, [{ id: '1', amt: 1987.15, d: '2026-10-12', name: 'Ann Tester' }], new Set()).id, '1', 'gross');
    assert.equal(matchFru(f, [{ id: '2', amt: 1950.1, d: '2026-10-12', name: 'Ann Tester' }], new Set()).id, '2', 'payout');
    assert.equal(matchFru(f, [{ id: '3', amt: 1987.15, d: '2026-10-02', name: 'Ann Tester' }], new Set()).id, '3', 'three days before');
    assert.equal(matchFru(f, [{ id: '4', amt: 1987.15, d: '2026-10-01', name: 'Ann Tester' }], new Set()), null);
    assert.equal(matchFru(f, [{ id: '5', amt: 1987.15, d: '2026-10-26', name: 'Ann Tester' }], new Set()).id, '5', '21 days after');
    assert.equal(matchFru(f, [{ id: '6', amt: 1987.15, d: '2026-10-27', name: 'Ann Tester' }], new Set()), null);
    assert.equal(matchFru(f, [{ id: '7', amt: 1987.15, d: '2026-10-06', name: 'Bob Other' }, { id: '8', amt: 1987.15, d: '2026-10-06', name: 'Ann Tester' }], new Set()).id, '8', 'last name');
  });

  it('uses the worker match (fru_matches.gift_id) over any amount guess', async () => {
    const donation = (id, usd, payout) => ({ id, created: '2026-10-12T09:00:00Z', status: 'succeeded', usd, payout, amount: String(usd), currency: 'usd', first: 'Gus', last: 'Gross', comment: '', designation: 'Wells', recurring: false });
    const { deps, m } = world({ fruList: [donation('F1', 77.77, 70.1), donation('F2', 10, 9)] });
    const put = (id, amt) => m.prepare("INSERT INTO gifts VALUES (?, '2026-10-12T00:00:00', '2026-10-12T08:00:00', ?, 'Donation', 'Other', 'wire', '500', ?, '{}')").run(id, amt, JSON.stringify([{ fund_id: '79' }]));
    put('9101', 77.77);
    put('9102', 33.33);
    m.prepare("INSERT INTO fru_matches (fru_id, created_at, gift_id, match_how) VALUES ('F2', '2026-10-12T09:00:00Z', '9102', 'name')").run();
    const ov = await overview(deps, ME, '2026-10-12');
    const fr = ov.rows.filter((r) => r.source === 'fundraise up');
    assert.deepEqual(fr.map((r) => [r.giftId, r.inBlackbaud]).sort(), [['9101', true], ['9102', true]]);
  });
});

describe('open flags on the screen', () => {
  const flag = (m, o) => m.prepare(`INSERT INTO og_flags (flag_key, kind, gift_id, fru_id, batch_id, batch_number, partner, amount, gift_date, current_fund, wanted_fund, words, detail, first_seen, last_seen, resolved_at)
    VALUES (@flag_key, @kind, @gift_id, @fru_id, @batch_id, @batch_number, @partner, @amount, @gift_date, @current_fund, @wanted_fund, @words, @detail, '2026-10-09', '2026-10-12', @resolved_at)`)
    .run({ gift_id: null, fru_id: null, batch_id: null, batch_number: null, partner: null, amount: 0, gift_date: null, current_fund: null, wanted_fund: null, words: null, detail: null, resolved_at: null, ...o });

  function flagged() {
    const w = world();
    w.m.prepare("INSERT INTO gifts VALUES ('9006', '2026-08-01T00:00:00', '2026-08-01T08:00:00', 25, 'Donation', 'Other', 'wire', '500', ?, '{}')").run(JSON.stringify([{ fund_id: '79' }]));
    flag(w.m, { flag_key: 'note:9002', kind: 'note', gift_id: '9002', current_fund: '79', wanted_fund: '136', words: 'trauma' });
    flag(w.m, { flag_key: 'fru-fund:9006', kind: 'fru-fund', gift_id: '9006', current_fund: '79', wanted_fund: '157', words: 'PBS Chad' });
    flag(w.m, { flag_key: 'fru-missing:dX', kind: 'fru-missing', fru_id: 'dX', partner: 'Sam Invented', amount: 50, gift_date: '2026-10-08', words: 'Wells' });
    flag(w.m, { flag_key: 'batch:777', kind: 'batch', batch_id: '777', batch_number: 'GFT-2026-1', amount: 12.5, gift_date: '2026-10-07', detail: '2 gifts, created by Pat Sample' });
    flag(w.m, { flag_key: 'note:9001', kind: 'note', gift_id: '9001', wanted_fund: '198', resolved_at: '2026-10-11' });
    return w;
  }

  it('merges open flags into rows whatever their date, preselects the wanted fund and counts them; a resolved flag is gone', async () => {
    const { deps } = flagged();
    const ov = await overview(deps, ME, '2026-10-12');
    const by = (id) => ov.rows.find((r) => r.giftId === id);
    assert.deepEqual([by('9002').flag.kind, by('9002').read.fundId, by('9002').read.by], ['note', '136', 'comment']);
    assert.equal(by('9001').flag, null);
    assert.equal(by('9001').read.fundId, '136', 'a resolved flag changes nothing');
    assert.deepEqual([by('9006').flag.kind, by('9006').source, by('9006').date, by('9006').read.fundId], ['fru-fund', 'fundraise up', '2026-08-01', '157']);
    const miss = ov.rows.find((r) => r.key === 'fru:dX');
    assert.deepEqual([miss.flag.kind, miss.flag.days, miss.inBlackbaud, miss.name, miss.amount], ['fru-missing', 4, false, 'Sam Invented', 50]);
    assert.deepEqual(ov.flags, { changes: 1, differs: 1, missing: 1, batches: 1, count: 4 });
    assert.deepEqual(ov.batchFlags.map((b) => [b.number, b.gifts, b.days, b.by]), [['GFT-2026-1', 2, 5, 'Pat Sample']]);
    assert.ok(ov.batchFlags[0].link.startsWith('https://host.nxt.blackbaud.com/gift-batch/batch-review/777?envid='));
  });

  it('works before the worker has made its tables', async () => {
    const { deps, m } = world();
    m.exec('DROP TABLE og_flags; DROP TABLE fru_matches; DROP TABLE og_check_status;');
    const ov = await overview(deps, ME, '2026-10-12');
    assert.equal(ov.flags.count, 0);
    assert.deepEqual(ov.health.map((h) => h.state), ['none', 'none', 'none']);
  });

  it('Keep fund refuses the tester, asks the worker with the viewer, logs it, and reports a flag the worker no longer holds', async () => {
    const { deps } = flagged();
    const calls = [];
    const ok = async (key, by, note) => (calls.push([key, by, note]), { ok: true, status: 200 });
    assert.deepEqual(await keepFund(deps, TESTER, 'note:9002', ok), { ok: false, code: 'test_user' });
    assert.equal(calls.length, 0);
    assert.deepEqual(await keepFund(deps, ME, 'batch:777', ok), { ok: false, code: 'no_flag' }, 'only a fund flag is kept');
    assert.deepEqual(await keepFund(deps, ME, 'note:9002', ok), { ok: true });
    assert.deepEqual(calls, [['note:9002', 'pam@favorintl.org', '']]);
    assert.deepEqual((await history(deps.db, 're:9002')).map((h) => [h.actor, h.event]), [['pam@favorintl.org', 'kept']]);
    assert.deepEqual(await keepFund(deps, ME, 'note:9002', async () => ({ ok: false, status: 404 })), { ok: false, code: 'no_flag' });
    assert.deepEqual(await keepFund(deps, ME, 'note:9002', async () => ({ ok: false, status: 500 })), { ok: false, code: 'worker' });
    const route = fs.readFileSync(new URL('../functions/api/online-gifts/[[a]].ts', import.meta.url), 'utf8');
    const at = route.indexOf("a === 'keep'");
    assert.ok(at > 0 && route.indexOf('viewer.tester', at) < route.indexOf('keepFund(deps', at), 'the route refuses the tester before it calls the worker');
  });
});

describe('check health line', () => {
  const NOW = new Date('2026-10-12T14:00:00Z');
  it('marks a check stale after two days and failing when an error is newer than the last good run', async () => {
    const { deps, m } = world();
    const put = (n, ok, err, errAt) => m.prepare('INSERT INTO og_check_status (check_name, last_run, last_ok, last_error, last_error_at) VALUES (?, ?, ?, ?, ?)').run(n, ok || errAt, ok, err, errAt);
    put('notes', '2026-10-12T12:00:00Z', null, null);
    put('fundraise', '2026-10-09T12:00:00Z', null, null);
    put('batches', '2026-10-12T12:00:00Z', 'SKY 429', '2026-10-12T13:00:00Z');
    const h = await checkHealth(deps.mirror, NOW);
    assert.deepEqual(h.map((x) => [x.label, x.state]), [['Website notes', 'ok'], ['Fundraise Up', 'stale'], ['Batches', 'failing']]);
    const edge = await checkHealth(async () => [{ check_name: 'notes', last_ok: '2026-10-10T14:00:01Z' }, { check_name: 'fundraise', last_ok: '2026-10-10T13:59:59Z' }], NOW);
    assert.deepEqual(edge.map((x) => x.state).slice(0, 2), ['ok', 'stale']);
    const ov = await overview(deps, ME, '2026-10-12');
    assert.deepEqual(ov.health.map((x) => x.state), ['ok', 'stale', 'failing']);
  });
});
