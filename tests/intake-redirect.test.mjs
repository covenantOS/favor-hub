// The old Requests addresses land on the new Projects views, and an old link to one request still opens that request.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';

const { REDIRECTS, AREAS, resolveNav } = await import('../src/data/areas.ts');
const mw = await import('../functions/_middleware.ts');

const go = async (url) => {
  const res = await mw.onRequest({ request: new Request(url), env: {}, next: async () => new Response('page'), waitUntil() {}, params: {}, data: {} });
  return { status: res.status, to: res.headers.get('location') };
};

test('the registry sends /requests and /requests/new to the Intake view and the composer', () => {
  const map = new Map(REDIRECTS);
  assert.equal(map.get('/requests'), '/projects/?tab=intake');
  assert.equal(map.get('/requests/new'), '/projects/?compose=1');
  assert.equal(map.get('/requests/board'), '/projects/?tab=intake');
  const hrefs = AREAS.flatMap((a) => a.pages).map((p) => p.href);
  assert.ok(!hrefs.includes('/requests/'), 'Requests is no longer a screen of its own');
  assert.equal(resolveNav('board').page.id, 'projects', 'the old pages still resolve their nav entry, under Projects');
  assert.equal(resolveNav('new').page.id, 'projects');
});

test('the middleware redirects the old addresses, with or without the trailing slash', async () => {
  assert.deepEqual(await go('https://dash.favorintl.org/requests/'), { status: 301, to: 'https://dash.favorintl.org/projects/?tab=intake' });
  assert.deepEqual(await go('https://dash.favorintl.org/requests'), { status: 301, to: 'https://dash.favorintl.org/projects/?tab=intake' });
  assert.deepEqual(await go('https://dash.favorintl.org/requests/new/'), { status: 301, to: 'https://dash.favorintl.org/projects/?compose=1' });
  assert.deepEqual(await go('https://dash.favorintl.org/requests/board'), { status: 301, to: 'https://dash.favorintl.org/projects/?tab=intake' });
});

test('an old link to one request opens that request in Projects', async () => {
  assert.deepEqual(await go('https://dash.favorintl.org/requests/?r=req_0a1b2c3d4e5f'), { status: 301, to: 'https://dash.favorintl.org/projects/?r=req_0a1b2c3d4e5f' });
  assert.deepEqual(await go('https://dash.favorintl.org/requests?r=req_0a1b2c3d4e5f'), { status: 301, to: 'https://dash.favorintl.org/projects/?r=req_0a1b2c3d4e5f' });
  // A request id is letters, digits, dash and underscore; anything else falls back to the Intake view and carries nothing over.
  const odd = await go('https://dash.favorintl.org/requests/?r=%3Cscript%3E');
  assert.equal(odd.to, 'https://dash.favorintl.org/projects/?tab=intake');
});
