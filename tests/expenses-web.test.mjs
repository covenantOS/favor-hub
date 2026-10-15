// The expense screens in the web app (web/src/features/expenses): the pure rules behind them, and how the middleware treats the approver's
// review page, which stays open without sign-in (the emailed token is the key) and reaches the web app only for a signed-in person.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const L = await import('../web/src/features/expenses/logic.ts');
const { WEB_ROUTES } = await import('../shared/web.ts');
const { WEB_OPEN_PAGES } = await import('../functions/_lib/web.ts');
const mw = await import('../functions/_middleware.ts');

describe('money, amounts and the mileage calculator', () => {
  it('money shows cents with two places and a dollar sign', () => {
    assert.equal(L.money(0), '$0.00');
    assert.equal(L.money(123456), '$1,234.56');
    assert.equal(L.dollars(76), '$76.00');
  });
  it('an amount box takes dollars with or without $ and commas, and anything else is nothing', () => {
    assert.equal(L.parseAmount('$1,200.50'), 1200.5);
    assert.equal(L.parseAmount('abc'), 0);
    assert.equal(L.parseAmount('-4'), 0);
    assert.equal(L.parseAmount(''), 0);
    assert.equal(L.lineTotal([{ amount: '10' }, { amount: '2.5' }, {}]), 12.5);
  });
  it('mileage skips the first miles of a trip and prices the rest at the policy rate', () => {
    const m = { rate_cents: 70, deduction_miles: 40 };
    assert.deepEqual(L.mileageCalc('100', m), { miles: 100, net: 60, amount: 42 });
    assert.equal(L.mileageCalc('30', m).amount, 0);
    assert.match(L.mileageNote('100', m), /^Per policy, the first 40 mi of a trip do not count\. 100 mi driven − 40 mi = 60 reimbursable mi × \$0\.70\/mi = \$42\.00\.$/);
    assert.equal(L.mileageLine('0', m), null);
    assert.deepEqual(L.mileageLine('100', m), { description: 'Mileage: 100 mi driven − 40 mi policy deduction = 60 mi @ $0.70/mi', item: 'Mileage', amount: '42.00' });
  });
});

describe('the request form', () => {
  const ok = { name: 'Ada Example', email: 'ada@favorintl.org', dates: '', city: '', reason: 'Trip', affirm: true, lines: [{ description: 'Hotel', item: 'Lodging', amount: '120' }, {}], hasSignature: true };
  it('lists what is missing in the order the page does', () => {
    assert.deepEqual(L.missingFields(ok), []);
    assert.deepEqual(L.missingFields({ ...ok, name: ' ', email: 'nope', lines: [{}], reason: '', affirm: false, hasSignature: false }), ['your name', 'a valid email', 'at least one expense amount', 'the reason', 'the affirmation', 'your signature']);
  });
  it('sends the same body the Astro form sent, without empty lines', () => {
    const body = L.requestBody({ ...ok, dates: ' Oct 6 ', city: ' Dallas, TX' }, 'data:image/png;base64,AAAA', '');
    assert.deepEqual(body, {
      name: 'Ada Example',
      email: 'ada@favorintl.org',
      travel_dates: 'Oct 6',
      travel_city: 'Dallas, TX',
      reason: 'Trip',
      affirm: true,
      signature: 'data:image/png;base64,AAAA',
      company: '',
      items: [{ description: 'Hotel', item: 'Lodging', amount: 120 }],
    });
  });
});

describe('the log', () => {
  const rows = [
    { id: 'a', doc_number: 'EXP-1', status: 'pending', requester_name: 'Ada Example', requester_email: 'ada@favorintl.org', approver_name: 'Bo Approver' },
    { id: 'b', doc_number: 'EXP-2', status: 'approved', requester_name: 'Cy Sample', requester_email: 'cy@favorintl.org', approver_name: 'Bo Approver' },
    { id: 'c', doc_number: 'EXP-3', status: 'declined', requester_name: 'Di Test', requester_email: 'di@favorintl.org', approver_name: 'Eve Approver' },
  ];
  it('filters by status chip and by a name or number, and counts each chip', () => {
    assert.equal(L.filterRows(rows, { status: 'all', q: '' }).length, 3);
    assert.deepEqual(L.filterRows(rows, { status: 'pending', q: '' }).map((r) => r.id), ['a']);
    assert.deepEqual(L.filterRows(rows, { status: 'all', q: 'exp-2' }).map((r) => r.id), ['b']);
    assert.deepEqual(L.filterRows(rows, { status: 'all', q: 'eve' }).map((r) => r.id), ['c']);
    assert.deepEqual(L.FILTERS.map(([s]) => L.filterCount(rows, s)), [3, 1, 1, 1]);
  });
  it('words for a status and a log event', () => {
    assert.equal(L.statusWord('pending'), 'Waiting');
    assert.equal(L.LOG_EVENTS.distributed, 'Approval emailed out');
    assert.equal(L.emailEventMeta({ to: ['a@b.org'], sent: false, html: '<p>x</p>' }), 'to a@b.org (send failed)');
    assert.equal(L.emailEventMeta({ note: 'No receipts' }), 'note: No receipts');
    assert.equal(L.emailEventMeta(null), '');
    assert.equal(L.parsePayload('{oops'), null);
  });
  it('dates read in Eastern time with plain spaces', () => {
    assert.equal(L.shortDate('2026-10-06T03:30:00Z'), 'Oct 5, 2026');
    assert.equal(L.longDate('2026-10-06T19:04:00Z'), 'Oct 6, 2026, 3:04 PM ET');
    assert.ok(!/ /.test(L.longDate('2026-10-06T19:04:00Z')));
  });
});

describe('the review link', () => {
  it('a token wins over an id, and neither is an empty target', () => {
    assert.deepEqual(L.reviewTarget({ token: 'abc', id: 'exp_1' }), { token: 'abc', id: '' });
    assert.deepEqual(L.reviewTarget({ id: 'exp_1' }), { token: '', id: 'exp_1' });
    assert.deepEqual(L.reviewTarget({}), { token: '', id: '' });
  });
});

describe('the middleware and the review page', () => {
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const world = (settings) => {
    const d1 = memoryD1();
    d1.exec(`CREATE TABLE hub_settings (key TEXT PRIMARY KEY, value TEXT, updated_by TEXT, updated_at TEXT);
      CREATE TABLE hub_users (email TEXT PRIMARY KEY, name TEXT, picture TEXT, role TEXT, blocked INTEGER DEFAULT 0, kpi INTEGER DEFAULT 1);
      CREATE TABLE hub_sessions (token_hash TEXT PRIMARY KEY, email TEXT, expires_at TEXT, last_seen TEXT);
      CREATE TABLE hub_google (email TEXT PRIMARY KEY)`);
    for (const [k, v] of Object.entries(settings)) d1.db.prepare('INSERT INTO hub_settings VALUES (?, ?, ?, ?)').run(k, v, 't', 'now');
    for (const [email, role] of [['tester@favorintl.org', 'admin'], ['someone@favorintl.org', 'staff']]) {
      d1.db.prepare('INSERT INTO hub_users (email, name, picture, role) VALUES (?, ?, ?, ?)').run(email, email, '', role);
      d1.db.prepare('INSERT INTO hub_sessions VALUES (?, ?, ?, ?)').run(sha('tok-' + email), email, '2099-01-01T00:00:00.000Z', new Date().toISOString());
      d1.db.prepare('INSERT INTO hub_google VALUES (?)').run(email);
    }
    return { DB: d1, WEB: { fetch: async (req) => new Response('web:' + (req.headers.get('X-Hub-Email') || 'nobody'), { headers: { 'content-type': 'text/html' } }) } };
  };
  const get = async (env, path, email) => {
    const headers = { 'Sec-Fetch-Dest': 'document' };
    if (email) headers.Cookie = 'favor_hub_session=tok-' + email;
    const res = await mw.onRequest({ request: new Request('https://dash.favorintl.org' + path, { headers }), env, next: async () => new Response('astro', { headers: { 'content-type': 'text/html' } }), waitUntil() {}, params: {}, data: {} });
    return { status: res.status, body: await res.text(), front: res.headers.get('X-Hub-Front') };
  };

  it('Expenses is built and owns its two sub-pages', () => {
    assert.ok(WEB_ROUTES.includes('/expenses/'));
    assert.ok(WEB_OPEN_PAGES.has('/expenses/review/'));
  });
  it('a visitor with no session and a token keeps the Astro page, even when the route is on for everyone', async () => {
    const env = world({ 'web.routes': '/expenses/@all' });
    const r = await get(env, '/expenses/review/?token=' + 'a'.repeat(48), '');
    assert.equal(r.status, 200);
    assert.equal(r.body, 'astro');
  });
  it('a signed-in person gets the web page when the route is on for them, and Astro when it is not', async () => {
    const onAll = world({ 'web.routes': '/expenses/@all' });
    assert.equal((await get(onAll, '/expenses/review/?id=exp_1', 'someone@favorintl.org')).body, 'web:someone@favorintl.org');
    const testers = world({ 'web.routes': '/expenses/@testers' });
    assert.equal((await get(testers, '/expenses/review/?id=exp_1', 'someone@favorintl.org')).body, 'astro');
    assert.equal((await get(testers, '/expenses/review/?id=exp_1', 'tester@favorintl.org')).body, 'web:tester@favorintl.org');
    const off = world({});
    assert.equal((await get(off, '/expenses/review/?id=exp_1', 'tester@favorintl.org')).body, 'astro');
  });
  it('the other expense pages still need a sign-in', async () => {
    const env = world({ 'web.routes': '/expenses/@all' });
    const r = await get(env, '/expenses/', '');
    assert.equal(r.status, 302);
  });
});
