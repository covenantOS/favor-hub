// The KPI dashboard in the web app (web/src/features/dashboard): which dashboard page an address asks for, which menu entry it belongs to,
// the frame's address, and the hand-off rules for the one full-load page that has a web route plus the files that stay Pages endpoints.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const P = await import('../web/src/features/dashboard/pages.ts');
const { webServes, STAY_PAGES } = await import('../shared/web.ts');
const { decideWeb } = await import('../functions/_lib/web.ts');
const { resetHubCache } = await import('../functions/_lib/admin/hubcache.ts').catch(() => ({}));

describe('which dashboard page an address asks for', () => {
  it('no page, a bad page and a page that leaves the dashboard are the Executive page', () => {
    for (const bad of [undefined, null, '', 'rdds', '//evil.example', '/a b', '/x#y', '/..%2f', '/a/../b', 5, {}, '/a' + String.fromCharCode(92) + 'b']) assert.equal(P.pageOf(bad), '/', String(bad));
  });
  it('keeps a page and its query', () => {
    assert.equal(P.pageOf('/rdds'), '/rdds');
    assert.equal(P.pageOf('/rdds/12?tab=gifts&x=1'), '/rdds/12?tab=gifts&x=1');
  });
  it('the hub address of a page is the one the menu links to', () => {
    assert.equal(P.hubHref('/'), '/dashboard/');
    assert.equal(P.hubHref('/rdds'), '/dashboard/?page=%2Frdds');
    for (const e of P.KPI_ENTRIES) assert.equal(P.hubHref(e.kpiPage), e.id === 'kpi' ? '/dashboard/' : '/dashboard/?page=' + encodeURIComponent(e.kpiPage), e.id);
  });
  it('embeds with the right joiner', () => {
    assert.equal(P.withEmbed('/'), '/?embed=1');
    assert.equal(P.withEmbed('/pc?x=1'), '/pc?x=1&embed=1');
  });
});

describe('the menu entry a dashboard page belongs to', () => {
  it('Executive, each team and Definitions have their own', () => {
    assert.deepEqual(P.KPI_ENTRIES.map((e) => e.kpiPage), ['/', '/rdds', '/pc', '/ce', '/grants', '/marketing', '/definitions']);
    assert.equal(P.navIdOf('/'), 'kpi');
    assert.equal(P.navIdOf('/rdds'), 'kpi-rdds');
    assert.equal(P.navIdOf('/marketing'), 'kpi-marketing');
    assert.equal(P.navIdOf('/definitions'), 'kpi-definitions');
  });
  it('a page under a team belongs to the team; a page the menu does not list keeps Executive', () => {
    assert.equal(P.navIdOf('/rdds/42'), 'kpi-rdds');
    assert.equal(P.navIdOf('/unknown'), 'kpi');
  });
});

describe('the freshness note', () => {
  it('reads in Eastern time and says when the numbers are stale', () => {
    assert.equal(P.freshText('2026-10-15T13:05:00Z', false), 'Updated Oct 15, 9:05 AM');
    assert.equal(P.freshText('2026-10-15T13:05:00Z', true), 'Not updated since Oct 15, 9:05 AM');
    assert.equal(P.freshText(undefined, false), '');
    assert.equal(P.freshText('not a date', false), '');
  });
});

describe('the hand-off', () => {
  const will = { email: 'will@favorintl.org', name: 'w', picture: '', role: 'admin', via: 'google', kpi: true };
  function world(value) {
    if (typeof resetHubCache === 'function') resetHubCache();
    const d1 = memoryD1();
    d1.exec('CREATE TABLE hub_settings (key TEXT PRIMARY KEY, value TEXT, updated_by TEXT, updated_at TEXT)');
    d1.db.prepare('INSERT INTO hub_settings VALUES (?, ?, ?, ?)').run('web.routes', value, 't', 'now');
    return { DB: d1, WEB: { fetch: async () => new Response('web') } };
  }
  const go = (env, path) => {
    const url = new URL('https://dash.test' + path);
    return decideWeb(env, new Request(url, { headers: { 'Sec-Fetch-Dest': 'document' } }), url, will);
  };
  it('/dashboard/ is a full-load page for the old app but the web app serves it once the route is listed', () => {
    assert.equal(webServes('/dashboard/', ['/dashboard/']), true);
    assert.equal(webServes('/dashboard/?page=%2Frdds', ['/dashboard/']), true);
    assert.equal(webServes('/dashboard/', ['/highlights/']), false);
  });
  it('other full-load pages still load from Astro even when a route above them is listed', () => {
    assert.equal(webServes('/help/videos/x/', ['/help/']), false);
    assert.equal(webServes('/meet/room/', ['/meet/']), false);
  });
  it('the JSON indexes and the Brain sprite stay Pages endpoints under a web route', async () => {
    for (const f of STAY_PAGES) assert.equal(webServes(f, ['/help/', '/changelog/', '/brain/']), false, f);
    assert.equal(webServes('/help/learn.json', ['/help/']), false);
    assert.equal(webServes('/help/search.json', ['/help/']), false);
    assert.equal(webServes('/changelog/latest.json', ['/changelog/']), false);
    assert.equal(webServes('/brain/sprite.js', ['/brain/']), false);
    assert.equal(webServes('/help/', ['/help/']), true);
    const env = world('/help/@all,/changelog/@all,/brain/@all');
    assert.equal((await go(env, '/help/learn.json')).kind, 'pass');
    assert.equal((await go(env, '/changelog/latest.json')).kind, 'pass');
    assert.equal((await go(env, '/help/')).kind, 'web');
  });
  it('a document load of /dashboard/ goes to the web app for a listed route and to Astro otherwise', async () => {
    assert.equal((await go(world('/dashboard/@testers'), '/dashboard/?page=%2Fpc')).kind, 'web');
    assert.equal((await go(world('/highlights/@testers'), '/dashboard/')).kind, 'pass');
  });
});
