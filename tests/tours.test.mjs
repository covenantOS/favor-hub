// The tour of FavorOS: who gets which tour, the shape of each one (5 to 8 stops, Today first, Help last), which stops a person
// sees (Mail, Chat and Learn only for people in the group, Meetings and Projects only when open to them), the wording rules,
// the What's new tour built from the changelog, the skip and come-back rules, and each person's progress on the server before
// and after the hub_tours table and its step column exist. Made-up people only; the database is an in-memory copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { GRANTS, HR, WILL, call, learnWorld, rows } from './support/learn-world.mjs';

const D = await import('../web/src/features/tour/data.ts');
const N = await import('../web/src/features/tour/news.ts');
const S = await import('../src/scripts/tour-state.ts');
const { AREAS } = await import('../src/data/areas.ts');

const NO = { work: false, gifts: false, chat: false, mail: false, learn: false, meetings: false, projects: false, kpi: false, hr: false, approver: false, expenses: false, admin: false, early: false };
const person = (over = {}, can = {}, counts = {}) => ({ email: 'pat@favorintl.org', first: 'Pat', role: 'staff', jobs: [], teams: [], can: { ...NO, ...can }, counts, ...over });
const ALL = { work: true, gifts: true, chat: true, mail: true, learn: true, meetings: true, projects: true, kpi: true, hr: true, approver: true, expenses: true, early: true };

const WHO = {
  admin: person({ role: 'admin', jobs: ['admin'], teams: ['rdd', 'ce', 'pc', 'grants', 'marketing'] }, { ...ALL, admin: true }),
  exec: person({ jobs: ['exec'], teams: ['rdd', 'ce', 'pc', 'grants', 'marketing'] }, ALL),
  rdd: person({ jobs: ['rdd'], teams: ['rdd'] }, { ...ALL, gifts: false, hr: false, approver: false, expenses: false }),
  partner_care: person({ jobs: ['partner_care'], teams: ['pc'] }, { ...ALL, hr: false, approver: false, expenses: false }),
  church: person({ jobs: ['church'], teams: ['ce'] }, { ...ALL, gifts: false, hr: false, approver: false, expenses: false }),
  grants: person({ jobs: ['grants'], teams: ['grants'] }, { ...ALL, gifts: false, hr: false, approver: false, expenses: false }),
  support: person({ jobs: ['support', 'giftdesk'] }, { ...ALL, hr: false, approver: false, expenses: false }),
  marketing: person({ teams: ['marketing'] }, { kpi: true, projects: true, meetings: true }),
  staff: person({}, { kpi: true, meetings: true }),
};

test('each person gets the tour for their job: admins and leaders first, then a job, then a dashboard team, then the fallback', () => {
  for (const [id, who] of Object.entries(WHO)) assert.equal(D.pickTour(who), id, id);
  // A job beats a dashboard team, and an admin who is also on a team is still an admin.
  assert.equal(D.pickTour(person({ jobs: ['grants'], teams: ['marketing'] })), 'grants');
  assert.equal(D.pickTour(person({ role: 'admin', jobs: ['admin'] }, { admin: true })), 'admin');
  assert.equal(D.pickTour(person({ jobs: ['giftdesk'] })), 'support');
  // A job beats the five dashboard teams a test user or a leader holds; the five teams with no job are leadership.
  assert.equal(D.pickTour(person({ jobs: ['rdd'], teams: ['rdd', 'ce', 'pc', 'grants', 'marketing'] })), 'rdd');
  assert.equal(D.pickTour(person({ teams: ['rdd', 'ce', 'pc', 'grants', 'marketing'] })), 'exec');
  assert.equal(D.pickTour(person()), 'staff');
  // An admin can preview another job's tour; the old preset names still work.
  assert.equal(D.tourFromAs('pc'), 'partner_care');
  assert.equal(D.tourFromAs('ce'), 'church');
  assert.equal(D.tourFromAs('leader'), 'exec');
  assert.equal(D.tourFromAs('rdd'), 'rdd');
  assert.equal(D.tourFromAs('nope'), null);
});

test('who the person is comes from the nav answer: access flags, jobs, teams and the counts they already read', () => {
  const w = D.whoFromNav({
    user: { name: 'Pat Lee', email: 'Pat@favorintl.org', role: 'staff' },
    access: { workCenter: true, chat: true, mail: false, learn: true, giftEntry: true, kpi: true, expenseLog: true },
    counts: { workOpen: 12, chatMentions: 0, mailUnread: 3, private: 99 },
    kpiTeams: ['rdd'],
    jobs: ['rdd'],
  });
  assert.equal(w.email, 'pat@favorintl.org');
  assert.equal(w.first, 'Pat');
  assert.deepEqual(w.can, { ...NO, work: true, chat: true, learn: true, gifts: true, kpi: true, expenses: true });
  assert.deepEqual(w.counts, { workOpen: 12, mailUnread: 3 }, 'zero counts and unknown keys are left out');
  const none = D.whoFromNav(null);
  assert.equal(none.can.admin, false);
  assert.deepEqual(none.jobs, []);
  // An older answer with no jobs or teams still gives a person.
  assert.equal(D.pickTour(D.whoFromNav({ user: { name: 'A B', email: 'a@favorintl.org', role: 'staff' }, access: {} })), 'staff');
});

test('every tour is 5 to 8 stops on both devices, opens on Today and ends on Help', () => {
  for (const [id, who] of Object.entries(WHO)) {
    for (const device of ['phone', 'desk']) {
      const steps = D.tourFor(id, who, device);
      assert.ok(steps.length >= 5 && steps.length <= 8, `${id} on ${device}: ${steps.length} stops`);
      assert.equal(steps[0].id, 'today', id);
      assert.equal(steps.at(-1).id, 'help', id);
      assert.equal(new Set(steps.map((s) => s.id)).size, steps.length, `${id}: a stop is used twice`);
    }
  }
  // Someone with no access to anything optional still gets a real tour.
  assert.ok(D.tourFor('staff', person(), 'desk').length >= 4);
});

test('Mail, Chat, Learn, Meetings and Projects stops show only to people who can open that tool', () => {
  const ids = (who, tour) => D.tourFor(tour || D.pickTour(who), who, 'desk').map((s) => s.id);
  // Open to everyone with the flag, read from the nav answer (which already folds in the group settings).
  const wide = person({ jobs: ['rdd'], teams: ['rdd'] }, { ...ALL, admin: false });
  assert.ok(ids({ ...wide, can: { ...wide.can, mail: true } }).includes('mail'));
  assert.ok(!ids({ ...wide, can: { ...wide.can, mail: false } }).includes('mail'), 'no Mail stop without Mail');
  const grants = person({ jobs: ['grants'] }, { ...ALL, admin: false, gifts: false });
  for (const [need, id] of [['chat', 'chat'], ['mail', 'mail'], ['learn', 'learn'], ['meetings', 'meetings'], ['projects', 'projects']]) {
    for (const tour of D.TOUR_IDS) {
      const without = person({ jobs: ['grants'] }, { ...ALL, admin: false, [need]: false });
      assert.ok(!ids(without, tour).includes(id), `${tour}: ${id} stop without ${need}`);
    }
    void grants;
  }
  // Nothing points at the top bar's buttons (Make a request, Help, Feedback, Clips): the chrome moves and the stops must not.
  for (const s of D.allStepDefs()) for (const sel of s.at) assert.doesNotMatch(sel, /\.h-top|#lp-btn|#h-fb|#clip-|h-help/, `${s.id}: ${sel}`);
  // The Mail stop points at Compose.
  const mail = D.allStepDefs().find((s) => s.id === 'mail');
  assert.deepEqual(mail.at[0], '.ml-compose');
  assert.equal(mail.need, 'mail');
  // Every optional shared tool a tour could include is gated on its own flag.
  const need = Object.fromEntries(D.allStepDefs().filter((s) => s.need).map((s) => [s.id, s.need]));
  assert.equal(need.chat, 'chat');
  assert.equal(need.learn, 'learn');
  assert.equal(need.meetings, 'meetings');
  assert.equal(need.projects, 'projects');
  // A person in the Mail, Chat and Learn group who is on the RDD team keeps what fits in 8 stops, in the shared order.
  const full = ids(person({ jobs: ['rdd'], teams: ['rdd'] }, { ...ALL, admin: false }), 'rdd');
  assert.deepEqual(full, ['today', 'actions', 'mine', 'week', 'chat', 'mail', 'projects', 'help']);
  // The same person outside the group has no Chat, Mail or Learn stop, and gets Brain and the request form in their place.
  const out = ids(person({ jobs: ['rdd'], teams: ['rdd'] }, { ...ALL, admin: false, chat: false, mail: false, learn: false }), 'rdd');
  assert.deepEqual(out, ['today', 'actions', 'mine', 'week', 'brain', 'projects', 'request', 'help']);
});

test('the Church Engagement tour ends its team stops on Churches, not on My week', () => {
  const steps = D.tourFor('church', WHO.church, 'desk');
  const got = steps.map((s) => s.id);
  assert.ok(got.includes('churches') && !got.includes('week'), got.join(','));
  const c = steps.find((s) => s.id === 'churches');
  assert.equal(c.page, '/churches/');
  assert.doesNotMatch(c.body, /—/);
});

test('the Church Engagement and Partner Care Today stops do not promise My week', () => {
  const pc = D.tourFor('partner_care', WHO.partner_care, 'desk').find((s) => s.id === 'today');
  assert.doesNotMatch(pc.body, /week/i);
  const today = D.tourFor('church', WHO.church, 'desk').find((s) => s.id === 'today');
  assert.doesNotMatch(today.body, /week/i);
  assert.doesNotMatch(today.body, /—/);
  assert.match(D.tourFor('rdd', WHO.rdd, 'desk').find((s) => s.id === 'today').body, /your week/);
});

test('team stops need the access their screen needs', () => {
  const staffRdd = person({ jobs: ['rdd'] }, { work: false });
  const steps = D.tourFor('rdd', staffRdd, 'desk').map((s) => s.id);
  assert.ok(!steps.includes('actions') && !steps.includes('mine') && !steps.includes('week'), 'no Work Center, no Work Center stops');
  assert.equal(steps[0], 'today');
  assert.equal(steps.at(-1), 'help');
  const pc = D.tourFor('partner_care', person({ jobs: ['partner_care'] }, { work: true, gifts: false }), 'desk').map((s) => s.id);
  assert.ok(pc.includes('cadence') && !pc.includes('online-gifts'), 'online gifts needs gift entry access');
});

test('counts come only from the nav answer, are spoken only above zero, and say the same thing the badge does', () => {
  const rdd = WHO.rdd;
  const withCount = D.tourFor('rdd', { ...rdd, counts: { workOpen: 12, chatMentions: 3, projectsMine: 9 } }, 'desk');
  const byId = Object.fromEntries(withCount.map((s) => [s.id, s.body]));
  assert.match(byId.actions, /^12 actions and gifts to thank are waiting on you here\.$/);
  assert.match(byId.chat, /^3 mentions and unread messages wait for you in Chat\.$/);
  assert.match(byId.projects, /^Projects has 9 items waiting on you/);
  const one = D.tourFor('rdd', { ...rdd, counts: { workOpen: 1 } }, 'desk').find((s) => s.id === 'actions');
  assert.match(one.body, /^1 action or gift to thank is waiting/);
  const none = D.tourFor('rdd', rdd, 'desk').find((s) => s.id === 'actions');
  assert.doesNotMatch(none.body, /\d/);
  // No stop can show a number the nav answer did not hold: every digit in a body comes from a count.
  for (const [id, who] of Object.entries(WHO)) for (const s of D.tourFor(id, who, 'desk')) assert.doesNotMatch(s.body + s.title, /\d/, `${id}/${s.id}`);
});

test('every stop names a page and a menu item that exist, and something to point at', () => {
  const navIds = new Set(AREAS.flatMap((a) => a.pages.map((p) => p.id)));
  const hrefs = new Set(AREAS.flatMap((a) => a.pages.map((p) => p.href.replace(/\/+$/, '').split('?')[0])));
  for (const s of D.allStepDefs()) {
    assert.ok(s.page, `${s.id}: a page`);
    if (s.page) {
      assert.ok(s.via, `${s.id}: how to get there`);
      assert.ok(navIds.has(s.via), `${s.id}: nav id ${s.via}`);
      assert.ok(hrefs.has(s.page.replace(/\/+$/, '').split('?')[0]) || s.page === '/', `${s.id}: page ${s.page} is in the menu`);
    }
    assert.ok(s.at.length >= 1, `${s.id}: something to point at`);
    assert.ok(s.title.length <= 36, `${s.id}: title ${s.title.length} long`);
  }
});

test('copy: one short sentence per stop, no em dash, no donors, no AI, the device word comes from {tap}', () => {
  const texts = [];
  for (const [id, who] of Object.entries(WHO)) {
    for (const device of ['phone', 'desk']) {
      for (const counts of [{}, { workOpen: 4, chatMentions: 2, projectsMine: 5, expensesWaiting: 2, inbox: 3, learn: 2, meetingsNow: 1 }]) {
        for (const s of D.tourFor(id, { ...who, counts }, device)) texts.push([`${id}/${device}/${s.id}`, s.title, s.body]);
      }
    }
  }
  for (const [where, title, body] of texts) {
    for (const t of [title, body]) {
      assert.doesNotMatch(t.replace(/[{][Tt]ap[}]/g, ''), /\b(click|tap|clicks|taps)\b/i, `${where}: write {tap}, not the word`);
      assert.doesNotMatch(t, /donors?\b|—|–|(^|[^.\w])AI([^.\w]|$)|\bChatGPT\b|\bClaude\b|\bjust\b|\bsimply\b|\bactually\b/i, `${where}: ${t}`);
    }
    assert.ok(body.length <= 150, `${where}: ${body.length} characters`);
    // One sentence: a full stop only at the end.
    assert.equal(body.replace(/\.$/, '').includes('. '), false, `${where}: more than one sentence`);
    assert.match(body, /[.]$/, `${where}: ends with a full stop`);
  }
  assert.equal(D.say('{Tap} a card, then {tap} Done.', 'phone'), 'Tap a card, then tap Done.');
  assert.equal(D.say('{Tap} a card, then {tap} Done.', 'desk'), 'Click a card, then click Done.');
  // Nothing on a phone reads a keyboard shortcut.
  for (const [where, , body] of texts.filter((t) => t[0].includes('/phone/'))) assert.doesNotMatch(body, /\bCtrl\b|Command and|arrow key/, where);
});

const NEWS = {
  latest: '2026-10-14T22:45',
  entries: [
    { stamp: '2026-10-14T22:45', area: 'brain', type: 'improved', text: 'Photos in Favor Brain answers show again.' },
    { stamp: '2026-10-14T22:12', area: 'gifts', type: 'new', text: 'Gifts has a Recurring page.' },
    { stamp: '2026-10-14T22:10', area: 'mail', type: 'improved', text: "Mail's partner card uses the same giving as the partner page." },
    { stamp: '2026-10-13T09:00', area: 'chat', type: 'new', text: 'Chat has threads.' },
    { stamp: '2026-10-12T09:00', area: 'admin', type: 'new', text: 'Admin has a Tours page.' },
    { stamp: '2026-10-11T09:00', area: 'everywhere', type: 'improved', text: 'Dotted words explain themselves.' },
  ],
};

test("What's new: entries newer than the last visit, one stop per area, only for areas the person can open", () => {
  const staff = person({}, { kpi: true });
  const steps = N.newsSteps(staff, NEWS, '2026-10-13T00:00');
  // Gifts needs gift entry access, Mail needs Mail, Chat needs Chat: a plain staff member sees Favor Brain only.
  assert.deepEqual(steps.map((s) => s.title), ['New in Favor Brain']);
  const rich = person({}, { gifts: true, mail: true, chat: true });
  const all = N.newsSteps(rich, NEWS, '2026-10-13T00:00');
  assert.deepEqual(all.map((s) => s.title), ['New in Gifts', 'New in Chat', 'New in Favor Brain', 'New in Mail'], 'new before improved, then newest first');
  assert.equal(N.newsSteps(rich, NEWS, '2026-10-14T22:45').length, 0, 'nothing is newer than the newest');
  assert.equal(N.newsSteps(rich, NEWS, '').length, 0, 'a first visit is shown nothing');
  assert.equal(N.newsCount(rich, NEWS, '2026-10-13T00:00'), 4);
  assert.equal(N.newsCount(staff, NEWS, '2026-10-13T00:00'), 1);
  // An admin-only area shows to admins only; an area with no page shows as a card with nothing to point at.
  const adm = person({ role: 'admin' }, { admin: true });
  const a = N.newsSteps(adm, NEWS, '2026-10-10T00:00');
  assert.ok(a.some((s) => s.title === 'New in Admin'));
  assert.deepEqual(a.find((s) => s.title === 'New in FavorOS').at, []);
  assert.ok(!N.newsSteps(staff, NEWS, '2026-10-10T00:00').some((s) => s.title === 'New in Admin'));
  assert.ok(N.newsSteps(adm, { ...NEWS, entries: Array.from({ length: 12 }, (_, i) => ({ stamp: `2026-10-1${i % 9}T10:0${i % 10}`, area: ['today', 'brain', 'help', 'admin', 'gifts', 'mail', 'chat', 'learn', 'expenses', 'projects', 'foundations', 'lists'][i], type: 'new', text: 'Something changed.' })) }, '2026-09-01T00:00').length <= N.MAX_NEWS);
});

test('a changelog entry is cut to a sentence a card can hold, at a comma when it is long', () => {
  assert.equal(N.firstSentence('Gifts has a Recurring page for every monthly schedule. It lists the payments and declined charges for the year.'), 'Gifts has a Recurring page for every monthly schedule.');
  assert.equal(N.firstSentence('Data care, under Partners. It lists partners with no mailing address.'), 'Data care, under Partners. It lists partners with no mailing address.', 'a short heading takes the next sentence');
  assert.equal(N.firstSentence('One sentence with no stop'), 'One sentence with no stop');
  const long = N.firstSentence('Soft credit, DAF, LYBUNT, Lapsed, Major partner, Household and the Other payment type have a dotted underline, so point at one or tap it to read what it means for you today.');
  assert.ok(long.length <= 151 && long.endsWith('.'), long);
  assert.doesNotMatch(long, /(,|and|or|at|the)\.$/);
  const ask = N.firstSentence('Ask for photos or videos and Favor Brain shows them as a grid: the real count (photos of finds over 1,400), the best and sharpest first, 24 at a time with a Show more button.');
  assert.ok(ask.length <= 151 && ask.endsWith('.') && !/ at\.$/.test(ask), ask);
});

test('the changelog feeds the What\'s new file: the build reads src/content/changelog and writes news.json', () => {
  const cfg = fs.readFileSync('web/vite.tour.config.ts', 'utf8');
  assert.match(cfg, /src\/content\/changelog/);
  assert.match(cfg, /news\.json/);
  assert.ok(fs.readdirSync('src/content/changelog').filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).length > 3);
});

test('Skip for now: back the next working day, three returns, then never by itself', () => {
  assert.equal(S.nextWorkingDay('2026-10-08'), '2026-10-09'); // Thursday to Friday
  assert.equal(S.nextWorkingDay('2026-10-09'), '2026-10-12'); // Friday to Monday
  assert.equal(S.nextWorkingDay('2026-10-10'), '2026-10-12'); // Saturday to Monday
  assert.equal(S.nextWorkingDay('2026-10-11'), '2026-10-12'); // Sunday to Monday
  assert.equal(S.dayWord('2026-10-09', '2026-10-08'), 'tomorrow');
  assert.equal(S.dayWord('2026-10-12', '2026-10-09'), 'Monday');

  let p = {};
  assert.equal(S.mayOpen(p, 'core', '2026-10-08'), true, 'a new person gets it');
  let day = '2026-10-08';
  for (let n = 1; n <= 3; n++) {
    assert.equal(S.comesBack(p, 'core'), true);
    p = S.skip(p, 'core', day);
    assert.equal(p.core.n, n);
    assert.equal(S.mayOpen(p, 'core', day), false, 'not again the same day');
    day = p.core.until;
    assert.equal(S.mayOpen(p, 'core', day), true, `return ${n}`);
  }
  assert.equal(S.comesBack(p, 'core'), false);
  p = S.skip(p, 'core', day);
  assert.equal(S.mayOpen(p, 'core', '2027-01-04'), false, 'after the third return it waits on Help and Today');
  assert.equal(S.isDone(p, 'core'), false, 'and is still not done');
  p = S.finish(p, 'core');
  assert.equal(S.mayOpen(p, 'core', '2027-01-04'), false);
  assert.equal(S.isDone(p, 'core'), true);
});

test('the tour keeps its place, and a finished tour keeps none', () => {
  let p = S.place({}, 'core', 3, '2026-10-15T10:00:00.000Z');
  assert.deepEqual(p.core, { s: 'offered', n: 0, at: '2026-10-15T10:00:00.000Z', i: 3 });
  p = S.skip(p, 'core', '2026-10-15', '2026-10-15T10:05:00.000Z');
  p = { ...p, core: { ...p.core, i: 3 } };
  assert.equal(p.core.i, 3);
  assert.equal(S.mayOpen(p, 'core', '2026-10-15'), false);
  // Going back to the first stop clears the place.
  assert.equal(S.place({ core: { s: 'offered', n: 0, at: '2026-10-15T10:00:00.000Z', i: 3 } }, 'core', 0, '2026-10-15T10:01:00.000Z').core.i, undefined);
  // A done tour is not given a place again.
  const done = S.finish({}, 'core', '2026-10-15T11:00:00.000Z');
  assert.equal(S.place(done, 'core', 4), done);
  assert.equal(S.finish(p, 'core').core.i, undefined);
  // The step survives the clean-up that every copy goes through, and is kept in range.
  assert.equal(S.cleanProgress({ core: { s: 'offered', n: 0, at: '2026-10-15T10:00:00.000Z', i: 5 } }).core.i, 5);
  assert.equal(S.cleanProgress({ core: { s: 'offered', n: 0, at: '2026-10-15T10:00:00.000Z', i: 999 } }).core.i, 40);
  assert.equal(S.cleanProgress({ core: { s: 'offered', n: 0, at: '2026-10-15T10:00:00.000Z', i: 'x' } }).core.i, undefined);
});

test("the Eastern clock reads the way the changelog writes it", () => {
  assert.equal(S.etStamp('2026-10-15T10:45:00.000Z'), '2026-10-15T06:45');
  assert.equal(S.etStamp('2026-01-15T10:45:00.000Z'), '2026-01-15T05:45');
  assert.equal(S.etStamp('nonsense'), '');
});

test("two copies of a person's progress merge: done holds, and only Send again undoes it", () => {
  const done = { core: { s: 'done', n: 1, at: '2026-10-11T12:00:00.000Z' } };
  const laterSkip = { core: { s: 'snoozed', n: 2, until: '2026-10-12', at: '2026-10-11T13:00:00.000Z' } };
  assert.equal(S.merge(done, laterSkip).core.s, 'done');
  assert.equal(S.merge(laterSkip, done).core.s, 'done');
  const sent = S.requeue({}, 'core', '2026-10-11T14:00:00.000Z');
  assert.equal(S.merge(done, sent).core.s, 'queued');
  assert.equal(S.mayOpen(S.merge(done, sent), 'core', '2026-10-11'), true);
  const again = { core: { s: 'done', n: 0, at: '2026-10-11T15:00:00.000Z' } };
  assert.equal(S.merge(S.merge(done, sent), again).core.s, 'done');
  // The newer step wins between two browsers.
  const a = { core: { s: 'offered', n: 0, at: '2026-10-15T10:00:00.000Z', i: 2 } };
  const b = { core: { s: 'offered', n: 0, at: '2026-10-15T10:05:00.000Z', i: 4 } };
  assert.equal(S.merge(a, b).core.i, 4);
  assert.equal(S.merge(b, a).core.i, 4);
  // Unknown names and broken rows are dropped.
  assert.deepEqual(Object.keys(S.cleanProgress({ core: { s: 'done', n: 0, at: '2026-10-11T12:00:00Z' }, news: { s: 'done', n: 0, at: '2026-10-11T12:00:00Z' }, 'x; DROP': { s: 'done', n: 0, at: '2026-10-11T12:00:00Z' }, 'f:2026-10-11.chat': { s: 'nope', n: 0, at: 'x' } })).sort(), ['core', 'news']);
});

const hubCall = async (w, user, method, body) => {
  const mod = await import('../functions/api/hub/tours.ts');
  const headers = { 'Content-Type': 'application/json', 'X-Hub-Email': user.email, 'X-Hub-Name': user.name, 'X-Hub-Role': user.role, 'X-Hub-Via': user.via };
  const request = new Request('https://dash.favorintl.org/api/hub/tours', { method, headers, body: body ? JSON.stringify(body) : undefined });
  const res = await (method === 'GET' ? mod.onRequestGet : mod.onRequestPost)({ request, env: w.env, waitUntil: (p) => w.pending.push(p) });
  await Promise.allSettled(w.pending.splice(0));
  return res.json();
};
const adminCall = async (w, user, method, body) => {
  const mod = await import('../functions/api/admin/tours.ts');
  const headers = { 'Content-Type': 'application/json', 'X-Hub-Email': user.email, 'X-Hub-Name': user.name, 'X-Hub-Role': user.role, 'X-Hub-Via': user.via, 'X-Hub-Request': '1', Origin: 'https://dash.favorintl.org', 'Sec-Fetch-Site': 'same-origin' };
  const request = new Request('https://dash.favorintl.org/api/admin/tours', { method, headers, body: body ? JSON.stringify(body) : undefined });
  const res = await (method === 'GET' ? mod.onRequestGet : mod.onRequestPost)({ request, env: w.env, waitUntil: (p) => w.pending.push(p) });
  return { status: res.status, data: await res.json() };
};
const AT = '2026-10-11T12:00:00.000Z';

test('before the table exists the server says not ready and stores nothing', async () => {
  const w = learnWorld();
  assert.deepEqual(await hubCall(w, GRANTS, 'GET'), { ok: true, ready: false, items: {} });
  assert.deepEqual(await hubCall(w, GRANTS, 'POST', { items: { core: { s: 'done', n: 0, at: AT } } }), { ok: true, ready: false, items: {} });
  const a = await adminCall(w, WILL, 'GET');
  assert.equal(a.data.ready, false);
  assert.deepEqual(a.data.releases, []);
  assert.equal((await adminCall(w, WILL, 'POST', { what: 'core', emails: [GRANTS.email] })).status, 409);
});

test('with the table: progress and the step are kept per person, finishing the tour completes the Learn lesson, admins see adoption and send again', async () => {
  const w = learnWorld();
  w.d1.exec(fs.readFileSync('db/tours.sql', 'utf8'));
  w.d1.exec(fs.readFileSync('db/tours.sql', 'utf8')); // safe to run twice
  w.d1.exec(fs.readFileSync('db/tours-step.sql', 'utf8'));
  await call(w, WILL, 'GET', 'home'); // writes the starter courses, FavorOS basics among them

  const first = await hubCall(w, GRANTS, 'POST', { items: { core: { s: 'offered', n: 0, at: AT, i: 3 }, news: { s: 'done', n: 0, at: AT }, 'f:2026-10-11.nope': { s: 'done', n: 0, at: AT } } });
  assert.equal(first.ready, true);
  assert.deepEqual(Object.keys(first.items).sort(), ['core', 'news'], 'only the tour and the What\'s new line are kept');
  assert.equal(first.items.core.i, 3, 'the step comes back');
  assert.equal((await hubCall(w, GRANTS, 'GET')).items.core.i, 3);
  assert.deepEqual((await hubCall(w, HR, 'GET')).items, {}, 'one person never reads another person\'s progress');

  // A skip keeps the step; going on moves it.
  await hubCall(w, GRANTS, 'POST', { items: { core: { s: 'snoozed', n: 1, until: '2026-10-12', at: '2026-10-11T12:30:00.000Z', i: 3 } } });
  const skipped = (await hubCall(w, GRANTS, 'GET')).items.core;
  assert.deepEqual([skipped.s, skipped.n, skipped.until, skipped.i], ['snoozed', 1, '2026-10-12', 3]);

  await hubCall(w, GRANTS, 'POST', { items: { core: { s: 'done', n: 1, at: '2026-10-11T13:00:00.000Z' } } });
  const lesson = rows(w, "SELECT p.state FROM learn_progress p JOIN learn_lessons l ON l.id = p.lesson_id WHERE p.email = ? AND l.ref = 'guided-tour'", GRANTS.email);
  assert.deepEqual(lesson.map((r) => r.state), ['done'], 'the guided tour lesson of FavorOS basics is complete');
  assert.equal((await hubCall(w, GRANTS, 'GET')).items.core.i, undefined, 'a finished tour keeps no step');
  // An older copy from another browser cannot undo it.
  assert.equal((await hubCall(w, GRANTS, 'POST', { items: { core: { s: 'snoozed', n: 3, until: '2026-10-13', at: '2026-10-11T14:00:00.000Z' } } })).items.core.s, 'done');

  assert.equal((await adminCall(w, GRANTS, 'GET')).status, 403, 'adoption is for admins');
  const a = (await adminCall(w, WILL, 'GET')).data;
  const gus = a.people.find((p) => p.email === GRANTS.email);
  assert.equal(gus.core.state, 'done');
  assert.equal(a.people.find((p) => p.email === HR.email).core.state, '');

  // Send again to one person, then to a team.
  assert.equal((await adminCall(w, WILL, 'POST', { what: 'core', emails: [GRANTS.email] })).data.sent, 1);
  const after = (await hubCall(w, GRANTS, 'GET')).items;
  assert.equal(after.core.s, 'queued');
  assert.equal(S.mayOpen(after, 'core', '2026-10-11'), true);
  assert.equal((await adminCall(w, WILL, 'POST', { what: 'core', team: 'Grants' })).data.sent, 1);
  assert.equal((await adminCall(w, WILL, 'POST', { what: 'r:2026-10-11', team: 'Grants' })).status, 400, 'releases are gone');
  assert.equal((await adminCall(w, WILL, 'POST', { what: 'core', team: 'Nobody' })).status, 400);
});

test('without the step column the server still keeps everything else', async () => {
  const w = learnWorld();
  w.d1.exec(fs.readFileSync('db/tours.sql', 'utf8'));
  const out = await hubCall(w, GRANTS, 'POST', { items: { core: { s: 'snoozed', n: 1, until: '2026-10-12', at: AT, i: 4 }, news: { s: 'done', n: 0, at: AT } } });
  assert.equal(out.ready, true);
  const got = (await hubCall(w, GRANTS, 'GET')).items;
  assert.deepEqual([got.core.s, got.core.n, got.core.until], ['snoozed', 1, '2026-10-12']);
  assert.equal(got.news.s, 'done');
  assert.equal(got.core.i, undefined, 'the step waits for db/tours-step.sql');
});

test('the files the tour is built from are where the next person will look', () => {
  const data = fs.readFileSync('web/src/features/tour/data.ts', 'utf8');
  assert.match(data, /WHO SEES A STOP/);
  assert.ok(fs.existsSync('src/pages/admin/tours/index.astro'));
  assert.match(fs.readFileSync('src/data/areas.ts', 'utf8'), /id: 'admin-tours'/);
  assert.match(fs.readFileSync('db/tours.sql', 'utf8'), /CREATE TABLE IF NOT EXISTS hub_tours/);
  assert.doesNotMatch(fs.readFileSync('db/tours.sql', 'utf8'), /\b(ALTER|DROP|DELETE|UPDATE)\b/);
  assert.match(fs.readFileSync('db/tours-step.sql', 'utf8'), /ALTER TABLE hub_tours ADD COLUMN step/);
  // The old tour is gone from the classic layout: hub.ts loads the island and nothing imports the old files.
  assert.ok(!fs.existsSync('src/scripts/tour.ts'));
  assert.ok(!fs.existsSync('src/scripts/tours.ts'));
  const hub = fs.readFileSync('src/scripts/hub.ts', 'utf8');
  assert.match(hub, /_tour\/tour\.js/);
  assert.doesNotMatch(hub, /initTour/);
  assert.match(fs.readFileSync('web/src/shell/WebShell.tsx', 'utf8'), /<TourHost \/>/);
});
