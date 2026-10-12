// Saved lists: private, team and everyone, who may open, change and delete each. The database is node:sqlite behind a D1-shaped wrapper.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { deleteSaved, getSaved, listSaved, saveList, scopeOf } from '../functions/_lib/lists/service.ts';
import { d1Of, makeHub } from './support/lists-fixture.mjs';

let env;
const RITA = { email: 'rita@favorintl.org', name: 'Rita Director' };
const PAM = { email: 'pam@favorintl.org', name: 'Pam Care' };
const NOBODY = { email: 'nobody@favorintl.org', name: 'No Team' };

before(() => {
  env = { DB: d1Of(makeHub()) };
});

describe('saved lists', () => {
  it('a private list is the owner only', async () => {
    const s = await saveList(env, RITA, { name: 'My lapsed', spec: { partner: { status: ['lapsed'] } } });
    assert.equal(s.scope, 'private');
    assert.equal(s.mine, true);
    assert.ok((await listSaved(env, RITA.email)).some((x) => x.id === s.id));
    assert.ok(!(await listSaved(env, PAM.email)).some((x) => x.id === s.id));
    assert.equal(await getSaved(env, PAM.email, s.id), null);
  });

  it('a team list reaches the team and nobody else', async () => {
    const s = await saveList(env, RITA, { name: 'RDD list', scope: 'team', spec: { partner: { status: ['active'] } } });
    assert.equal(s.team, 'rdd');
    assert.ok(!(await listSaved(env, PAM.email)).some((x) => x.id === s.id));
    hubExec(env, "INSERT INTO act_staff (email, name, team, bb_fundraiser_id, work_center) VALUES ('rod@favorintl.org', 'Rod RDD', 'rdd', '5009', 1)");
    assert.ok((await listSaved(env, 'rod@favorintl.org')).some((x) => x.id === s.id && x.mine === false));
  });

  it('an everyone list reaches every person', async () => {
    const s = await saveList(env, RITA, { name: 'Everyone', scope: 'all', spec: {} });
    assert.ok((await listSaved(env, PAM.email)).some((x) => x.id === s.id));
    assert.ok((await listSaved(env, NOBODY.email)).some((x) => x.id === s.id));
  });

  it('only the owner changes or deletes', async () => {
    const s = await saveList(env, RITA, { name: 'Mine', scope: 'all', spec: {} });
    await assert.rejects(() => saveList(env, PAM, { name: 'Stolen', spec: {} }, s.id), /Only the person who saved/);
    await assert.rejects(() => deleteSaved(env, PAM.email, s.id), /not yours/);
    const changed = await saveList(env, RITA, { name: 'Renamed', scope: 'private', spec: { partner: { major: 'yes' } } }, s.id);
    assert.equal(changed.name, 'Renamed');
    assert.equal(changed.spec.partner.major, 'yes');
    await deleteSaved(env, RITA.email, s.id);
    assert.equal(await getSaved(env, RITA.email, s.id), null);
  });

  it('refuses a list with no name and a team share with no team', async () => {
    await assert.rejects(() => saveList(env, RITA, { name: '  ', spec: {} }), /Name the list/);
    await assert.rejects(() => saveList(env, NOBODY, { name: 'Team', scope: 'team', spec: {} }), /not on a team/);
  });

  it('cleans the spec it stores', async () => {
    const s = await saveList(env, RITA, { name: 'Clean', spec: { partner: { status: ['active', 'junk'], states: ['fl', 'Florida'] }, evil: 'x' } });
    assert.deepEqual(s.spec.partner.status, ['active']);
    assert.deepEqual(s.spec.partner.states, ['FL']);
    assert.equal(s.spec.evil, undefined);
  });
});

describe('partner access', () => {
  it('an admin sees every partner and everyone else only what their scope holds', () => {
    assert.deepEqual(scopeOf({ scope: { all: true, fids: new Set() } }), { all: true, fids: [] });
    assert.deepEqual(scopeOf({ scope: { all: false, fids: new Set(['5001']) } }), { all: false, fids: ['5001'] });
  });
});

function hubExec(e, sql) {
  e.DB.prepare(sql).run();
}
