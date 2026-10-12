// The FavorOS Tester: the session route needs the agent key and is logged, the tester is left out of lists, and its writes to
// Blackbaud, email and staff are refused. A stand-in database records statements; nothing live is touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
const { TESTER_EMAIL, isTester, notTesterSql, testerWriteBlocked, withoutTester } = await import('../functions/_lib/testuser.ts');
const { onRequestPost } = await import('../functions/api/admin/test-session.ts');
const seed = await import('../functions/api/admin/test-seed.ts');

function db() {
  const log = [];
  return {
    log,
    prepare(sql) {
      return { bind: (...a) => ({ run: async () => { log.push({ sql, a }); return { meta: {} }; }, first: async () => null, all: async () => ({ results: [] }) }) };
    },
  };
}
const post = (env, key) => onRequestPost({ request: new Request('https://dash.test/api/admin/test-session', { method: 'POST', headers: key ? { Authorization: 'Bearer ' + key } : {} }), env });

test('the test session is refused without the agent key and logged', async () => {
  const env = { DB: db(), AGENT_API_KEY: 'k-123' };
  assert.equal((await post(env, '')).status, 403);
  assert.equal((await post(env, 'wrong')).status, 403);
  assert.ok(env.DB.log.some((l) => /hub_auth_log/.test(l.sql) && l.a.includes('test_session_refused')));
  assert.ok(!env.DB.log.some((l) => /hub_sessions/.test(l.sql)));
});

test('the agent key gets a session cookie for the tester, an audit row and the tester cookie', async () => {
  const env = { DB: db(), AGENT_API_KEY: 'k-123' };
  const res = await post(env, 'k-123');
  assert.equal(res.status, 200);
  const cookies = res.headers.getSetCookie().join(' ');
  assert.match(cookies, /favor_hub_session=/);
  assert.ok(env.DB.log.some((l) => /hub_users/.test(l.sql) && l.a.includes(TESTER_EMAIL)));
  assert.ok(env.DB.log.some((l) => /hub_hr/.test(l.sql)));
  assert.ok(env.DB.log.some((l) => /hub_auth_log/.test(l.sql) && l.a.includes('test_session')));
});

test('no agent key configured means nobody gets a session', async () => {
  assert.equal((await post({ DB: db() }, 'anything')).status, 403);
});

test('writes to Blackbaud, mail, requests and meetings are refused for the tester only', () => {
  assert.equal(testerWriteBlocked(TESTER_EMAIL, 'POST', '/api/work/actions'), true);
  assert.equal(testerWriteBlocked(TESTER_EMAIL, 'POST', '/api/gift-entry/deposits/gd_1/send'), true);
  assert.equal(testerWriteBlocked(TESTER_EMAIL, 'POST', '/api/requests'), true);
  assert.equal(testerWriteBlocked(TESTER_EMAIL, 'POST', '/api/requests/route'), false, 'autofill reads only');
  assert.equal(testerWriteBlocked(TESTER_EMAIL, 'POST', '/api/work/calls/preview'), false);
  assert.equal(testerWriteBlocked(TESTER_EMAIL, 'GET', '/api/work/actions'), false);
  assert.equal(testerWriteBlocked(TESTER_EMAIL, 'POST', '/api/meet/meetings'), false, 'a start-now meeting alone is allowed');
  assert.equal(testerWriteBlocked(TESTER_EMAIL, 'POST', '/api/meet/meetings/abc/invite'), true);
  assert.equal(testerWriteBlocked(TESTER_EMAIL, 'POST', '/api/chat/post'), false);
  assert.equal(testerWriteBlocked('will@favorintl.org', 'POST', '/api/work/actions'), false);
});

test('the tester is left out of lists', () => {
  assert.ok(isTester(' Tester@FavorIntl.org '));
  assert.deepEqual(withoutTester([{ email: 'a@x.org' }, { email: TESTER_EMAIL }, { id: TESTER_EMAIL }]).length, 1);
  assert.match(notTesterSql('u.email'), /lower\(u\.email\) NOT IN \('tester@favorintl\.org'/);
});

test('Tester Two gets a session of its own, and both testers are left out of lists', async () => {
  const env = { DB: db(), AGENT_API_KEY: 'k-123' };
  const res = await onRequestPost({ request: new Request('https://dash.test/api/admin/test-session?who=two', { method: 'POST', headers: { Authorization: 'Bearer k-123' } }), env });
  assert.equal((await res.json()).user.email, 'tester2@favorintl.org');
  assert.ok(env.DB.log.some((l) => /hub_users/.test(l.sql) && l.a.includes('tester@favorintl.org')), 'both testers are made');
  assert.ok(isTester('tester2@favorintl.org'));
  assert.match(notTesterSql('u.email'), /tester2@favorintl\.org/);
});

test('the seed needs the agent key', async () => {
  const res = await seed.onRequestPost({ request: new Request('https://dash.test/api/admin/test-seed', { method: 'POST' }), env: { DB: db(), AGENT_API_KEY: 'k-123' } });
  assert.equal(res.status, 403);
});
