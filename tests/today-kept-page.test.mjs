// Today's kept page (public/sw.js) is tied to the signed-in session by the hub_who cookie (functions/_lib/session.ts).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';

const { hubWho, hubWhoCookie, clearHubWhoCookie, whoCookieFor } = await import('../functions/_lib/session.ts');
const req = (cookie) => new Request('https://dash.favorintl.org/', { headers: cookie ? { Cookie: cookie } : {} });

describe('hub_who', () => {
  it('names a session without exposing its token, and differs per session', async () => {
    const a = await hubWho('a'.repeat(64));
    const b = await hubWho('b'.repeat(64));
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.notEqual(a, b);
    assert.ok(!a.includes('aaaa'));
  });
  it('is readable by the service worker (not HttpOnly) and is dropped on sign-out', async () => {
    assert.ok(!(await hubWhoCookie('t')).includes('HttpOnly'));
    assert.ok(clearHubWhoCookie().includes('Max-Age=0'));
  });
  it('is set only when it does not already name the request\'s session', async () => {
    const token = 'c'.repeat(64);
    const who = await hubWho(token);
    assert.equal(await whoCookieFor(req('')), null);
    assert.ok((await whoCookieFor(req('favor_hub_session=' + token))).includes('hub_who=' + who));
    assert.equal(await whoCookieFor(req(`favor_hub_session=${token}; hub_who=${who}`)), null);
    assert.ok((await whoCookieFor(req(`favor_hub_session=${token}; hub_who=0000000000000000`))).includes('hub_who=' + who));
  });
});

describe('service worker kept Today', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  it('keeps and serves a page only under the person\'s hub_who, and forgets it with everything else on sign-out', () => {
    assert.ok(sw.includes("cookie('hub_who')"));
    assert.ok(sw.includes("'/__today/' + who"));
    assert.ok(/forgetEverything[\s\S]{0,200}caches\.delete/.test(sw));
    assert.ok(sw.includes('TODAY, ') || sw.includes('TODAY,'), 'the Today cache survives activation cleanup');
  });
  it('serves a kept page only for "/" with no query and only while hub_web lists "/"', () => {
    assert.ok(sw.includes("url.pathname !== '/' || url.search"));
    assert.ok(sw.includes("routes.includes('/')"));
    assert.ok(sw.includes("off === '1'"));
  });
});
