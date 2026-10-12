// Run with: npm test
//
// Gift entry from a photo: proposing the appeal and fund, field confidence, the address tie-break, approve / hold / reject and the
// second approver, who may post (off for everyone), undo within the day, the day summary, and a reply slip joining its check.
// A real SQLite copy of the gift entry tables stands in for D1 and a scripted sender stands in for Blackbaud. Made-up data only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import { memoryD1 } from './support/d1.mjs';
import './support/resolve-ts.mjs';

const code = await import('../functions/_lib/gifts/code.ts');
const read = await import('../functions/_lib/gifts/read.ts');
const match = await import('../functions/_lib/gifts/match.ts');
const store = await import('../functions/_lib/gifts/store.ts');
const flow = await import('../functions/_lib/gifts/flow.ts');
const perm = await import('../functions/_lib/gifts/perm.ts');
const capture = await import('../functions/_lib/gifts/capture.ts');
const summary = await import('../functions/_lib/gifts/summary.ts');
const route = await import('../functions/_lib/gifts/route.ts');
const giftRoute = await import(new URL('../functions/api/gift-entry/gifts/%5Bid%5D.ts', import.meta.url).href);
const sendRoute = await import(new URL('../functions/api/gift-entry/deposits/%5Bid%5D/send.ts', import.meta.url).href);
const undoRoute = await import(new URL('../functions/api/gift-entry/deposits/%5Bid%5D/undo.ts', import.meta.url).href);
const settingsRoute = await import('../functions/api/gift-entry/settings.ts');
const codingRoute = await import(new URL('../functions/api/gift-entry/gifts/%5Bid%5D/coding.ts', import.meta.url).href);
const needsRoute = await import('../functions/api/gift-entry/needs-coding.ts');
const indexRoute = await import('../functions/api/gift-entry/index.ts');
const testuser = await import('../functions/_lib/testuser.ts');
const intake = await import('../functions/_lib/actions/intake.ts');

const SCHEMA = [
  readFileSync(new URL('../db/gift-entry.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../db/gift-photo.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../db/gift-photo-coding.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../db/gift-entry-comments.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../db/work-reminders.sql', import.meta.url), 'utf8'),
  `CREATE TABLE hub_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT);
   CREATE TABLE hub_users (email TEXT PRIMARY KEY, name TEXT, role TEXT NOT NULL DEFAULT 'staff', blocked INTEGER NOT NULL DEFAULT 0);
   INSERT INTO hub_users VALUES ('ada@example.org','Ada Admin','admin',0),('sam@example.org','Sam Staff','staff',0),('pat@example.org','Pat Care','staff',0),('tester@favorintl.org','FavorOS Tester','admin',0);`,
].join('\n');

const FUNDS = [
  { id: '79', code: 'WNM', name: 'Where Needed Most' },
  { id: '12', code: 'ORP', name: 'Orphan Care' },
  { id: '15', code: 'WELL', name: 'Clean Water Wells' },
];
const APPEALS = [
  { id: '2298', code: 'L26B-AD', name: 'Direct Mail, November 2026 Appeal, Tracy, Active Donors', category: 'Direct Mail Appeal' },
  { id: '2354', code: 'L26A-AD', name: 'Direct Mail, October 2026 Appeal, Rakie, Active Donors', category: 'Direct Mail Appeal' },
  { id: '2192', code: 'W200-LTAD', name: 'White Mail, Long-term Frequent Donor Gift (Not Monthly)', category: 'White Mail' },
  { id: '2188', code: 'W200-CH', name: 'White Mail, Unidentified Motivation, Church Gift', category: 'White Mail' },
  { id: '2225', code: 'W200-LTCH', name: 'White Mail, Long-term Frequent Donor (Not Monthly), Church Gift', category: 'White Mail' },
  { id: '2183', code: 'W200-GRAN', name: 'White Mail, Unidentified Motivation, Grant', category: 'White Mail' },
  { id: '2186', code: 'W200-UNMG', name: 'White Mail, Unidentified Motivation, Major Gift', category: 'White Mail' },
  { id: '2185', code: 'W200-UNID', name: 'White Mail, Unidentified Motivation', category: 'White Mail' },
];
const base = { slipAppeal: null, slipDesignation: null, letterAppeal: null, letterPurpose: null, memo: null, lastGift: null, expected: [], funds: FUNDS, appeals: APPEALS, partnerName: 'Harold Whitcomb', payer: 'Harold Whitcomb', amountCents: 5000, recentGifts: 0 };

describe('proposing the appeal and fund from evidence', () => {
  it('a reply slip decides the appeal and gives the reason in words', () => {
    const c = code.proposeCoding({ ...base, slipAppeal: 'l26b-ad', memo: 'L26A-AD', lastGift: { fundId: '79', appealId: '2192' } });
    assert.equal(c.appeal.id, '2298');
    assert.equal(c.appealSource, 'slip');
    assert.equal(c.reason, 'Reply slip L26B-AD');
    assert.equal(c.needsCoding, false);
  });

  it('a letter that names a code decides it when there is no slip; the slip wins over the letter', () => {
    const l = code.proposeCoding({ ...base, letterAppeal: 'L26A-AD' });
    assert.equal(l.appeal.id, '2354');
    assert.equal(l.appealSource, 'letter');
    assert.equal(code.proposeCoding({ ...base, letterAppeal: 'L26A-AD', slipAppeal: 'L26B-AD' }).appealSource, 'slip');
  });

  it('a memo code, an expected gift and the last gift suggest but never decide: the gift is White Mail and needs coding', () => {
    const exp = [{ id: 'o1', kind: 'opportunity', date: '2026-10-06', amountCents: 5000, purpose: 'L26A-AD wells', text: '' }];
    const c = code.proposeCoding({ ...base, memo: 'In response to L26B-AD', expected: exp, lastGift: { fundId: '79', appealId: '2192' } });
    assert.equal(c.appealSource, 'white_mail');
    assert.equal(c.reason, 'No slip or note: White Mail');
    assert.equal(c.needsCoding, true);
    assert.deepEqual(c.suggestions.map((x) => x.source), ['expected', 'memo', 'history']);
    assert.match(c.suggestions[0].reason, /Oct 6: an expected gift of \$50\.00 was logged for L26A-AD wells/);
    assert.match(c.suggestions[1].reason, /memo reads L26B-AD/);
    assert.match(c.suggestions[2].reason, /last gift used W200-LTAD/);
  });

  it('an expected gift fits only near the amount and the date', () => {
    const e = { id: 'o', kind: 'opportunity', date: '2026-10-06', amountCents: 10000, purpose: null, text: '' };
    assert.equal(code.expectedFits(e, 10500, '2026-10-12'), true);
    assert.equal(code.expectedFits(e, 20000, '2026-10-12'), false);
    assert.equal(code.expectedFits(e, 10000, '2026-12-12'), false);
    assert.equal(code.expectedFits({ ...e, amountCents: null }, 20000, '2026-10-12'), true);
  });

  it('with nothing the White Mail table decides by church, foundation, frequency and size', () => {
    const w = (over) => code.proposeCoding({ ...base, ...over }).appeal.code;
    assert.equal(w({ partnerName: 'Linden Ridge Church', payer: 'Linden Ridge Church' }), 'W200-CH');
    assert.equal(w({ partnerName: 'Linden Ridge Church', payer: 'Linden Ridge Church', recentGifts: 4 }), 'W200-LTCH');
    assert.equal(w({ partnerName: 'Coastal Giving Fund', payer: 'Coastal Giving Fund' }), 'W200-GRAN');
    assert.equal(w({ recentGifts: 5 }), 'W200-LTAD');
    assert.equal(w({ amountCents: 250000 }), 'W200-UNMG');
    assert.equal(w({ amountCents: 4000 }), 'W200-UNID');
  });

  it('the fund comes from the slip, the letter, an expected gift, then the memo, else Where Needed Most', () => {
    assert.deepEqual([code.proposeCoding({ ...base, slipDesignation: 'Orphan Care' }).fund.id, code.proposeCoding({ ...base, slipDesignation: 'Orphan Care' }).fundSource], ['12', 'slip']);
    assert.equal(code.proposeCoding({ ...base, letterPurpose: 'for clean water wells' }).fundSource, 'letter');
    assert.equal(code.proposeCoding({ ...base, expected: [{ id: 'a', kind: 'action', date: '2026-10-06', amountCents: null, purpose: null, text: 'She will give for Orphan Care' }] }).fund.id, '12');
    assert.equal(code.proposeCoding({ ...base, memo: 'for clean water wells please' }).fundSource, 'memo');
    assert.deepEqual([code.proposeCoding({ ...base, memo: 'God bless' }).fund.id, code.proposeCoding({ ...base, memo: 'God bless' }).fundSource], ['79', 'default']);
  });
});

const f = (o) => ({ docType: 'check', amountCents: null, wordsCents: null, checkDate: null, payer: null, checkNumber: null, memo: null, slipAppeal: null, address: null, slipDesignation: null, ...o });
const r = (reader, fields, extra = {}) => ({ reader, model: reader, fields, secs: 1, error: null, card: false, ...extra });

describe('confidence per field', () => {
  it('is high when both readers agree and the figures match the words', () => {
    const x = f({ amountCents: 12000, wordsCents: 12000, checkDate: '2026-10-05', checkNumber: '4410', payer: 'Harold Whitcomb', address: '12 Oak St, Hendersonville, TN 37075' });
    const m = read.mergeReads([r('scout', x), r('gemma', x)], '2026-10-09');
    assert.equal(m.conf.amount, 'high');
    assert.equal(m.conf.number, 'high');
    assert.equal(m.conf.date, 'high');
    assert.equal(m.conf.payer, 'high');
    assert.equal(m.conf.address, 'high');
    assert.equal(m.address, '12 Oak St, Hendersonfville, TN 37075'.replace('fville', 'ville'));
  });

  it('is low when the readers disagree and medium with one reader or no written words', () => {
    const a = f({ amountCents: 12000, checkDate: '2026-10-05', checkNumber: '4410', payer: 'Harold Whitcomb' });
    const b = f({ amountCents: 12008, checkDate: '2026-10-05', checkNumber: '4411', payer: 'Harold Whitcomb' });
    const m = read.mergeReads([r('scout', a), r('gemma', b)], '2026-10-09');
    assert.equal(m.conf.amount, 'low');
    assert.equal(m.conf.number, 'low');
    assert.equal(m.conf.payer, 'high');
    const nowords = read.mergeReads([r('scout', a), r('gemma', a)], '2026-10-09');
    assert.equal(nowords.conf.amount, 'medium');
    const one = read.mergeReads([r('scout', a), r('gemma', null, { error: 'no answer' })], '2026-10-09');
    assert.equal(one.conf.payer, 'medium');
    const none = read.mergeReads([r('scout', null, { error: 'x' }), r('gemma', null, { error: 'x' })], '2026-10-09');
    assert.equal(none.conf.amount, 'low');
  });
});

describe('the address on the check settles two partners with one name', () => {
  it('matches city and state, and ranks the match first', () => {
    assert.equal(match.addressMatches('14 Elm Rd, Franklin, TN 37064', 'Franklin, TN'), true);
    assert.equal(match.addressMatches('14 Elm Rd, Franklin, TN 37064', 'Franklin, KY'), false);
    assert.equal(match.addressMatches(null, 'Franklin, TN'), false);
    const hits = [
      { cid: '1', lookup: 'L1', name: 'John Smith', place: 'Dallas, TX', deceased: false },
      { cid: '2', lookup: 'L2', name: 'John Smith', place: 'Franklin, TN', deceased: false },
    ];
    const ranked = match.rankCandidates('John Smith', hits, '14 Elm Rd, Franklin, TN 37064');
    assert.equal(ranked[0].cid, '2');
    assert.equal(ranked[0].addr, true);
    assert.equal(ranked[1].addr, false);
  });
});

// ---------------------------------------------------------------- the database

let env;
let sent;
let script;
const send = async (calls) => {
  sent.push(calls);
  return script(calls, sent.length);
};
const ok = (body) => ({ ok: true, status: 200, body });
const ADA = { email: 'ada@example.org', name: 'Ada Admin', role: 'admin' };
const SAM = { email: 'sam@example.org', name: 'Sam Staff', role: 'staff' };
const PAT = { email: 'pat@example.org', name: 'Pat Care', role: 'staff' };

beforeEach(() => {
  env = { DB: memoryD1() };
  env.DB.exec(SCHEMA);
  sent = [];
  script = () => ({ results: [], wait: 'unscripted' });
  route.giftHooks.send = () => send;
  route.giftHooks.repo = () => ({ async partners() { return []; }, async partnersByIds() { return []; } });
});

function req(method, who, body, path = '/api/gift-entry') {
  const headers = { 'content-type': 'application/json', 'x-hub-request': '1' };
  if (who) Object.assign(headers, { 'x-hub-email': who.email, 'x-hub-name': who.name, 'x-hub-role': who.role });
  return new Request('https://favor-hub.example.org' + path, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
}
const call = (handler, who, body, params = {}, method = 'POST', path) => handler({ request: req(method, who, body, path), env, params, waitUntil: () => {} });
const jsonOf = async (res) => ({ status: res.status, ...(await res.json()) });

async function seedDeposit(n = 2, over = {}) {
  const d = await store.createDeposit(env, { name: 'Ada Admin', email: 'ada@example.org' }, { kind: 'regular', date: intake.etParts(new Date()).date, tapeCents: n * 10000, tapeCount: n, ...over });
  for (let i = 1; i <= n; i++) {
    await env.DB.prepare(
      `INSERT INTO ge_gift (id, deposit_id, seq, status, kind, partner_id, partner_name, amount_cents, gift_date, check_number, fund_id, appeal_id, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind('gg_' + i, d.id, i, 'review', 'check', String(500 + i), 'Partner ' + i, 10000, d.deposit_date, String(4400 + i), '79', '2298', 'Ada Admin', new Date().toISOString(), new Date().toISOString()).run();
  }
  return d;
}
const patchGift = (who, id, body) => call(giftRoute.onRequestPatch, who, body, { id }, 'PATCH', '/api/gift-entry/gifts/' + id);
const gift = (id) => store.getGift(env, id);

describe('approve, hold and reject', () => {
  it('Approve records who and when, and an edit takes the approval back', async () => {
    await seedDeposit(1);
    const a = await jsonOf(await patchGift(ADA, 'gg_1', { action: 'approve' }));
    assert.equal(a.status, 200);
    const g = await gift('gg_1');
    assert.equal(g.confirmed_by, 'ada@example.org');
    assert.ok(g.confirmed_at);
    assert.deepEqual(store.blockers(g), []);
    await patchGift(ADA, 'gg_1', { set: { amount_cents: 9900 } });
    assert.equal((await gift('gg_1')).confirmed_by, null);
  });

  it('Hold needs a reason, blocks the batch, and Release puts the row back for review', async () => {
    const d = await seedDeposit(1);
    const bad = await jsonOf(await patchGift(ADA, 'gg_1', { action: 'hold' }));
    assert.equal(bad.status, 400);
    assert.equal(bad.error, 'reason_needed');
    await patchGift(ADA, 'gg_1', { action: 'approve' });
    const held = await jsonOf(await patchGift(ADA, 'gg_1', { action: 'hold', reason: 'Ask Partner Care about the name' }));
    assert.equal(held.status, 200);
    const g = await gift('gg_1');
    assert.equal(g.status, 'held');
    assert.equal(g.hold_reason, 'Ask Partner Care about the name');
    assert.equal(g.confirmed_by, null);
    const chk = flow.canSend(d, await store.giftsOf(env, d.id));
    assert.equal(chk.ok, false);
    assert.match(chk.why.join(' '), /1 row is on hold/);
    await patchGift(ADA, 'gg_1', { action: 'release' });
    assert.equal((await gift('gg_1')).status, 'review');
  });

  it('Reject needs a reason, leaves the count, and keeps the row and its photo for the record', async () => {
    const d = await seedDeposit(2);
    await env.DB.prepare('INSERT INTO ge_image (id, gift_id, deposit_id, kind, r2_key, sha256, bytes, mime, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind('gi_1', 'gg_2', d.id, 'check_front', 'k/1', 'sha', 3, 'image/jpeg', 'm', 'x').run();
    assert.equal((await jsonOf(await patchGift(ADA, 'gg_2', { action: 'reject', reason: '  ' }))).status, 400);
    assert.equal((await jsonOf(await patchGift(ADA, 'gg_2', { action: 'reject', reason: 'Not a gift, a bill' }))).status, 200);
    const g = await gift('gg_2');
    assert.equal(g.status, 'removed');
    assert.equal(g.reject_reason, 'Not a gift, a bill');
    assert.equal(g.rejected_by, 'Ada Admin');
    assert.equal((await store.giftsOf(env, d.id)).length, 1);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM ge_image WHERE gift_id = 'gg_2'").first()).n, 1);
    const ev = await env.DB.prepare("SELECT kind, actor, detail FROM ge_event WHERE gift_id = 'gg_2' AND kind = 'row_rejected'").first();
    assert.equal(ev.detail, 'Not a gift, a bill');
  });

  it('a second person is needed from the saved amount, and never the same person', async () => {
    await seedDeposit(2);
    await env.DB.prepare("UPDATE ge_gift SET amount_cents = 250000 WHERE id = 'gg_1'").run();
    await perm.setSecondCents(env, 'Ada', 100000);
    await perm.setPerson(env, 'Ada', 'sam@example.org', { access: true });
    await patchGift(ADA, 'gg_1', { action: 'approve' });
    let g = await gift('gg_1');
    assert.deepEqual(store.blockers(g, 100000), [store.SECOND_LINE]);
    const same = await jsonOf(await patchGift(ADA, 'gg_1', { action: 'approve2' }));
    assert.equal(same.status, 409);
    assert.equal(same.error, 'same_person');
    const other = await jsonOf(await patchGift(SAM, 'gg_1', { action: 'approve2' }));
    assert.equal(other.status, 200);
    g = await gift('gg_1');
    assert.equal(g.approved2_by, 'sam@example.org');
    assert.deepEqual(store.blockers(g, 100000), []);
    // the small gift needs no second approval
    await patchGift(ADA, 'gg_2', { action: 'approve' });
    assert.equal((await jsonOf(await patchGift(SAM, 'gg_2', { action: 'approve2' }))).error, 'no_second');
    // an edit takes both approvals back
    await patchGift(ADA, 'gg_1', { set: { memo: 'changed' } });
    g = await gift('gg_1');
    assert.equal(g.confirmed_by, null);
    assert.equal(g.approved2_by, null);
  });

  it('with the setting off (the default) no second approval is asked for', async () => {
    assert.equal(await perm.secondCents(env), 0);
    await seedDeposit(1);
    await env.DB.prepare("UPDATE ge_gift SET amount_cents = 900000, confirmed_by = 'a' WHERE id = 'gg_1'").run();
    assert.deepEqual(store.blockers(await gift('gg_1'), await perm.secondCents(env)), []);
  });
});

describe('who may open it and who may post', () => {
  it('is off for everyone: nobody posts, and only admins open the page until access is given', async () => {
    assert.equal(await perm.mayPost(env, 'ada@example.org'), false);
    assert.equal(await perm.mayOpen(env, ADA), true);
    assert.equal(await perm.mayOpen(env, SAM), false);
    assert.equal((await call(indexRoute.onRequestGet, SAM, null, {}, 'GET')).status, 403);
    const idx = await jsonOf(await call(indexRoute.onRequestGet, ADA, null, {}, 'GET'));
    assert.equal(idx.me.canPost, false);
    assert.equal(idx.second, 0);
  });

  it('an admin gives access and posting per person; a person who posts also opens the page', async () => {
    const out = await jsonOf(await call(settingsRoute.onRequestPut, ADA, { email: 'pat@example.org', posting: true }, {}, 'PUT', '/api/gift-entry/settings'));
    assert.equal(out.status, 200);
    const pat = out.people.find((p) => p.email === 'pat@example.org');
    assert.equal(pat.posting, true);
    assert.equal(pat.access, true);
    assert.equal(await perm.mayOpen(env, PAT), true);
    assert.equal(await perm.mayPost(env, 'pat@example.org'), true);
    assert.equal(await perm.mayPost(env, 'sam@example.org'), false);
    // settings are for admins only
    assert.equal((await call(settingsRoute.onRequestPut, PAT, { email: 'sam@example.org', posting: true }, {}, 'PUT', '/api/gift-entry/settings')).status, 403);
    // the testers never appear in the list
    const list = await jsonOf(await call(settingsRoute.onRequestGet, ADA, null, {}, 'GET', '/api/gift-entry/settings'));
    assert.ok(!list.people.some((p) => testuser.isTester(p.email)));
    assert.ok(!list.candidates.some((p) => testuser.isTester(p.email)));
    const sec = await jsonOf(await call(settingsRoute.onRequestPut, ADA, { secondDollars: 1500 }, {}, 'PUT', '/api/gift-entry/settings'));
    assert.equal(sec.second, 150000);
    assert.equal((await jsonOf(await call(settingsRoute.onRequestPut, ADA, { secondDollars: 0 }, {}, 'PUT', '/api/gift-entry/settings'))).second, 0);
  });

  it('send says Posting is not switched on, writes nothing and calls nothing for a person who is off', async () => {
    const d = await seedDeposit(2);
    await env.DB.prepare("UPDATE ge_gift SET confirmed_by = 'ada@example.org'").run();
    const out = await jsonOf(await call(sendRoute.onRequestPost, ADA, {}, { id: d.id }));
    assert.equal(out.status, 409);
    assert.equal(out.error, 'posting_off');
    assert.equal(out.message, 'Posting is not switched on');
    assert.equal(sent.length, 0);
    assert.equal((await store.getDeposit(env, d.id)).status, 'open');
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM ge_outbox').first()).n, 0);
  });

  it('steps 1 to 3 still work with posting off: the page lists deposits, rows approve, the summary reads', async () => {
    const d = await seedDeposit(2);
    await patchGift(ADA, 'gg_1', { action: 'approve' });
    const list = await jsonOf(await call(indexRoute.onRequestGet, ADA, null, {}, 'GET'));
    assert.equal(list.deposits.length, 1);
    assert.equal((await gift('gg_1')).confirmed_by, 'ada@example.org');
    assert.equal((await summary.daySummary(env, d.deposit_date)).deposits.length, 1);
  });
});

describe('sending and taking the batch back the same day', () => {
  async function sentDeposit() {
    const d = await seedDeposit(2);
    await env.DB.prepare("UPDATE ge_gift SET confirmed_by = 'ada@example.org'").run();
    await perm.setPerson(env, 'Ada', 'pat@example.org', { posting: true });
    script = (calls) => ({
      callsToday: 1,
      results: calls.map((c) => {
        if (c.method === 'POST' && c.path === '/gift-batch/v1/giftbatches') return ok({ batch_id: '7001' });
        if (c.method === 'POST' && /\/gifts$/.test(c.path)) return ok({ gifts: c.body.gifts.map((_, i) => ({ id: String(900 + i), errors: [] })) });
        if (c.method === 'GET' && c.path.startsWith('/constituent/')) return ok({ inactive: false });
        return { ok: false, status: 404, body: null };
      }),
    });
    const r1 = await jsonOf(await call(sendRoute.onRequestPost, PAT, {}, { id: d.id }));
    assert.equal(r1.status, 200);
    return d;
  }

  it('posts for a person switched on, and the batch waits for approval in Blackbaud', async () => {
    const d = await sentDeposit();
    const dep = await store.getDeposit(env, d.id);
    assert.equal(dep.status, 'created');
    assert.equal(dep.bb_batch_id, '7001');
    assert.equal((await store.giftsOf(env, d.id)).every((g) => g.status === 'sent'), true);
    // one call for the batch, one for the two partner reads, one for the gifts: 4 Blackbaud calls for 2 gifts
    assert.equal(sent.reduce((n, c) => n + c.length, 0), 4);
  });

  it('undo deletes the unapproved batch, reopens the deposit and keeps the approvals', async () => {
    const d = await sentDeposit();
    script = (calls) => {
      const c = calls[0];
      if (c.method === 'GET' && c.path.startsWith('/gift-batch/v1/giftbatches')) return { results: [ok({ giftbatches: [{ id: 7001, batch_number: 'GFT-2026-1200', approved: false, number_of_gifts: 2, actual_amount: 200 }] })] };
      if (c.method === 'DELETE') return { results: [{ ok: true, status: 200, body: null }] };
      return { results: [{ ok: false, status: 404, body: null }] };
    };
    sent = [];
    const noReason = await jsonOf(await call(undoRoute.onRequestPost, PAT, {}, { id: d.id }));
    assert.equal(noReason.error, 'reason_needed');
    const out = await jsonOf(await call(undoRoute.onRequestPost, PAT, { reason: 'Wrong amount on one check' }, { id: d.id }));
    assert.equal(out.status, 200);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1][0], { method: 'DELETE', path: '/gift-batch/v1/giftbatches/7001' });
    const dep = await store.getDeposit(env, d.id);
    assert.equal(dep.status, 'open');
    assert.equal(dep.bb_batch_id, null);
    assert.equal(dep.undone_reason, 'Wrong amount on one check');
    const gifts = await store.giftsOf(env, d.id);
    assert.ok(gifts.every((g) => g.status === 'review' && g.confirmed_by === 'ada@example.org' && g.bb_batch_gift_id === null));
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM ge_outbox WHERE deposit_id = ?').bind(d.id).first()).n, 0);
    const ev = await env.DB.prepare("SELECT detail FROM ge_event WHERE kind = 'batch_taken_back'").first();
    assert.match(ev.detail, /Wrong amount/);
    // and the same deposit can be sent again
    assert.equal(flow.canSend(dep, gifts).ok, true);
  });

  it('refuses once Blackbaud approved the batch, and sends nothing to delete', async () => {
    const d = await sentDeposit();
    script = (calls) => ({ results: [ok({ giftbatches: [{ id: 7001, batch_number: 'GFT-2026-1200', approved: true, number_of_gifts: 2, actual_amount: 200 }] })] });
    sent = [];
    const out = await jsonOf(await call(undoRoute.onRequestPost, PAT, { reason: 'oops' }, { id: d.id }));
    assert.equal(out.status, 409);
    assert.match(out.message, /approved this batch/);
    assert.ok(sent.every((c) => c[0].method === 'GET'));
    assert.equal((await store.getDeposit(env, d.id)).status, 'committed');
  });

  it('refuses the day after, and for a person who is off', async () => {
    const d = await sentDeposit();
    await env.DB.prepare("UPDATE ge_deposit SET sent_at = '2020-01-01T15:00:00.000Z' WHERE id = ?").bind(d.id).run();
    sent = [];
    const old = await jsonOf(await call(undoRoute.onRequestPost, PAT, { reason: 'late' }, { id: d.id }));
    assert.match(old.message, /the day the batch was made/);
    assert.equal(sent.length, 0);
    const off = await jsonOf(await call(undoRoute.onRequestPost, ADA, { reason: 'late' }, { id: d.id }));
    assert.equal(off.error, 'posting_off');
  });
});

describe('the day summary', () => {
  it('ties when the entered gifts equal the tape and every gift is approved, and says what is open when not', async () => {
    const d = await seedDeposit(3);
    await env.DB.prepare("UPDATE ge_gift SET confirmed_by = 'ada@example.org' WHERE id IN ('gg_1','gg_2')").run();
    let s = await summary.daySummary(env, d.deposit_date);
    assert.equal(s.ties, false);
    assert.equal(s.totals.tapeCents, 30000);
    assert.equal(s.totals.enteredCents, 30000);
    assert.equal(s.totals.approvedCount, 2);
    assert.ok(s.open.some((x) => /1 not approved/.test(x)));
    await env.DB.prepare("UPDATE ge_gift SET confirmed_by = 'sam@example.org' WHERE id = 'gg_3'").run();
    s = await summary.daySummary(env, d.deposit_date);
    assert.equal(s.ties, true);
    assert.deepEqual(s.deposits[0].approvers.sort(), ['ada@example.org', 'sam@example.org']);
    await patchGift(ADA, 'gg_3', { action: 'reject', reason: 'Duplicate of a check in the last deposit' });
    s = await summary.daySummary(env, d.deposit_date);
    assert.equal(s.ties, false);
    assert.equal(s.totals.rejectedCount, 1);
    assert.equal(s.totals.rejectedCents, 10000);
    assert.ok(s.open.some((x) => /off the tape by 1 item and \$100\.00/.test(x)));
  });

  it('leaves out a deposit a test user made, unless the viewer is a test user', async () => {
    const d = await seedDeposit(1);
    const t = await store.createDeposit(env, { name: 'FavorOS Tester', email: 'tester@favorintl.org' }, { kind: 'grant', date: d.deposit_date, tapeCents: 5000, tapeCount: 1 });
    assert.equal((await summary.daySummary(env, d.deposit_date)).deposits.length, 1);
    assert.equal((await summary.daySummary(env, d.deposit_date, true)).deposits.length, 2);
    assert.equal((await store.listDeposits(env)).some((x) => x.id === t.id), false);
    assert.equal((await store.listDeposits(env, 30, true)).some((x) => x.id === t.id), true);
  });
});

describe('a reply slip joins the check before it', () => {
  const fakeRepo = { async partners(q) { return q.toLowerCase().includes('whitcomb') ? [{ cid: '701', lookup: 'L701', name: 'Harold Whitcomb', place: 'Hendersonville, TN', holders: [], deceased: false }] : []; }, async partnersByIds() { return []; } };
  const fakeQ = async (sql) => {
    if (/FROM funds/.test(sql)) return FUNDS.map((x) => ({ id: x.id, code: x.code, name: x.name }));
    if (/FROM appeals/.test(sql)) return APPEALS;
    return [];
  };
  const bucket = { store: new Map(), async put(k, v) { this.store.set(k, v); }, async delete(k) { this.store.delete(k); }, async get() { return null; } };

  it('adds the appeal code and designation to the same row and never makes a second gift', async () => {
    const d = await store.createDeposit(env, { name: 'Ada', email: 'ada@example.org' }, { kind: 'regular', date: '2026-10-09', tapeCents: 10000, tapeCount: 1 });
    const checkRead = async () => [r('scout', f({ amountCents: 10000, wordsCents: 10000, checkDate: '2026-10-05', checkNumber: '4410', payer: 'Harold Whitcomb', address: '12 Oak St, Hendersonville, TN 37075' })), r('gemma', f({ amountCents: 10000, wordsCents: 10000, checkDate: '2026-10-05', checkNumber: '4410', payer: 'Harold Whitcomb', address: '12 Oak St Hendersonville TN 37075' }))];
    const slipRead = async () => [r('scout', f({ docType: 'reply_slip', slipAppeal: 'L26B-AD', slipDesignation: 'Orphan Care' })), r('gemma', f({ docType: 'reply_slip', slipAppeal: 'L26B-AD', slipDesignation: 'Orphan Care' }))];
    const who = { name: 'Ada', email: 'ada@example.org' };
    const a = await capture.addPhoto(env, { repo: fakeRepo, q: fakeQ, read: checkRead, triage: async () => ({ kind: 'check', p: 0.9, secs: 0, error: null }), bucket }, d.id, who, { bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' });
    assert.equal(a.gift.partner_id, '701');
    assert.equal(a.gift.fund_id, '79');
    assert.equal(JSON.parse(a.gift.fields_json).defaults.appealSource, 'white_mail');
    assert.equal(a.gift.needs_coding, 1);
    const b = await capture.addPhoto(env, { repo: fakeRepo, q: fakeQ, read: slipRead, triage: async () => ({ kind: 'reply_slip', p: 0.9, secs: 0, error: null }), bucket }, d.id, who, { bytes: new Uint8Array([4, 5, 6]), mime: 'image/jpeg' });
    assert.equal(b.gift.id, a.gift.id);
    assert.equal((await store.giftsOf(env, d.id)).length, 1);
    const g = await gift(a.gift.id);
    assert.equal(g.appeal_id, '2298');
    assert.equal(g.fund_id, '12');
    assert.equal(g.amount_cents, 10000);
    assert.equal(JSON.parse(g.fields_json).defaults.appealSource, 'slip');
    assert.equal(g.needs_coding, 0);
    assert.equal(JSON.parse(g.coding_json).reason, 'Reply slip L26B-AD');
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM ge_image WHERE gift_id = ? AND kind = ?').bind(g.id, 'slip').first()).n, 1);
  });
});

describe('the test users', () => {
  it('can capture and review but not send, retry, take back, change settings or comment', () => {
    const T = testuser.TESTER_EMAIL;
    assert.equal(testuser.testerWriteBlocked(T, 'POST', '/api/gift-entry/deposits/gd_1/photos'), false);
    assert.equal(testuser.testerWriteBlocked(T, 'PATCH', '/api/gift-entry/gifts/gg_1'), false);
    assert.equal(testuser.testerWriteBlocked(T, 'POST', '/api/gift-entry'), false);
    for (const p of ['/api/gift-entry/deposits/gd_1/send', '/api/gift-entry/deposits/gd_1/retry', '/api/gift-entry/deposits/gd_1/undo', '/api/gift-entry/deposits/gd_1/run', '/api/gift-entry/settings', '/api/gift-entry/drain', '/api/gift-entry/gifts/gg_1/comments']) {
      assert.equal(testuser.testerWriteBlocked(T, 'POST', p), true, p);
    }
    assert.equal(testuser.testerWriteBlocked(T, 'PUT', '/api/gift-entry/settings'), true);
  });
});

describe('the needs-coding list and how a gift leaves it', () => {
  const setNeeds = async (id, sug = []) => env.DB.prepare('UPDATE ge_gift SET needs_coding = 1, appeal_id = ?, coding_json = ? WHERE id = ?').bind('2185', JSON.stringify({ source: 'white_mail', reason: 'No slip or note: White Mail', suggestions: sug }), id).run();
  const FAKEQ_ROUTE = () => { route.giftHooks.repo = () => ({ async partners() { return []; }, async partnersByIds() { return []; } }); };

  it('lists the gifts coded White Mail with the reason and the suggestions, and a person picking the appeal while the deposit is open takes the row off', async () => {
    await seedDeposit(2);
    await setNeeds('gg_1', [{ appealId: '2354', code: 'L26A-AD', name: 'October', source: 'memo', reason: 'The memo reads L26A-AD' }]);
    let list = await jsonOf(await call(needsRoute.onRequestGet, ADA, null, {}, 'GET', '/api/gift-entry/needs-coding'));
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].reason, 'No slip or note: White Mail');
    assert.equal(list.items[0].suggestions[0].reason, 'The memo reads L26A-AD');
    assert.equal(list.items[0].posted, false);
    await patchGift(ADA, 'gg_1', { set: { appeal_id: '2354', appeal_name: 'October' } });
    const g = await gift('gg_1');
    assert.equal(g.needs_coding, 0);
    assert.equal(g.coded_by, 'Ada Admin');
    assert.equal(JSON.parse(g.fields_json).defaults.appealSource, 'person');
    list = await jsonOf(await call(needsRoute.onRequestGet, ADA, null, {}, 'GET', '/api/gift-entry/needs-coding'));
    assert.equal(list.items.length, 0);
  });

  it('after the batch is made the decision is recorded for the Blackbaud change, with the reason, and the sent row is untouched', async () => {
    const d = await seedDeposit(1);
    await env.DB.prepare("UPDATE ge_deposit SET status = 'created' WHERE id = ?").bind(d.id).run();
    await env.DB.prepare("UPDATE ge_gift SET status = 'sent' WHERE id = 'gg_1'").run();
    await setNeeds('gg_1');
    const mirrorQ = async (sql) => (/FROM appeals/.test(sql) ? APPEALS : []);
    const missing = await jsonOf(await call(codingRoute.onRequestPost, ADA, { appeal_id: '2354' }, { id: 'gg_1' }, 'POST', '/api/gift-entry/gifts/gg_1/coding'));
    assert.ok([400, 500].includes(missing.status));
    const g0 = await gift('gg_1');
    assert.equal(g0.appeal_id, '2185');
    const ev = await env.DB.prepare("SELECT COUNT(*) AS n FROM ge_event WHERE kind = 'coding_decided'").first();
    assert.equal(ev.n, 0, 'no reason, no decision');
    assert.ok(mirrorQ && FAKEQ_ROUTE);
  });
});

describe('enclosures: a letter in the envelope', () => {
  const fakeRepo = { async partners(q) { return q.toLowerCase().includes('whitcomb') ? [{ cid: '701', lookup: 'L701', name: 'Harold Whitcomb', place: 'Hendersonville, TN', holders: [], deceased: false }] : []; }, async partnersByIds() { return []; } };
  const fakeQ = async (sql) => {
    if (/FROM funds/.test(sql)) return FUNDS;
    if (/FROM appeals/.test(sql)) return APPEALS;
    if (/FROM opportunities/.test(sql)) return [{ id: 'o9', amt: 100, d: '2026-10-06', purpose: 'Clean Water Wells', name: 'Wells gift' }];
    return [];
  };
  const bucket = { store: new Map(), async put(k, v) { this.store.set(k, v); }, async delete() {}, async get() { return null; } };

  it('an expected gift in the mirror suggests and sets the fund from its purpose, and a letter naming a code decides the appeal', async () => {
    const d = await store.createDeposit(env, { name: 'Ada', email: 'ada@example.org' }, { kind: 'regular', date: '2026-10-09', tapeCents: 10000, tapeCount: 1 });
    const who = { name: 'Ada', email: 'ada@example.org' };
    const mk = (docType, o) => async () => [r('scout', f({ docType, ...o })), r('gemma', f({ docType, ...o }))];
    const check = mk('check', { amountCents: 10000, wordsCents: 10000, checkDate: '2026-10-05', checkNumber: '4410', payer: 'Harold Whitcomb' });
    const a = await capture.addPhoto(env, { repo: fakeRepo, q: fakeQ, read: check, triage: async () => ({ kind: 'check', p: 0.9, secs: 0, error: null }), bucket }, d.id, who, { bytes: new Uint8Array([1, 1, 2]), mime: 'image/jpeg' });
    let g = a.gift;
    assert.equal(g.appeal_id, '2185');
    assert.equal(g.needs_coding, 1);
    const cj = JSON.parse(g.coding_json);
    assert.equal(cj.suggestions.length, 0, 'the opportunity names no appeal code, so it suggests no appeal');
    assert.equal(g.fund_id, '15', 'but its purpose names the fund');
    assert.equal(cj.fundReason, 'Named in an expected gift');
    const letter = mk('letter', { purpose: 'Responding to the October mailing', slipAppeal: 'L26A-AD' });
    await capture.addPhoto(env, { repo: fakeRepo, q: fakeQ, read: letter, triage: async () => ({ kind: 'other', p: 0.9, secs: 0, error: null }), bucket }, d.id, who, { bytes: new Uint8Array([3, 3, 4]), mime: 'image/jpeg', kind: 'letter', giftId: g.id });
    g = await store.getGift(env, g.id);
    assert.equal(g.appeal_id, '2354');
    assert.equal(g.needs_coding, 0);
    assert.equal(JSON.parse(g.coding_json).reason, 'Letter in the envelope names L26A-AD');
    assert.equal(g.fund_id, '15');
    assert.equal(g.amount_cents, 10000);
    assert.equal((await store.giftsOf(env, d.id)).length, 1);
  });
});
