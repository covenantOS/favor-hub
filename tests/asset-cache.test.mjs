// Run with: npm test
// Script and style caching: an address with the build stamp is kept a year, anything else keeps no-cache from _headers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const { withAssetCache } = await import('../functions/_lib/assetcache.ts');
const res = () => new Response('x', { headers: { 'Cache-Control': 'no-cache' } });
const cc = (u) => { const url = new URL('https://dash.favorintl.org' + u); return withAssetCache(res(), url.pathname, url).headers.get('Cache-Control'); };

describe('asset cache headers', () => {
  it('keeps a stamped script or style a year', () => {
    assert.equal(cc('/js/hub-nav.js?v=3&b=1791981954849'), 'public, max-age=31536000, immutable');
    assert.equal(cc('/css/dock-panel.css?b=1791981954849'), 'public, max-age=31536000, immutable');
    assert.equal(cc('/_astro/break-ui.CoTDCUza.css'), 'public, max-age=31536000, immutable');
  });
  it('leaves an unstamped address alone', () => {
    assert.equal(cc('/js/dock-panel.js?v=4'), 'no-cache');
    assert.equal(cc('/js/hub-nav.js'), 'no-cache');
    assert.equal(cc('/js/hub-nav.js?b=abc'), 'no-cache');
    assert.equal(cc('/images/favor-icon.png?b=1'), 'no-cache');
  });
  it('the build stamps every script and style tag', () => {
    const src = readFileSync(new URL('../scripts/stamp-build.mjs', import.meta.url), 'utf8');
    assert.match(src, /\(\?:js\|css\)/);
  });
});
