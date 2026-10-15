// The composer's parser (shared/request-parse.ts): the same code the server and the React composer run. Made-up words and people only.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';

const P = await import('../shared/request-parse.ts');
const M = await import('../shared/intake-model.ts');

const TODAY = '2026-10-12'; // a Monday
const PEOPLE = [
  { email: 'ada@favorintl.org', name: 'Ada Admin', team: 'Tech', title: 'Lead Developer' },
  { email: 'dan@favorintl.org', name: 'Dan Design', team: 'Marketing', title: 'Creative Director' },
  { email: 'dana@favorintl.org', name: 'Dana Door', team: 'Support Team', title: 'Assistant' },
  { email: 'dan.second@favorintl.org', name: 'Dan Other', team: 'Support Team', title: 'Assistant' },
];

test('a request about the website parses to Tech, a change or fix, the website, the public, and this Friday', () => {
  const p = P.parseRequest('The donate button on the website is broken, please fix it', TODAY, { people: PEOPLE });
  assert.equal(p.team.value, 'tech');
  assert.equal(p.kind.value, 'change');
  assert.equal(p.place.value, 'website');
  assert.equal(p.audience.value, 'Public on favorintl.org');
  assert.equal(p.due.value, '2026-10-16');
  assert.equal(p.due.guess, true, 'no date in the words, so the due date is a default');
  assert.equal(p.assignee, null, 'nobody named and no history');
  assert.equal(p.title, 'The donate button on the website is broken, please fix it');
});

test('every chip carries a plain reason, and none of them has a long dash', () => {
  for (const text of ['Add Sarah to the team page by October 30', 'A flyer for the banquet, ask Dan', 'Please fix the KPI dashboard ASAP', 'Something about stuff']) {
    const p = P.parseRequest(text, TODAY, { people: PEOPLE, ownerGuess: { email: 'ada@favorintl.org', name: 'Ada Admin', why: 'Took the last 3 website requests' } });
    for (const k of ['team', 'kind', 'place', 'audience', 'due']) {
      assert.ok(p[k].why.length > 3 && p[k].label.length > 0, `${text} / ${k}`);
      assert.ok(!p[k].why.includes(String.fromCharCode(8212)), `${k} why has a long dash`);
    }
  }
});

test('Marketing work parses to Marketing with the kind of piece named', () => {
  const flyer = P.parseRequest('We need a flyer for the church banquet by Friday', TODAY);
  assert.equal(flyer.team.value, 'marketing');
  assert.equal(flyer.place.value, 'print');
  assert.equal(flyer.place.label, 'Print');
  assert.equal(flyer.audience.value, 'Churches');
  assert.equal(flyer.due.value, '2026-10-16');
  const reel = P.parseRequest('Cut a reel for Instagram from the trip video', TODAY);
  assert.equal(reel.place.value, 'social');
  const none = P.parseRequest('Make something nice for the campaign', TODAY);
  assert.equal(none.team.value, 'marketing');
  assert.equal(none.place.value, 'design');
  assert.equal(none.place.guess, true);
});

test('money goes to the expense request', () => {
  const p = P.parseRequest('Reimburse my hotel and mileage for the trip', TODAY);
  assert.equal(p.team.value, 'expense');
  assert.equal(p.assignee, null, 'no assignee for an expense request');
});

test('a tie between Tech and Marketing goes to Tech, and words that name nothing go to Tech by default', () => {
  assert.equal(P.routeByWords('the newsletter link is broken'), 'board');
  assert.equal(P.routeByWords('hello there'), null);
  const p = P.parseRequest('Can someone look at this for me', TODAY);
  assert.equal(p.team.value, 'tech');
  assert.equal(p.team.guess, true);
});

test('dates: a named date wins, urgent words mean tomorrow, no rush means two weeks', () => {
  assert.equal(P.parseRequest('Add the page by October 30', TODAY).due.value, '2026-10-30');
  assert.equal(P.parseRequest('Add the page by October 30', TODAY).due.guess, false);
  assert.equal(P.parseRequest('The form is broken, fix ASAP', TODAY).due.value, '2026-10-13');
  assert.equal(P.parseRequest('Update the footer, no rush', TODAY).due.value, '2026-10-26');
  assert.equal(P.parseRequest('Need it next Friday', TODAY).due.value, '2026-10-23');
});

test('the assignee: a person the words name, one match only, else the suggested owner', () => {
  const named = P.parseRequest('Ask Ada to move the banner on the website', TODAY, { people: PEOPLE });
  assert.equal(named.assignee.value, 'ada@favorintl.org');
  assert.equal(named.assignee.guess, false);
  assert.match(named.assignee.why, /Ask Ada/);
  const at = P.parseRequest('@Ada can you fix the link', TODAY, { people: PEOPLE });
  assert.equal(at.assignee.value, 'ada@favorintl.org');
  const full = P.parseRequest('Hand it to Dan Other for the form fix', TODAY, { people: PEOPLE });
  assert.equal(full.assignee.value, 'dan.second@favorintl.org', 'a full name picks the right one');
  const token = P.parseRequest('Fix this <@dana@favorintl.org> please', TODAY, { people: PEOPLE });
  assert.equal(token.assignee.value, 'dana@favorintl.org');
  const guess = { email: 'ada@favorintl.org', name: 'Ada Admin', why: 'Took the last 2 website requests' };
  const sugg = P.parseRequest('The home page headline is wrong', TODAY, { people: PEOPLE, ownerGuess: guess });
  assert.equal(sugg.assignee.value, 'ada@favorintl.org');
  assert.equal(sugg.assignee.guess, true);
  assert.equal(sugg.assignee.why, guess.why);
  const same = P.parseRequest('Ask Dan about the form', TODAY, { people: [PEOPLE[1], { email: 'dan.second@favorintl.org', name: 'Dan Other', team: '', title: '' }] });
  assert.equal(same.assignee, null, 'two people named Dan, so the words do not pick one');
  assert.equal(P.parseRequest('Ask Ada to fix it', TODAY).assignee, null, 'no staff list, no assignee');
});

test('the old fill still works through the shared module (suggestFill keeps its answers)', () => {
  const f = P.suggestFill("Could we add Sarah's bio to the team page on the website?", TODAY);
  assert.equal(f.kind, 'add');
  assert.equal(f.surface, 'website');
  assert.equal(f.title, "Add Sarah's bio to the team page on the website");
});

test('the stages and the words people see: five stages, four words, Review reads as In progress', () => {
  assert.deepEqual([...M.STAGES], ['Intake', 'Triage', 'In progress', 'Review', 'Done']);
  assert.deepEqual([...M.STOPS], ['Sent', 'Approved', 'In progress', 'Done']);
  assert.equal(M.statusForSection('Intake', true), 'inbox');
  assert.equal(M.statusForSection('Triage', true), 'approved');
  assert.equal(M.statusForSection('In progress', true), 'in_progress');
  assert.equal(M.statusForSection('Review', true), 'in_progress');
  assert.equal(M.statusForSection('Done', true), 'done');
  assert.equal(M.statusForSection('Doing', false), 'in_progress');
  assert.equal(M.statusForSection('Backlog', false), 'approved');
  assert.equal(M.statusForSection('Shipped', false), 'approved', 'only done-like names close a request');
  assert.equal(M.statusForSection('Complete', false), 'done');
  assert.equal(M.statusForSection(null, false), 'approved');
  assert.equal(M.stageOf('in PROGRESS'), 'In progress');
  assert.equal(M.stageOf('Backlog'), null);
  for (const text of Object.values(M.STATUS_WORD)) assert.ok(!text.includes(String.fromCharCode(8212)));
});

test('no text in the shared modules, the migration or the schema carries a long dash', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['shared/request-parse.ts', 'shared/intake-model.ts', 'db/projects-intake.sql']) {
    assert.ok(!readFileSync(new URL('../' + f, import.meta.url), 'utf8').includes(String.fromCharCode(8212)), f);
  }
});
