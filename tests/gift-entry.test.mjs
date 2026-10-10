// Run with: npm test
//
// Gift entry (the mail day): the readers' comparison, the card guard, the row rules, the duplicate guard, the outbox that creates
// an unapproved Blackbaud batch (retries, lost answers, per-gift errors, the lane cap), the commit watcher and the attachment
// copy. A real SQLite copy of db/gift-entry.sql stands in for D1 and a scripted sender stands in for Blackbaud. Made-up data only:
// the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import { memoryD1 } from './support/d1.mjs';
import './support/resolve-ts.mjs';

const read = await import('../functions/_lib/gifts/read.ts');
const store = await import('../functions/_lib/gifts/store.ts');
const flow = await import('../functions/_lib/gifts/flow.ts');
const attach = await import('../functions/_lib/gifts/attach.ts');
const capture = await import('../functions/_lib/gifts/capture.ts');
const match = await import('../functions/_lib/gifts/match.ts');
const runner = await import('../functions/_lib/gifts/runner.ts');

const SCHEMA = readFileSync(new URL('../db/gift-entry.sql', import.meta.url), 'utf8');

describe('card guard and amounts', () => {
  it('finds a Luhn-valid card number with spaces and dashes, and ignores check numbers', () => {
    assert.equal(read.hasCardNumber('card 4111 1111 1111 1111 exp 12/29'), true);
    assert.equal(read.hasCardNumber('4111-1111-1111-1111'), true);
    assert.equal(read.hasCardNumber('check 4410 dated 2026-10-05 amount 1200.00'), false);
    assert.equal(read.hasCardNumber('routing 021000021'), false);
    assert.equal(read.hasCardNumber('1234567890123'), false);
  });

  it('reads written amounts', () => {
    assert.equal(read.wordsToCents('One hundred and 00/100'), 10000);
    assert.equal(read.wordsToCents('Five thousand two hundred fifty and 50/100 dollars'), 525050);
    assert.equal(read.wordsToCents('Twenty-five'), 2500);
    assert.equal(read.wordsToCents('seventy five dollars and 25 cents'), 7525);
    assert.equal(read.wordsToCents('not an amount'), null);
    assert.equal(read.wordsToCents(null), null);
  });

  it('parses a fenced answer and cleans the fields', () => {
    const o = read.parseAnswer('```json\n{"amount_numeric": "$1,200.00", "check_date": "10/05/2026", "check_number": "No. 8821", "payer_name": "Linden Ridge Church"}\n```');
    const f = read.normalizeFields(o);
    assert.equal(f.amountCents, 120000);
    assert.equal(f.checkDate, '2026-10-05');
    assert.equal(f.checkNumber, 'No8821'.replace('No', 'No'));
    assert.equal(f.payer, 'Linden Ridge Church');
  });
});

const fields = (o) => ({ docType: 'check', amountCents: null, wordsCents: null, checkDate: null, payer: null, checkNumber: null, memo: null, slipAppeal: null, ...o });
const res = (reader, f, extra = {}) => ({ reader, model: reader, fields: f, secs: 1, error: null, card: false, ...extra });

describe('two readers, highlighted when they disagree', () => {
  it('agreeing readers flag nothing', () => {
    const f = fields({ amountCents: 12000, wordsCents: 12000, checkDate: '2026-10-05', checkNumber: '4410', payer: 'Harold Whitcomb' });
    const m = read.mergeReads([res('scout', f), res('gemma', f)], '2026-10-09');
    assert.deepEqual(m.flags, []);
    assert.equal(m.amountCents, 12000);
  });

  it('flags the amount when the readers disagree, naming both', () => {
    const a = fields({ amountCents: 500000, checkDate: '2026-10-05', checkNumber: '1902' });
    const b = fields({ amountCents: 500008, checkDate: '2026-10-05', checkNumber: '1902' });
    const m = read.mergeReads([res('scout', b), res('gemma', a)], '2026-10-09');
    assert.ok(m.flags.includes('amount'));
    assert.match(m.why.amount, /\$5,000\.08 and \$5,000\.00/);
    assert.ok(!m.flags.includes('number'));
  });

  it('flags figures that differ from the written words', () => {
    const f = fields({ amountCents: 13000, wordsCents: 15000, checkDate: '2026-10-05', checkNumber: '9041' });
    const m = read.mergeReads([res('scout', f), res('gemma', f)], '2026-10-09');
    assert.ok(m.flags.includes('amount'));
    assert.match(m.why.amount, /figures say \$130\.00 and the words say \$150\.00/);
  });

  it('flags a date more than 45 days old, in the future, or missing', () => {
    const mk = (d) => read.mergeReads([res('scout', fields({ amountCents: 100, checkNumber: '1', checkDate: d })), res('gemma', fields({ amountCents: 100, checkNumber: '1', checkDate: d }))], '2026-10-09');
    assert.ok(mk('2024-10-05').flags.includes('date'));
    assert.ok(mk('2026-10-20').flags.includes('date'));
    assert.ok(mk(null).flags.includes('date'));
    assert.ok(!mk('2026-09-20').flags.includes('date'));
  });

  it('a card number drops the answer and sets the card flag, whatever the reader claims', () => {
    const m = read.mergeReads([res('scout', null, { card: true }), res('gemma', fields({ amountCents: 100, checkNumber: '1', checkDate: '2026-10-05' }))], '2026-10-09');
    assert.equal(m.card, true);
  });

  it('unreadable photos ask for typing', () => {
    const m = read.mergeReads([res('scout', null, { error: 'no answer' }), res('gemma', null, { error: 'no answer' })], '2026-10-09');
    assert.equal(m.unreadable, true);
    assert.ok(m.flags.includes('amount'));
  });
});

describe('Reference, gift body and rules', () => {
  const g = { id: 'gg_abc', kind: 'check', check_number: '4410', memo: 'for the clinic', partner_id: '555', amount_cents: 12050, gift_date: '2026-10-09', check_date: '2026-10-05', fund_id: '79', appeal_id: '2298', soft_partner_id: null };

  it('builds a Reference with the channel, deposit, check number and hub id, under 255 characters and free of the site address', () => {
    const r = store.referenceFor({ ...g, memo: 'x'.repeat(400) + ' favorintl.org' }, 'Regular Mail 2026-10-09');
    assert.ok(r.length <= 255);
    assert.ok(r.startsWith('[Channel: Mail check] Regular Mail 2026-10-09, check 4410, hub gg_abc'));
    assert.ok(!/favorintl\.org/i.test(r));
    assert.equal(store.referenceFor({ ...g, kind: 'cash', check_number: null, memo: null }, 'Regular Mail 2026-10-09'), '[Channel: Mail cash] Regular Mail 2026-10-09, hub gg_abc');
  });

  it('writes the gift the way P0 proved it, with no constituency and no fundraiser credit', () => {
    const b = store.giftBody(g, { name: 'Regular Mail 2026-10-09', deposit_date: '2026-10-09' });
    assert.equal(b.type, 'Donation');
    assert.equal(b.constituent_id, '555');
    assert.deepEqual(b.amount, { value: 120.5 });
    assert.equal(b.date, '2026-10-09T00:00:00');
    assert.deepEqual(b.gift_splits, [{ amount: { value: 120.5 }, fund_id: '79', appeal_id: '2298' }]);
    assert.deepEqual(b.payments, [{ payment_method: 'PersonalCheck', check_number: '4410', check_date: { y: 2026, m: 10, d: 5 } }]);
    assert.ok(!('constituency' in b) && !('default_fundraiser_credits' in b) && !('fundraisers' in b));
    assert.deepEqual(store.giftBody({ ...g, soft_partner_id: '777' }, { name: 'x', deposit_date: '2026-10-09' }).soft_credits, [{ constituent_id: '777', amount: { value: 120.5 } }]);
  });

  it('copies the photo only for designated funds, $5,000 and up, and giving funds', () => {
    assert.equal(store.ruleFor({ fund_id: '79', amount_cents: 12000, partner_name: 'Harold Whitcomb', payer: 'Harold Whitcomb' }), '');
    assert.equal(store.ruleFor({ fund_id: '12', amount_cents: 12000, partner_name: 'X', payer: 'X' }), 'designated');
    assert.equal(store.ruleFor({ fund_id: '79', amount_cents: 500000, partner_name: 'X', payer: 'X' }), 'big');
    assert.equal(store.ruleFor({ fund_id: '79', amount_cents: 20000, partner_name: 'Greater Coastal Giving Fund', payer: 'X' }), 'giving_fund');
  });
});

let env;
let sent;
let script;

const send = async (calls) => {
  sent.push(calls);
  const out = script(calls, sent.length);
  return out;
};

function ok(body) {
  return { ok: true, status: 200, body };
}

async function seedDeposit(n = 3, over = {}) {
  const d = await store.createDeposit(env, { name: 'Morgan Test', email: 'morgan@example.org' }, { kind: 'regular', date: '2026-10-09', tapeCents: n * 10000, tapeCount: n, ...over });
  for (let i = 1; i <= n; i++) {
    const id = 'gg_' + i;
    await env.DB.prepare(
      `INSERT INTO ge_gift (id, deposit_id, seq, status, kind, partner_id, partner_name, amount_cents, gift_date, check_number, fund_id, appeal_id, confirmed_by, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
      .bind(id, d.id, i, 'review', 'check', String(500 + i), 'Partner ' + i, 10000, '2026-10-09', String(4400 + i), '79', '2298', 'Morgan Test', 'Morgan Test', new Date().toISOString(), new Date().toISOString())
      .run();
  }
  return d;
}

beforeEach(() => {
  const m = memoryD1();
  m.exec(SCHEMA);
  env = { DB: m, db: m.db };
  sent = [];
  script = () => ({ results: [], wait: 'unscripted' });
});

const ctx = (extra = {}) => ({ env, send, actor: 'Morgan Test', ...extra });

describe('tape and readiness', () => {
  it('reconciles to the tape, and every row needs a glance before it can send', async () => {
    const d = await seedDeposit(3);
    await env.DB.prepare("UPDATE ge_gift SET confirmed_by = NULL WHERE id = 'gg_3'").run();
    let gifts = await store.giftsOf(env, d.id);
    let t = store.tapeOf(d, gifts);
    assert.equal(t.matches, true);
    assert.equal(t.needLook, 1);
    assert.equal(flow.canSend(d, gifts).ok, false);
    assert.match(flow.canSend(d, gifts).why.join(' '), /1 row still needs a look/);
    await env.DB.prepare("UPDATE ge_gift SET confirmed_by = 'M' WHERE id = 'gg_3'").run();
    gifts = await store.giftsOf(env, d.id);
    assert.equal(flow.canSend(d, gifts).ok, true);
    await env.DB.prepare("UPDATE ge_gift SET amount_cents = 9900 WHERE id = 'gg_1'").run();
    gifts = await store.giftsOf(env, d.id);
    assert.match(flow.canSend(d, gifts).why.join(' '), /off the tape by \$1\.00/);
  });

  it('an undecided duplicate and a card number block the row', async () => {
    const d = await seedDeposit(1);
    await env.DB.prepare("UPDATE ge_gift SET dup_json = ? WHERE id = 'gg_1'").bind(JSON.stringify({ kind: 'hub', message: 'Same check already entered in Regular Mail 2026-10-07.', decision: null })).run();
    let g = await store.getGift(env, 'gg_1');
    assert.ok(store.blockers(g).some((x) => /duplicate/.test(x)));
    await env.DB.prepare("UPDATE ge_gift SET dup_json = ? WHERE id = 'gg_1'").bind(JSON.stringify({ kind: 'hub', message: 'x', decision: 'keep' })).run();
    g = await store.getGift(env, 'gg_1');
    assert.deepEqual(store.blockers(g), []);
    await env.DB.prepare("UPDATE ge_gift SET fields_json = ? WHERE id = 'gg_1'").bind(JSON.stringify({ card: true })).run();
    g = await store.getGift(env, 'gg_1');
    assert.ok(store.blockers(g).some((x) => /card number/.test(x)));
  });

  it('a giving fund needs the recommending partner or the No partner named choice', async () => {
    await seedDeposit(1);
    await env.DB.prepare("UPDATE ge_gift SET rule = 'giving_fund' WHERE id = 'gg_1'").run();
    let g = await store.getGift(env, 'gg_1');
    assert.ok(store.blockers(g).some((x) => /recommended/.test(x)));
    await env.DB.prepare("UPDATE ge_gift SET soft_partner_name = 'No partner named' WHERE id = 'gg_1'").run();
    g = await store.getGift(env, 'gg_1');
    assert.deepEqual(store.blockers(g), []);
  });
});

describe('the outbox creates an unapproved batch', () => {
  it('refuses to send while the tape is off', async () => {
    const d = await seedDeposit(3);
    await env.DB.prepare("UPDATE ge_gift SET status = 'removed' WHERE id = 'gg_3'").run();
    await assert.rejects(() => flow.queueSend(ctx(), d.id), /count is 2 and the tape says 3/);
    assert.equal(sent.length, 0);
  });

  it('creates the batch, checks each partner, posts the gifts and reads every gift', async () => {
    const d = await seedDeposit(3);
    script = (calls) => {
      const c = calls[0];
      if (c.method === 'POST' && c.path === '/gift-batch/v1/giftbatches') return { results: [ok({ batch_id: '9001' })], callsToday: 1, cap: 400 };
      if (c.method === 'GET' && c.path.startsWith('/constituent/v1/constituents/')) return { results: calls.map(() => ok({ id: '1' })), callsToday: 4, cap: 400 };
      if (c.path === '/gift/v1/giftbatches/9001/gifts') return { results: [ok({ errors: [], gifts: c.body.gifts.map((_, i) => ({ id: String(31000 + i), errors: [] })) })], callsToday: 5, cap: 400 };
      return { results: [{ ok: false, status: 404, body: null }] };
    };
    await flow.queueSend(ctx(), d.id);
    const p = await flow.advance(ctx(), d.id);
    assert.equal(p.status, 'created');
    const batchCall = sent[0][0];
    assert.equal(batchCall.body.expected_number, 3);
    assert.equal(batchCall.body.expected_batch_total, 300);
    assert.ok(batchCall.body.batch_description.includes('hub ' + d.id));
    assert.ok(!('batch_number' in batchCall.body));
    const post = sent.find((s) => s[0].path === '/gift/v1/giftbatches/9001/gifts')[0];
    assert.equal(post.body.gifts.length, 3);
    const gifts = await store.giftsOf(env, d.id);
    assert.ok(gifts.every((g) => g.status === 'sent' && g.bb_batch_gift_id));
    assert.equal((await store.getDeposit(env, d.id)).bb_batch_id, '9001');
    assert.equal((await env.DB.prepare('SELECT calls FROM ge_lane').first()).calls, 5);
    // running again changes nothing: a finished step never repeats
    const before = sent.length;
    await flow.advance(ctx(), d.id);
    assert.equal(sent.length, before);
  });

  it('a gift stored with an error marks the deposit as needing a person, and never posts twice', async () => {
    const d = await seedDeposit(2);
    script = (calls) => {
      const c = calls[0];
      if (c.path === '/gift-batch/v1/giftbatches') return { results: [ok({ batch_id: '9002' })] };
      if (c.method === 'GET') return { results: calls.map(() => ok({ id: '1' })) };
      return { results: [ok({ errors: [], gifts: [{ id: '31001', errors: [] }, { id: '31002', errors: [{ message: 'The fund does not exist.' }] }] })] };
    };
    await flow.queueSend(ctx(), d.id);
    await flow.advance(ctx(), d.id);
    const dep = await store.getDeposit(env, d.id);
    assert.equal(dep.status, 'needs_person');
    const g2 = await store.getGift(env, 'gg_2');
    assert.equal(g2.status, 'failed');
    assert.match(g2.error, /fund does not exist/);
    const posts = sent.filter((s) => /\/gifts$/.test(s[0].path)).length;
    await flow.retryDeposit(ctx(), d.id);
    await flow.advance(ctx(), d.id);
    // the failed gift is already in the batch, so a retry posts nothing
    assert.equal(sent.filter((s) => /\/gifts$/.test(s[0].path)).length, posts);
    await store.updateGift(env, 'gg_2', { status: 'by_hand' });
    await flow.settleDeposit(env, d.id);
    assert.equal((await store.getDeposit(env, d.id)).status, 'created');
  });

  it('a rejected post (400) stores nothing, so Try again posts the gifts', async () => {
    const d = await seedDeposit(2);
    let rejecting = true;
    script = (calls) => {
      const c = calls[0];
      if (c.path === '/gift-batch/v1/giftbatches') return { results: [ok({ batch_id: '9003' })] };
      if (c.method === 'GET') return { results: calls.map(() => ok({ id: '1' })) };
      if (rejecting) return { results: [{ ok: false, status: 400, body: [{ message: 'The field reference must be a string with a maximum length of 255.' }] }] };
      return { results: [ok({ errors: [], gifts: c.body.gifts.map((_, i) => ({ id: String(32000 + i), errors: [] })) })] };
    };
    await flow.queueSend(ctx(), d.id);
    await flow.advance(ctx(), d.id);
    assert.equal((await store.getDeposit(env, d.id)).status, 'needs_person');
    rejecting = false;
    await flow.retryDeposit(ctx(), d.id);
    await flow.advance(ctx(), d.id);
    assert.equal((await store.getDeposit(env, d.id)).status, 'created');
  });

  it('a lost answer on the batch is checked against Blackbaud before it sends again', async () => {
    const d = await seedDeposit(1);
    let t = Date.parse('2026-10-10T12:00:00Z');
    const c = () => ctx({ now: () => new Date(t) });
    script = (calls, n) => {
      if (n === 1) return { results: [], wait: 'Blackbaud did not answer. It will try again.', lost: true };
      const call = calls[0];
      if (call.method === 'GET' && call.path.startsWith('/gift-batch')) return { results: [ok({ giftbatches: [{ id: '9010', batch_number: 'GFT-2026-1200', batch_description: `x, hub ${d.id}`, number_of_gifts: 0, actual_amount: 0, approved: false }] })] };
      if (call.method === 'GET') return { results: calls.map(() => ok({ id: '1' })) };
      if (call.path === '/gift/v1/giftbatches/9010/gifts') return { results: [ok({ errors: [], gifts: [{ id: '31100', errors: [] }] })] };
      return { results: [{ ok: false, status: 500, body: null }] };
    };
    await flow.queueSend(c(), d.id);
    let p = await flow.advance(c(), d.id);
    assert.equal(p.steps[0].status, 'queued');
    assert.equal(p.steps[0].attempts, 1);
    assert.ok(p.waiting);
    // not due yet: nothing is sent
    const n = sent.length;
    await flow.advance(c(), d.id);
    assert.equal(sent.length, n);
    t += 61_000;
    p = await flow.advance(c(), d.id);
    assert.equal(p.status, 'created');
    const created = sent.filter((s) => s[0].method === 'POST' && s[0].path === '/gift-batch/v1/giftbatches');
    assert.equal(created.length, 1, 'the batch was made once; the retry found it by the hub id');
    assert.equal((await store.getDeposit(env, d.id)).bb_batch_number, 'GFT-2026-1200');
  });

  it('five failed tries stop and ask a person; the daily cap waits for the reset', async () => {
    const d = await seedDeposit(1);
    let t = Date.parse('2026-10-10T12:00:00Z');
    const c = () => ctx({ now: () => new Date(t) });
    script = () => ({ results: [{ ok: false, status: 503, body: { message: 'busy' } }] });
    await flow.queueSend(c(), d.id);
    for (let i = 0; i < 6; i++) {
      await flow.advance(c(), d.id);
      t += 61 * 60_000;
    }
    const dep = await store.getDeposit(env, d.id);
    assert.equal(dep.status, 'needs_person');
    const row = (await flow.listOutbox(env, d.id))[0];
    assert.equal(row.attempts, 5);

    const d2 = await seedDeposit(1, { date: '2026-10-08' }).catch(() => null);
    script = () => ({ results: [], capped: true, wait: "Gift entry is at today's Blackbaud limit. It sends after the reset." });
    const d3 = await store.createDeposit(env, { name: 'M', email: 'm@example.org' }, { kind: 'acquisition', date: '2026-10-09', tapeCents: 10000, tapeCount: 1 });
    await env.DB.prepare(`INSERT INTO ge_gift (id, deposit_id, seq, status, kind, partner_id, amount_cents, gift_date, check_number, fund_id, appeal_id, confirmed_by, created_by, created_at, updated_at) VALUES ('gg_x', ?, 1, 'review', 'check', '1', 10000, '2026-10-09', '1', '79', '1', 'M', 'M', 'x', 'x')`).bind(d3.id).run();
    await flow.queueSend(c(), d3.id);
    const p = await flow.advance(c(), d3.id);
    assert.equal(p.steps[0].status, 'waiting');
    assert.match(p.waiting, /^2026-10-11T00:10/);
    assert.equal((await store.getDeposit(env, d3.id)).status, 'sending');
  });

  it('a partner Blackbaud no longer has fails that gift only', async () => {
    const d = await seedDeposit(2);
    script = (calls) => {
      const c = calls[0];
      if (c.path === '/gift-batch/v1/giftbatches') return { results: [ok({ batch_id: '9004' })] };
      if (c.method === 'GET') return { results: calls.map((x) => (x.path.endsWith('/501') ? { ok: false, status: 404, body: null } : ok({ id: '1' }))) };
      return { results: [ok({ errors: [], gifts: c.body.gifts.map((_, i) => ({ id: String(33000 + i), errors: [] })) })] };
    };
    await flow.queueSend(ctx(), d.id);
    await flow.advance(ctx(), d.id);
    assert.equal((await store.getGift(env, 'gg_1')).status, 'failed');
    assert.equal((await store.getGift(env, 'gg_2')).status, 'sent');
    const post = sent.find((s) => /\/gifts$/.test(s[0].path))[0];
    assert.equal(post.body.gifts.length, 1);
  });
});

describe('watching for the commit', () => {
  async function created() {
    const d = await seedDeposit(2);
    script = (calls) => {
      const c = calls[0];
      if (c.path === '/gift-batch/v1/giftbatches') return { results: [ok({ batch_id: '9005' })] };
      if (c.method === 'GET') return { results: calls.map(() => ok({ id: '1' })) };
      return { results: [ok({ errors: [], gifts: c.body.gifts.map((_, i) => ({ id: String(34000 + i), errors: [] })) })] };
    };
    await flow.queueSend(ctx(), d.id);
    await flow.advance(ctx(), d.id);
    return d;
  }

  it('reads the batch as unapproved, then as committed', async () => {
    const d = await created();
    script = () => ({ results: [ok({ giftbatches: [{ id: '9005', batch_number: 'GFT-2026-1300', number_of_gifts: 2, actual_amount: 200, approved: false, has_exceptions: false }] })] });
    let w = await flow.pollBatch(ctx(), d.id);
    assert.equal(w.approved, false);
    assert.equal(w.mismatch, null);
    assert.equal((await store.getDeposit(env, d.id)).status, 'created');
    script = () => ({ results: [ok({ giftbatches: [{ id: '9005', batch_number: 'GFT-2026-1300', number_of_gifts: 2, actual_amount: 200, approved: true }] })] });
    w = await flow.pollBatch(ctx(), d.id);
    assert.equal(w.approved, true);
    const dep = await store.getDeposit(env, d.id);
    assert.equal(dep.status, 'committed');
    assert.ok(dep.committed_at);
    assert.equal(dep.bb_batch_number, 'GFT-2026-1300');
  });

  it('says so when the batch holds different gifts or dollars than the hub sent', async () => {
    const d = await created();
    script = () => ({ results: [ok({ giftbatches: [{ id: '9005', number_of_gifts: 3, actual_amount: 250, approved: false }] })] });
    const w = await flow.pollBatch(ctx(), d.id);
    assert.match(w.mismatch, /shows 3 gifts and \$250\.00\. The hub sent 2 and \$200\.00/);
  });
});

describe('attachments after commit', () => {
  it('copies the photo for a rule gift in three steps and skips plain gifts', async () => {
    const d = await seedDeposit(2);
    await env.DB.prepare("UPDATE ge_deposit SET status = 'committed', bb_batch_id = '9006' WHERE id = ?").bind(d.id).run();
    for (const gid of ['gg_1', 'gg_2']) {
      await env.DB.prepare("UPDATE ge_gift SET status = 'sent' WHERE id = ?").bind(gid).run();
      await env.DB.prepare('INSERT INTO ge_image (id, gift_id, deposit_id, kind, r2_key, sha256, bytes, mime, uploaded_by, uploaded_at, copy_to_bb) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind('gi_' + gid, gid, d.id, 'check_front', 'k/' + gid, 'sha' + gid, 3, 'image/jpeg', 'm', 'x', gid === 'gg_2' ? 1 : 0)
        .run();
    }
    script = (calls) => {
      const c = calls[0];
      if (c.method === 'GET' && c.path.startsWith('/gift/v1/gifts?')) return { results: [ok({ count: 1, value: [{ id: '66600', reference: '[Channel: Mail check] Regular Mail, check 4402, hub gg_2' }] })], callsToday: 2 };
      if (c.path === '/gift/v1/documents') return { results: [ok({ file_id: 'file-1', file_upload_request: { method: 'PUT', url: 'https://files.example/blob', headers: [{ name: 'x-ms-blob-type', value: 'BlockBlob' }] } })] };
      if (c.path === '/gift/v1/gifts/attachments') return { results: [ok({ id: 'att-1' })] };
      return { results: [{ ok: false, status: 404, body: null }] };
    };
    const puts = [];
    const out = await attach.runAttachments(ctx(), d.id, {
      bytes: async () => new Uint8Array([1, 2, 3]),
      put: async (url, init) => {
        puts.push({ url, init });
        return new Response('', { status: 201 });
      },
    });
    assert.equal(out.attached, 1);
    assert.equal(puts.length, 1);
    assert.equal(puts[0].init.headers['x-ms-blob-type'], 'BlockBlob');
    const att = sent.find((s) => s[0].path === '/gift/v1/gifts/attachments')[0];
    assert.equal(att.body.parent_id, '66600');
    assert.equal(att.body.type, 'Physical');
    assert.equal(sent.length, 3, 'three lane calls per rule gift');
    assert.equal((await store.getGift(env, 'gg_2')).bb_gift_id, '66600');
    const img = await env.DB.prepare("SELECT * FROM ge_image WHERE id = 'gi_gg_2'").first();
    assert.equal(img.bb_attachment_id, 'att-1');
    assert.ok(img.attached_at);
    const plain = await env.DB.prepare("SELECT * FROM ge_image WHERE id = 'gi_gg_1'").first();
    assert.equal(plain.attached_at, null);
  });

  it('waits when the committed gift is not found yet, and does nothing before the commit', async () => {
    const d = await seedDeposit(1);
    await env.DB.prepare("UPDATE ge_gift SET status = 'sent' WHERE id = 'gg_1'").run();
    await env.DB.prepare('INSERT INTO ge_image (id, gift_id, deposit_id, kind, r2_key, sha256, bytes, mime, uploaded_by, uploaded_at, copy_to_bb) VALUES (?,?,?,?,?,?,?,?,?,?,1)').bind('gi_1', 'gg_1', d.id, 'check_front', 'k/1', 'sh', 3, 'image/jpeg', 'm', 'x').run();
    const deps = { bytes: async () => new Uint8Array([1]), put: async () => new Response('', { status: 201 }) };
    await attach.runAttachments(ctx(), d.id, deps);
    assert.equal(sent.length, 0, 'an unapproved batch has no gift ids, so nothing is called');
    await env.DB.prepare("UPDATE ge_deposit SET status = 'committed' WHERE id = ?").bind(d.id).run();
    script = () => ({ results: [ok({ count: 0, value: [] })] });
    const out = await attach.runAttachments(ctx(), d.id, deps);
    assert.equal(out.attached, 0);
    assert.equal(out.waiting, 1);
  });
});

describe('capture: photo in, review row out', () => {
  const fakeRepo = { async partners(q) { return q.toLowerCase().includes('whitcomb') ? [{ cid: '701', lookup: 'L701', name: 'Harold Whitcomb', place: 'Hendersonville, TN', holders: [], deceased: false }] : []; }, async partnersByIds() { return []; } };
  const calls = [];
  const fakeQ = async (sql, params) => {
    calls.push(sql);
    if (/FROM funds/.test(sql)) return [{ id: '79', code: 'Where Needed Most', name: 'Where Needed Most' }];
    if (/FROM appeals/.test(sql)) return [{ id: '2298', code: 'P200-RDAD', name: 'Portfolio', category: 'Portfolio' }];
    if (/gift_splits AS splits/.test(sql)) return [{ splits: JSON.stringify([{ fund_id: '79', appeal_id: '2298' }]), d: '2026-08-01' }];
    return [];
  };
  const bucket = { store: new Map(), async put(k, v) { this.store.set(k, v); }, async delete(k) { this.store.delete(k); }, async get(k) { return this.store.get(k) ? { arrayBuffer: async () => this.store.get(k).buffer } : null; } };
  const goodRead = async () => [
    res('scout', fields({ amountCents: 10000, wordsCents: 10000, checkDate: '2026-10-05', checkNumber: '4410', payer: 'Harold Whitcomb' })),
    res('gemma', fields({ amountCents: 10000, wordsCents: 10000, checkDate: '2026-10-05', checkNumber: '4410', payer: 'Harold Whitcomb' })),
  ];

  it('proposes the partner, the last-gift appeal and a rule, and leaves the glance to a person', async () => {
    const d = await store.createDeposit(env, { name: 'Morgan', email: 'm@example.org' }, { kind: 'regular', date: '2026-10-09', tapeCents: 10000, tapeCount: 1 });
    const out = await capture.addPhoto(env, { repo: fakeRepo, q: fakeQ, read: goodRead, bucket }, d.id, { name: 'Morgan', email: 'm@example.org' }, { bytes: new Uint8Array([9, 9, 9]), mime: 'image/jpeg' });
    const g = out.gift;
    assert.equal(g.status, 'review');
    assert.equal(g.partner_id, '701');
    assert.equal(g.amount_cents, 10000);
    assert.equal(g.check_number, '4410');
    assert.equal(g.fund_id, '79');
    assert.equal(g.appeal_id, '2298');
    assert.equal(g.confirmed_by, null);
    assert.deepEqual(store.blockers(g), ['Look it over and press Looks right.']);
    assert.equal(bucket.store.size, 1);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM ge_read').first()).n, 2);
    assert.ok(calls.every((s) => !/insert|update|replace|upsert|delete|drop|alter|create/i.test(s)), 'mirror statements avoid the words the mirror refuses');
  });

  it('a card number in the photo deletes the image and keeps nothing', async () => {
    const d = await store.createDeposit(env, { name: 'Morgan', email: 'm@example.org' }, { kind: 'regular', date: '2026-10-09', tapeCents: 5000, tapeCount: 1 });
    bucket.store.clear();
    const cardRead = async () => [res('scout', null, { card: true }), res('gemma', fields({ amountCents: 5000 }))];
    const out = await capture.addPhoto(env, { repo: fakeRepo, q: fakeQ, read: cardRead, bucket }, d.id, { name: 'Morgan', email: 'm@example.org' }, { bytes: new Uint8Array([7]), mime: 'image/jpeg' });
    assert.equal(bucket.store.size, 0);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM ge_image WHERE gift_id = ?').bind(out.gift.id).first()).n, 0);
    assert.match(out.gift.error, /card number/);
    assert.ok(store.blockers(out.gift).some((x) => /card number/.test(x)));
  });

  it('the duplicate guard catches the same check in another deposit and the same photo twice', async () => {
    const d1 = await store.createDeposit(env, { name: 'Morgan', email: 'm@example.org' }, { kind: 'regular', date: '2026-10-07', tapeCents: 10000, tapeCount: 1 });
    const d2 = await store.createDeposit(env, { name: 'Morgan', email: 'm@example.org' }, { kind: 'acquisition', date: '2026-10-09', tapeCents: 10000, tapeCount: 1 });
    const deps = { repo: fakeRepo, q: fakeQ, read: goodRead, bucket };
    const bytes = new Uint8Array([5, 5, 5, 5]);
    await capture.addPhoto(env, deps, d1.id, { name: 'Morgan', email: 'm@example.org' }, { bytes, mime: 'image/jpeg' });
    const again = await capture.addPhoto(env, deps, d2.id, { name: 'Morgan', email: 'm@example.org' }, { bytes, mime: 'image/jpeg' });
    assert.equal(again.duplicatePhoto || !!JSON.parse(again.gift.dup_json).kind, true);
    const dup = JSON.parse(again.gift.dup_json);
    assert.equal(dup.decision, null);
    assert.ok(['hub', 'photo'].includes(dup.kind));
    assert.ok(store.blockers(again.gift).some((x) => /duplicate/.test(x)));
    // the same check with a different photo is still caught by the check number
    const third = await capture.addPhoto(env, deps, d2.id, { name: 'Morgan', email: 'm@example.org' }, { bytes: new Uint8Array([1, 2, 3, 4, 5]), mime: 'image/jpeg' });
    assert.equal(JSON.parse(third.gift.dup_json).kind, 'hub');
  });

  it('a failed read leaves the row for typing', async () => {
    const d = await store.createDeposit(env, { name: 'Morgan', email: 'm@example.org' }, { kind: 'regular', date: '2026-10-09', tapeCents: 5000, tapeCount: 1 });
    const out = await capture.addPhoto(env, { repo: fakeRepo, q: fakeQ, read: async () => { throw new Error('boom'); }, bucket }, d.id, { name: 'Morgan', email: 'm@example.org' }, { bytes: new Uint8Array([3, 3]), mime: 'image/jpeg' });
    assert.equal(out.gift.status, 'review');
    assert.match(out.gift.error, /could not be read/);
  });

  it('name queries split a couple into each person', () => {
    assert.deepEqual(match.nameQueries('Harold & Judith Whitcomb').slice(0, 3), ['Harold & Judith Whitcomb', 'Harold Whitcomb', 'Judith Whitcomb']);
  });
});

describe('one pass over a deposit', () => {
  it('polls at most once a minute, notices the commit, then copies the photo of a rule gift', async () => {
    const d = await seedDeposit(1);
    await env.DB.prepare("UPDATE ge_deposit SET status = 'created', bb_batch_id = '9100' WHERE id = ?").bind(d.id).run();
    await env.DB.prepare("UPDATE ge_gift SET status = 'sent', rule = 'big' WHERE id = 'gg_1'").run();
    await env.DB.prepare('INSERT INTO ge_image (id, gift_id, deposit_id, kind, r2_key, sha256, bytes, mime, uploaded_by, uploaded_at, copy_to_bb) VALUES (?,?,?,?,?,?,?,?,?,?,1)').bind('gi_a', 'gg_1', d.id, 'check_front', 'k/a', 'sha', 3, 'image/jpeg', 'm', 'x').run();
    env.GIFT_CAPTURES = { async get() { return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; } };
    let approved = false;
    script = (calls) => {
      const c = calls[0];
      if (c.path.startsWith('/gift-batch/v1/giftbatches')) return { results: [ok({ giftbatches: [{ id: '9100', batch_number: 'GFT-2026-1400', number_of_gifts: 1, actual_amount: 100, approved }] })] };
      if (c.path.startsWith('/gift/v1/gifts?')) return { results: [ok({ value: [{ id: '70001', reference: 'x hub gg_1' }] })] };
      if (c.path === '/gift/v1/documents') return { results: [ok({ file_id: 'f1', file_upload_request: { method: 'PUT', url: 'https://files.example/b', headers: [] } })] };
      if (c.path === '/gift/v1/gifts/attachments') return { results: [ok({ id: 'att-9' })] };
      return { results: [{ ok: false, status: 404, body: null }] };
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 201 });
    try {
      let p = await runner.runDeposit(env, ctx(), d.id);
      assert.equal(p.watch.approved, false);
      const n = sent.length;
      p = await runner.runDeposit(env, ctx(), d.id);
      assert.equal(p.watch, null, 'the second pass inside a minute does not poll');
      assert.equal(sent.length, n);
      p = await runner.runDeposit(env, ctx(), d.id, { force: true });
      assert.equal(p.watch.approved, false);
      approved = true;
      p = await runner.runDeposit(env, ctx(), d.id, { force: true });
      assert.equal(p.watch.approved, true);
      assert.equal((await store.getDeposit(env, d.id)).status, 'committed');
      assert.equal(p.attach.attached, 1, 'the pass that sees the commit also copies the photo');
      p = await runner.runDeposit(env, ctx(), d.id);
      assert.equal(p.attach.attached, 0);
      assert.equal(await attach.attachmentsLeft(env, d.id), 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
