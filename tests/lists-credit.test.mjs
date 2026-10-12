// Credit and assignments: the rules, the scan, proposals, the approval flow, the audit trail, and the apply step staying OFF.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { assignmentCall, afterApproval, holdersOn, mayApprove, oddCredits, proposeForGift } from '../functions/_lib/lists/credit.ts';
import { actorOf, cancel, decide, history, listChanges, propose, putSetting, queueDone, queued, scan, setting, SETTING_APPLY } from '../functions/_lib/lists/credit-service.ts';
import { d1Of, makeHub, makeMirror, qOf } from './support/lists-fixture.mjs';

const TODAY = '2026-10-12';
const RDD = 'Regional Development Director (RDD)';
const A = (o) => ({ id: 'x', cid: '1', fid: '5001', type: RDD, from: '2020-01-01', to: '', ...o });
const G = (o) => ({ id: '9', date: '2026-10-05', amount: 100, partners: ['1'], category: 'White Mail', code: 'W200', credits: [], ...o });

describe('the rules', () => {
  it('a gift with no credit in an eligible category gets the holder on its date', () => {
    const p = proposeForGift(G({}), [A({})], TODAY);
    assert.deepEqual(p.map((x) => [x.op, x.fundraiserId, x.amount, x.closedMonth]), [['add', '5001', 100, false]]);
  });

  it('credit stays with the holder at the gift date: a director who left is the one credited for gifts in his time', () => {
    const left = A({ fid: '6000', to: '2026-09-08' });
    const now = A({ id: 'y', fid: '5001', from: '2026-09-09' });
    const p = proposeForGift(G({ date: '2026-08-20' }), [left, now], TODAY);
    assert.deepEqual(p.map((x) => x.fundraiserId), ['6000']);
    assert.equal(p[0].closedMonth, true);
  });

  it('never proposes removing a former holder who held the partner on the gift date', () => {
    const left = A({ fid: '6000', to: '2026-09-08' });
    const g = G({ date: '2026-08-20', credits: [{ fid: '6000', amount: 100 }] });
    assert.deepEqual(proposeForGift(g, [left], TODAY), []);
    assert.deepEqual(oddCredits(g, [left]), []);
  });

  it('marketing appeals carry no credit, so any credit on one is proposed for removal', () => {
    const g = G({ category: 'Direct Mail Appeal', credits: [{ fid: '5001', amount: 100 }] });
    const p = proposeForGift(g, [A({})], TODAY);
    assert.deepEqual(p.map((x) => [x.op, x.rule]), [['remove', 'marketing']]);
    assert.deepEqual(proposeForGift(G({ category: 'Digital Newsletter' }), [A({})], TODAY), []);
  });

  it('other categories, zero gifts and existing credit propose nothing', () => {
    assert.deepEqual(proposeForGift(G({ category: 'Acquisition' }), [A({})], TODAY), []);
    assert.deepEqual(proposeForGift(G({ amount: 0 }), [A({})], TODAY), []);
    assert.deepEqual(proposeForGift(G({ credits: [{ fid: '5001', amount: 100 }] }), [A({})], TODAY), []);
  });

  it('a gift that already has credit is not given a second or a former holder', () => {
    const g = G({ credits: [{ fid: '5001', amount: 100 }] });
    assert.deepEqual(proposeForGift(g, [A({}), A({ id: 'z', fid: '5002', type: 'Partner Care' })], TODAY), []);
  });

  it('a soft-credited gift follows the soft-credited partner', () => {
    const g = G({ partners: ['2'] });
    assert.deepEqual(proposeForGift(g, [A({ cid: '1' })], TODAY), []);
    assert.equal(proposeForGift(g, [A({ cid: '2', fid: '5002' })], TODAY)[0].fundraiserId, '5002');
  });

  it('an assignment that ended before or began after the gift date does not count', () => {
    assert.equal(holdersOn([A({ to: '2026-10-01' })], ['1'], '2026-10-05').length, 0);
    assert.equal(holdersOn([A({ from: '2026-10-06' })], ['1'], '2026-10-05').length, 0);
    assert.equal(holdersOn([A({ type: 'Foundation Steward' })], ['1'], '2026-10-05').length, 0);
  });

  it('flags a credit on someone who never held the partner, without proposing a change', () => {
    const g = G({ credits: [{ fid: '7777', amount: 100 }] });
    assert.equal(oddCredits(g, [A({})]).length, 1);
    assert.ok(!proposeForGift(g, [A({})], TODAY).some((p) => p.fundraiserId === '7777'));
  });
});

describe('who may approve', () => {
  it('admins, the Operations team and named people', () => {
    assert.equal(mayApprove({ email: 'a', admin: true, team: '', named: [] }), true);
    assert.equal(mayApprove({ email: 'm', admin: false, team: 'admin', named: [] }), true);
    assert.equal(mayApprove({ email: 'n@x', admin: false, team: 'rdd', named: ['n@x'] }), true);
    assert.equal(mayApprove({ email: 'r', admin: false, team: 'rdd', named: [] }), false);
    assert.equal(mayApprove({ email: 's', admin: false, team: 'support', named: [] }), false);
  });
  it('apply off keeps every approval waiting', () => {
    assert.equal(afterApproval(false, 'credit'), 'approved');
    assert.equal(afterApproval(false, 'assignment'), 'approved');
    assert.equal(afterApproval(true, 'credit'), 'queued');
  });
});

let env;
let hub;
let mirror;
const ADMIN = { email: 'boss@favorintl.org', admin: true, team: '', named: [] };
const ADMIN2 = { email: 'boss2@favorintl.org', admin: true, team: '', named: [] };
const RDDGUY = { email: 'rita@favorintl.org', admin: false, team: 'rdd', named: [] };
const noOps = async () => {
  throw new Error('the upkeep route must not be called');
};

before(() => {
  hub = makeHub();
  hub.exec(`CREATE TABLE act_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);`);
  hub.exec(`INSERT INTO lr_fr (id, name) VALUES ('5001', 'Rita Director'), ('5002', 'Pam Care')`);
  env = { DB: d1Of(hub) };
  const m = makeMirror();
  // A gift with no credit on a white mail appeal, and a direct mail gift carrying credit.
  m.exec(`INSERT INTO appeals (id, appeal_id, appeal_description, appeal_category, appeal_start_date) VALUES ('9', 'W300', 'x', 'White Mail', '2026-01-01')`);
  m.exec(`INSERT INTO gifts (id, constituent_record_id, gift_date, gift_amount, gift_type, gift_splits) VALUES ('900', '101', '2026-10-05T00:00:00', 80, 'Donation', '[{"appeal_id":"9","fund_id":"79"}]')`);
  m.exec(`INSERT INTO gifts (id, constituent_record_id, gift_date, gift_amount, gift_type, gift_splits, fundraiser_credits) VALUES ('901', '101', '2026-10-06T00:00:00', 60, 'Donation', '[{"appeal_id":"2","fund_id":"79"}]', '[{"amount":{"value":60},"constituent_id":"5002"}]')`);
  m.exec("INSERT INTO assignments (id, constituent_record_id, assignment_fundraiser_id, assignment_type, assignment_from_date) VALUES ('4401', '101', '5001', 'Regional Development Director (RDD)', '2020-01-01')");
  mirror = qOf(m);
});

describe('scan, propose, approve', () => {
  it('stores one proposal per difference and does not repeat an open one', async () => {
    const r = await scan(env, mirror, '2026-10-01', TODAY, TODAY);
    assert.equal(r.added, 2);
    const again = await scan(env, mirror, '2026-10-01', TODAY, TODAY);
    assert.equal(again.added, 0);
    const w = await listChanges(env, ['proposed']);
    assert.deepEqual(w.map((x) => x.change.op).sort(), ['add', 'remove']);
    assert.ok(w.every((x) => x.proposedBy === 'scan'));
  });

  it('a person proposes a change and gives a reason', async () => {
    await assert.rejects(() => propose(env, mirror, { email: 'rita@favorintl.org' }, { kind: 'credit', giftId: '900', fundraiserId: '5002', op: 'add', reason: '' }, TODAY), /Say why/);
    const id = await propose(env, mirror, { email: 'rita@favorintl.org' }, { kind: 'credit', giftId: '900', fundraiserId: '5002', op: 'add', reason: 'Pam took the call' }, TODAY);
    assert.match(id, /^crd_/);
    await assert.rejects(() => propose(env, mirror, { email: 'rita@favorintl.org' }, { kind: 'credit', giftId: '901', fundraiserId: '5002', op: 'add', reason: 'x' }, TODAY), /already has credit/);
    await assert.rejects(() => propose(env, mirror, { email: 'rita@favorintl.org' }, { kind: 'assignment', op: 'add', recordId: '101', fundraiserId: '5001', type: 'Bogus', reason: 'x' }, TODAY), /role/);
  });

  it('only an approver decides, and never on their own proposal', async () => {
    const [one] = await listChanges(env, ['proposed']);
    await assert.rejects(() => decide(env, RDDGUY, one.id, 'approve', '', TODAY, noOps), /Only an admin/);
    const mine = await propose(env, mirror, { email: ADMIN.email }, { kind: 'credit', giftId: '900', fundraiserId: '5001', op: 'add', reason: 'holder' }, TODAY);
    await assert.rejects(() => decide(env, ADMIN, mine, 'approve', '', TODAY, noOps), /second person/);
    const ok = await decide(env, ADMIN2, mine, 'approve', 'checked', TODAY, noOps);
    assert.equal(ok.state, 'approved');
  });

  it('with apply OFF an approval changes nothing outside FavorOS and says it is held', async () => {
    assert.equal(await setting(env, SETTING_APPLY, 'off'), 'off');
    const id = await propose(env, mirror, { email: 'rita@favorintl.org' }, { kind: 'assignment', op: 'end', recordId: '101', fundraiserId: '5001', assignmentId: '4401', reason: 'She moved' }, TODAY);
    const r = await decide(env, ADMIN, id, 'approve', '', TODAY, noOps);
    assert.equal(r.state, 'approved');
    const log = await history(env, id);
    assert.deepEqual(log.map((l) => l.event), ['proposed', 'approved', 'held']);
    assert.equal((await queued(env)).length, 0);
  });

  it('a rejection and a cancel are recorded', async () => {
    const id = await propose(env, mirror, { email: 'rita@favorintl.org' }, { kind: 'credit', giftId: '900', fundraiserId: '5002', op: 'add', reason: 'again' }, TODAY).catch(() => null);
    const [w] = (await listChanges(env, ['proposed'])).filter((x) => x.proposedBy === 'scan');
    const r = await decide(env, ADMIN, w.id, 'reject', 'wrong partner', TODAY, noOps);
    assert.equal(r.state, 'rejected');
    await assert.rejects(() => decide(env, ADMIN2, w.id, 'approve', '', TODAY, noOps), /already rejected/);
    const [x] = await listChanges(env, ['proposed']);
    await assert.rejects(() => cancel(env, { ...RDDGUY, email: 'someone@favorintl.org' }, x.id), /Only the person/);
    await cancel(env, ADMIN, x.id);
    assert.equal((await history(env, x.id)).at(-1).event, 'cancelled');
    assert.ok(id === null || typeof id === 'string');
  });
});

describe('apply ON, behind the test limit', () => {
  it('queues a credit change only for the test record and holds every other one', async () => {
    await putSetting(env, SETTING_APPLY, 'on');
    const real = await propose(env, mirror, { email: 'rita@favorintl.org' }, { kind: 'credit', giftId: '900', fundraiserId: '5001', op: 'add', reason: 'real partner' }, TODAY).catch(() => null);
    const ids = (await listChanges(env, ['proposed'])).map((x) => x.id);
    assert.ok(ids.length > 0);
    const r = await decide(env, ADMIN, ids[0], 'approve', '', TODAY, noOps);
    assert.equal(r.state, 'approved');
    assert.match(r.note, /limited to record 27202/);
    assert.equal((await queued(env)).length, 0);
    assert.ok(real === null || real);
  });

  it('on the test record a credit change is queued for the runner, which reports back', async () => {
    const m = makeMirror();
    m.exec(`INSERT INTO appeals (id, appeal_id, appeal_description, appeal_category, appeal_start_date) VALUES ('9', 'W300', 'x', 'White Mail', '2026-01-01')`);
    m.exec(`INSERT INTO gifts (id, constituent_record_id, gift_date, gift_amount, gift_type, gift_splits) VALUES ('950', '27202', '2026-10-05T00:00:00', 1, 'Donation', '[{"appeal_id":"9","fund_id":"79"}]')`);
    const id = await propose(env, qOf(m), { email: 'rita@favorintl.org' }, { kind: 'credit', giftId: '950', fundraiserId: '5001', op: 'add', reason: 'test record' }, TODAY);
    const r = await decide(env, ADMIN, id, 'approve', '', TODAY, noOps);
    assert.equal(r.state, 'queued');
    const q = await queued(env);
    assert.equal(q.length, 1);
    assert.equal(q[0].record_id, '27202');
    await queueDone(env, id, true, 'Saved and read back');
    assert.equal((await history(env, id)).at(-1).event, 'applied');
    await assert.rejects(() => queueDone(env, id, true, ''), /not waiting/);
  });

  it('the test user never applies, even with apply on and the limit lifted', async () => {
    await putSetting(env, 'lists:credit_test_only', '');
    const id = await propose(env, mirror, { email: 'rita@favorintl.org' }, { kind: 'credit', giftId: '900', fundraiserId: '5002', op: 'add', reason: 'x' }, TODAY);
    const r = await decide(env, { ...ADMIN, email: 'tester@favorintl.org' }, id, 'approve', '', TODAY, noOps);
    assert.equal(r.state, 'approved');
    assert.match(r.note, /test user/);
  });
});

describe('the assignment call', () => {
  it('ends and adds through the upkeep route paths', () => {
    assert.deepEqual(assignmentCall({ op: 'end', assignmentId: '77', date: TODAY }), { method: 'PATCH', path: '/fundraising/v1/fundraisers/assignments/77', body: { end: '2026-10-12T00:00:00' } });
    const add = assignmentCall({ op: 'add', recordId: '5', fundraiserId: '6', type: RDD, date: TODAY });
    assert.equal(add.method, 'POST');
    assert.equal(add.body.constituent_id, '5');
  });
  it('actorOf reads the team and named approvers', async () => {
    hub.exec(`INSERT INTO act_staff (email, name, team, work_center) VALUES ('mike@favorintl.org', 'Mike Ops', 'admin', 1)`);
    assert.equal((await actorOf(env, 'mike@favorintl.org', false)).team, 'admin');
    assert.equal(mayApprove(await actorOf(env, 'mike@favorintl.org', false)), true);
  });
});
