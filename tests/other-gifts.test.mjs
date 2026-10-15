// Run with: npm test
//
// Other gifts: DAF, foundation, wire, stock and phone gifts entered into a batch with the soft credit, a second person's approval, and the
// post to Blackbaud through SKY API. A real SQLite copy of db/other-gifts.sql stands in for D1 and a scripted sender stands in for
// Blackbaud: nothing here can write to Blackbaud. Made-up data only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import { memoryD1 } from './support/d1.mjs';
import './support/resolve-ts.mjs';

const rules = await import('../functions/_lib/other-gifts/rules.ts');
const store = await import('../functions/_lib/other-gifts/store.ts');
const post = await import('../functions/_lib/other-gifts/post.ts');
const acts = await import('../functions/_lib/other-gifts/actions.ts');
const access = await import('../functions/_lib/other-gifts/access.ts');
const view = await import('../functions/_lib/other-gifts/view.ts');
const { resetHubCache } = await import('../functions/_lib/admin/hubcache.ts').catch(() => ({}));

const SCHEMA = ['gift-entry.sql', 'gift-photo.sql', 'other-gifts.sql'].map((f) => readFileSync(new URL('../db/' + f, import.meta.url), 'utf8')).join(';\n') + ';\nCREATE TABLE IF NOT EXISTS hub_settings (key TEXT PRIMARY KEY, value TEXT, updated_by TEXT, updated_at TEXT);';

const A = { name: 'Alex Entry', email: 'alex.entry@favorintl.org', admin: true, canApprove: true };
const B = { name: 'Blake Second', email: 'blake.second@favorintl.org', admin: true, canApprove: true };
const C = { name: 'Casey Staff', email: 'casey.staff@favorintl.org', admin: false, canApprove: false };
const TODAY = '2026-10-14';
const q = async () => [];

const FULL = (over = {}) => ({
  kind: 'daf', partner_id: '37974', partner_name: 'Example Giving Foundation', fund_named: 'The Sample Family Giving Fund',
  soft_partner_id: '37975', soft_partner_name: 'Sample Recommender', amount_cents: 100000, gift_date: '2026-10-13', fund_id: '79', fund_name: 'Where Needed Most',
  appeal_id: '2298', appeal_name: 'P200-RDAD', ...over,
});

/** A sender that records every call and answers like Blackbaud does. `script` overrides one call at a time. */
function sender(script = []) {
  const calls = [];
  let n = 0;
  const fn = async (batch) => {
    const out = [];
    for (const c of batch) {
      calls.push(c);
      const s = script.shift();
      if (s === 'lost') return { results: [], wait: 'Blackbaud did not answer. It will try again.', lost: true };
      if (s) {
        out.push(s);
        continue;
      }
      if (c.method === 'POST' && c.path === '/gift/v1/gifts') out.push({ ok: true, status: 200, body: { id: String(70000 + ++n) } });
      else if (c.method === 'GET') out.push({ ok: true, status: 200, body: { value: [] } });
      else if (c.path === '/gift/v1/documents') out.push({ ok: true, status: 200, body: { file_id: 'f1', file_upload_request: { url: 'https://files.test/up', method: 'PUT', headers: [] } } });
      else if (c.path === '/gift/v1/gifts/attachments') out.push({ ok: true, status: 200, body: { id: 'att1' } });
      else out.push({ ok: true, status: 200, body: {} });
    }
    return { results: out, callsToday: calls.length, cap: 400 };
  };
  return { fn, calls };
}

let env;
let ctx;
let s;
const fresh = (script) => {
  const d1 = memoryD1();
  d1.exec(SCHEMA);
  env = { DB: d1 };
  s = sender(script);
  ctx = { env, send: s.fn, letterBytes: async () => new Uint8Array([1, 2, 3]), put: async () => new Response('', { status: 200 }) };
};
beforeEach(() => {
  if (typeof resetHubCache === 'function') resetHubCache();
  fresh();
});

const enterAndSend = async (over = {}, who = A) => {
  const g = await acts.createGift(env, q, who, TODAY, FULL(over));
  await acts.submitBatch(env, who, g.batch_id);
  return g;
};

describe('rules', () => {
  const base = { id: 'og_x', batch_id: 'b', seq: 1, status: 'draft', created_by: 'A', created_by_email: 'a@x', created_at: '', updated_at: '', letter_key: null, letter_status: null, dup_json: null, no_soft: 0, fund_named: null, ref_text: null, memo: null, soft_partner_id: null };
  it('a DAF needs the sponsor, amount, date, fund, appeal, the fund named and a soft credit decision', () => {
    const g = { ...base, kind: 'daf', partner_id: null, amount_cents: null, gift_date: null, fund_id: null, appeal_id: null };
    assert.equal(rules.blockers(g).length, 7);
    assert.equal(rules.blockers({ ...g, partner_id: '1', amount_cents: 500, gift_date: '2026-10-01', fund_id: '79', appeal_id: '2', fund_named: 'The Fund', no_soft: 1 }).length, 0);
  });
  it('a wire needs no soft credit decision and a stock gift needs its ticker', () => {
    const w = { ...base, kind: 'wire', partner_id: '1', amount_cents: 500, gift_date: '2026-10-01', fund_id: '79', appeal_id: '2' };
    assert.deepEqual(rules.blockers(w), []);
    assert.deepEqual(rules.blockers({ ...w, kind: 'stock' }), ['Enter the ticker and the number of shares.']);
  });
  it('naming a recommender clears No partner named, and the other way round', () => {
    assert.equal(rules.cleanEdit({ soft_partner_id: '5', no_soft: 1 }, TODAY).no_soft, 0);
    const e = rules.cleanEdit({ no_soft: true }, TODAY);
    assert.equal(e.soft_partner_id, null);
  });
  it('refuses a future gift date and a card kind', () => {
    assert.deepEqual(rules.cleanEdit({ gift_date: '2026-10-20' }, TODAY), {});
    assert.deepEqual(rules.cleanEdit({ kind: 'card' }, TODAY), {});
  });
  it('the Blackbaud gift carries the soft credit for the full amount, an Other payment, FavorOS id and who entered and approved', () => {
    const g = { ...base, kind: 'daf', partner_id: '37974', amount_cents: 100000, gift_date: '2026-10-13', fund_id: '79', appeal_id: '2298', fund_named: 'Sample Fund', soft_partner_id: '37975', created_by: 'Alex Entry' };
    const body = rules.giftBody(g, { batchName: 'Other gifts Oct 14', enteredBy: 'Alex Entry', approvedBy: 'Blake Second' });
    assert.equal(body.type, 'Donation');
    assert.deepEqual(body.soft_credits, [{ constituent_id: '37975', amount: { value: 1000 } }]);
    assert.deepEqual(body.payments, [{ payment_method: 'Other' }]);
    assert.equal(body.date, '2026-10-13T00:00:00');
    assert.match(body.reference, /^\[Channel: DAF\] Other gifts Oct 14, entered by Alex Entry, approved by Blake Second/);
    assert.match(body.reference, /hub og_x$/);
    assert.ok(!('constituency' in body) && !('fundraisers' in body));
    assert.ok(body.reference.length <= 255);
  });
  it('a long memo is cut to fit 255 characters and FavorOS id stays', () => {
    const r = rules.referenceFor({ id: 'og_abc', kind: 'wire', fund_named: null, ref_text: 'W'.repeat(100), memo: 'm'.repeat(400) }, 'Other gifts Oct 14', 'A', 'B');
    assert.equal(r.length, 255);
    assert.match(r, /hub og_abc$/);
  });
});

describe('entry and the second person', () => {
  it('each person enters into their own open batch, and a gift gets a duplicate flag', async () => {
    const g1 = await acts.createGift(env, q, A, TODAY, FULL());
    const g2 = await acts.createGift(env, q, A, TODAY, FULL({ amount_cents: 5000 }));
    assert.equal(g1.batch_id, g2.batch_id);
    const g3 = await acts.createGift(env, q, B, TODAY, FULL());
    assert.notEqual(g3.batch_id, g1.batch_id);
    assert.match(JSON.parse(g3.dup_json).message, /already in Other gifts/);
    assert.ok(rules.blockers(g3).includes('Decide about the possible duplicate.'));
    const kept = await acts.editGift(env, q, B, TODAY, g3.id, { dupDecision: 'keep' });
    assert.deepEqual(rules.blockers(kept), []);
  });

  it('a batch with a gift that is not ready cannot be sent for approval', async () => {
    const g = await acts.createGift(env, q, A, TODAY, FULL({ appeal_id: null }));
    await assert.rejects(() => acts.submitBatch(env, A, g.batch_id), /needs a fix/);
  });

  it('the person who entered a gift cannot approve the batch, and a person who only entered one gift cannot either', async () => {
    const g = await enterAndSend();
    await assert.rejects(() => acts.approve(ctx, A, g.batch_id), /second person/);
    assert.equal(s.calls.length, 0);
    // Blake adds a gift to a batch of his own, so he is not in Alex's batch and may approve it.
    const out = await acts.approve(ctx, B, g.batch_id);
    assert.equal(out.started, true);
    assert.equal(s.calls.filter((c) => c.method === 'POST' && c.path === '/gift/v1/gifts').length, 1);
  });

  it('an approver who also entered a gift in the batch is refused', async () => {
    const g = await enterAndSend();
    // a gift entered by Blake inside Alex's batch
    await env.DB.prepare("UPDATE og_batch SET status = 'open' WHERE id = ?").bind(g.batch_id).run();
    await store.addGift(env, await store.getBatch(env, g.batch_id), { name: B.name, email: B.email }, { ...rules.cleanEdit(FULL({ amount_cents: 7000 }), TODAY), kind: 'daf' });
    await env.DB.prepare("UPDATE og_batch SET status = 'waiting' WHERE id = ?").bind(g.batch_id).run();
    await assert.rejects(() => acts.approve(ctx, B, g.batch_id), /second person/);
  });

  it('approving needs the approve switch for staff who are not admins', async () => {
    const g = await enterAndSend();
    await assert.rejects(() => acts.approve(ctx, C, g.batch_id), /not switched on/);
  });

  it('a batch that is still open cannot be approved, and two presses at once approve once', async () => {
    const g = await acts.createGift(env, q, A, TODAY, FULL());
    await assert.rejects(() => acts.approve(ctx, B, g.batch_id), /not sent this batch/);
    await acts.submitBatch(env, A, g.batch_id);
    const [r1, r2] = await Promise.allSettled([acts.approve(ctx, B, g.batch_id), acts.approve(ctx, { ...B, email: 'dana.third@favorintl.org', name: 'Dana Third' }, g.batch_id)]);
    assert.equal([r1, r2].filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(s.calls.filter((c) => c.method === 'POST' && c.path === '/gift/v1/gifts').length, 1);
  });

  it('the enterer can take a waiting batch back and change a gift, but not once it is approved', async () => {
    const g = await enterAndSend();
    await assert.rejects(() => acts.editGift(env, q, A, TODAY, g.id, { amount_cents: 200000 }), /waiting for approval/);
    await acts.withdrawBatch(env, A, g.batch_id);
    const e = await acts.editGift(env, q, A, TODAY, g.id, { amount_cents: 200000 });
    assert.equal(e.amount_cents, 200000);
    await acts.submitBatch(env, A, g.batch_id);
    await acts.approve(ctx, B, g.batch_id);
    await assert.rejects(() => acts.editGift(env, q, A, TODAY, g.id, { amount_cents: 1 }), /approved|in Blackbaud/);
  });
});

describe('posting to Blackbaud', () => {
  it('approving posts each gift once with its soft credit and settles the batch', async () => {
    const g1 = await acts.createGift(env, q, A, TODAY, FULL());
    await acts.createGift(env, q, A, TODAY, FULL({ kind: 'wire', partner_id: '30001', partner_name: 'Wire Giver', amount_cents: 2500, no_soft: 1, soft_partner_id: null, soft_partner_name: null }));
    await acts.submitBatch(env, A, g1.batch_id);
    await acts.approve(ctx, B, g1.batch_id);
    const posts = s.calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0].body.soft_credits, [{ constituent_id: '37975', amount: { value: 1000 } }]);
    assert.ok(!('soft_credits' in posts[1].body));
    assert.match(posts[0].body.reference, /entered by Alex Entry, approved by Blake Second/);
    const batch = await store.getBatch(env, g1.batch_id);
    assert.equal(batch.status, 'posted');
    assert.equal(batch.approved_by, 'Blake Second');
    const gifts = await store.giftsOf(env, g1.batch_id);
    assert.deepEqual(gifts.map((g) => g.status), ['posted', 'posted']);
    assert.deepEqual(gifts.map((g) => g.bb_gift_id), ['70001', '70002']);
    // a second run sends nothing
    await post.runBatch(ctx, g1.batch_id);
    assert.equal(s.calls.filter((c) => c.method === 'POST').length, 2);
  });

  it('a lost answer is looked up by FavorOS id before anything is sent again', async () => {
    fresh(['lost']);
    const g = await enterAndSend();
    await acts.approve(ctx, B, g.batch_id);
    let row = await store.getGift(env, g.id);
    assert.equal(row.status, 'check');
    assert.equal(s.calls.filter((c) => c.method === 'POST').length, 1);
    // The gift did land. The next run finds it by its Reference and posts nothing.
    const sent = s.calls.find((c) => c.method === 'POST').body;
    s.fn = null;
    ctx.send = async (calls) => {
      s.calls.push(...calls);
      return { results: calls.map((c) => (c.method === 'GET' ? { ok: true, status: 200, body: { value: [{ id: '88001', reference: sent.reference }] } } : { ok: true, status: 200, body: { id: 'WRONG' } })) };
    };
    await env.DB.prepare('UPDATE og_gift SET next_try_at = NULL WHERE id = ?').bind(g.id).run();
    await post.runBatch(ctx, g.batch_id);
    row = await store.getGift(env, g.id);
    assert.equal(row.status, 'posted');
    assert.equal(row.bb_gift_id, '88001');
    assert.equal(s.calls.filter((c) => c.method === 'POST').length, 1);
    assert.equal((await store.getBatch(env, g.batch_id)).status, 'posted');
  });

  it('a 400 stops that gift, keeps the others posted, and Try again after a fix posts it', async () => {
    fresh([undefined, { ok: false, status: 400, body: [{ message: 'The soft credit constituent is not valid.', error_name: 'x' }] }]);
    const g1 = await acts.createGift(env, q, A, TODAY, FULL({ amount_cents: 1000 }));
    const g2 = await acts.createGift(env, q, A, TODAY, FULL({ amount_cents: 2000 }));
    await acts.submitBatch(env, A, g1.batch_id);
    await acts.approve(ctx, B, g1.batch_id);
    const gifts = await store.giftsOf(env, g1.batch_id);
    assert.deepEqual(gifts.map((g) => g.status), ['posted', 'failed']);
    assert.match(gifts[1].error, /soft credit/);
    const batch = await store.getBatch(env, g1.batch_id);
    assert.equal(batch.status, 'needs_person');
    // The approver or the enterer fixes the gift and presses Try again.
    const fixed = await acts.editGift(env, q, B, TODAY, g2.id, { soft_partner_id: null, no_soft: true });
    assert.equal(fixed.status, 'failed');
    await acts.retry(ctx, B, g1.batch_id);
    assert.equal((await store.getBatch(env, g1.batch_id)).status, 'posted');
    // the retry looked the gift up first, then sent it
    assert.equal(s.calls.filter((c) => c.method === 'POST').length, 3);
  });

  it('a wait or a daily cap leaves the gift to retry on a backoff, not failed for good', async () => {
    fresh();
    ctx.send = async () => ({ results: [], capped: true, wait: "Blackbaud's daily limit is reached. It sends after the reset." });
    const g = await enterAndSend();
    await acts.approve(ctx, B, g.batch_id);
    const row = await store.getGift(env, g.id);
    assert.equal(row.status, 'failed');
    assert.ok(row.next_try_at);
    assert.equal((await store.getBatch(env, g.batch_id)).status, 'posting');
    // Not due yet: the morning drain skips it.
    const before = ctx.send;
    let called = 0;
    ctx.send = async (c) => {
      called++;
      return before(c);
    };
    await post.resumeBatches(ctx);
    assert.equal(called, 0);
  });

  it('a call the Blackbaud connection refuses is final and says so', async () => {
    fresh([{ ok: false, status: 0, body: { refused: 'test lock: gifts go to 27202 only' }, refused: 'test lock: gifts go to 27202 only' }]);
    const g = await enterAndSend();
    await acts.approve(ctx, B, g.batch_id);
    const row = await store.getGift(env, g.id);
    assert.equal(row.status, 'failed');
    assert.match(row.error, /held this call back/);
    assert.equal(row.next_try_at, null);
    assert.equal((await store.getBatch(env, g.batch_id)).status, 'needs_person');
  });

  it('a test account batch never reaches the real sender, and the stand-in posts it', async () => {
    const T1 = { name: 'FavorOS Tester', email: 'tester@favorintl.org', admin: true, canApprove: true };
    const T2 = { name: 'FavorOS Tester Two', email: 'tester2@favorintl.org', admin: true, canApprove: true };
    const g = await enterAndSend({}, T1);
    // The real sender is handed the tester batch: nothing is sent.
    await env.DB.prepare("UPDATE og_batch SET status = 'posting', approved_by = ?, approved_by_email = ?, approved_at = ? WHERE id = ?").bind(T2.name, T2.email, new Date().toISOString(), g.batch_id).run();
    await post.runBatch(ctx, g.batch_id);
    assert.equal(s.calls.length, 0);
    assert.equal((await post.resumeBatches(ctx)).length, 0);
    // The stand-in posts it.
    await env.DB.prepare("UPDATE og_batch SET status = 'waiting' WHERE id = ?").bind(g.batch_id).run();
    const sim = { env, send: post.simulatedSender(), simulated: true };
    await acts.approve(sim, T2, g.batch_id);
    const row = await store.getGift(env, g.id);
    assert.equal(row.status, 'posted');
    assert.match(row.bb_gift_id, /^TEST-/);
    assert.equal(s.calls.length, 0);
  });

  it('a test account cannot attach a gift to a real partner, entering or editing', async () => {
    const T1 = { name: 'FavorOS Tester', email: 'tester@favorintl.org', admin: true, canApprove: true };
    await assert.rejects(() => acts.createGift(env, q, T1, TODAY, FULL({ partner_id: '37822' })), /test partner/);
    await assert.rejects(() => acts.createGift(env, q, T1, TODAY, FULL({ soft_partner_id: '37822' })), /test partner/);
    const g = await acts.createGift(env, q, T1, TODAY, FULL());
    await assert.rejects(() => acts.editGift(env, q, T1, TODAY, g.id, { partner_id: '37822' }), /test partner/);
    // A real person is not held to it.
    await acts.createGift(env, q, A, TODAY, FULL({ partner_id: '37822' }));
  });

  it('a letter attaches to the saved gift after it posts, and one added later attaches at once', async () => {
    const bucket = { items: new Map(), put: async (k, v) => bucket.items.set(k, v), delete: async (k) => bucket.items.delete(k), get: async (k) => (bucket.items.has(k) ? { arrayBuffer: async () => bucket.items.get(k).buffer } : null) };
    const g = await acts.createGift(env, q, A, TODAY, FULL());
    await acts.saveLetter(ctx, bucket, A, g.id, { bytes: new Uint8Array([37, 80, 68, 70]), mime: 'application/pdf', name: 'NCF grant notice Oct 13.pdf' });
    assert.equal((await store.getGift(env, g.id)).letter_status, null);
    await acts.submitBatch(env, A, g.batch_id);
    await acts.approve(ctx, B, g.batch_id);
    const row = await store.getGift(env, g.id);
    assert.equal(row.letter_status, 'done');
    assert.equal(row.bb_attachment_id, 'att1');
    const att = s.calls.find((c) => c.path === '/gift/v1/gifts/attachments');
    assert.equal(att.body.parent_id, row.bb_gift_id);
    await assert.rejects(() => acts.saveLetter(ctx, bucket, A, g.id, { bytes: new Uint8Array([1]), mime: 'text/html', name: 'x.html' }), /PDF, a PNG or a JPG/);
  });
});

describe('who sees it', () => {
  const staff = { email: 'someone@favorintl.org', role: 'staff' };
  const admin = { email: 'an.admin@favorintl.org', role: 'admin' };
  const set = (v) => {
    if (typeof resetHubCache === 'function') resetHubCache();
    if (v) env.DB.db.prepare('INSERT OR REPLACE INTO hub_settings VALUES (?, ?, ?, ?)').run('gifts.other', v, 't', 'now');
  };
  it('is off for staff and admins until the setting is changed; Will and the testers always see it', async () => {
    set(null);
    assert.equal(await access.ogMode(env), 'off');
    assert.equal(await access.mayUseOther(env, staff), false);
    assert.equal(await access.mayUseOther(env, admin), false);
    assert.equal(await access.mayUseOther(env, { email: 'will@favorintl.org', role: 'admin' }), true);
    assert.equal(await access.mayUseOther(env, { email: 'tester@favorintl.org', role: 'admin' }), true);
    assert.equal(await access.mayUseOther(env, { email: 'tester2@favorintl.org', role: 'admin' }), true);
  });
  it('admins mode opens it to admins only; on opens it to admins and people given Gift entry', async () => {
    set('admins');
    assert.equal(await access.mayUseOther(env, admin), true);
    assert.equal(await access.mayUseOther(env, staff), false);
    set('on');
    assert.equal(await access.mayUseOther(env, staff), false);
    env.DB.db.prepare('INSERT INTO ge_person (email, access, posting, set_by, set_at) VALUES (?,?,?,?,?)').run(staff.email, 1, 0, 't', 'now');
    assert.equal(await access.mayUseOther(env, staff), true);
    assert.equal(await access.mayApprove(env, staff), false);
    env.DB.db.prepare('UPDATE ge_person SET posting = 1 WHERE email = ?').run(staff.email);
    assert.equal(await access.mayApprove(env, staff), true);
  });
  it('a setting other than off, admins or on is refused', async () => {
    await assert.rejects(() => access.setOgMode(env, 'Will', 'maybe'), /off, admins or on/);
  });
});

describe('the page views', () => {
  it('a batch view says why this person cannot approve, and who may', async () => {
    const g = await enterAndSend();
    const batch = await store.getBatch(env, g.batch_id);
    const mine = await view.batchView(env, batch, { email: A.email, admin: true, canApprove: true });
    assert.equal(mine.approve.allowed, false);
    assert.match(mine.approve.why, /second person/);
    const theirs = await view.batchView(env, batch, { email: B.email, admin: true, canApprove: true });
    assert.equal(theirs.approve.allowed, true);
    assert.equal(theirs.gifts[0].softPartnerName, 'Sample Recommender');
    assert.equal(theirs.batch.gifts, 1);
  });
});
