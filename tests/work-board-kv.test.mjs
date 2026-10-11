// Run with: npm test
//
// The shaped board is kept in KV for a minute so a tab opened in another server instance skips the mirror read. Made-up data only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const repoMod = await import('../functions/_lib/work/repo.ts');
const fakeKv = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; };
const data = { rows: [{ id: '1' }, { id: '2' }], people: {}, synced: '2026-10-09T09:00:00Z', orphans: 0 };

describe('board KV copy', () => {
  it('reads the mirror once, then serves the copy from KV in a new instance, with the same rows', async () => {
    const kv = fakeKv(); let reads = 0;
    const repo = { async loadBoard() { reads++; return data; } };
    await repoMod.forgetBoard();
    const a = await repoMod.boardData(repo, '2026-10-11', [], kv);
    await repoMod.forgetBoard(); // a different instance has no memory of its own
    const b = await repoMod.boardData(repo, '2026-10-11', [], kv);
    assert.equal(reads, 1);
    assert.deepEqual(b.rows, a.rows);
  });
  it('forgetting drops the KV copy', async () => {
    const kv = fakeKv(); let reads = 0;
    const repo = { async loadBoard() { reads++; return data; } };
    await repoMod.forgetBoard();
    await repoMod.boardData(repo, '2026-10-11', [], kv);
    await repoMod.forgetBoard(kv, '2026-10-11');
    await repoMod.boardData(repo, '2026-10-11', [], kv);
    assert.equal(reads, 2);
  });
});
