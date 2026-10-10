// Run with: npm test
//
// copyTime() reads the last complete sync of the Blackbaud copy (sync_log, table __complete__) from
// the mirror, and returns it as ISO UTC for the "As of" stamps. The mirror is a stand-in here: the
// fetch is mocked, so the test checks the SQL that goes out, the ISO conversion, and the empty
// answer when the mirror is down or has no complete sync on record.
import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';
import './support/resolve-ts.mjs';

const MIRROR_URL = 'https://mirror.test/d1/query';
const env = { MIRROR_API_KEY: 'test-mirror-key', MIRROR_QUERY_URL: MIRROR_URL };
let copyTime;
let reply;
let posted = [];

before(async () => {
  ({ copyTime } = await import('../functions/_lib/hub/copy-time.ts'));
  mock.method(globalThis, 'fetch', async (url, init = {}) => {
    posted.push({ url: String(url), body: JSON.parse(init.body || '{}') });
    return reply();
  });
});

after(() => mock.restoreAll());

describe('copyTime', () => {
  it('reads the latest complete sync from sync_log and returns it as ISO UTC', async () => {
    posted = [];
    reply = () => new Response(JSON.stringify([{ at: '2026-10-10 09:03:11' }]), { status: 200 });
    const at = await copyTime(env);
    assert.equal(at, '2026-10-10T09:03:11Z');
    assert.equal(posted.length, 1);
    assert.equal(posted[0].url, MIRROR_URL);
    assert.match(posted[0].body.sql, /sync_log/);
    assert.match(posted[0].body.sql, /__complete__/);
    assert.match(posted[0].body.sql, /sync_status = 'success'/);
    assert.doesNotMatch(posted[0].body.sql, /insert|update|delete|drop|alter|create/i);
  });

  it('keeps a time that already carries a T and a zone', async () => {
    reply = () => new Response(JSON.stringify([{ at: '2026-10-10T13:03:11Z' }]), { status: 200 });
    assert.equal(await copyTime(env), '2026-10-10T13:03:11Z');
  });

  it('returns an empty value when the mirror has no complete sync on record', async () => {
    reply = () => new Response(JSON.stringify([{ at: null }]), { status: 200 });
    assert.equal(await copyTime(env), '');
  });

  it('returns an empty value when the mirror is down, so the stamps stay hidden', async () => {
    reply = () => new Response('unavailable', { status: 503 });
    assert.equal(await copyTime(env), '');
  });
});
