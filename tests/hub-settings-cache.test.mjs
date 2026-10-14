// hub_settings is read from a 30-second copy per isolate (functions/_lib/admin/hubcache.ts). A save through hubPut()/hubDel() updates
// the copy at once and marks the response with hub_sv, which makes any isolate with an older copy read the table again.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const C = await import('../functions/_lib/admin/hubcache.ts');
const S = await import('../functions/_lib/admin/settings.ts');
const H = await import('../functions/_lib/admin/health.ts');

function world() {
  const d1 = memoryD1();
  d1.exec('CREATE TABLE hub_settings (key TEXT PRIMARY KEY, value TEXT, updated_by TEXT, updated_at TEXT)');
  d1.db.prepare('INSERT INTO hub_settings VALUES (?, ?, ?, ?)').run('field.brain', 'off', 't', 'now');
  let reads = 0;
  const prepare = d1.prepare.bind(d1);
  d1.prepare = (sql) => { if (/^SELECT[^;]*FROM hub_settings/.test(sql.trim())) reads++; return prepare(sql); };
  return { env: { DB: d1 }, db: d1.db, reads: () => reads };
}

test('one read serves many, a save shows at once, and the save marks the response', async () => {
  C.resetHubCache(true);
  try {
    const w = world();
    assert.equal(await C.hubValue(w.env, 'field.brain'), 'off');
    assert.equal(await C.hubValue(w.env, 'field.brain'), 'off');
    assert.deepEqual(await C.hubPrefix(w.env, 'field.'), [{ key: 'field.brain', value: 'off' }]);
    assert.equal(w.reads(), 1);
    const res = await C.withHubWrites(async () => {
      await S.hubPut(w.env, 'field.brain', 'on', 'admin@favorintl.org');
      return new Response('{}');
    });
    assert.match(res.headers.get('Set-Cookie') || '', /^hub_sv=\d+; Path=\/; Max-Age=60/);
    assert.equal(await C.hubValue(w.env, 'field.brain'), 'on');
    assert.equal((await S.hubGet(w.env, 'field.brain')).by, 'admin@favorintl.org');
    await S.hubDel(w.env, 'field.brain');
    assert.equal(await C.hubValue(w.env, 'field.brain'), null);
    assert.equal(w.reads(), 1);
    // A row changed elsewhere is read again once the person who saved comes back with hub_sv.
    w.db.prepare('INSERT INTO hub_settings VALUES (?, ?, ?, ?)').run('field.brain', 'on', 'x', 'now');
    C.honorSavedCookie('a=1; hub_sv=' + (Date.now() + 1));
    assert.equal(await C.hubValue(w.env, 'field.brain'), 'on');
    assert.equal(w.reads(), 2);
    // A request that saved nothing gets no cookie.
    const plain = await C.withHubWrites(async () => new Response('{}'));
    assert.equal(plain.headers.get('Set-Cookie'), null);
    // Another database (another test, another binding) never reads this copy.
    const other = world();
    assert.equal(await C.hubValue(other.env, 'field.brain'), 'off');
  } finally {
    C.resetHubCache(false);
  }
});

test('the Notification emails tile says what the last pass did in words', () => {
  assert.equal(H.notifyDetail('{"tasks":0,"feedback":{"sent":0,"skipped":0,"failed":0},"nudges":{"closed":0,"first":0,"second":0,"told":0,"emails":0}}'), 'Last pass: nothing to send');
  assert.equal(H.notifyDetail('{"tasks":2,"feedback":{"sent":1,"failed":1},"nudges":{"emails":3}}'), 'Last pass sent 2 task emails, 1 feedback reply, 3 nudges, 1 failed');
  assert.equal(H.notifyDetail('Blackbaud said wait'), 'Blackbaud said wait');
  assert.equal(H.notifyDetail(''), 'No run yet');
});
