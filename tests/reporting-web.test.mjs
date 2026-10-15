// Reporting in the web app (Highlights, Reports, Admin > Reports): the pure pieces the pages draw with. The pages must say what the classic
// pages said (public/js/reporting.js, reports.js), so the words and addresses are pinned here with made-up figures.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import './support/resolve-ts.mjs';

const hl = await import('../web/src/features/highlights/format.ts');
const rp = await import('../web/src/features/reports/format.ts');
const url = await import('../web/src/features/reports/url.ts');
const { WEB_ROUTES } = await import('../shared/web.ts');

describe('Highlights words', () => {
  it('writes short and long days by hand', () => {
    assert.equal(hl.shortDay('2026-10-08'), 'Oct 8');
    assert.equal(hl.longDay('2026-10-08'), 'October 8, 2026');
    assert.equal(hl.shortDay('nonsense'), '');
  });
  it('rounds a year-end estimate the way FavorUI.short does', () => {
    assert.equal(hl.short(12_840_000), '$12.8M');
    assert.equal(hl.short(450_400), '$450.4K');
    assert.equal(hl.short(812.4), '$812');
    assert.equal(hl.short(999_600), '$1M');
    assert.equal(hl.short(-2_500), '-$2.5K');
  });
  it('writes whole dollars with a minus sign in front', () => {
    assert.equal(hl.money0(1234.5), '$1,235');
    assert.equal(hl.money0(-1200), '-$1,200');
  });
  it('says when a pin was asked', () => {
    const now = Date.parse('2026-10-15T15:00:00Z');
    assert.equal(hl.askedAt('2026-10-15T14:40:00Z', now), 'just now');
    assert.equal(hl.askedAt('2026-10-15T12:00:00Z', now), '3 hours ago');
    assert.equal(hl.askedAt('2026-10-12T15:00:00Z', now), 'Oct 12');
  });
  it('names a failed read by the server sentence, the connection, or the page words', () => {
    const hub = (message) => Object.assign(new Error(message), { name: 'HubReadError' });
    assert.equal(hl.failText(hub('The KPI numbers are open to leadership.'), 'x'), 'The KPI numbers are open to leadership.');
    assert.equal(hl.failText(hub('Something went wrong. Try again.'), 'The numbers did not load. Reload in a minute.'), 'The numbers did not load. Reload in a minute.');
    assert.match(hl.failText(new TypeError('Failed to fetch'), 'x'), /could not be reached/);
  });
});

describe('Reports words', () => {
  it('writes money with cents, counts with commas and percents with one decimal', () => {
    assert.equal(rp.money(1234), '$1,234.00');
    assert.equal(rp.money(-5.5), '-$5.50');
    assert.equal(rp.num(1234567), '1,234,567');
    assert.equal(rp.pct(0.1234), '12.3%');
  });
  it('writes a date by hand and leaves what is not a date as it came', () => {
    assert.equal(rp.dshort('2026-10-05'), 'Oct 5, 2026');
    assert.equal(rp.dshort('2026-10-05T04:00:00Z'), 'Oct 5, 2026');
    assert.equal(rp.dshort('2026-13-05'), '2026-13-05');
    assert.equal(rp.dshort('Pending'), 'Pending');
  });
});

describe('Reports addresses', () => {
  it('reads the report and its filters from the address, and drops the Google return flag', () => {
    const got = url.askedOf('?r=daily-revenue&month=2026-10&team=&google=1');
    assert.equal(got.id, 'daily-revenue');
    assert.deepEqual(got.asked, { month: '2026-10', team: '' });
  });
  it('refuses a report id with anything but letters, digits and dashes', () => {
    assert.equal(url.askedOf('?r=../admin').id, null);
    assert.equal(url.askedOf('').id, null);
  });
  it('sends every filter to the server (an empty one means all) and keeps empty ones out of the address bar', () => {
    const values = { month: '2026-10', team: '' };
    assert.equal(url.apiUrl('daily-revenue', values), '/api/reports/daily-revenue?month=2026-10&team=');
    assert.equal(url.apiUrl('daily-revenue', values, 'csv'), '/api/reports/daily-revenue?month=2026-10&team=&format=csv');
    assert.equal(url.pageUrl('daily-revenue', values), '/reports/?r=daily-revenue&month=2026-10');
    assert.equal(url.pageUrl('daily-revenue', {}), '/reports/?r=daily-revenue');
  });
});

describe('Reporting routes', () => {
  it('lists the three routes and has a route file for each', () => {
    for (const [route, file] of [
      ['/highlights/', 'highlights'],
      ['/reports/', 'reports'],
      ['/admin/reports/', 'admin/reports'],
    ]) {
      assert.ok(WEB_ROUTES.includes(route), route + ' is in the web route list');
      assert.ok(existsSync(new URL(`../web/src/routes/${file}/index.tsx`, import.meta.url)), route + ' has a route file');
    }
  });
  it('reads the filters from the address once and never prefetches an unpinned report on hover', () => {
    const src = readFileSync(new URL('../web/src/routes/reports/index.tsx', import.meta.url), 'utf8');
    assert.ok(!/loaderDeps/.test(src), 'the loader does not depend on the search, so a filter change is read once by the page');
    const list = readFileSync(new URL('../web/src/features/reports/List.tsx', import.meta.url), 'utf8');
    assert.ok(!/from '@tanstack\/react-router'/.test(list), 'report rows are NavLinks, which never preload (a report run is logged and costs a query)');
  });
});
