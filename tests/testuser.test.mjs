// The FavorOS Tester: the session route needs the agent key and is logged, the tester is left out of lists, and its writes to
// Blackbaud, email and staff are refused. A stand-in database records statements; nothing live is touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
const { TESTER_EMAIL, isTester, notTesterSql, testerWriteBlocked, withoutTester } = await import('../functions/_lib/testuser.ts');
const { onRequestPost } = await import('../functions/api/admin/test-session.ts');

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
  assert.match(cookies, /hub_tester=1/);
  assert.ok(env.DB.log.some((l) => /hub_users/.test(l.sql) && l.a.includes(TESTER_EMAIL)));
  assert.ok(env.DB.log.some((l) => /hub_hr/.test(l.sql)));
  assert.ok(env.DB.log.some((l) => /hub_auth_log/.test(l.sql) && l.a.includes('test_session')));
});

test('no agent key configured means nobody gets a session', async () => {
  assert.equal((await post({ DB: db() }, 'anything')).status, 403);
});

test('writes to Blackbaud, mail, requests and meetings are refused for the tester only', () => {
  assert.equal(testerWriteBlocked(TESTER_EMAIL, 'POST', '/api/work/actions'), true);
  assert.equal(testerWriteBlocked(TESTER_EMAIL, 'POST', '/api/gift-entry/gifts'), true);
  assert.equal(testerWriteBlocked(TESTER_EMAIL, 'POST', '/api/requests/route'), true);
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
  assert.match(notTesterSql('u.email'), /lower\(u\.email\) <> 'tester@favorintl\.org'/);
});
