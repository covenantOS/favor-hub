// Run with: npm test
// Clips: a recording whose recorder window closed is finished from whole parts plus tail pieces.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const PART = 8 * 1024 * 1024;
let tail;

/** A small R2 stand-in: list, get, delete and a multipart upload that remembers each part's bytes. */
function fakeEnv(tailPieces) {
  const objects = new Map(tailPieces.map(([off, bytes]) => [`clips/c1/tail/${String(off).padStart(12, '0')}`, bytes]));
  const uploaded = [];
  return {
    uploaded,
    CLIPS: {
      async list({ prefix }) {
        return { objects: [...objects].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.byteLength })), truncated: false };
      },
      async get(key) {
        const v = objects.get(key);
        return v ? { arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) } : null;
      },
      async delete(keys) {
        for (const k of [].concat(keys)) objects.delete(k);
      },
      resumeMultipartUpload() {
        return {
          async uploadPart(n, data) {
            uploaded.push({ n, bytes: new Uint8Array(data) });
            return { etag: `e${n}` };
          },
        };
      },
    },
  };
}

const bytes = (n, fill) => new Uint8Array(n).fill(fill);

before(async () => {
  tail = await import('../functions/_lib/clipTail.ts');
});

describe('contiguous', () => {
  it('keeps parts 1..k and drops everything after a gap', () => {
    const parts = [{ n: 1, etag: 'a', size: 1 }, { n: 2, etag: 'b', size: 1 }, { n: 4, etag: 'd', size: 1 }];
    assert.deepEqual(tail.contiguous(parts).map((p) => p.n), [1, 2]);
    assert.deepEqual(tail.contiguous([{ n: 2, etag: 'b', size: 1 }]), []);
  });
});

describe('foldTail', () => {
  it('adds the bytes after the stored parts as new parts, trimming overlap', async () => {
    const env = fakeEnv([[PART - 100, bytes(300, 1)], [PART + 200, bytes(500, 2)]]);
    const out = await tail.foldTail(env, 'c1', 'u', [{ n: 1, etag: 'p1', size: PART }]);
    assert.equal(out.length, 2);
    assert.equal(out[1].size, 700);
    assert.equal(env.uploaded[0].bytes[0], 1);
    assert.equal(env.uploaded[0].bytes[199], 1);
    assert.equal(env.uploaded[0].bytes[200], 2);
  });
  it('stops at a gap between pieces', async () => {
    const env = fakeEnv([[0, bytes(100, 1)], [300, bytes(100, 2)]]);
    const out = await tail.foldTail(env, 'c1', 'u', []);
    assert.equal(out.length, 1);
    assert.equal(out[0].size, 100);
  });
  it('changes nothing when the stored parts already cover the tail', async () => {
    const env = fakeEnv([[0, bytes(100, 1)]]);
    const parts = [{ n: 1, etag: 'p1', size: PART }];
    assert.deepEqual(await tail.foldTail(env, 'c1', 'u', parts), parts);
    assert.equal(env.uploaded.length, 0);
  });
  it('splits a long tail into whole 8 MiB parts and a remainder', async () => {
    const env = fakeEnv([[0, bytes(PART + 10, 3)]]);
    const out = await tail.foldTail(env, 'c1', 'u', []);
    assert.deepEqual(out.map((p) => p.size), [PART, 10]);
  });
});
