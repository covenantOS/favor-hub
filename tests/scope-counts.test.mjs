// Run with: npm test
// Per-person scoping (Will, 2026-10-13: "I have 223 current open things for me to do supposedly. But I don't."). A number beside a menu entry
// counts work assigned to the signed-in person or waiting on them personally. Being an admin adds nothing. Made-up people and ids only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { learnWorld } from './support/learn-world.mjs';
import { WILL, VIDEO, NOW } from './support/request-world.mjs';
import './support/resolve-ts.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const run = (w, sql, ...a) => w.d1.db.prepare(sql).run(...a);
let M, T, H;

const row = (id, fundraisers) => ({ id, due: '2026-10-01', fundraisers, holders: [], pending: null, deceased: false, ty: false });
const scope = (role, fid, fids = []) => ({ role, email: 'x@example.org', name: 'X', fid, team: '', all: role === 'admin', fids: new Set(fid ? [fid, ...fids] : fids) });
const board = [row('1', ['501']), row('2', ['502']), row('3', []), row('4', ['501', '502']), row('5', ['503'])];

before(async () => {
  M = await import('../functions/_lib/work/mine.ts');
  T = await import('../functions/_lib/hub/today.ts');
  H = await import('../functions/_lib/work/home.ts');
});

describe('which actions count toward a person', () => {
  it('an admin with no book of their own counts nothing, however much the board holds', () => {
    assert.equal(M.badgeRows(scope('admin', null), board).length, 0);
  });
  it('a director counts the actions that list them and no one else', () => {
    assert.deepEqual(M.badgeRows(scope('director', '501'), board).map((r) => r.id), ['1', '4']);
  });
  it('Partner Care counts its own actions, not the team', () => {
    assert.deepEqual(M.badgeRows(scope('partner_care', '502', ['503']), board).map((r) => r.id), ['2', '4']);
  });
  it('Support counts its own plus the actions with no owner, which is its lane', () => {
    assert.deepEqual(M.badgeRows(scope('support', '503'), board).map((r) => r.id), ['3', '5']);
    assert.deepEqual(M.badgeRows(scope('support', null), board).map((r) => r.id), ['3']);
  });
  it('a director never counts the unassigned actions', () => {
    assert.ok(!M.badgeRows(scope('director', '501'), board).some((r) => r.id === '3'));
  });
});

describe('which gifts owed a thank-you count toward a person', () => {
  it('own partners only, except Partner Care, which shares its team partners', () => {
    assert.equal(M.ownsGift(scope('director', '501'), ['501']), true);
    assert.equal(M.ownsGift(scope('director', '501'), ['502']), false);
    assert.equal(M.ownsGift(scope('admin', null), ['501']), false);
    assert.equal(M.ownsGift(scope('support', '503', ['501', '502']), ['501']), false, 'Support can read the directors gifts but does not owe them');
    assert.equal(M.ownsGift(scope('partner_care', '502', ['503']), ['503']), true);
  });
});

describe('the Today work card follows the same rule', () => {
  const b = { rows: board, people: {}, synced: '', orphans: 0, today: '2026-10-11' };
  it('lists only the own actions of the person and is never the whole portfolio', () => {
    const due = H.duePool({ scope: scope('director', '501') }, b);
    assert.deepEqual(due.pool.map((r) => r.id), ['1', '4']);
    assert.equal(due.portfolio, false);
  });
  it('an admin with no book sees an empty card, not the board', () => {
    const due = H.duePool({ scope: scope('admin', null) }, b);
    assert.equal(due.pool.length, 0);
    assert.equal(due.portfolio, false);
  });
});

const world = () => {
  const w = learnWorld({ learn: 'staff' });
  w.d1.exec(read('db/receipts.sql'));
  w.d1.exec(read('db/expenses.sql'));
  return w;
};
const access = (over = {}) => ({ admin: false, kpi: true, approver: false, workCenter: false, meetings: true, chat: true, tasks: true, learn: true, mail: false, ...over });

describe('menu counts that need the database', () => {
  it('Receipts counts for the person who made the print file, not for every admin', async () => {
    const w = world();
    run(w, "INSERT INTO rcp_batches (id, kind, letter_date, appeal_code, count, gifts, pdf_key, letters, copy, marked, status, created_by, created_at) VALUES ('b1', 'new', '2026-10-12', 'X', 55, 56, 'k', '[]', '{}', 0, 'printing', 'Mia Maker', ?)", NOW);
    const admin = { ...WILL, name: 'Will Example', role: 'admin' };
    assert.equal((await T.navCounts(w.env, admin, access({ admin: true }))).receiptsLeft, 0, 'an admin who did not make the file');
    assert.equal((await T.waitingCards(w.env, admin, access({ admin: true }))).some((c) => c.id === 'receipts'), false, 'and the bell and Today agree');
    const maker = { ...VIDEO, name: 'Mia Maker', role: 'staff' };
    assert.equal((await T.navCounts(w.env, maker, access())).receiptsLeft, 55);
    run(w, "UPDATE rcp_batches SET created_by = 'Mia' WHERE id = 'b1'");
    assert.equal((await T.navCounts(w.env, maker, access())).receiptsLeft, 55, 'a first name is enough, as the page records it');
  });

  it('Expenses counts the requests that name this person as approver', async () => {
    const w = world();
    run(w, "UPDATE expense_settings SET approver_email = 'a@favorintl.org' WHERE id = 1");
    const ins = (id, approver) =>
      run(w, "INSERT INTO expense_requests (id, doc_number, status, requester_name, requester_email, reason, total_cents, approver_name, approver_email, requester_signature, review_token_hash, submitted_at, created_at, updated_at) VALUES (?, ?, 'pending', 'R', 'r@favorintl.org', 'why', 1000, 'N', ?, 's', ?, ?, ?, ?)", id, id, approver, id, NOW, NOW, NOW);
    ins('e1', 'b@favorintl.org,c@favorintl.org');
    ins('e2', 'b@favorintl.org');
    assert.equal((await T.expensesWaitingFor(w.env, 'b@favorintl.org')).n, 2);
    assert.equal((await T.expensesWaitingFor(w.env, 'c@favorintl.org')).n, 1);
    assert.equal((await T.expensesWaitingFor(w.env, 'd@favorintl.org')).n, 0);
  });

  it('a live room open to all staff does not add to everyone Meetings number', async () => {
    const w = world();
    run(w, "INSERT INTO hub_meetings (id, title, host_email, access, invitees, status, created_at) VALUES ('open', 'M', ?, 'staff', '[]', 'live', ?)", WILL.email, NOW);
    run(w, "INSERT INTO hub_meeting_presence (meeting_id, pid, email, name, role, joined_at, seen, left_at, removed, waiting) VALUES ('open', 'p1', ?, 'P', 'host', ?, ?, 0, 0, 0)", WILL.email, Date.now(), Date.now());
    assert.equal(await T.liveMeetingsFor(w.env, VIDEO.email), 0);
    assert.equal(await T.liveMeetingsFor(w.env, WILL.email), 1);
  });

  it('an admin Requests number is the inbox they triage plus their own notices, and nothing of other people', async () => {
    const w = world();
    run(w, "INSERT INTO requests (id, title, body, surface, status, submitter_name, submitter_email, source, created_at, updated_at) VALUES ('q1', 'T', 'b', 'website', 'inbox', 'A', 'a@favorintl.org', 'form', ?, ?)", NOW, NOW);
    run(w, "INSERT INTO requests (id, title, body, surface, status, submitter_name, submitter_email, source, created_at, updated_at) VALUES ('q2', 'T', 'b', 'website', 'approved', 'A', 'a@favorintl.org', 'form', ?, ?)", NOW, NOW);
    run(w, "INSERT INTO request_notices (request_id, email, kind, actor_email, actor_name, note, created_at) VALUES ('q2', 'someone@favorintl.org', 'comment', 'x@favorintl.org', 'X', 'n', ?)", NOW);
    const c = await T.navCounts(w.env, { ...WILL, role: 'admin' }, access({ admin: true }));
    assert.equal(c.board, 1);
    assert.equal(c.tasks, 0);
  });
});
