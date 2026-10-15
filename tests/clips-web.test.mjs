// The Clips pages in the web app (web/src/features/clips): the pure rules and the route registration. The pages themselves are checked
// against the classic pages by the QA scripts, and the recorder and editor engines (public/js/clips) by tests/clips-*.test.mjs.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';

const L = await import('../web/src/features/clips/logic.ts');
const { WEB_ROUTES, webServes } = await import('../shared/web.ts');
const { routeServed } = await import('../shared/app2.ts');

describe('sharing levels', () => {
  it('say what the Share window says', () => {
    assert.equal(L.levelLabel('private'), 'Private');
    assert.equal(L.levelLabel('people'), 'Specific people');
    assert.equal(L.levelLabel('staff'), 'Anyone at Favor');
    assert.equal(L.levelLabel('public'), 'Everybody');
    assert.equal(L.levelLabel('nonsense'), 'Specific people');
  });
  it('read the level from either shape the API uses', () => {
    assert.equal(L.levelOfClip({ level: 'staff' }), 'staff');
    assert.equal(L.levelOfClip({ access: 'private' }), 'private');
    assert.equal(L.levelOfClip({ share: 1 }), 'public');
    assert.equal(L.levelOfClip({ staff_link: 1 }), 'staff');
    assert.equal(L.levelOfClip({ staffLink: 1 }), 'staff');
    assert.equal(L.levelOfClip({}), 'people');
  });
});

describe('the library text', () => {
  it('sizes read in the unit a person expects', () => {
    assert.equal(L.fmtBytes(0), '1 KB');
    assert.equal(L.fmtBytes(2048), '2 KB');
    assert.equal(L.fmtBytes(5 * 1024 ** 2), '5 MB');
    assert.equal(L.fmtBytes(1.5 * 1024 ** 3), '1.5 GB');
  });
  it('counts and empty states', () => {
    assert.equal(L.countLabel(0), '');
    assert.equal(L.countLabel(1), '1 clip');
    assert.equal(L.countLabel(1234), '1,234 clips');
    assert.equal(L.fmtViews(1), '1 view');
    assert.equal(L.fmtViews(0), '0 views');
    assert.equal(L.emptyText('mine', ''), 'No clips yet.');
    assert.equal(L.emptyText('all', ''), 'No clips have been recorded yet.');
    assert.equal(L.emptyText('mine', 'zebra'), 'No clip matches that search.');
  });
  it('draws sixty at a time and caps a meter at the full bar', () => {
    assert.equal(L.PAGE, 60);
    assert.equal(L.capPct(5, 10), 50);
    assert.equal(L.capPct(50, 10), 100);
  });
});

describe('Admin > Clips storage table', () => {
  it('shows gigabytes and the share of the cap (a share can pass 100)', () => {
    const cap = 10 * 1073741824;
    const rows = L.usageRows([{ email: 'a@x.org', name: 'A', clips: 1234, bytes: 1073741824 * 12 }, { email: 'b@x.org', name: 'B', clips: 0, bytes: 0 }], cap);
    assert.deepEqual(rows[0], { email: 'a@x.org', name: 'A', clips: '1,234', used: '12.00 GB', pct: 120 });
    assert.equal(rows[1].used, '0.00 GB');
    assert.equal(rows[1].pct, 0);
  });
  it('a setting row saves only when the box differs from the server', () => {
    assert.equal(L.settingChanged('10', '10'), false);
    assert.equal(L.settingChanged('12', '10'), true);
  });
});

describe('route registration', () => {
  it('lists the Clips pages and their admin page', () => {
    assert.ok(WEB_ROUTES.includes('/clips/'));
    assert.ok(WEB_ROUTES.includes('/admin/clips/'));
  });
  it('has a route file for every classic Clips address', () => {
    for (const f of ['clips/index', 'clips/all/index', 'clips/edit/index', 'clips/rec/index', 'admin/clips/index']) assert.ok(existsSync(new URL(`../web/src/routes/${f}.tsx`, import.meta.url)), f);
  });
  it('serves the recorder window from the web app but leaves it a full load for the old React app', () => {
    assert.equal(webServes('/clips/rec/', ['/clips/']), true);
    assert.equal(webServes('/clips/edit/', ['/clips/']), true);
    assert.equal(webServes('/clips/all/', ['/clips/']), true);
    assert.equal(webServes('/meet/room/', ['/meet/']), false);
    assert.equal(webServes('/login/', ['/']), false);
    assert.equal(routeServed('/clips/rec/', ['/clips/rec/', '/clips/']), false);
  });
  it('draws the recorder route without the frame', () => {
    const rec = readFileSync(new URL('../web/src/routes/clips/rec/index.tsx', import.meta.url), 'utf8');
    assert.match(rec, /solo: true/);
    const root = readFileSync(new URL('../web/src/routes/__root.tsx', import.meta.url), 'utf8');
    assert.match(root, /data-cr-standalone="1"/);
  });
});
