// Run with: npm test
//
// Gift images: which gifts need an image in Blackbaud, what the hub knows about each one's attachments, asking Blackbaud (1 call each
// on the gift entry lane), and attaching an image. Every name, id and amount is made up: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const gi = await import('../functions/_lib/work/giftimages.ts');
const svc = await import('../functions/_lib/work/giftimages-svc.ts');
const { readOnly } = await import('../functions/_lib/work/repo.ts');

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const day = (n) => new Date(Date.parse(TODAY + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const SCHEMA = ['work.sql', 'work-giftimages.sql'].map((f) => readFileSync(new URL('../db/' + f, import.meta.url), 'utf8')).join('\n');

describe('whyOf', () => {
  it('$5,000 or more, then a giving fund, then a designated fund; Where Needed Most alone needs no image', () => {
    assert.equal(gi.whyOf({ amount: 5000, name: 'Ann Example', funds: ['79'] }), 'big');
    assert.equal(gi.whyOf({ amount: 150, name: 'Example Community Foundation', funds: ['79'] }), 'giving_fund');
    assert.equal(gi.whyOf({ amount: 150, name: 'Ann Example', funds: ['79', '12'] }), 'designated');
    assert.equal(gi.whyOf({ amount: 150, name: 'Ann Example', funds: ['79'] }), '');
    assert.equal(gi.whyOf({ amount: 4999.99, name: 'Ann Example', funds: [] }), '');
  });
  it('has none of the words the mirror refuses', () => assert.doesNotThrow(() => readOnly(gi.GIFTS_SQL)));
});

let mirror;
const q = async (sql, params = []) => {
  readOnly(sql);
  return mirror.prepare(sql).all(...params);
};
function addGift(id, cid, amount, date, o = {}) {
  mirror.prepare('INSERT INTO gifts (id, gift_amount, gift_date, gift_type, gift_status, gift_payment_method, gift_splits, constituent_record_id, raw_json) VALUES (?,?,?,?,?,?,?,?,?)').run(
    id, amount, date + 'T00:00:00', o.type || 'Donation', 'Active', o.pm || 'PersonalCheck', JSON.stringify([{ fund_id: o.fund || '79' }]), cid, JSON.stringify({ batch_number: o.chk || 'GFT-2026-1001' })
  );
}
function buildMirror() {
  mirror = new DatabaseSync(':memory:');
  mirror.exec(`
    CREATE TABLE constituents (id TEXT PRIMARY KEY, constituent_type TEXT, first_name TEXT, last_name TEXT, raw_json TEXT);
    CREATE TABLE gifts (id TEXT PRIMARY KEY, gift_amount REAL, gift_date TEXT, gift_type TEXT, gift_status TEXT, gift_payment_method TEXT, gift_splits TEXT, constituent_record_id TEXT, raw_json TEXT);
    CREATE TABLE funds (id TEXT PRIMARY KEY, fund_description TEXT);
    INSERT INTO funds VALUES ('79', 'Where Needed Most'), ('12', 'Clean Water');
  `);
  const who = (id, name) => mirror.prepare('INSERT INTO constituents (id, constituent_type, raw_json) VALUES (?,?,?)').run(id, 'Individual', JSON.stringify({ name }));
  who('1', 'Ann Example'); who('2', 'Example Giving Fund'); who('3', 'Bob Sample');
  addGift('301', '1', 6000, day(-2));                       // big
  addGift('302', '2', 200, day(-3), { pm: 'Other' });        // giving fund
  addGift('303', '3', 100, day(-4), { fund: '12' });          // designated
  addGift('304', '3', 100, day(-5));                          // Where Needed Most: no image
  addGift('305', '1', 9000, day(-6), { pm: 'CreditCard' });   // online: no paper image
  addGift('306', '1', 7000, day(-90));                        // older than the window
  addGift('307', '1', 5500, day(-7), { chk: '2002' });        // big, already has an attachment
  addGift('308', '1', 5200, day(-8));                         // big, checked, none
}

describe('loadImageRows', () => {
  beforeEach(buildMirror);
  it('lists the rule gifts that are not known to have an image, newest first, with the reason and the fund', async () => {
    const known = new Map([['307', { state: 'has', files: 1, file: null, checked_at: 'x' }], ['308', { state: 'none', files: 0, file: null, checked_at: '2026-10-10T10:00:00Z' }]]);
    const rows = await gi.loadImageRows(q, { today: TODAY, known });
    assert.deepEqual(rows.map((r) => r.giftId), ['301', '302', '303', '308']);
    assert.deepEqual(rows.map((r) => r.why), ['big', 'giving_fund', 'designated', 'big']);
    assert.equal(rows[0].state, 'unknown');
    assert.equal(rows[3].state, 'none');
    assert.equal(rows[0].batch, 'GFT-2026-1001');
    assert.equal(rows[2].fund, 'Clean Water');
    assert.equal(rows[0].age, 2);
  });
});

/* ------------------------------------------------------------------ the service */
let hub;
let sent;
let puts;
let stored;
let attachCount;
let ctx;
function fakeD1(db) {
  const stmt = (sql, args = []) => ({
    args, sql,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return { prepare: (sql) => stmt(sql), batch: async () => [] };
}
function deps(over = {}) {
  return {
    send: async (calls) => {
      sent.push(calls);
      return {
        results: calls.map((c) => {
          if (c.method === 'GET' && /\/attachments$/.test(c.path)) { const id = c.path.split('/')[4]; return { ok: true, status: 200, body: { count: attachCount[id] || 0, value: Array(attachCount[id] || 0).fill({}) } }; }
          if (c.method === 'GET') return { ok: true, status: 200, body: { constituent_id: '27202' } };
          if (c.path === '/gift/v1/documents') return { ok: true, status: 200, body: { file_id: 'f-9', file_upload_request: { url: 'https://files.test/put', method: 'PUT', headers: [] } } };
          return { ok: true, status: 200, body: { id: 'att-1' } };
        }),
        callsToday: 50, cap: 400,
      };
    },
    lane: async () => ({ calls: 50, cap: 400 }),
    bucket: { put: async (key, v) => { stored.push({ key, size: v.length }); } },
    put: async (url, init) => { puts.push({ url, init }); return new Response('', { status: 201 }); },
    ...over,
  };
}
const ADMIN = { role: 'admin', fid: null, fids: new Set(), all: false, email: 'desk@example.org', name: 'Desk Person', team: 'Operations' };
const img = (name = 'check.jpg', size = 30) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

describe('the gift images service', () => {
  beforeEach(() => {
    buildMirror();
    hub = new DatabaseSync(':memory:');
    hub.exec(SCHEMA);
    sent = []; puts = []; stored = []; attachCount = {};
    ctx = { env: { DB: fakeD1(hub), MIRROR_API_KEY: 'k', MIRROR_QUERY_URL: 'https://mirror.test/d1/query' }, repo: { async synced() { return '2026-10-10T09:00:00Z'; } }, actor: 'Desk Person', email: 'desk@example.org', scope: ADMIN };
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://mirror.test')) return real(url, init);
      const { sql, params } = JSON.parse(init.body);
      return new Response(JSON.stringify(mirror.prepare(sql).all(...params)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  });

  it('reads the list with counts and the lane', async () => {
    const out = await svc.giftImagesResponse(ctx, deps());
    assert.equal(out.rows.length, 5, '301, 302, 303, 307, 308 are all unknown');
    assert.equal(out.stats.unchecked, 5);
    assert.equal(out.stats.big, 3);
    assert.equal(out.lane.left, 400 - 50 - svc.LANE_RESERVE);
  });

  it('asking Blackbaud takes a gift with an attachment off the list and keeps one with none on it, 1 call each', async () => {
    attachCount['301'] = 1;
    const out = await svc.checkGifts(ctx, ['301', '302', '999'], deps());
    assert.equal(out.has, 1);
    assert.equal(out.none, 1);
    assert.equal(sent.flat().length, 2, 'an id not on the list costs nothing');
    const list = await svc.giftImagesResponse(ctx, deps());
    assert.ok(!list.rows.some((r) => r.giftId === '301'));
    assert.equal(list.rows.find((r) => r.giftId === '302').state, 'none');
    assert.equal(list.stats.need, 1);
  });

  it('refuses a check when the lane has too little left, more than 20 gifts, or nothing', async () => {
    await assert.rejects(svc.checkGifts(ctx, ['301', '302'], deps({ lane: async () => ({ calls: 345, cap: 400 }) })), /nearly used/);
    await assert.rejects(svc.checkGifts(ctx, Array.from({ length: 21 }, (_, i) => String(300 + i)), deps()), /20 gifts or fewer/);
    await assert.rejects(svc.checkGifts(ctx, [], deps()), /Pick the gifts/);
    assert.equal(sent.length, 0);
  });

  it('a failed read leaves the gift unchecked and says so', async () => {
    const bad = deps({ send: async (calls) => ({ results: calls.map(() => ({ ok: false, status: 500, body: { message: 'down' } })) }) });
    const out = await svc.checkGifts(ctx, ['301'], bad);
    assert.equal(out.checked, 0);
    assert.equal(out.failed.length, 1);
    assert.equal(hub.prepare('SELECT COUNT(*) n FROM act_giftimg').get().n, 0);
  });

  it('attaching asks for an upload address, puts the bytes there, attaches by file id and keeps the master copy', async () => {
    const out = await svc.attachToGift(ctx, { giftId: '301', kind: 'check', file: img('front.jpg') }, deps());
    assert.equal(out.ok, true);
    const calls = sent.flat();
    assert.deepEqual(calls.map((c) => c.path), ['/gift/v1/documents', '/gift/v1/gifts/attachments']);
    assert.equal(calls[1].body.parent_id, '301');
    assert.equal(calls[1].body.file_id, 'f-9');
    assert.equal(calls[1].body.type, 'Physical');
    assert.equal(calls[1].body.name, 'Check (hub)');
    assert.equal(calls[1].body.date, day(-2) + 'T00:00:00');
    assert.equal(puts.length, 1);
    assert.equal(stored.length, 1);
    assert.match(stored[0].key, /^attach\/301\//);
    const list = await svc.giftImagesResponse(ctx, deps());
    assert.ok(!list.rows.some((r) => r.giftId === '301'), 'the gift leaves the list');
    assert.equal(hub.prepare("SELECT source FROM act_giftimg WHERE gift_id = '301'").get().source, 'hub');
  });

  it('refuses a file type, a big file, a gift not on the list and a role outside the desk', async () => {
    await assert.rejects(svc.attachToGift(ctx, { giftId: '301', file: img('run.exe') }, deps()), /PDF, JPEG or PNG/);
    await assert.rejects(svc.attachToGift(ctx, { giftId: '301', file: img('big.jpg', 10 * 1024 * 1024 + 1) }, deps()), /10 MB/);
    await assert.rejects(svc.attachToGift(ctx, { giftId: '304', file: img() }, deps()), /not on the list/);
    await assert.rejects(svc.attachToGift(ctx, { giftId: '301' }, deps()), /Pick the image/);
    const rdd = { ...ctx, scope: { role: 'director', fid: '5', fids: new Set(['5']), all: false, email: 'a@b.c', name: 'A', team: 'RDD' } };
    await assert.rejects(svc.giftImagesResponse(rdd, deps()), /admin desk/);
    await assert.rejects(svc.attachToGift(rdd, { giftId: '301', file: img() }, deps()), /admin desk/);
    assert.equal(sent.length, 0);
    assert.equal(puts.length, 0);
  });

  it('nothing is recorded when the attachment call fails, and an upload that does not reach Blackbaud stops the second call', async () => {
    const bad = deps({ send: async (calls) => ({ results: calls.map((c) => (c.path === '/gift/v1/documents' ? { ok: true, status: 200, body: { file_id: 'f', file_upload_request: { url: 'https://files.test/put', headers: [] } } } : { ok: false, status: 400, body: { message: 'no' } })) }) });
    await assert.rejects(svc.attachToGift(ctx, { giftId: '301', file: img() }, bad), /was not attached/);
    assert.equal(hub.prepare('SELECT COUNT(*) n FROM act_giftimg').get().n, 0);
    const noPut = deps({ put: async () => new Response('', { status: 500 }) });
    await assert.rejects(svc.attachToGift(ctx, { giftId: '301', file: img() }, noPut), /did not reach Blackbaud/);
    assert.equal(sent.flat().filter((c) => c.path === '/gift/v1/gifts/attachments').length, 0, 'no attachment is made when the bytes did not arrive');
  });

  it('a role test may attach only to a gift on its one test record', async () => {
    const t = { ...ctx, testCid: '27202' };
    const out = await svc.attachToGift(t, { giftId: '999', file: img() }, deps());
    assert.equal(out.ok, true, 'the gift read says it belongs to the test record');
    const other = deps({ send: async (calls) => ({ results: calls.map(() => ({ ok: true, status: 200, body: { constituent_id: '555' } })) }) });
    await assert.rejects(svc.attachToGift(t, { giftId: '998', file: img() }, other), /test record/);
    await assert.rejects(svc.attachToGift(t, { giftId: '301', file: img() }, deps()), /test record/);
  });
});
