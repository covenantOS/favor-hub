// Run with: npm test
// The data rules behind Today: which feedback rows are notes to read, and which lines Waiting on may show.
// Made-up people only; the database is an in-memory copy.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

let N, W, d1;
before(async () => {
  N = await import('../functions/_lib/hub/feedback-notes.ts');
  W = await import('../functions/_lib/integrations/waitrules.ts');
  d1 = memoryD1();
  d1.exec(`CREATE TABLE brain_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, email TEXT NOT NULL, name TEXT, source TEXT NOT NULL DEFAULT 'brain', rating TEXT, comment TEXT, status TEXT NOT NULL DEFAULT 'new');
    CREATE TABLE hub_users (email TEXT PRIMARY KEY, blocked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE hub_mailboxes (owner TEXT, mailbox TEXT, name TEXT, color TEXT, scopes TEXT, connected_at TEXT);`);
});

const ROWS = [
  ['ada@favorintl.org', 'wrong', 'The total on the gifts page is off.', true],
  ['ada@favorintl.org', 'unrouted', 'No answer matched this question', false],
  ['tester@favorintl.org', 'wrong', 'Tester wrote a comment', false],
  ['tester2@favorintl.org', null, 'Second tester', false],
  ['bo@favorintl.org', 'helpful', '', false],
  ['bo@favorintl.org', 'helpful', '   ', false],
  ['bo@favorintl.org', null, null, false],
  ['cy@favorintl.org', null, 'Please add a search box.', true],
];

describe('feedback notes', () => {
  it('counts only comments a person wrote, in SQL and in code', async () => {
    for (const [email, rating, comment] of ROWS) d1.db.prepare("INSERT INTO brain_feedback (at, email, rating, comment) VALUES ('2026-10-14', ?, ?, ?)").run(email, rating, comment);
    const n = d1.db.prepare(`SELECT COUNT(*) AS n FROM brain_feedback WHERE status = 'new' AND ${N.REAL_NOTE_SQL}`).get().n;
    assert.equal(n, ROWS.filter((r) => r[3]).length);
    for (const [email, rating, comment, keep] of ROWS) assert.equal(N.isRealNote({ email, rating, comment }), keep, `${email} ${rating} ${comment}`);
  });
  it('treats any tester@ address as a test account', () => {
    assert.equal(N.isRealNote({ email: 'tester3@favorintl.org', rating: null, comment: 'hi' }), false);
  });
});

describe('waiting on: who counts', () => {
  let self;
  before(() => { self = W.selfSet('will@favorintl.org', ['will@truecorp.example']); });
  it('knows the signed-in person by address, by connected mailbox, or by the Gmail label "me"', () => {
    assert.equal(W.isSelf({ email: 'WILL@favorintl.org', name: 'Will' }, self), true);
    assert.equal(W.isSelf({ email: 'will@truecorp.example', name: '' }, self), true);
    assert.equal(W.isSelf({ email: '', name: 'me' }, self), true);
    assert.equal(W.isSelf({ email: 'wiland@example.org', name: 'me' }, self), false);
    assert.equal(W.isSelf({ email: 'ada@favorintl.org', name: 'Ada' }, self), false);
  });
  it('skips "me" and picks the first other person, with the To: prefix removed', () => {
    const gone = new Set(['daniel@favorintl.org']);
    const t = W.waitTarget([{ name: 'me', email: 'will@favorintl.org' }, { name: 'Pat Wiland', email: 'pat@wiland.example' }], self, gone);
    assert.deepEqual(t, { email: 'pat@wiland.example', name: 'Pat Wiland' });
    assert.deepEqual(W.waitTarget([{ name: 'To: Pat Wiland', email: 'pat@wiland.example' }], self, gone), { email: 'pat@wiland.example', name: 'Pat Wiland' });
    assert.equal(W.waitTarget([{ name: 'me', email: 'will@favorintl.org' }], self, gone), null);
    assert.equal(W.waitTarget([], self, gone), null);
    assert.equal(W.waitTarget([{ name: 'Daniel Casella', email: 'daniel@favorintl.org' }], self, gone), null);
    // The wait moves to the next person when the first one has left.
    assert.equal(W.waitTarget([{ name: 'Daniel Casella', email: 'daniel@favorintl.org' }, { name: 'Ada', email: 'ada@favorintl.org' }], self, gone).email, 'ada@favorintl.org');
  });
  it('treats a blocked account, or a FavorOS account off the roster, as departed, and keeps outsiders and test accounts', () => {
    const users = [
      { email: 'ada@favorintl.org', blocked: 0 },
      { email: 'daniel@favorintl.org', blocked: 0 },
      { email: 'stephanie@favorintl.org', blocked: 1 },
      { email: 'tester@favorintl.org', blocked: 0 },
    ];
    const gone = W.departedSet(users, new Set(['ada@favorintl.org']));
    assert.deepEqual([...gone].sort(), ['daniel@favorintl.org', 'stephanie@favorintl.org']);
    assert.equal(gone.has('pat@wiland.example'), false);
    // A roster that could not be read leaves only blocked accounts out.
    assert.deepEqual([...W.departedSet(users, new Set())], ['stephanie@favorintl.org']);
    assert.deepEqual([...W.departedSet(users, null)], ['stephanie@favorintl.org']);
  });
  it('reads the account table and connected mailboxes from the database', async () => {
    d1.db.prepare("INSERT INTO hub_users VALUES ('ada@favorintl.org', 0), ('daniel@favorintl.org', 0), ('stephanie@favorintl.org', 1)").run();
    d1.db.prepare("INSERT INTO hub_mailboxes VALUES ('will@favorintl.org', 'info@favorintl.org', '', '', '', 'x')").run();
    const g = await W.guards({ DB: d1 }, 'will@favorintl.org', new Map([['ada@favorintl.org', 'Ada']]));
    assert.ok(g.self.has('info@favorintl.org') && g.self.has('will@favorintl.org'));
    assert.deepEqual([...g.gone].sort(), ['daniel@favorintl.org', 'stephanie@favorintl.org']);
  });
});

describe('waiting on: how old', () => {
  it('drops a wait older than the limit and keeps a question put to the person', () => {
    assert.equal(W.WAIT_MAX_DAYS, 14);
    assert.equal(W.keepWait({ dir: 'out', days: 14 }), true);
    assert.equal(W.keepWait({ dir: 'out', days: 15 }), false);
    assert.equal(W.keepWait({ dir: 'out', days: 19 }), false);
    assert.equal(W.keepWait({ dir: 'in', days: 30 }), true);
  });
});
