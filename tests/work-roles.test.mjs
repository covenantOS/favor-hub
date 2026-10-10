// Run with: npm test
//
// Who sees what and who may change what in the Work Center, by role. Made-up ids only: the repository is public.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const role = await import('../functions/_lib/work/role.ts');
const svc = await import('../functions/_lib/work/service.ts');
const repoMod = await import('../functions/_lib/work/repo.ts');

const row = (o) => ({ id: '1', cid: '100', due: '2026-10-01', typeRaw: 'RDD Action', type: 'RDD Action', category: 'Task/Other', summary: 'x', fundraisers: ['10'], holders: [], partner: 'P', pending: null, ...o });
const people = { 10: { n: 'Dir A', team: 'RDD', active: 1, left: null, listed: 1 }, 11: { n: 'Dir B', team: 'RDD', active: 1, left: null, listed: 1 }, 20: { n: 'Care A', team: 'Partner Care', active: 1, left: null, listed: 1 } };
const rows = [row({ id: '1', fundraisers: ['10'] }), row({ id: '2', fundraisers: ['11'] }), row({ id: '3', fundraisers: ['20'], holders: ['10'] }), row({ id: '4', fundraisers: ['20'] })];
const scope = (r, fids, extra = {}) => ({ role: r, email: 'x@favorintl.org', name: 'X', fid: [...fids][0] || null, team: r === 'director' ? 'RDD' : r === 'support' ? 'Support' : 'Partner Care', all: false, fids: new Set(fids), ...extra });

function ctxOf(s, testCid) {
  repoMod.forgetBoard();
  const repo = { async loadBoard() { return { rows, people, synced: '2026-10-09T09:00:00Z', orphans: 0 }; } };
  const env = { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => null, run: async () => ({}) }), all: async () => ({ results: [] }), first: async () => null }) } };
  return { env, repo, actor: 'X', email: 'x@favorintl.org', scope: s, testCid };
}
const refused = async (c, input) => {
  await assert.rejects(() => svc.authorizeBatch(c, input), (e) => e.status === 403);
};

describe('what each role sees', () => {
  it('a director sees actions they work and actions on partners they hold', () => {
    const got = role.scopeRows(scope('director', ['10']), rows).map((r) => r.id);
    assert.deepEqual(got, ['1', '3']);
  });
  it('Support sees the directors they support', () => {
    assert.deepEqual(role.scopeRows(scope('support', ['10', '11']), rows).map((r) => r.id), ['1', '2', '3']);
  });
  it('Partner Care sees the team portfolio and an admin sees everything', () => {
    assert.deepEqual(role.scopeRows(scope('partner_care', ['20']), rows).map((r) => r.id), ['3', '4']);
    assert.equal(role.scopeRows({ ...scope('admin', []), all: true }, rows).length, 4);
  });
});

describe('write rules by role', () => {
  it('only admins and Support delete or move', () => {
    assert.equal(role.can(scope('director', ['10']), 'delete'), false);
    assert.equal(role.can(scope('partner_care', ['20']), 'delete'), false);
    assert.equal(role.can(scope('grants', ['30']), 'move'), false);
    assert.equal(role.can(scope('support', ['10']), 'delete'), true);
    assert.equal(role.can(undefined, 'delete'), true);
  });
  it('a director cannot delete, and cannot edit someone else\'s action, alone or in bulk', async () => {
    const c = ctxOf(scope('director', ['10']));
    await refused(c, { op: 'delete', ids: ['1'] });
    await svc.authorizeBatch(c, { op: 'edit', ids: ['1'], set: { summary: 'ok' } });
    await refused(c, { op: 'edit', ids: ['2'], set: { summary: 'no' } });
    await refused(c, { op: 'bulk_edit', ids: ['1', '2'], set: { priority: 'High' } });
    await refused(c, { op: 'complete', ids: ['4'] });
  });
  it('Support deletes inside their directors and not outside', async () => {
    const c = ctxOf(scope('support', ['10', '11']));
    await svc.authorizeBatch(c, { op: 'delete', ids: ['1', '2'] });
    await refused(c, { op: 'delete', ids: ['4'] });
  });
  it('reassigning across teams is an admin\'s call', async () => {
    const c = ctxOf(scope('director', ['10']));
    await svc.authorizeBatch(c, { op: 'reassign', ids: ['1'], to: '11' });
    await refused(c, { op: 'reassign', ids: ['1'], to: '20' });
    await refused(c, { op: 'edit', ids: ['1'], set: { fundraisers: ['20'] } });
    const admin = ctxOf({ ...scope('admin', []), all: true });
    await svc.authorizeBatch(admin, { op: 'reassign', ids: ['1'], to: '20' });
  });
  it('a role test may touch only the test record', async () => {
    const c = ctxOf({ ...scope('support', ['10', '11']) }, '27202');
    await refused(c, { op: 'edit', ids: ['1'], set: { summary: 'no' } });
    await refused(c, { op: 'new', cids: ['100'], set: {} });
  });
  it('a batch belongs to the person who made it', async () => {
    const c = ctxOf(scope('director', ['10']));
    c.env.DB.prepare = () => ({ bind: () => ({ first: async () => ({ actor_email: 'someone@favorintl.org' }) }) });
    await assert.rejects(() => svc.assertOwnBatch(c, 'wcb_1'), (e) => e.status === 403);
  });
});
