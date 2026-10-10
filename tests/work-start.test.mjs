// Run with: npm test
// Group 0 of Work Center round 3: the per-person start view and the tab registry. Made-up addresses only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const start = await import('../functions/_lib/work/start.ts');
const role = await import('../functions/_lib/work/role.ts');

function env() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../db/work.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }) });
  return { DB: { prepare: (s) => stmt(s) } };
}
const dir = { role: 'director', email: 'pat@example.org', name: 'Pat', fid: '10', team: 'RDD', all: false, fids: new Set(['10']) };

describe('start view', () => {
  it('has a default tab for each role and no saved choice at first', async () => {
    const e = env();
    assert.equal((await start.getStart(e, 'pat@example.org', dir)).defaultTab, 'gifts');
    assert.equal(role.DEFAULT_TAB.support, 'hqty');
    assert.equal(role.DEFAULT_TAB.partner_care, 'cadence');
    assert.equal((await start.getStart(e, 'pat@example.org', dir)).pref, null);
  });
  it('saves one choice per person and resets it', async () => {
    const e = env();
    const r = await start.putStart(e, 'Pat@Example.org', dir, { tab: 'open', scope: 'partners' });
    assert.deepEqual(r.pref, { tab: 'open', scope: 'partners' });
    assert.equal((await start.getStart(e, 'jo@example.org', dir)).pref, null);
    assert.equal((await start.putStart(e, 'pat@example.org', dir, { reset: true })).pref, null);
  });
  it('refuses a tab id that is not an id and drops an unknown scope', async () => {
    const e = env();
    await assert.rejects(() => start.putStart(e, 'pat@example.org', dir, { tab: '<b>', scope: 'mine' }));
    assert.equal((await start.putStart(e, 'pat@example.org', dir, { tab: 'ty', scope: 'everything' })).pref.scope, '');
  });
});

describe('tab registry', () => {
  const load = () => { const w = { WCX: [] }; vm.runInNewContext(readFileSync(new URL('../public/js/work-tabs.js', import.meta.url), 'utf8'), { window: w }); return w.WCTabs; };
  const t = (id, more = {}) => ({ id, label: id, mount() {}, ...more });
  it('keeps built-in tabs first and puts a tab after the one it names', () => {
    const R = load();
    R.registerTab(t('hqty', { after: 'open', roles: ['support'] }));
    R.registerTab(t('open', { core: true }));
    R.registerTab(t('ty', { core: true }));
    assert.deepEqual(Array.from(R.list({ role: 'support' }), (x) => x.id), ['open', 'hqty', 'ty']);
    assert.deepEqual(Array.from(R.list({ role: 'director' }), (x) => x.id), ['open', 'ty']);
    assert.deepEqual(Array.from(R.list({ role: 'admin' }), (x) => x.id), ['open', 'hqty', 'ty']);
  });
  it('rejects a bad id or a missing mount and replaces a tab registered twice', () => {
    const R = load();
    assert.throws(() => R.registerTab({ id: 'Bad Id', mount() {} }));
    assert.throws(() => R.registerTab({ id: 'fine' }));
    R.registerTab(t('x1', { label: 'One' })); R.registerTab(t('x1', { label: 'Two' }));
    assert.equal(R.get('x1').label, 'Two');
  });
  it('still reads tabs pushed on the older WCX list', () => {
    const w = { WCX: [{ k: 'mine', label: 'My partners', after: 'open', view() {} }] };
    vm.runInNewContext(readFileSync(new URL('../public/js/work-tabs.js', import.meta.url), 'utf8'), { window: w });
    w.WCTabs.registerTab(t('open', { core: true }));
    assert.deepEqual(Array.from(w.WCTabs.list({ role: 'director' }), (x) => x.id), ['open', 'mine']);
  });
});
