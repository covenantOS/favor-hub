// Run with: npm test
//
// Review comments on gift entry rows: add a comment, mark a row needs a fix (text required), resolve it, the bell reminder for the
// person who entered the deposit, the money fields left alone, and the admin-only routes (403 for staff, 401 with no sign-in).
// A real SQLite copy of the gift entry and reminder tables stands in for D1 and the route files run as Pages Functions would call
// them. Made-up names and example.org addresses only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import { memoryD1 } from './support/d1.mjs';
import './support/resolve-ts.mjs';

const comments = await import('../functions/_lib/gifts/comments.ts');
const view = await import('../functions/_lib/gifts/view.ts');
const route = await import(new URL('../functions/api/gift-entry/gifts/%5Bid%5D/comments.ts', import.meta.url).href);

const SCHEMA = [
  readFileSync(new URL('../db/gift-entry.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../db/work-reminders.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../db/gift-entry-comments.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../db/gift-photo.sql', import.meta.url), 'utf8'),
].join('\n');

const SUBMITTER = { email: 'ada@example.org', name: 'Ada Tester' };
const REVIEWER = { email: 'rev@example.org', name: 'Rev Reviewer' };
const STAFF = { email: 'staff@example.org', name: 'Sam Staff' };

let env;

function seed() {
  env = { DB: memoryD1() };
  env.DB.exec(SCHEMA);
  const now = '2026-10-10T14:00:00.000Z';
  env.DB.exec(`
    INSERT INTO ge_deposit (id, kind, name, deposit_date, tape_cents, tape_count, status, created_by, created_by_email, created_at)
      VALUES ('gd_test1', 'regular', 'Regular Mail 2026-10-10', '2026-10-10', 100000, 3, 'open', 'Ada Tester', 'ada@example.org', '${now}');
    INSERT INTO ge_gift (id, deposit_id, seq, status, kind, partner_name, amount_cents, gift_date, fund_id, fund_name, appeal_id, appeal_name,
        confirmed_by, created_by, created_at, updated_at)
      VALUES ('gg_test1', 'gd_test1', 1, 'review', 'check', 'Made Up Partner', 12500, '2026-10-10', '79', 'Where Needed Most', '2192', 'Made Up Appeal',
        NULL, 'Ada Tester', '${now}', '${now}');
    INSERT INTO ge_gift (id, deposit_id, seq, status, kind, partner_name, amount_cents, gift_date, created_by, created_at, updated_at)
      VALUES ('gg_removed', 'gd_test1', 2, 'removed', 'check', 'Gone Partner', 900, '2026-10-10', 'Ada Tester', '${now}', '${now}');
  `);
}

const gift = (id = 'gg_test1') => ({ id, deposit_id: 'gd_test1', partner_name: 'Made Up Partner' });
const money = async (id = 'gg_test1') => env.DB.prepare('SELECT amount_cents, fund_id, fund_name, appeal_id, appeal_name, status, confirmed_by, bb_batch_gift_id, bb_gift_id, gift_date FROM ge_gift WHERE id = ?').bind(id).first();
const reminders = async (owner) => env.DB.prepare('SELECT owner, kind, title, note, source, state FROM act_reminders WHERE owner = ? ORDER BY created_at').bind(owner).all().then((r) => r.results);
const countComments = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM ge_comment').first()).n;

function hubRequest(method, who, body) {
  const headers = { 'content-type': 'application/json', 'x-hub-request': '1' };
  if (who) Object.assign(headers, { 'x-hub-email': who.email, 'x-hub-name': who.name, 'x-hub-role': who.role || 'admin' });
  return new Request('https://favor-hub.example.org/api/gift-entry/gifts/gg_test1/comments', { method, headers, body: body == null ? undefined : JSON.stringify(body) });
}

async function callPost(who, body, id = 'gg_test1') {
  return route.onRequestPost({ request: hubRequest('POST', who, body), env, params: { id }, waitUntil: () => {} });
}
async function callGet(who, id = 'gg_test1') {
  return route.onRequestGet({ request: hubRequest('GET', who), env, params: { id }, waitUntil: () => {} });
}

describe('adding a comment', () => {
  beforeEach(seed);

  it('stores who, when and the text, and reads the thread back in order', async () => {
    const row = await comments.addComment(env, gift(), REVIEWER, { body: '  Check the memo, it reads "Mission".  ' });
    assert.equal(row.kind, 'comment');
    assert.equal(row.body, 'Check the memo, it reads "Mission".');
    assert.equal(row.author_email, 'rev@example.org');
    assert.equal(row.author_name, 'Rev Reviewer');
    assert.ok(row.id.startsWith('gc_'));
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T/);
    const thread = await comments.commentsOf(env, 'gg_test1');
    assert.equal(thread.length, 1);
    assert.equal(thread[0].body, row.body);
    assert.equal(comments.reviewState(thread).needsFix, false);
  });

  it('a plain comment needs text', async () => {
    await assert.rejects(comments.addComment(env, gift(), REVIEWER, { body: '   ' }), (e) => e.code === 'missing_text' && e.status === 400);
    assert.equal(await countComments(), 0);
  });

  it('refuses a note over the limit and an unknown kind', async () => {
    await assert.rejects(comments.addComment(env, gift(), REVIEWER, { body: 'x'.repeat(1001) }), (e) => e.status === 400);
    await assert.rejects(comments.addComment(env, gift(), REVIEWER, { kind: 'approve', body: 'ok' }), (e) => e.status === 400);
    assert.equal(await countComments(), 0);
  });
});

describe('needs a fix', () => {
  beforeEach(seed);

  it('requires a note: a bare needs-a-fix mark is refused and writes nothing', async () => {
    await assert.rejects(comments.addComment(env, gift(), REVIEWER, { kind: 'needs_fix', body: '' }), (e) => e.status === 400 && e.code === 'needs_fix_text');
    await assert.rejects(comments.addComment(env, gift(), REVIEWER, { kind: 'needs_fix' }), (e) => e.code === 'needs_fix_text');
    await assert.rejects(comments.addComment(env, gift(), REVIEWER, { kind: 'needs_fix', body: ' \n ' }), (e) => e.code === 'needs_fix_text');
    assert.equal(await countComments(), 0);
  });

  it('turns the row to needs a fix, a later comment keeps it there, and resolved clears it', async () => {
    await comments.addComment(env, gift(), REVIEWER, { kind: 'needs_fix', body: 'Amount reads 125.00 on the slip, not 152.00.' });
    let thread = await comments.commentsOf(env, 'gg_test1');
    assert.equal(comments.reviewState(thread).needsFix, true);
    await comments.addComment(env, gift(), SUBMITTER, { body: 'Fixing it now.' });
    thread = await comments.commentsOf(env, 'gg_test1');
    assert.equal(comments.reviewState(thread).needsFix, true);
    assert.equal(comments.reviewState(thread).comments, 2);
    await comments.addComment(env, gift(), SUBMITTER, { kind: 'resolved' });
    thread = await comments.commentsOf(env, 'gg_test1');
    assert.equal(comments.reviewState(thread).needsFix, false);
  });

  it('counts the rows that need a fix per deposit, one per row', async () => {
    await comments.addComment(env, gift(), REVIEWER, { kind: 'needs_fix', body: 'Wrong fund on the slip.' });
    await comments.addComment(env, gift(), REVIEWER, { kind: 'needs_fix', body: 'Date is off by a week.' });
    assert.deepEqual(await comments.needsFixByDeposit(env), { gd_test1: 1 });
    await comments.addComment(env, gift(), SUBMITTER, { kind: 'resolved' });
    assert.deepEqual(await comments.needsFixByDeposit(env), {});
  });
});

describe('the bell reminder for the person who entered the deposit', () => {
  beforeEach(seed);

  it('tells the submitter when a reviewer writes, and not when the submitter writes', async () => {
    await comments.addComment(env, gift(), REVIEWER, { kind: 'needs_fix', body: 'Check number is 99001, not 99010.' });
    const mine = await reminders('ada@example.org');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].kind, 'message');
    assert.equal(mine[0].source, 'message');
    assert.equal(mine[0].state, 'open');
    assert.match(mine[0].title, /needs a fix/);
    assert.equal(mine[0].note, 'Check number is 99001, not 99010.');
    assert.equal((await reminders('rev@example.org')).length, 0);

    await comments.addComment(env, gift(), SUBMITTER, { body: 'Done, see the new slip.' });
    assert.equal((await reminders('ada@example.org')).length, 1);
  });

  it('never names anyone in the title', async () => {
    await comments.addComment(env, gift(), REVIEWER, { kind: 'needs_fix', body: 'Fix it.' });
    const [r] = await reminders('ada@example.org');
    assert.equal(r.title.includes('Rev'), false);
    assert.equal(r.title.includes('Reviewer'), false);
  });
});

describe('the money stays put', () => {
  beforeEach(seed);

  it('leaves amount, fund, appeal, status, confirmation and Blackbaud ids as they were', async () => {
    const before = await money();
    await comments.addComment(env, gift(), REVIEWER, { kind: 'needs_fix', body: 'Looks wrong.' });
    await comments.addComment(env, gift(), SUBMITTER, { kind: 'resolved', body: '' });
    await comments.addComment(env, gift(), REVIEWER, { body: 'Thanks.' });
    assert.deepEqual(await money(), before);
    assert.equal(before.amount_cents, 12500);
    assert.equal(before.confirmed_by, null);
    const outbox = await env.DB.prepare('SELECT COUNT(*) AS n FROM ge_outbox').first();
    assert.equal(outbox.n, 0);
  });
});

describe('the deposit view carries each row\'s thread', () => {
  beforeEach(seed);

  it('shows the thread and the needs-a-fix state on the row, and none for a removed row', async () => {
    await comments.addComment(env, gift(), REVIEWER, { kind: 'needs_fix', body: 'Wrong fund.' });
    const v = await view.depositView(env, 'gd_test1');
    const row = v.rows.find((r) => r.id === 'gg_test1');
    assert.equal(row.review.needsFix, true);
    assert.equal(row.thread.length, 1);
    assert.equal(row.thread[0].kind, 'needs_fix');
    assert.equal(row.thread[0].body, 'Wrong fund.');
    assert.equal(v.rows.some((r) => r.id === 'gg_removed'), false);
  });
});

describe('routes: admins only, with the same checks as the gift entry routes', () => {
  beforeEach(seed);

  it('an admin posts and reads the thread', async () => {
    const res = await callPost(REVIEWER, { kind: 'needs_fix', body: 'Date reads 2026-10-01.' });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.ok, true);
    assert.equal(out.comment.kind, 'needs_fix');
    assert.equal(out.review.needsFix, true);
    const got = await (await callGet(SUBMITTER)).json();
    assert.equal(got.thread.length, 1);
    assert.equal(got.review.needsFix, true);
  });

  it('a staff member gets 403 on read and write, and nothing is written', async () => {
    const write = await callPost({ ...STAFF, role: 'staff' }, { body: 'Hello' });
    assert.equal(write.status, 403);
    assert.equal((await write.json()).error, 'admin_only');
    const read = await callGet({ ...STAFF, role: 'staff' });
    assert.equal(read.status, 403);
    assert.equal((await read.json()).error, 'admin_only');
    assert.equal(await countComments(), 0);
  });

  it('no sign-in gets 401', async () => {
    const res = await callPost(null, { body: 'Hello' });
    assert.equal(res.status, 401);
    assert.equal(await countComments(), 0);
  });

  it('a removed row answers 404 and takes no comment', async () => {
    const res = await callPost(REVIEWER, { body: 'Hello' }, 'gg_removed');
    assert.equal(res.status, 404);
    assert.equal(await countComments(), 0);
  });

  it('a needs-a-fix mark without text answers 400', async () => {
    const res = await callPost(REVIEWER, { kind: 'needs_fix', body: '' });
    assert.equal(res.status, 400);
    assert.equal(await countComments(), 0);
  });
});
