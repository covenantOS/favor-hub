// Run with: npm test (or node --test tests/wc-snap.test.mjs)
// The saved copy of the Work lists. A copy opens the page at once; it must never bring back an action the person finished, and Undo must
// bring the row back. Made-up ids only: the repository is public.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
await import('../public/js/wc-snap.js');
const Snap = globalThis.WCSnap;

const board = { rows: [{ id: '1' }, { id: '2' }, { id: '3' }], today: '2026-10-12' };
const ids = (rows) => rows.map((r) => r.id);
const T0 = 1_800_000_000_000;

beforeEach(() => mem.clear());

describe('saved copy of a list', () => {
  it('opens only for the person it was saved for', () => {
    Snap.save('board', 'Pat Smith', board, T0);
    assert.deepEqual(ids(Snap.load('board', 'Pat Smith', T0 + 1000).rows), ['1', '2', '3']);
    assert.equal(Snap.load('board', 'Lee Jones', T0 + 1000), null);
    assert.equal(Snap.load('board', '', T0 + 1000), null);
  });

  it('is dropped after 12 hours', () => {
    Snap.save('board', 'Pat Smith', board, T0);
    assert.ok(Snap.load('board', 'Pat Smith', T0 + Snap.MAX_AGE - 1));
    assert.equal(Snap.load('board', 'Pat Smith', T0 + Snap.MAX_AGE + 1), null);
  });

  it('a damaged copy reads as nothing', () => {
    mem.set('wcsnap:board', '{not json');
    assert.equal(Snap.load('board', 'Pat Smith', T0), null);
  });
});

describe('a completed action never comes back from a stale copy', () => {
  it('stays off the copy after the copy was saved before it was completed', () => {
    Snap.save('board', 'Pat Smith', board, T0);
    Snap.rememberGone(['2'], 'batch-a', T0 + 5000);
    const copy = Snap.load('board', 'Pat Smith', T0 + 6000);
    assert.deepEqual(ids(Snap.withoutGone(copy.rows, (r) => r.id, T0 + 6000)), ['1', '3']);
  });

  it('a whole batch stays off, and a second batch adds to it', () => {
    Snap.rememberGone(['1', '3'], 'batch-a', T0);
    Snap.rememberGone(['2'], 'batch-b', T0 + 1);
    assert.deepEqual(ids(Snap.withoutGone(board.rows, (r) => r.id, T0 + 2)), []);
  });

  it('Undo puts the row back on the copy at once, and only the undone batch', () => {
    Snap.rememberGone(['1'], 'batch-a', T0);
    Snap.rememberGone(['2'], 'batch-b', T0);
    Snap.forgetBatch('batch-a', T0 + 10);
    assert.deepEqual(ids(Snap.withoutGone(board.rows, (r) => r.id, T0 + 20)), ['1', '3']);
  });

  it('pressing Undo twice changes nothing more', () => {
    Snap.rememberGone(['2'], 'batch-a', T0);
    Snap.forgetBatch('batch-a', T0 + 1);
    Snap.forgetBatch('batch-a', T0 + 2);
    assert.deepEqual(ids(Snap.withoutGone(board.rows, (r) => r.id, T0 + 3)), ['1', '2', '3']);
  });

  it('an entry ends after 15 minutes, when the server list has had the change for a long time', () => {
    Snap.rememberGone(['2'], 'batch-a', T0);
    assert.deepEqual(ids(Snap.withoutGone(board.rows, (r) => r.id, T0 + 14 * 60000)), ['1', '3']);
    assert.deepEqual(ids(Snap.withoutGone(board.rows, (r) => r.id, T0 + 16 * 60000)), ['1', '2', '3']);
  });

  it('numbers and strings name the same action', () => {
    Snap.rememberGone([2], 'batch-a', T0);
    assert.deepEqual(ids(Snap.withoutGone([{ id: 2 }, { id: 3 }], (r) => r.id, T0 + 1)), [3]);
  });

  it('a thank-you press that saved two batches stays off the copy, and undoing either batch brings the gift back', () => {
    Snap.rememberGone(['g501', 'g502'], 'batch-a,batch-b', T0);
    assert.deepEqual(ids(Snap.withoutGone([{ id: 'g501' }, { id: 'g502' }, { id: 'g503' }], (r) => r.id, T0 + 1)), ['g503']);
    Snap.forgetBatch('batch-b', T0 + 2);
    assert.deepEqual(ids(Snap.withoutGone([{ id: 'g501' }, { id: 'g502' }], (r) => r.id, T0 + 3)), ['g501', 'g502']);
  });

  it('gift ids and action ids never collide', () => {
    Snap.rememberGone(['g7'], 'batch-a', T0);
    assert.deepEqual(ids(Snap.withoutGone([{ id: '7' }], (r) => r.id, T0 + 1)), ['7']);
  });
});
