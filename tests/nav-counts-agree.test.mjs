// Run with: npm test
// Every number beside a menu entry equals what the page it opens shows. Each case below is a mismatch found in the 2026-10-12 count audit.
// In-memory database and made-up people only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { learnWorld, call as learnCall } from './support/learn-world.mjs';
import { WILL, VIDEO, NOW } from './support/request-world.mjs';
import './support/resolve-ts.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
let T, P, C, MR;
const run = (w, sql, ...a) => w.d1.db.prepare(sql).run(...a);

function world() {
  const w = learnWorld({ learn: 'staff' });
  w.d1.exec(read('db/receipts.sql'));
  w.d1.exec(read('db/expenses.sql'));
  run(w, "INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('projects.enabled', 'staff', 't', ?)", NOW);
  return w;
}
const staff = (u) => ({ ...u, role: 'staff' });
const access = (over = {}) => ({ admin: false, kpi: true, approver: false, workCenter: false, meetings: true, chat: true, tasks: true, learn: true, mail: false, ...over });

before(async () => {
  T = await import('../functions/_lib/hub/today.ts');
  P = await import('../functions/_lib/projects/links/today.ts');
  C = await import('../functions/_lib/chat/db.ts');
  MR = await import('../functions/_lib/meetroute.ts');
});

describe('menu numbers sit under the right entry', () => {
  it('Evaluations reads the evaluation steps, never the Projects number', async () => {
    const w = world();
    for (const id of ['t1', 't2', 't3']) {
      run(w, "INSERT INTO hub_tasks (id, title, status, owner_email, due_date, created_by, created_at, updated_at) VALUES (?, 'Due thing', 'open', ?, ?, 'x', ?, ?)", id, VIDEO.email, '2020-01-01', NOW, NOW);
    }
    const c = await T.navCounts(w.env, staff(VIDEO), access());
    assert.equal(c.projectsMine, 3, 'three tasks late');
    assert.equal(c.evals, 0, 'no evaluation step is waiting, so the Evaluations entry shows nothing');
    assert.equal(c.learn, 0);
    const cards = await T.evalCards(w.env, staff(VIDEO));
    assert.equal(cards.length, 0, 'and Today has no Evaluations card');
  });

  it('Projects equals the sum of the Projects cards on Today', async () => {
    const w = world();
    run(w, "INSERT INTO hub_tasks (id, title, status, owner_email, due_date, created_by, created_at, updated_at) VALUES ('a', 'Late', 'open', ?, '2020-01-01', 'x', ?, ?)", VIDEO.email, NOW, NOW);
    run(w, "INSERT INTO hub_tasks (id, title, status, owner_email, due_date, created_by, created_at, updated_at) VALUES ('b', 'Future', 'open', ?, '2999-01-01', 'x', ?, ?)", VIDEO.email, NOW, NOW);
    // Two notices on one task count once; a due-soon notice is not a card; a notice on a deleted task is not shown.
    for (const [id, kind, task] of [['n1', 'assigned', 'b'], ['n2', 'comment', 'b'], ['n3', 'mentioned', 'b'], ['n4', 'due_soon', 'b'], ['n5', 'assigned', 'gone']]) {
      run(w, "INSERT INTO hub_task_notices (id, email, task_id, kind, actor_email, body, created_at) VALUES (?, ?, ?, ?, 'x@favorintl.org', '', ?)", id, VIDEO.email, task, kind, NOW);
    }
    const user = staff(VIDEO);
    const cards = await P.projectCards(w.env, user);
    const sum = cards.reduce((n, c) => n + c.n, 0);
    assert.equal(sum, 3, 'one late task, one task given, one task with news');
    assert.equal(await P.projectsMineCount(w.env, user), sum);
  });

  it('Requests counts requests with something unread, once each, and skips ones the person cannot see', async () => {
    const w = world();
    const mk = (id, status) => run(w, "INSERT INTO requests (id, title, body, surface, status, submitter_name, submitter_email, source, created_at, updated_at) VALUES (?, 'T', 'b', 'website', ?, 'A', 'a@favorintl.org', 'form', ?, ?)", id, status, NOW, NOW);
    mk('r1', 'approved');
    mk('r2', 'declined');
    for (const [i, r] of [[1, 'r1'], [2, 'r1'], [3, 'r1'], [4, 'r2']]) {
      run(w, "INSERT INTO request_notices (request_id, email, kind, actor_email, actor_name, note, created_at) VALUES (?, ?, 'comment', 'x@favorintl.org', 'X', ?, ?)", r, VIDEO.email, 'n' + i, NOW);
    }
    assert.equal(await T.unreadRequestCount(w.env, VIDEO.email, false), 1, 'three notices on one request, and the declined one is not on the board');
    assert.equal(await T.unreadRequestCount(w.env, VIDEO.email, true), 2, 'an admin sees declined requests on the board');
    const c = await T.navCounts(w.env, staff(VIDEO), access());
    assert.equal(c.tasks, 1);
    assert.equal(c.board, 1);
  });

  it('Meetings counts only live rooms the person can open', async () => {
    const w = world();
    const ins = (id, mode, invitees) => {
      run(w, "INSERT INTO hub_meetings (id, title, host_email, access, invitees, status, created_at) VALUES (?, 'M', ?, ?, ?, 'live', ?)", id, WILL.email, mode, JSON.stringify(invitees), NOW);
      run(w, "INSERT INTO hub_meeting_presence (meeting_id, pid, email, name, role, joined_at, seen, left_at, removed, waiting) VALUES (?, ?, ?, 'P', 'host', ?, ?, 0, 0, 0)", id, 'p' + id, WILL.email, Date.now(), Date.now());
    };
    ins('open', 'staff', []);
    ins('closed', 'invited', [{ email: 'someone@favorintl.org' }]);
    ins('mine', 'invited', [{ email: VIDEO.email }]);
    assert.equal(await T.liveMeetingsFor(w.env, VIDEO.email), 2, 'the staff room and the one she is invited to, not the invite-only room');
    assert.equal(await T.liveMeetingsFor(w.env, WILL.email), 3, 'the host can open all three');
  });

  it('Chat counts only mentions the person can still open', async () => {
    const w = world();
    run(w, "INSERT INTO chat_channels (id, kind, name, created_by, created_at) VALUES ('pub', 'public', 'pub', 'x', ?), ('priv', 'private', 'priv', 'x', ?), ('old', 'public', 'old', 'x', ?)", NOW, NOW, NOW);
    run(w, 'UPDATE chat_channels SET archived = 1 WHERE id = ?', 'old');
    const msg = (ch, deleted) => Number(run(w, "INSERT INTO chat_messages (channel_id, email, body, created_at, deleted_at) VALUES (?, 'x@favorintl.org', 'hi', ?, ?)", ch, NOW, deleted ? NOW : null).lastInsertRowid);
    for (const [ch, del] of [['pub', false], ['pub', true], ['priv', false], ['old', false]]) {
      const id = msg(ch, del);
      run(w, "INSERT INTO chat_mentions (message_id, channel_id, email, kind, created_at) VALUES (?, ?, ?, 'mention', ?)", id, ch, VIDEO.email, NOW);
    }
    assert.equal(await C.unreadMentionCount(w.env, VIDEO.email), 1, 'one live public mention; deleted, archived and a private room she is not in do not count');
    assert.equal((await C.inbox(w.env, VIDEO.email)).count, 1, 'the bell agrees');
    assert.equal((await C.inbox(w.env, VIDEO.email)).items.length, 1);
  });

  it('Learn counts what My learning lists: published, with lessons, not finished', async () => {
    const w = world();
    const course = (id, status, lessons) => {
      run(w, 'INSERT INTO learn_courses (id, slug, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, id, 'Course ' + id, status, NOW, NOW);
      for (let i = 0; i < lessons; i++) run(w, "INSERT INTO learn_lessons (id, course_id, sort, kind, title, created_at, updated_at) VALUES (?, ?, ?, 'article', 'L', ?, ?)", `${id}-${i}`, id, i, NOW, NOW);
      run(w, "INSERT INTO learn_assignments (id, email, kind, target_id, assigned_by, assigned_at) VALUES (?, ?, 'course', ?, 'x', ?)", 'a-' + id, VIDEO.email, id, NOW);
    };
    course('live', 'published', 2);
    course('draft', 'draft', 2);
    course('empty', 'published', 0);
    const b = await (await import('../functions/_lib/learn/views.ts')).badgeFor(w.env, VIDEO.email);
    assert.equal(b.open, 1, 'only the published course with lessons');
    const home = (await learnCall(w, staff(VIDEO), 'GET', 'home')).data;
    const listed = (home.assigned || (home.home && home.home.assigned) || []).length;
    assert.equal(b.open, listed, 'the same number My learning lists');
  });

  it('Receipts shows the same number on the menu and on Today', async () => {
    const w = world();
    run(w, "INSERT INTO rcp_batches (id, kind, letter_date, appeal_code, count, gifts, pdf_key, letters, copy, marked, status, created_by, created_at) VALUES ('b1', 'new', '2026-10-12', 'X', 4, 9, 'k', '[]', '{}', 0, 'printing', 'Ada Admin', ?)", NOW);
    const admin = { ...WILL };
    const c = await T.navCounts(w.env, admin, access({ admin: true }));
    const cards = await T.waitingCards(w.env, admin, access({ admin: true }));
    assert.equal(c.receiptsLeft, cards.find((x) => x.id === 'receipts').n);
    assert.equal(c.receiptsLeft, 4, 'four receipts in the file');
    run(w, "UPDATE rcp_batches SET status = 'marking', marked = 5 WHERE id = 'b1'");
    const c2 = await T.navCounts(w.env, admin, access({ admin: true }));
    assert.equal(c2.receiptsLeft, 4, 'nine gifts, five marked');
    assert.equal(c2.receiptsLeft, (await T.waitingCards(w.env, admin, access({ admin: true }))).find((x) => x.id === 'receipts').n);
  });

  it('the Notes page lists the action items the Meetings card counts', async () => {
    const w = world();
    run(w, "INSERT INTO hub_meetings (id, title, host_email, access, status, created_at, started_at) VALUES ('m1', 'M', ?, 'staff', 'ended', ?, ?)", WILL.email, NOW, NOW);
    for (const i of [0, 1, 2]) run(w, "INSERT INTO hub_meeting_actions (meeting_id, idx, text, owner_name, owner_email, due, t, done) VALUES ('m1', ?, ?, 'V', ?, '', 0, 0)", i, 'Item ' + i, VIDEO.email);
    run(w, "INSERT INTO hub_meeting_actions (meeting_id, idx, text, owner_name, owner_email, due, t, done) VALUES ('ghost', 0, 'Orphan', 'V', ?, '', 0, 0)", VIDEO.email);
    run(w, "INSERT INTO hub_tasks (id, title, status, owner_email, meeting_id, meeting_action_idx, created_by, created_at, updated_at) VALUES ('mt', 'Item 1', 'open', ?, 'm1', 1, 'x', ?, ?)", VIDEO.email, NOW, NOW);
    const card = await P.openActionsWithoutTask(w.env, VIDEO.email);
    const req = new Request('https://hub.test/api/meet/meetings/actions', { headers: { 'X-Hub-Email': VIDEO.email, 'X-Hub-Name': VIDEO.name, 'X-Hub-Role': 'staff' } });
    const res = await MR.route({ request: req, env: { ...w.env, MEET_RELEASE: 'staff' }, params: { path: ['meetings', 'actions'] }, waitUntil: () => {} });
    const body = await res.json();
    const page = body.actions;
    assert.ok(page, JSON.stringify(body));
    assert.equal(card.n, 2, 'item 1 became a task, the orphan has no meeting');
    assert.equal(page.length, card.n);
  });

  it('an area badge is the sum of its pages, and the board Mine filter counts open requests only', () => {
    const layout = read('src/layouts/App.astro');
    assert.ok(!layout.includes('__hubTasks) || 0'), 'the Work area no longer adds request notices on top of its pages');
    assert.ok(!/id === 'work' && c\.dataset\.count/.test(layout), 'the Work area sums every page badge, not two of them');
    const board = read('public/js/requests-board.js');
    assert.match(board, /mine: \(i\) => t\(i\)\.owner === meEmail && i\.status !== 'done' && i\.status !== 'declined'/);
  });
});
