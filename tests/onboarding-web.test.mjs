// The onboarding screens in the web app (web/src/features/onboarding): the pure rules, and the route registration.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const L = await import('../web/src/features/onboarding/logic.ts');
const { WEB_ROUTES } = await import('../shared/web.ts');

const people = [
  { email: 'ada@favorintl.org', name: 'Ada Example', team: 'Grants', title: 'Writer' },
  { email: 'bo@favorintl.org', name: 'Bo Sample', team: 'Care', title: 'Lead' },
  { email: 'cy@favorintl.org', name: 'Cy Adams', team: 'Admin', title: '' },
];

describe('words and dates', () => {
  it('day words use the calendar day', () => {
    assert.equal(L.dayWord('2026-10-12'), 'Mon, Oct 12');
    assert.equal(L.dayWord('2026-10-12', true), 'Mon, Oct 12, 2026');
    assert.equal(L.dayWord(null), '');
    assert.equal(L.dateWord({ kind: 'offboard', date: '2026-10-12' }), 'Last day Mon, Oct 12');
    assert.equal(L.dateWord({ kind: 'onboard', date: '2026-10-12' }), 'Starts Mon, Oct 12');
  });
  it('the default start is the Monday after today', () => {
    assert.equal(L.mondayAfter('2026-10-15'), '2026-10-19');
    assert.equal(L.mondayAfter('2026-10-19'), '2026-10-26');
  });
  it('times read in Eastern with a plain space', () => {
    assert.equal(L.etTime('2026-10-12T19:45:00Z'), 'Oct 12, 3:45 PM');
    assert.equal(L.etTime('nope'), '');
  });
  it('percent and initials', () => {
    assert.equal(L.pct(1, 3), 33);
    assert.equal(L.pct(0, 0), 0);
    assert.equal(L.initials('Ada Example Smith'), 'AE');
  });
});

describe('the staff search', () => {
  it('ranks a first-name start before other matches', () => {
    assert.deepEqual(L.matchPeople(people, 'ad').map((p) => p.name), ['Ada Example', 'Cy Adams', 'Bo Sample']);
    assert.deepEqual(L.matchPeople(people, 'care').map((p) => p.name), ['Bo Sample']);
    assert.equal(L.matchPeople(people, '').length, 3);
  });
  it('a stranger gets a name made from the address', () => {
    assert.equal(L.personIn(people, 'jo.q@favorintl.org').name, 'Jo Q');
  });
});

describe('the list page', () => {
  it('tabs from the hash: checklist and owners need manage', () => {
    assert.equal(L.tabFromHash('#done', false), 'done');
    assert.equal(L.tabFromHash('#owners', false), 'active');
    assert.equal(L.tabFromHash('#owners', true), 'owners');
    assert.deepEqual(L.listTabs(false, 2).map((t) => t.key), ['active', 'done']);
    assert.deepEqual(L.listTabs(true, 2).map((t) => t.key), ['active', 'done', 'checklist', 'owners']);
  });
  it('the start link', () => {
    assert.deepEqual(L.startRequest({ start: 'offboard', email: 'a@b.c' }), { kind: 'offboard', email: 'a@b.c', name: '' });
    assert.equal(L.startRequest({ start: 'x' }), null);
  });
  it('checklist values keep their type', () => {
    assert.equal(L.templateValue('number', '', false), 0);
    assert.equal(L.templateValue('number', '-3', false), -3);
    assert.equal(L.templateValue('checkbox', 'on', false), false);
    assert.equal(L.templateValue('text', 'x', false), 'x');
  });
  it('request bodies', () => {
    const b = L.onboardBody({ name: ' Ada ', email: 'ADA@favorintl.org ', title: '', team: 'Grants', date: '2026-10-19', hq: true, welcome: '', supervisor: '' });
    assert.equal(b.email, 'ada@favorintl.org');
    assert.equal(b.name, 'Ada');
    const o = L.offboardBody({ who: 'bo@favorintl.org', date: '2026-10-19', stays: true, supervisor: '' }, people[1]);
    assert.equal(o.team, 'Care');
    assert.equal(o.stays, true);
  });
});

describe('the run page gates', () => {
  const g = (manage, status = 'active') => ({ manage, status });
  it('an owner ticks their own step, never an automatic one', () => {
    assert.equal(L.canTick(g(false), { mine: true, kind: 'task' }), true);
    assert.equal(L.canTick(g(false), { mine: true, kind: 'auto' }), false);
    assert.equal(L.canTick(g(false), { mine: false, kind: 'task' }), false);
    assert.equal(L.canTick(g(true), { mine: false, kind: 'auto' }), true);
    assert.equal(L.canTick(g(true, 'done'), { mine: true, kind: 'task' }), false);
  });
  it('FavorOS buttons show on open automatic steps for managers of an active run', () => {
    assert.equal(L.autoAction(g(true), { kind: 'auto', status: 'open', key: 'hubadd' }), 'hubadd');
    assert.equal(L.autoAction(g(false), { kind: 'auto', status: 'open', key: 'hubadd' }), '');
    assert.equal(L.autoAction(g(true), { kind: 'auto', status: 'done', key: 'hubclose' }), '');
    assert.equal(L.autoAction(g(true), { kind: 'task', status: 'open', key: 'hubadd' }), '');
  });
  it('failure words', () => {
    assert.match(L.failureWord(503, 'x', 'list'), /not switched on/);
    assert.match(L.failureWord(403, 'x', 'run'), /for HR, the supervisor/);
    assert.equal(L.failureWord(404, 'x', 'run'), 'No such onboarding.');
    assert.equal(L.failureWord(500, 'boom', 'list'), 'boom');
  });
  it('banner says which duties have no owner', () => {
    const b = L.bannerFor({ id: 'r', steps: 12, unset: ['hr', 'tech'] }, { run: { kind: 'onboard', name: 'Ada Example' }, tasks: true });
    assert.equal(b.title, 'Onboarding started for Ada Example');
    assert.match(b.lines[0], /12 steps.*task in Projects/);
    assert.match(b.lines[1], /HR file and shared drive, Technical access/);
  });
  it('events skip raw JSON details', () => {
    assert.equal(L.eventLine({ actor: 'Ada', event: 'completed', detail: '{"a":1}' }), 'Ada completed');
    assert.equal(L.eventLine({ actor: 'Ada', event: 'note', detail: 'hi' }), 'Ada note: hi');
  });
});

describe('registration', () => {
  it('/onboarding/ is a built web route and owns /onboarding/run/', () => {
    assert.ok(WEB_ROUTES.includes('/onboarding/'));
  });
});
