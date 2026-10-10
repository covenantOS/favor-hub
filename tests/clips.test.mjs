// Run with: npm test
// Clips: Range parsing, who may watch, and who may record.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

let lib;
let media;
before(async () => {
  lib = await import('../functions/_lib/clips.ts');
  media = (await import('../functions/api/clips/[id]/media.ts')).onRequestGet;
});

describe('parseRange', () => {
  it('reads open, closed and suffix ranges', () => {
    assert.deepEqual(lib.parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
    assert.deepEqual(lib.parseRange('bytes=900-', 1000), { start: 900, end: 999 });
    assert.deepEqual(lib.parseRange('bytes=-100', 1000), { start: 900, end: 999 });
    assert.deepEqual(lib.parseRange('bytes=10-5000', 1000), { start: 10, end: 999 });
  });
  it('refuses a range past the end and ignores a missing header', () => {
    assert.equal(lib.parseRange('bytes=1000-', 1000), 'bad');
    assert.equal(lib.parseRange(null, 1000), null);
  });
});

describe('ids and watching', () => {
  it('makes 128-bit hex ids', () => {
    const a = lib.clipId();
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.notEqual(a, lib.clipId());
  });
  it('lets a signed-in user watch and a signed-out one watch only when shared', () => {
    const signedIn = new Request('https://hub.test/', { headers: { 'X-Hub-Email': 'ada@favorintl.org' } });
    const out = new Request('https://hub.test/');
    assert.equal(lib.mayWatch(signedIn, { share: 0 }), true);
    assert.equal(lib.mayWatch(out, { share: 0 }), false);
    assert.equal(lib.mayWatch(out, { share: 1 }), true);
  });
  it('only admins record', () => {
    const staff = new Request('https://hub.test/', { headers: { 'X-Hub-Email': 'ada@favorintl.org', 'X-Hub-Role': 'staff' } });
    const admin = new Request('https://hub.test/', { headers: { 'X-Hub-Email': 'will@favorintl.org', 'X-Hub-Role': 'admin' } });
    assert.equal(lib.adminOrError(staff).res.status, 403);
    assert.equal(lib.adminOrError(new Request('https://hub.test/')).res.status, 401);
    assert.equal(lib.adminOrError(admin).user.email, 'will@favorintl.org');
  });
});

describe('media route', () => {
  const id = 'a'.repeat(32);
  const clip = (share) => ({ id, status: 'ready', share, mime: 'video/webm' });
  const env = (share) => ({
    DB: { prepare: () => ({ bind: () => ({ first: async () => clip(share) }) }) },
    CLIPS: {
      head: async () => ({ size: 100, httpEtag: '"x"' }),
      get: async (_k, o) => ({ body: o && o.range ? 'x'.repeat(o.range.length) : 'x'.repeat(100) }),
    },
  });
  const call = (share, headers = {}) => media({ request: new Request('https://hub.test/api/clips/' + id + '/media', { headers }), env: env(share), params: { id } });
  it('refuses signed-out viewers when sharing is off, with no caching', async () => {
    const res = await call(0);
    assert.equal(res.status, 401);
    assert.match(res.headers.get('Cache-Control'), /no-store/);
  });
  it('streams a range to a signed-out viewer when sharing is on', async () => {
    const res = await call(1, { Range: 'bytes=10-19' });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('Content-Range'), 'bytes 10-19/100');
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  });
});
