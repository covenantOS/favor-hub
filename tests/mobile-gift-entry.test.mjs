// Run with: npm test
//
// The Capture tab's routes (build item 4a): gift entry reached with a device token, the way the iPhone app calls it. Real middleware, real
// route files, a stand-in Blackbaud sender, stand-in readers and a fake photo bucket. Every response goes through callChecked, so a body
// that drifts from contract/mobile-v1.yaml fails the test. Nothing here approves a batch in Blackbaud: the scripted sender flips its own
// approved flag to prove the status step. Made-up names, ids and amounts only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callChecked, contractLog, signIn, spec, TODAY_ET, world } from './support/mobile-harness.mjs';

const mobileRoute = await import('../functions/_lib/mobile/route.ts');
const { giftHooks } = await import('../functions/_lib/gifts/route.ts');

const uuid = () => crypto.randomUUID();
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const jpeg = (n) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, n + 1, n + 2, 0xff, 0xd9]);
const fields = (o) => ({ docType: 'check', amountCents: null, wordsCents: null, checkDate: null, payer: null, checkNumber: null, memo: null, slipAppeal: null, ...o });
const reader = (name, f) => ({ reader: name, model: name, fields: f, secs: 1.2, error: null, card: false });

let nextRead = [];
let nextTriage = null;
let batchApproved = false;
let posted = 0;
let postedCents = 0;

function sender() {
  return async (calls) => ({
    results: calls.map((c) => {
      if (c.method === 'POST' && c.path === '/gift-batch/v1/giftbatches') return { ok: true, status: 200, body: { batch_id: '555' } };
      if (c.method === 'GET' && c.path.startsWith('/constituent/v1/constituents/')) return { ok: true, status: 200, body: {} };
      if (c.method === 'POST' && /\/gift\/v1\/giftbatches\/555\/gifts$/.test(c.path)) {
        posted += c.body.gifts.length;
        postedCents += c.body.gifts.reduce((s, g) => s + Math.round(g.amount.value * 100), 0);
        return { ok: true, status: 200, body: { gifts: c.body.gifts.map((_g, i) => ({ id: String(8800 + i), errors: [] })) } };
      }
      if (c.method === 'GET' && c.path.startsWith('/gift-batch/v1/giftbatches')) {
        return { ok: true, status: 200, body: { giftbatches: [{ id: '555', batch_number: 'GFT-2026-1200', number_of_gifts: posted, actual_amount: postedCents / 100, approved: batchApproved }] } };
      }
      return { ok: true, status: 200, body: {} };
    }),
    callsToday: 12,
    cap: 400,
  });
}

async function ready() {
  const w = await world();
  giftHooks.repo = (env) => mobileRoute.hooks.repo(env);
  giftHooks.send = () => sender();
  giftHooks.read = async () => nextRead;
  giftHooks.triage = async () => nextTriage || { kind: 'other', p: 0.9, secs: 0.2, error: null };
  nextTriage = null;
  giftHooks.bucket = (env) => env.GIFT_CAPTURES;
  posted = 0;
  postedCents = 0;
  batchApproved = false;
  const token = await signIn(w, { email: 'will@favorintl.org', name: 'Will Hamilton' });
  return { w, token };
}

const A = '/api/mobile/gift-entry';

describe('who can reach the mail day', () => {
  it('refuses no token, and refuses a person who is not an admin', async () => {
    const { w } = await ready();
    const none = await callChecked(w, 'GET', A);
    assert.equal(none.status, 401);
    const staff = await signIn(w, { email: 'ada@favorintl.org', name: 'Ada Example' });
    const out = await callChecked(w, 'GET', A, { token: staff });
    assert.equal(out.status, 403);
    assert.equal(out.body.error, 'admin_only');
    const post = await callChecked(w, 'POST', A, { token: staff, body: { kind: 'regular', date: TODAY_ET(), tapeTotal: 10, tapeCount: 1 } });
    assert.equal(post.status, 403);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ge_deposit').get().n, 0);
  });
});

describe('the whole mail day from the phone', () => {
  it('deposit, photos, readers, match, review against the tape, duplicate guard, send, status', async () => {
    const { w, token } = await ready();
    const today = TODAY_ET();

    // 1. Deposit with the tape total and count
    const bad = await callChecked(w, 'POST', A, { token, body: { kind: 'regular', date: addDays(today, 3), tapeTotal: 10, tapeCount: 1 } });
    assert.equal(bad.status, 400);
    const made = await callChecked(w, 'POST', A, { token, body: { kind: 'regular', date: today, tapeTotal: 295.5, tapeCount: 3 } });
    assert.equal(made.status, 200);
    const dep = made.body.deposit;
    assert.equal(dep.status, 'open');
    assert.equal(dep.tape_cents, 29550);
    assert.equal(dep.tape_count, 3);
    const list = await callChecked(w, 'GET', A, { token });
    assert.equal(list.body.deposits.length, 1);
    assert.equal(list.body.lane.cap, 400);

    // 2 and 3. A check photo: both readers agree, the payer matches one partner
    const checkDate = addDays(today, -3);
    const same = fields({ amountCents: 12000, wordsCents: 12000, checkDate, payer: 'Ada Example', checkNumber: '4410', memo: null });
    nextRead = [reader('scout', same), reader('gemma', same)];
    const c1 = uuid();
    const up1 = await callChecked(w, 'POST', `${A}/deposits/${dep.id}/photos?client_id=${c1}&kind=check_front`, { token, raw: jpeg(1), headers: { 'Content-Type': 'image/jpeg' } });
    assert.equal(up1.status, 200);
    assert.equal(up1.body.status, 'review');
    const row1 = up1.body.giftId;

    // the same client_id again returns the stored answer and files no second row
    const again = await callChecked(w, 'POST', `${A}/deposits/${dep.id}/photos?client_id=${c1}&kind=check_front`, { token, raw: jpeg(1), headers: { 'Content-Type': 'image/jpeg' } });
    assert.equal(again.body.repeat, true);
    assert.equal(again.body.giftId, row1);
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM ge_gift WHERE deposit_id = ? AND status <> 'removed'").get(dep.id).n, 1);

    // a second check: the readers disagree on the amount, and no partner is found
    nextRead = [
      reader('scout', fields({ amountCents: 15050, wordsCents: 15050, checkDate, payer: 'B. Sample', checkNumber: '9021' })),
      reader('gemma', fields({ amountCents: 15000, wordsCents: 15050, checkDate, payer: 'B. Sample', checkNumber: '9021' })),
    ];
    const up2 = await callChecked(w, 'POST', `${A}/deposits/${dep.id}/photos?client_id=${uuid()}&kind=check_front`, { token, raw: jpeg(20), headers: { 'Content-Type': 'image/jpeg' } });
    const row2 = up2.body.giftId;

    // a reply slip for the first row
    nextRead = [reader('scout', fields({ docType: 'reply_slip', slipAppeal: 'L2610' })), reader('gemma', fields({ docType: 'reply_slip', slipAppeal: 'L2610' }))];
    const slip = await callChecked(w, 'POST', `${A}/deposits/${dep.id}/photos?client_id=${uuid()}&kind=slip&gift=${row1}`, { token, raw: jpeg(40), headers: { 'Content-Type': 'image/jpeg' } });
    assert.equal(slip.body.giftId, row1);

    let view = (await callChecked(w, 'GET', `${A}/deposits/${dep.id}`, { token })).body;
    const r1 = view.rows.find((r) => r.id === row1);
    const r2 = view.rows.find((r) => r.id === row2);
    assert.equal(r1.partner.name, 'Ada Example');
    assert.deepEqual(r1.flags, []);
    assert.equal(r1.images.length, 2);
    assert.deepEqual(r2.flags.includes('amount'), true);
    assert.match(r2.why.amount, /readers disagree/);
    assert.equal(r2.partner, null);
    assert.ok(r2.blockers.includes('Pick the partner.'));

    // 4. Choose the partner by hand
    const hits = await callChecked(w, 'GET', `${A}/partners?q=ben`, { token });
    assert.equal(hits.body.hits[0].name, 'Ben Sample');
    const cat = await callChecked(w, 'GET', `${A}/catalog`, { token });
    assert.ok(cat.body.funds.some((f) => f.id === '79'));
    assert.ok(cat.body.appeals.some((a) => a.id === '2192'));
    await callChecked(w, 'PATCH', `${A}/gifts/${row2}`, { token, body: { set: { partner_id: '9002', partner_name: 'Ben Sample', amount_cents: 15050, appeal_id: '2192', appeal_name: 'October Letter' } } });
    await callChecked(w, 'PATCH', `${A}/gifts/${row1}`, { token, body: { set: { appeal_id: '2192', appeal_name: 'October Letter' } } });

    // 5. The tape: two rows and 270.50 against a tape of 3 and 295.50, and the send is refused
    view = (await callChecked(w, 'GET', `${A}/deposits/${dep.id}`, { token })).body;
    assert.equal(view.tape.count, 2);
    assert.equal(view.tape.cents, 27050);
    assert.equal(view.tape.diffCents, -2500);
    assert.equal(view.tape.matches, false);
    assert.equal(view.canSend.ok, false);
    const refused = await callChecked(w, 'POST', `${A}/deposits/${dep.id}/send`, { token });
    assert.equal(refused.status, 409);

    // cash row
    const cash = await callChecked(w, 'POST', `${A}/deposits/${dep.id}/cash`, { token, body: { amountCents: 2500 } });
    const cashRow = cash.body.giftId;
    const badCash = await callChecked(w, 'POST', `${A}/deposits/${dep.id}/cash`, { token, body: { amountCents: 0 } });
    assert.equal(badCash.status, 400);
    await callChecked(w, 'PATCH', `${A}/gifts/${cashRow}`, { token, body: { set: { partner_id: '9001', partner_name: 'Ada Example', appeal_id: '2192', appeal_name: 'October Letter' } } });

    // 6. Duplicate guard: the same check number from the same partner for the same amount
    nextRead = [reader('scout', same), reader('gemma', same)];
    const dupUp = await callChecked(w, 'POST', `${A}/deposits/${dep.id}/photos?client_id=${uuid()}&kind=check_front`, { token, raw: jpeg(60), headers: { 'Content-Type': 'image/jpeg' } });
    view = (await callChecked(w, 'GET', `${A}/deposits/${dep.id}`, { token })).body;
    const dupRow = view.rows.find((r) => r.id === dupUp.body.giftId);
    assert.equal(dupRow.dup.kind, 'hub');
    assert.match(dupRow.dup.message, /Same check already entered/);
    assert.ok(dupRow.blockers.includes('Decide about the possible duplicate.'));
    const removed = await callChecked(w, 'PATCH', `${A}/gifts/${dupRow.id}`, { token, body: { action: 'dup_remove' } });
    assert.equal(removed.body.view.rows.some((r) => r.id === dupRow.id), false);
    const badAction = await callChecked(w, 'PATCH', `${A}/gifts/${row1}`, { token, body: { action: 'approve_batch' } });
    assert.equal(badAction.status, 400);

    // the glance on every row
    for (const id of [row1, row2, cashRow]) {
      const ok = await callChecked(w, 'PATCH', `${A}/gifts/${id}`, { token, body: { action: 'confirm' } });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
    }
    view = (await callChecked(w, 'GET', `${A}/deposits/${dep.id}`, { token })).body;
    assert.equal(view.tape.matches, true);
    assert.equal(view.canSend.ok, true);

    // a stored photo reads back to the signed-in admin, never cached
    const img = await callChecked(w, 'GET', `${A}/images/${r1.images[0].id}`, { token });
    assert.equal(img.status, 200);
    assert.equal(img.res.headers.get('Cache-Control'), 'private, no-store');
    assert.equal((await callChecked(w, 'GET', `${A}/images/nope`, { token })).status, 404);

    // 7. Send as an unapproved batch
    const sent = await callChecked(w, 'POST', `${A}/deposits/${dep.id}/send`, { token });
    assert.equal(sent.status, 200);
    assert.equal(posted, 3);
    assert.equal(postedCents, 29550);
    const locked = await callChecked(w, 'PATCH', `${A}/gifts/${row1}`, { token, body: { set: { amount_cents: 1 } } });
    assert.equal(locked.status, 409);
    assert.equal((await callChecked(w, 'DELETE', `${A}/gifts/${row1}`, { token })).status, 409);
    assert.equal((await callChecked(w, 'DELETE', `${A}/deposits/${dep.id}`, { token })).status, 409);
    assert.equal((await callChecked(w, 'POST', `${A}/deposits/${dep.id}/send`, { token })).status, 409);

    // 8. Status: waiting for approval, then approved
    let run = (await callChecked(w, 'POST', `${A}/deposits/${dep.id}/run?force=1`, { token })).body;
    assert.equal(run.deposit.status, 'created');
    assert.equal(run.watch.approved, false);
    batchApproved = true;
    run = (await callChecked(w, 'POST', `${A}/deposits/${dep.id}/run?force=1`, { token })).body;
    assert.equal(run.deposit.status, 'committed');
    assert.equal(run.deposit.batchNumber, 'GFT-2026-1200');
    const retry = await callChecked(w, 'POST', `${A}/deposits/${dep.id}/retry`, { token });
    assert.equal(retry.status, 200);
    assert.equal((await callChecked(w, 'POST', `${A}/deposits/none/run`, { token })).status, 404);

    // The hub never approved anything: the only Blackbaud writes were the batch and its gifts.
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM ge_event WHERE kind LIKE '%approve%' AND kind <> 'committed_in_blackbaud'").get().n, 0);
  });

  it('removes a deposit that was never sent, and refuses an unsupported photo', async () => {
    const { w, token } = await ready();
    const made = await callChecked(w, 'POST', A, { token, body: { kind: 'grant', date: TODAY_ET(), tapeTotal: 50, tapeCount: 1 } });
    const id = made.body.deposit.id;
    const png = await callChecked(w, 'POST', `${A}/deposits/${id}/photos?client_id=${uuid()}`, { token, raw: new Uint8Array([1, 2, 3]), headers: { 'Content-Type': 'text/plain' } });
    assert.equal(png.status, 415);
    const noId = await callChecked(w, 'POST', `${A}/deposits/${id}/photos?client_id=nope`, { token, raw: jpeg(3), headers: { 'Content-Type': 'image/jpeg' } });
    assert.equal(noId.status, 400);
    const big = await callChecked(w, 'POST', `${A}/deposits/${id}/photos?client_id=${uuid()}`, { token, raw: new Uint8Array(6 * 1024 * 1024 + 1), headers: { 'Content-Type': 'image/jpeg' } });
    assert.equal(big.status, 413);
    // a failed upload frees its client_id so the queue can try again
    const cid = uuid();
    await callChecked(w, 'POST', `${A}/deposits/${id}/photos?client_id=${cid}`, { token, raw: new Uint8Array(6 * 1024 * 1024 + 1), headers: { 'Content-Type': 'image/jpeg' } });
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM mobile_writes WHERE client_id = ?').get(cid).n, 0);
    const cashRow = (await callChecked(w, 'POST', `${A}/deposits/${id}/cash`, { token, body: { amountCents: 5000 } })).body.giftId;
    const off = await callChecked(w, 'DELETE', `${A}/gifts/${cashRow}`, { token });
    assert.equal(off.status, 200);
    assert.equal(off.body.view.rows.length, 0);
    const gone = await callChecked(w, 'DELETE', `${A}/deposits/${id}`, { token });
    assert.equal(gone.status, 200);
    assert.equal((await callChecked(w, 'GET', `${A}/deposits/${id}`, { token })).status, 404);
  });
});

describe('the contract', () => {
  it('every response seen in this file matched its schema', () => {
    assert.ok(contractLog.length > 40, 'only ' + contractLog.length + ' responses were checked');
    assert.deepEqual(contractLog.filter((l) => l.problems.length), []);
  });

  it('every gift-entry operation in mobile-v1.yaml was exercised, and every documented success was seen', () => {
    const seen = new Map();
    for (const l of contractLog) {
      const key = `${l.method} ${l.pattern.replace(/:([a-z]+)/g, '{$1}')}`;
      seen.set(key, new Set([...(seen.get(key) || []), l.status]));
    }
    const missing = [];
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        if (!(op.tags || []).includes('gift-entry')) continue;
        const key = `${method.toUpperCase()} ${path}`;
        const statuses = seen.get(key);
        if (!statuses) {
          missing.push(key + ' (never called)');
          continue;
        }
        for (const s of Object.keys(op.responses).filter((x) => x.startsWith('2'))) if (!statuses.has(Number(s))) missing.push(`${key} never answered ${s}`);
      }
    }
    assert.deepEqual(missing, []);
  });
});

describe('a flagged reader field clears when someone resolves it', () => {
  it('Looks right clears the flag and records the email; editing the flagged field clears it too', async () => {
    const { w, token } = await ready();
    const today = TODAY_ET();
    const dep = (await callChecked(w, 'POST', A, { token, body: { kind: 'regular', date: today, tapeTotal: 295.5, tapeCount: 3 } })).body.deposit;
    const checkDate = addDays(today, -3);
    const same = fields({ amountCents: 12000, wordsCents: 12000, checkDate, payer: 'Ada Example', checkNumber: '4410' });
    nextRead = [reader('scout', same), reader('gemma', same)];
    await callChecked(w, 'POST', `${A}/deposits/${dep.id}/photos?client_id=${uuid()}&kind=check_front`, { token, raw: jpeg(1), headers: { 'Content-Type': 'image/jpeg' } });
    const disagree = (checkNumber) => [
      reader('scout', fields({ amountCents: 15050, wordsCents: 15050, checkDate, payer: 'B. Sample', checkNumber })),
      reader('gemma', fields({ amountCents: 15000, wordsCents: 15050, checkDate, payer: 'B. Sample', checkNumber })),
    ];
    const photo = async (checkNumber, n) => {
      nextRead = disagree(checkNumber);
      return (await callChecked(w, 'POST', `${A}/deposits/${dep.id}/photos?client_id=${uuid()}&kind=check_front`, { token, raw: jpeg(n), headers: { 'Content-Type': 'image/jpeg' } })).body.giftId;
    };
    const deposit = async () => (await callChecked(w, 'GET', `${A}/deposits/${dep.id}`, { token })).body;
    const rowOf = async (id) => (await deposit()).rows.find((r) => r.id === id);
    const patch = (id, body) => callChecked(w, 'PATCH', `${A}/gifts/${id}`, { token, body });
    const pick = { partner_id: '9002', partner_name: 'Ben Sample', appeal_id: '2192', appeal_name: 'October Letter' };

    // Choosing the partner and the appeal leaves the flag in place, and the send stays off.
    const row2 = await photo('9021', 20);
    assert.deepEqual((await rowOf(row2)).flags, ['amount']);
    await patch(row2, { set: pick });
    assert.deepEqual((await rowOf(row2)).flags, ['amount']);
    assert.equal((await rowOf(row2)).confirmed, false);
    assert.equal((await deposit()).canSend.ok, false);

    // Looks right clears the flag and records the email of the person who confirmed.
    assert.equal((await patch(row2, { action: 'confirm' })).status, 200);
    const confirmed = await rowOf(row2);
    assert.deepEqual(confirmed.flags, []);
    assert.equal(confirmed.confirmed, true);
    assert.equal(confirmed.confirmedBy, 'will@favorintl.org');

    // Editing the flagged amount clears the flag and confirms the row, because nothing else is missing.
    const row3 = await photo('9022', 30);
    await patch(row3, { set: pick });
    assert.equal((await patch(row3, { set: { amount_cents: 15000 } })).status, 200);
    const edited = await rowOf(row3);
    assert.deepEqual(edited.flags, []);
    assert.equal(edited.confirmed, true);
    assert.equal(edited.confirmedBy, 'will@favorintl.org');

    // With no partner chosen, the same edit clears the flag and the row still waits for a look.
    const row4 = await photo('9023', 40);
    await patch(row4, { set: { amount_cents: 15000 } });
    const waiting = await rowOf(row4);
    assert.deepEqual(waiting.flags, []);
    assert.equal(waiting.confirmed, false);
    assert.ok(waiting.blockers.includes('Pick the partner.'));
  });
});

describe('Clef sorts each photo before the readers run', () => {
  it('skips an envelope, asks for a retake on an unreadable photo, and reads a check', async () => {
    const { w, token } = await ready();
    const dep = (await callChecked(w, 'POST', A, { token, body: { kind: 'regular', date: TODAY_ET(), tapeTotal: 50, tapeCount: 1 } })).body.deposit;
    const up = (n) => callChecked(w, 'POST', `${A}/deposits/${dep.id}/photos?client_id=${uuid()}&kind=check_front`, { token, raw: jpeg(n), headers: { 'Content-Type': 'image/jpeg' } });
    const rowCount = () => w.db.prepare('SELECT COUNT(*) AS n FROM ge_gift WHERE deposit_id = ?').get(dep.id).n;
    const imageCount = () => w.db.prepare('SELECT COUNT(*) AS n FROM ge_image WHERE deposit_id = ?').get(dep.id).n;

    // an envelope: skipped, no row, no image kept, no reader run
    nextTriage = { kind: 'envelope', p: 0.93, secs: 0.3, error: null };
    nextRead = [];
    const env = await up(80);
    assert.equal(env.status, 200);
    assert.equal(env.body.status, 'skipped');
    assert.equal(env.body.photoKind, 'envelope');
    assert.equal(env.body.giftId, null);
    assert.equal(rowCount(), 0);
    assert.equal(imageCount(), 0);

    // an unreadable photo: retake, nothing filed
    nextTriage = { kind: 'unreadable', p: 0.8, secs: 0.3, error: null };
    const blur = await up(81);
    assert.equal(blur.body.status, 'retake');
    assert.equal(blur.body.photoKind, 'unreadable');
    assert.equal(blur.body.giftId, null);
    assert.equal(rowCount(), 0);

    // a check: triage says check, the readers run, and the row carries the photo kind
    const same = fields({ amountCents: 4500, wordsCents: 4500, checkDate: addDays(TODAY_ET(), -2), payer: 'Ada Example', checkNumber: '5150', memo: null });
    nextTriage = { kind: 'check', p: 0.97, secs: 0.3, error: null };
    nextRead = [reader('scout', same), reader('gemma', same)];
    const check = await up(82);
    assert.equal(check.status, 200);
    assert.equal(check.body.status, 'review');
    assert.equal(check.body.photoKind, 'check');
    assert.ok(check.body.giftId);
    assert.equal(rowCount(), 1);
    const row = w.db.prepare('SELECT fields_json FROM ge_gift WHERE id = ?').get(check.body.giftId);
    assert.equal(JSON.parse(row.fields_json).photo, 'check');
  });

  it('reads an envelope or unreadable call below 0.5 as other, and a failed call reads as other', async () => {
    const { triageWith } = await import('../functions/_lib/gifts/triage.ts');
    const answer = (choice, p) => async () => ({ answers: { kind: { choice, probabilities: { [choice]: p } } } });
    assert.equal((await triageWith(answer('envelope', 0.3), 'data:x')).kind, 'other');
    assert.equal((await triageWith(answer('unreadable', 0.49), 'data:x')).kind, 'other');
    assert.equal((await triageWith(answer('envelope', 0.5), 'data:x')).kind, 'envelope');
    assert.equal((await triageWith(answer('reply_slip', 0.9), 'data:x')).kind, 'reply_slip');
    assert.equal((await triageWith(answer('other_document', 0.9), 'data:x')).kind, 'other');
    const failed = await triageWith(async () => { throw new Error('model down'); }, 'data:x');
    assert.equal(failed.kind, 'other');
    assert.match(failed.error, /model down/);
    assert.equal((await triageWith(async () => ({ result: { answers: { kind: { choice: 'check', probabilities: { check: 0.8 } } } } }), 'data:x')).kind, 'check');
  });
});
