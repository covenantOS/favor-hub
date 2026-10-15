// Admin group A in the web app (Overview, People and roles, Blackbaud users, Audit log, Adoption, Tours, Brain admin, Text Favor Brain): the pure pieces and the
// wiring the pages depend on. Made-up figures only.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import './support/resolve-ts.mjs';

const f = await import('../web/src/features/admin-a/format.ts');
const people = await import('../web/src/features/admin-a/people.api.ts');
const { WEB_ROUTES, WEB_EXACT_ROUTES, webServes } = await import('../shared/web.ts');
const { ADMIN_PAGES } = await import('../src/data/admin-pages.ts');

const ROUTES = [
  ['/admin/', 'admin'],
  ['/admin/people/', 'admin/people'],
  ['/admin/blackbaud-users/', 'admin/blackbaud-users'],
  ['/admin/audit/', 'admin/audit'],
  ['/admin/adoption/', 'admin/adoption'],
  ['/admin/tours/', 'admin/tours'],
  ['/brain/admin/', 'brain/admin'],
  ['/brain/text/', 'brain/text'],
];

describe('Admin group A routes', () => {
  it('lists every route and has a route file for each', () => {
    for (const [route, file] of ROUTES) {
      assert.ok(WEB_ROUTES.includes(route), route + ' is in the web route list');
      assert.ok(existsSync(new URL(`../web/src/routes/${file}/index.tsx`, import.meta.url)), route + ' has a route file');
    }
  });
  it('lets /admin/ and /brain/ own only their own address, so a page that is not built yet keeps its Astro page', () => {
    assert.ok(WEB_EXACT_ROUTES.includes('/admin/') && WEB_EXACT_ROUTES.includes('/brain/'));
    assert.equal(webServes('/admin/', ['/admin/']), true);
    assert.equal(webServes('/admin/clips/', ['/admin/']), false);
    assert.equal(webServes('/brain/admin/', ['/brain/']), false);
    assert.equal(webServes('/brain/admin/', ['/brain/admin/']), true);
    assert.equal(webServes('/brain/', ['/brain/']), true);
  });
  it('keeps the Overview and its tab row listing every admin page, built or not', () => {
    const src = readFileSync(new URL('../web/src/features/admin-a/OverviewPage.tsx', import.meta.url), 'utf8');
    assert.match(src, /ADMIN_PAGES\.filter\(\(p\) => p\.live && p\.card\)/, 'the cards come from the page registry, not from the routes the web app has built');
    const head = readFileSync(new URL('../web/src/features/admin-reports/AdminHead.tsx', import.meta.url), 'utf8');
    assert.match(head, /ADMIN_PAGES\.filter\(\(p\) => p\.live && p\.tab\)/);
    for (const id of ['people', 'bbusers', 'adoption', 'tours', 'audit', 'work', 'meetings', 'brain', 'clips', 'reports', 'expenses', 'ai', 'chat', 'projects', 'gifts', 'receipts', 'statements', 'appeals']) {
      assert.ok(ADMIN_PAGES.some((p) => p.id === id && p.live), id + ' is in the registry');
    }
  });
});

describe('Admin words', () => {
  it('says a time the way public/js/admin.js did, in Eastern', () => {
    assert.equal(f.full('2026-10-08T14:05:00Z'), 'Oct 8, 2026, 10:05 AM ET');
    assert.equal(f.full(''), '');
    assert.equal(f.when(null), 'No run on record');
    assert.equal(f.day('nonsense'), 'No run on record');
    assert.match(f.when(new Date().toISOString()), /^Today \d{1,2}:\d{2} (AM|PM) ET$/);
    assert.equal(f.day(new Date().toISOString()), 'Today');
    assert.equal(f.ago(new Date(Date.now() - 5 * 60000).toISOString()), '5 min ago');
    assert.equal(f.ago(new Date(Date.now() - 3 * 3600000).toISOString()), '3 h ago');
    assert.equal(f.ago(new Date(Date.now() - 5 * 86400000).toISOString()), '5 days ago');
    assert.equal(f.ago(new Date().toISOString()), 'just now');
  });
  it('writes a calendar day without shifting it by a time zone', () => {
    assert.equal(f.calDay('2026-10-12'), 'Oct 12');
    assert.equal(f.num(12345), '12,345');
    assert.equal(f.num(null), '0');
  });
});

describe('People page', () => {
  it('opens on a filter only for the ones the Show drop-down offers', () => {
    assert.equal(people.isFilter('pending'), true);
    assert.equal(people.isFilter('hr'), true);
    assert.equal(people.isFilter(''), false);
    assert.equal(people.isFilter('everything'), false);
    assert.equal(people.isFilter(undefined), false);
  });
  it('lists the filters in the order the classic page did', () => {
    assert.deepEqual(people.FILTERS.map((x) => x[0]), ['', 'admin', 'pending', 'field', 'blocked', 'wc', 'nolist', 'nosup', 'hr']);
  });
  it('asks before a role change or a block, as the classic page did, and sends the same body', () => {
    const src = readFileSync(new URL('../web/src/features/admin-a/PeoplePage.tsx', import.meta.url), 'utf8');
    assert.match(src, /Make ' \+ name \+ ' an admin\? Admins can change every setting\./);
    assert.match(src, /Make ' \+ name \+ ' staff\? They lose admin access\./);
    assert.match(src, /Block ' \+ name \+ '\? Their open sessions end now\./);
    assert.match(src, /body=\{\{ email: p\.email, role: toAdmin \? 'admin' : 'staff' \}\}/);
    assert.match(src, /body=\{\{ email: p\.email, blocked: !p\.blocked \}\}/);
  });
});

describe('Blackbaud users page', () => {
  it('only ever posts to the request queue, never to Blackbaud', () => {
    const src = readFileSync(new URL('../web/src/features/admin-a/BbUsersPage.tsx', import.meta.url), 'utf8');
    const posts = [...src.matchAll(/hubSend\('([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(posts.sort(), ['/api/work/bbusers/jobs', '/api/work/bbusers/jobs/cancel']);
    assert.ok(!/dbv|webview|sky/i.test(src.replace(/\/\/.*$/gm, '')), 'no direct Blackbaud call in the page code');
  });
});
