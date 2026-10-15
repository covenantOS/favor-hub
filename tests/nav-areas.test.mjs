// The October 2026 split of Work: jobs decide which areas sit in a person's rail and which tabs come first, never what they may open.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const { AREAS, arrangeTabs, railAreas, jobMatch, TAB_CAP } = await import('../src/data/areas.ts');
const { jobsFrom } = await import('../functions/_lib/hub/jobs.ts');

test('jobs come from the Work Center team, the meetings roster and the access flags; admins hold every job', () => {
  assert.deepEqual(jobsFrom('rdd', 'Development (RDD)', {}), ['rdd']);
  assert.deepEqual(jobsFrom(null, 'Partner Care', {}).sort(), ['partner_care']);
  assert.deepEqual(jobsFrom(null, 'Operations', { giftEntry: true, hr: true, approver: true }).sort(), ['approver', 'giftdesk', 'hr']);
  assert.deepEqual(jobsFrom('support', 'Support Team', { giftEntry: true }).sort(), ['giftdesk', 'support']);
  assert.deepEqual(jobsFrom(null, 'Marketing', {}), []);
  assert.deepEqual(jobsFrom('rdd', 'Grants', { admin: true }), ['admin']);
});

test('the rail has no More menu: every area is in it, in one order, whatever the jobs are', () => {
  assert.deepEqual(railAreas(AREAS).map((a) => a.id), ['today', 'partners', 'gifts', 'projects', 'ask', 'kpi', 'staff', 'meet', 'chat', 'mail']);
  for (const a of AREAS) assert.equal(a.jobs, undefined, `${a.id}: an area is never hidden by a job`);
  const layout = fs.readFileSync('src/layouts/App.astro', 'utf8');
  assert.doesNotMatch(layout, /h-area--more|moreAreas|railmore|is-more/, 'the layout draws no rail More');
  assert.deepEqual(AREAS.filter((a) => !a.foot).map((a) => a.id), railAreas(AREAS).map((a) => a.id), 'the registry lists the areas in rail order too');
});

test('jobs never gate: a job match is only an order', () => {
  assert.equal(jobMatch(['grants'], []), false);
  assert.equal(jobMatch(['grants'], ['admin']), true);
  assert.equal(jobMatch(undefined, []), true);
  for (const a of AREAS) if (a.jobs) assert.ok(a.pages.some((p) => !p.need), `${a.id} has a page anyone can open`);
});

const tab = (id, jobs, on) => ({ id, jobs, on: !!on });
test('the tab row: your job pages first, at most six, the rest under More; an open page under More lights More', () => {
  const tabs = [tab('ov', ['giftdesk', 'support', 'partner_care']), tab('ge', ['giftdesk', 'support']), tab('og', ['partner_care']), tab('rc', ['giftdesk', 'partner_care']), tab('ty', ['support']), tab('st', ['giftdesk', 'partner_care']), tab('dc', ['giftdesk', 'support', 'partner_care'])];
  const morgan = arrangeTabs(tabs, ['giftdesk', 'hr']);
  assert.deepEqual(morgan.row.map((t) => t.id), ['ov', 'ge', 'rc', 'st', 'dc']);
  assert.deepEqual(morgan.more.map((t) => t.id), ['og', 'ty']);
  const admin = arrangeTabs(tabs, ['admin']);
  assert.equal(admin.row.length, TAB_CAP);
  assert.deepEqual(admin.more.map((t) => t.id), ['dc']);
  const danny = arrangeTabs(tabs, []);
  assert.deepEqual(danny.row.map((t) => t.id), ['ov', 'ge', 'og', 'rc', 'ty', 'st'], 'no job in the area: registry order');
  const onMore = arrangeTabs(tabs.map((t) => ({ ...t, on: t.id === 'og' })), ['giftdesk']);
  assert.deepEqual(onMore.row.map((t) => t.id), morgan.row.map((t) => t.id), 'the row keeps its shape');
  assert.equal(onMore.moreOn, true);
  assert.equal(morgan.moreOn, false);
});

// The layout's inline copy of the rule (src/layouts/App.astro hubTabsLayout) must agree with arrangeTabs.
test('the layout arranges the tab row by the same rule', () => {
  const src = fs.readFileSync('src/layouts/App.astro', 'utf8');
  assert.match(src, /window\.hubTabsLayout = function/);
  assert.match(src, /var CAP = 6;/);
  assert.equal(TAB_CAP, 6);
  const m = src.match(/window\.hubJobMatch = (function \(jobs, mine\) \{[\s\S]*?\n {8}\});/);
  assert.ok(m, 'hubJobMatch is in the layout');
  const fn = vm.runInNewContext('(' + m[1] + ')');
  for (const [jobs, mine] of [[['grants'], []], [['grants'], ['admin']], [null, []], [['rdd', 'support'], ['support']], [['rdd'], null]]) assert.equal(fn(jobs, mine), jobMatch(jobs, mine));
});

test('the header shows the area over the page name; the tab row is drawn by the build', () => {
  const src = fs.readFileSync('src/layouts/App.astro', 'utf8');
  assert.match(src, /h-top__crumb/);
  assert.match(src, /headTitle/);
  assert.doesNotMatch(src, /tab-org\.js/, 'the tab row is never rebuilt after load');
});
