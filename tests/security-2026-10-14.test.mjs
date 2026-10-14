// Fixes from the 2026-10-14 security pass: cross-site writes refused, waiting-room guests see nothing, meeting chat links stay on
// Google Drive, push goes only to browser push services, HR cannot close an admin, a signed-in person files expenses as themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';

const { crossSiteWrite } = await import('../functions/_lib/session.ts');
const { validEndpoint } = await import('../functions/_lib/push.ts');
const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const req = (method, origin) => new Request('https://dash.favorintl.org/api/tasks', { method, headers: origin ? { Origin: origin } : {} });
const url = new URL('https://dash.favorintl.org/api/tasks');

test('a cookie write from another Favor site is refused, the same page and scripts pass', () => {
  assert.equal(crossSiteWrite(req('POST', 'https://www.favorintl.org'), url, 'google'), true);
  assert.equal(crossSiteWrite(req('DELETE', 'null'), url, 'google'), true);
  assert.equal(crossSiteWrite(req('POST', 'https://dash.favorintl.org'), url, 'google'), false);
  assert.equal(crossSiteWrite(req('POST'), url, 'google'), false);
  assert.equal(crossSiteWrite(req('GET', 'https://evil.example'), url, 'google'), false);
  assert.equal(crossSiteWrite(req('POST', 'https://evil.example'), url, 'agent'), false);
  assert.equal(crossSiteWrite(req('POST', 'https://evil.example'), url, 'device'), false);
  assert.equal(crossSiteWrite(req('POST', 'https://evil.example'), url, 'password'), true);
  assert.match(src('functions/_middleware.ts'), /if \(user && !open && crossSiteWrite\(request, url, user\.via\)\)/);
});

test('push subscriptions go only to browser push services', () => {
  assert.ok(validEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(validEndpoint('https://web.push.apple.com/QH1'));
  assert.ok(validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(validEndpoint('https://wns2-bl2p.notify.windows.com/w/?token=x'));
  assert.ok(!validEndpoint('https://evil.example/collect'));
  assert.ok(!validEndpoint('https://fcm.googleapis.com.evil.example/x'));
  assert.ok(!validEndpoint('http://fcm.googleapis.com/x'));
  assert.ok(!validEndpoint('https://fcm.googleapis.com:8443/x'));
});

test('a waiting guest gets no chat, people or captions, and cannot post or publish', () => {
  const s = src('functions/_lib/meetroute.ts');
  assert.match(s, /if \(me\.waiting && me\.role === 'guest'\) \{\n\s+return \{ ok: true, now, role: me\.role, people: \[\], lines: \[\], me: \{ waiting: true \}, events: \[\]/);
  const post = s.slice(s.indexOf('async function postEvent('), s.indexOf("if (kind === 'chat')"));
  assert.match(post, /if \(me\.waiting\) throw new HttpError\(403, 'waiting'/);
  const tracks = s.slice(s.indexOf('async function setTracks('), s.indexOf('async function setTracks(') + 400);
  assert.match(tracks, /if \(me\.waiting\) throw/);
});

test('a file in meeting chat links only to Google Drive or Docs', async () => {
  const { driveUrl } = await import('../functions/_lib/meetroute.ts');
  assert.equal(driveUrl('https://drive.google.com/file/d/1/view'), 'https://drive.google.com/file/d/1/view');
  assert.equal(driveUrl('https://docs.google.com/document/d/1'), 'https://docs.google.com/document/d/1');
  assert.equal(driveUrl('javascript:alert(1)'), '');
  assert.equal(driveUrl('https://drive.google.com.evil.example/x'), '');
  assert.ok(src('public/js/meet/room.js').includes("test(f.url || '') ? esc(f.url) : '#'"));
});

test('HR cannot close an admin or reopen an account an admin blocked', () => {
  const s = src('functions/_lib/onboard/run.ts');
  const close = s.slice(s.indexOf('export async function hubClose('), s.indexOf("await step('Block the FavorOS account'"));
  assert.match(close, /if \(!actor\.admin && \(await storedRole\(env, run\.email\)\)\.role === 'admin'\) throw/);
  const add = s.slice(s.indexOf('export async function hubAdd('), s.indexOf("await step('FavorOS account'"));
  assert.match(add, /if \(!actor\.admin && was\.blocked && !\/\^Left Favor\/\.test\(was\.note\)\)/);
});

test('a signed-in person files an expense under their own address, and the review link is never logged', () => {
  const s = src('functions/api/expenses/index.ts');
  assert.match(s, /const email = user && user\.via === 'google' \? user\.email : asTrimmed\(data\.email/);
  assert.doesNotMatch(s, /console\.log\([^)]*reviewUrl/);
});

test('field accounts watch a clip only when it is shared, and see no comments or viewers', () => {
  assert.match(src('functions/_lib/clips.ts'), /if \(user && user\.role !== 'field'\) return true;/);
  assert.match(src('functions/api/clips/[id]/info.ts'), /if \(user && user\.role !== 'field'\) \{/);
});

test('meeting links have a per-sender daily cap across meetings', async () => {
  const { SENDER_DAY_CAP } = await import('../functions/_lib/meetsend.ts');
  assert.equal(SENDER_DAY_CAP, 500);
  assert.match(src('functions/_lib/meetsend.ts'), /WHERE by_email = \? AND at > \?/);
});

test('every page carries HSTS and a frame-ancestors policy', () => {
  const h = src('public/_headers');
  assert.match(h, /Strict-Transport-Security: max-age=31536000/);
  assert.match(h, /Content-Security-Policy: frame-ancestors 'self'/);
});
