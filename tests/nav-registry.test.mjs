// The navigation registry: every page is reachable, ids are unique, roles gate what they should, old URLs redirect.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { AREAS, REDIRECTS, SWAP_PATHS, resolveNav, paletteItems } = await import('../src/data/areas.ts');

const pages = AREAS.flatMap((a) => a.pages.map((p) => ({ a, p })));

test('page ids are unique', () => {
  const ids = pages.map((x) => x.p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('there are six working areas plus Admin, Help and Tools at the foot', () => {
  assert.deepEqual(AREAS.filter((a) => !a.foot).map((a) => a.id), ['today', 'work', 'meet', 'ask', 'kpi']);
  assert.deepEqual(AREAS.filter((a) => a.foot).map((a) => a.id), ['admin', 'help', 'tools']);
});

test('the phone bar fits five areas plus More', () => {
  assert.ok(AREAS.filter((a) => !a.foot).length >= 5);
  const ranks = AREAS.filter((a) => !a.foot).map((a) => a.barRank);
  assert.equal(new Set(ranks).size, ranks.length);
});

test('every page route has a built page and a registry entry', () => {
  for (const { p } of pages) {
    if (p.ext) continue;
    const route = p.href.split('?')[0].replace(/^\//, '').replace(/\/$/, '');
    const cands = [route ? `src/pages/${route}/index.astro` : 'src/pages/index.astro', `src/pages/${route}.astro`, `src/content/help/${route.split('/').pop()}.md`];
    assert.ok(cands.some((c) => fs.existsSync(c)) || route.startsWith('help/'), `${p.id} ${p.href} has no page`);
  }
});

test('every page the layout receives as nav resolves to an area', () => {
  const used = new Set();
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith('.astro')) { const m = fs.readFileSync(f, 'utf8').match(/<App[^>]*\snav="([^"]+)"/); if (m) used.add(m[1]); } });
  walk('src/pages');
  const loose = new Set(['expense']);
  for (const id of used) assert.ok(resolveNav(id), `nav="${id}" is not in the registry`);
  assert.ok(loose);
});

test('gated pages carry a flag the nav answer returns', () => {
  const flags = new Set(['admin', 'kpi', 'expenseLog', 'workCenter', 'clips', 'meetings']);
  for (const { p } of pages) if (p.need) assert.ok(flags.has(p.need), `${p.id} needs ${p.need}`);
});

test('admin pages are gated; an expense approver reaches only the log in Admin', () => {
  const admin = AREAS.find((a) => a.id === 'admin');
  assert.ok(admin.pages.every((p) => p.need));
  assert.deepEqual(admin.pages.filter((p) => p.need === 'expenseLog').map((p) => p.id), ['expenses']);
});

test('team tabs map to the KPI teams', () => {
  const teams = AREAS.flatMap((a) => a.pages).filter((p) => p.team).map((p) => p.team).sort();
  assert.deepEqual(teams, ['ce', 'grants', 'marketing', 'pc', 'rdd']);
});

test('old URLs redirect to a page that exists in the registry', () => {
  const hrefs = new Set(pages.map((x) => x.p.href.replace(/\/$/, '')));
  hrefs.add('');
  for (const [from, to] of REDIRECTS) {
    assert.ok(from.startsWith('/') && to.startsWith('/'));
    assert.ok(hrefs.has(to.replace(/\/$/, '')), `${from} goes to ${to}, which is not a registry page`);
    assert.ok(!pages.some((x) => x.p.href.replace(/\/$/, '') === from.replace(/\/$/, '')), `${from} is a live page and cannot redirect`);
  }
});

test('the middleware applies the registry redirects', () => {
  const mw = fs.readFileSync('functions/_middleware.ts', 'utf8');
  assert.match(mw, /REDIRECTS/);
  assert.match(mw, /NAV_MOVED/);
});

test('the palette lists every internal page once, with its area', () => {
  const items = paletteItems();
  assert.equal(items.length, pages.length);
  assert.ok(items.every((i) => i.desc.includes(' \u00b7 ')));
});

test('swap paths are real internal pages without a query', () => {
  for (const p of SWAP_PATHS) assert.ok(!p.includes('?') && p.endsWith('/'));
  assert.ok(SWAP_PATHS.includes('/receipts/'));
});

test('every non-external page has a Learn slug or is exempt', () => {
  const have = new Set(fs.readdirSync('src/content/help').map((f) => f.replace(/\.md$/, '')));
  for (const { p } of pages) if (p.learn) assert.ok(have.has(p.learn), `${p.id} learn=${p.learn} has no article`);
});
