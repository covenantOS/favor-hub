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

test('Work is split: ten working areas in rail order, Admin and Help at the foot', () => {
  assert.deepEqual(AREAS.filter((a) => !a.foot).map((a) => a.id), ['today', 'partners', 'gifts', 'projects', 'meet', 'chat', 'mail', 'ask', 'kpi', 'staff']);
  assert.deepEqual(AREAS.filter((a) => a.foot).map((a) => a.id), ['admin', 'help']);
  assert.ok(!AREAS.some((a) => a.id === 'work' || a.id === 'learn' || a.id === 'tools'));
});

test('the rail and the phone bar read the areas in the same order', () => {
  const main = AREAS.filter((a) => !a.foot);
  const ranks = main.map((a) => a.barRank);
  assert.deepEqual(ranks, ranks.slice().sort((x, y) => x - y));
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
    const cands = [route ? `src/pages/${route}/index.astro` : 'src/pages/index.astro', `src/pages/${route}.astro`, `web/src/routes/${route}/index.tsx`, `src/content/help/${route.split('/').pop()}.md`];
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
  const flags = new Set(['admin', 'kpi', 'expenseLog', 'workCenter', 'clips', 'meetings', 'chat', 'projects', 'hr', 'mail', 'giftEntry', 'otherGifts', 'learn', 'learnAdmin']);
  for (const { p } of pages) if (p.need) assert.ok(flags.has(p.need), `${p.id} needs ${p.need}`);
});

test('admin pages are all admin-only; the expense log and onboarding moved to Staff with their own gates', () => {
  const admin = AREAS.find((a) => a.id === 'admin');
  assert.ok(admin.pages.every((p) => p.need === 'admin'));
  const staff = AREAS.find((a) => a.id === 'staff');
  // Expenses is everyone's page (My requests); the log on it is read only by approvers and the people they add (the API decides).
  assert.equal(staff.pages.find((p) => p.id === 'expenses').need, undefined);
  assert.equal(staff.pages.find((p) => p.id === 'expense').parent, 'expenses');
  assert.equal(staff.pages.find((p) => p.id === 'onboarding').need, 'hr');
  assert.equal(staff.pages.find((p) => p.id === 'evals').need, 'hr');
  assert.ok(staff.pages.filter((p) => p.group === 'Learning').every((p) => p.need === 'learn' || p.need === 'learnAdmin'), 'Learn keeps its access group');
});

test('every page that left Work, Learn or Admin says where it was', () => {
  const moved = ['work', 'partners-thank', 'partners-entry', 'letters', 'declines', 'foundations', 'gift-entry', 'online-gifts', 'receipts', 'statements', 'projects', 'board', 'expense', 'expenses', 'evals', 'learn', 'onboarding'];
  for (const id of moved) assert.ok(resolveNav(id).page.was, `${id} has no was`);
});

test('no area draws more than six tabs before its More menu', async () => {
  const { arrangeTabs } = await import('../src/data/areas.ts');
  for (const a of AREAS) {
    const entries = [];
    for (const p of a.pages.filter((x) => !x.ext && x.menu !== false)) {
      if (p.group) { if (!entries.some((e) => e.group === p.group)) entries.push({ group: p.group }); } else entries.push(p);
    }
    for (const mine of [null, ['admin'], [], ['giftdesk'], ['rdd']]) {
      const { row } = arrangeTabs(entries, mine);
      assert.ok(row.length <= 6, `${a.id} draws ${row.length} tabs for ${JSON.stringify(mine)}`);
    }
  }
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
    assert.ok(hrefs.has(to.split('?')[0].replace(/\/$/, '')), `${from} goes to ${to}, which is not a registry page`);
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
  assert.equal(items.filter((i) => i.area !== 'tools').length, pages.length);
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
