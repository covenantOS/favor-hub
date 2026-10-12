// Pages hands /api/requests/route, /api/requests/marketing and /api/requests/<id>/attachments to the catch-all in
// functions/api/requests/[id]/[[task]].ts. On 2026-10-11 the catch-all answered 405 to them, so Continue on Make a request
// said "Not allowed." for everyone. Each address must reach its own file.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';

const { onRequest } = await import('../functions/api/requests/[id]/[[task]].ts');

const ctx = (method, id, task = []) => ({
  request: new Request('https://hub.test/api/requests/' + [id, ...task].join('/'), { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' }),
  env: {},
  params: { id, task },
  waitUntil: () => {},
});

const notTheCatchAll = async (res, what) => {
  const body = await res.clone().json().catch(() => ({}));
  assert.notEqual(body.error, 'method', what + ' was refused by the catch-all');
  assert.notEqual(res.status, 405, what + ' answered 405');
};

test('Make a request: the route address reaches its own file for POST and PUT', async () => {
  await notTheCatchAll(await onRequest(ctx('POST', 'route')), 'POST /api/requests/route');
  await notTheCatchAll(await onRequest(ctx('PUT', 'route')), 'PUT /api/requests/route');
});

test('the Marketing form address reaches its own file', async () => {
  await notTheCatchAll(await onRequest(ctx('POST', 'marketing')), 'POST /api/requests/marketing');
  await notTheCatchAll(await onRequest(ctx('GET', 'marketing')), 'GET /api/requests/marketing');
});

test('a request upload reaches the attachments file', async () => {
  await notTheCatchAll(await onRequest(ctx('POST', 'req_x', ['attachments'])), 'POST /api/requests/<id>/attachments');
});

test('a method no file takes on a request itself is still refused', async () => {
  const res = await onRequest(ctx('DELETE', 'req_x'));
  assert.equal(res.status, 405);
});
