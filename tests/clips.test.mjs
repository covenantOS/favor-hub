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
  const envWith = (blocked) => ({ DB: { prepare: () => ({ bind: () => ({ first: async () => (blocked === null ? null : { blocked }) }) }) } });
  it('lets a signed-in user watch and a signed-out one watch only when shared', async () => {
    const signedIn = new Request('https://hub.test/', { headers: { 'X-Hub-Email': 'ada@favorintl.org' } });
    const out = new Request('https://hub.test/');
    const mine = { owner_email: 'owner@favorintl.org' };
    assert.equal(await lib.canWatch(envWith(0), signedIn, { ...mine, share: 0 }), true);
    assert.equal(await lib.canWatch(envWith(0), out, { ...mine, share: 0 }), false);
    assert.equal(await lib.canWatch(envWith(0), out, { ...mine, share: 1 }), true);
  });
  it('stops a shared link for outsiders when the person who made the clip is blocked from the hub', async () => {
    const out = new Request('https://hub.test/');
    const signedIn = new Request('https://hub.test/', { headers: { 'X-Hub-Email': 'ada@favorintl.org' } });
    assert.equal(await lib.canWatch(envWith(1), out, { owner_email: 'gone@favorintl.org', share: 1 }), false);
    assert.equal(await lib.canWatch(envWith(1), signedIn, { owner_email: 'gone@favorintl.org', share: 1 }), true);
  });
  it('every signed-in person records, a signed-out one does not', () => {
    const staff = new Request('https://hub.test/', { headers: { 'X-Hub-Email': 'ada@favorintl.org', 'X-Hub-Role': 'staff' } });
    assert.equal(lib.staffOrError(staff).user.email, 'ada@favorintl.org');
    assert.equal(lib.staffOrError(new Request('https://hub.test/')).res.status, 401);
  });
  it('a person manages only their own clips; an admin may also delete any', async () => {
    const row = { id: 'c'.repeat(32), owner_email: 'owner@favorintl.org', status: 'ready' };
    const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => row }) }) } };
    const user = (email, role) => ({ email, name: email, role, picture: '', via: 'google', kpi: true });
    assert.ok(await lib.manageClip(env, user('owner@favorintl.org', 'staff'), row.id));
    assert.equal(await lib.manageClip(env, user('ada@favorintl.org', 'staff'), row.id), null);
    assert.equal(await lib.manageClip(env, user('will@favorintl.org', 'admin'), row.id), null);
    assert.ok(await lib.manageClip(env, user('will@favorintl.org', 'admin'), row.id, { allowAdmin: true }));
    assert.equal(await lib.manageClip(env, user('ada@favorintl.org', 'staff'), row.id, { allowAdmin: true }), null);
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

describe('watch data for each kind of viewer', () => {
  let info;
  let comments;
  before(async () => {
    info = (await import('../functions/api/clips/[id]/info.ts')).onRequestGet;
    comments = (await import('../functions/api/clips/[id]/comments.ts')).onRequestPost;
  });
  const id = 'b'.repeat(32);
  const row = (share, status = 'ready') => ({ id, title: 'T', summary: 'S', status, share, mime: 'video/webm', kind: 'screen', owner_email: 'owner@favorintl.org', owner_name: 'Owner', duration_ms: 12000, size_bytes: 1, has_poster: 0, views: 3, created_at: '2026-10-10T12:00:00Z', chapters: '[{"at":0,"title":"Start"}]', transcript: '[{"s":0,"e":2,"t":"Hello"}]', words: '[]', edits: '{}', help_draft: 'draft', error: null });
  const env = (share, status) => ({
    DB: {
      prepare: (sql) => ({
        bind: () => ({
          first: async () => row(share, status),
          all: async () => ({ results: /hub_clip_views/.test(sql) ? [{ person_email: 'ada@favorintl.org', person_name: 'Ada', at: '2026-10-10T13:00:00Z', seconds: 5 }, { person_email: 'owner@favorintl.org', person_name: 'Owner', at: '2026-10-10T13:00:00Z', seconds: 9 }] : [] }),
          run: async () => ({}),
        }),
      }),
    },
  });
  const call = (share, headers = {}, status) => info({ request: new Request('https://hub.test/api/clips/' + id + '/info', { headers }), env: env(share, status), params: { id } });
  const staff = { 'X-Hub-Email': 'ada@favorintl.org', 'X-Hub-Name': 'Ada', 'X-Hub-Role': 'staff' };
  const admin = { 'X-Hub-Email': 'will@favorintl.org', 'X-Hub-Name': 'Will', 'X-Hub-Role': 'admin' };

  it('refuses a signed-out viewer when sharing is off', async () => {
    const res = await call(0);
    assert.equal(res.status, 401);
    assert.match(res.headers.get('Cache-Control'), /no-store/);
  });
  it('gives a signed-out viewer through the link the words and nothing private', async () => {
    const res = await call(1);
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.clip.transcript[0].t, 'Hello');
    assert.equal(d.clip.chapters[0].title, 'Start');
    assert.equal(d.comments, undefined);
    assert.equal(d.viewers, undefined);
    assert.equal(d.can, undefined);
    assert.equal(d.helpDraft, undefined);
  });
  it('gives staff comments, reactions and viewers (the owner is not a viewer) but no manage rights', async () => {
    const d = await (await call(0, staff)).json();
    assert.deepEqual(d.viewers.map((v) => v.email), ['ada@favorintl.org']);
    assert.equal(d.can.edit, false);
    assert.equal(d.helpDraft, undefined);
  });
  const owner = { 'X-Hub-Email': 'owner@favorintl.org', 'X-Hub-Name': 'Owner', 'X-Hub-Role': 'staff' };
  it('gives the person who made the clip the manage rights and the help article draft', async () => {
    const d = await (await call(0, owner)).json();
    assert.equal(d.can.edit, true);
    assert.equal(d.can.delete, true);
    assert.equal(d.helpDraft, 'draft');
  });
  it('gives an admin who did not make the clip a delete button and nothing else', async () => {
    const d = await (await call(0, admin)).json();
    assert.equal(d.can.edit, false);
    assert.equal(d.can.delete, true);
    assert.equal(d.helpDraft, undefined);
  });
  it('shows a clip that is still being named', async () => {
    const res = await call(0, staff, 'processing');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).clip.status, 'processing');
  });
  it('hides a clip that is still uploading', async () => {
    const res = await call(1, staff, 'uploading');
    assert.equal(res.status, 404);
  });
  it('lets only signed-in staff comment', async () => {
    const post = (headers) => comments({ request: new Request('https://hub.test/api/clips/' + id + '/comments', { method: 'POST', headers, body: JSON.stringify({ at: 3, text: 'hi' }) }), env: env(1), params: { id } });
    assert.equal((await post({})).status, 401);
    assert.equal((await post(staff)).status, 200);
  });
});
