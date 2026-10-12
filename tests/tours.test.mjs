// The tour of FavorOS and New in FavorOS: the shape of the tours (a short core tour for every role, at most 8 walkthroughs in a
// release, 1 to 4 steps each, an article behind each), the wording rules, the skip and come-back rules, and each person's progress
// on the server before and after the hub_tours table exists. Made-up people only; the database is an in-memory copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { GRANTS, HR, WILL, call, learnWorld, rows } from './support/learn-world.mjs';

const T = await import('../src/scripts/tours.ts');
const S = await import('../src/scripts/tour-state.ts');

const BASE = { admin: false, approver: false, expenseLog: false, work: false, kpi: true, teams: [], leader: false, first: 'Pat', chat: false, projects: false, meetings: false, clips: true, hr: false };
const ADMIN = { ...BASE, admin: true, work: true, chat: true, projects: true, meetings: true, hr: true, teams: ['rdd', 'ce', 'pc', 'grants', 'marketing'], leader: true };
const roles = { admin: ADMIN, ...Object.fromEntries(Object.entries(T.PRESETS).map(([k, v]) => [k, { ...BASE, ...v }])) };

test('the core tour is 8 to 10 stops for every role, on a phone and on a computer', () => {
  for (const [name, who] of Object.entries(roles)) {
    for (const device of ['phone', 'desk']) {
      const steps = T.coreFor(who, device);
      assert.ok(steps.length >= 8 && steps.length <= 10, `${name} on ${device}: ${steps.length} stops`);
      assert.equal(steps[0].id, 'core-today');
    }
  }
  // One stop is for the person's own job, and nobody gets two.
  const job = (who) => T.coreFor(who, 'desk').filter((s) => ['core-partners', 'core-cadence', 'core-grants', 'core-receipts', 'core-kpi', 'core-admin'].includes(s.id)).map((s) => s.id);
  assert.deepEqual(job(roles.rdd), ['core-partners']);
  assert.deepEqual(job(roles.pc), ['core-cadence']);
  assert.deepEqual(job(roles.grants), ['core-grants']);
  assert.deepEqual(job(roles.marketing), ['core-receipts']);
  assert.deepEqual(job(roles.leader), ['core-kpi']);
  assert.deepEqual(job(roles.admin), ['core-admin']);
  assert.deepEqual(job(roles.staff), []);
});

test('a release has at most 8 walkthroughs of 1 to 4 steps, each with a help article, and a clip that exists', () => {
  const videos = new Set(JSON.parse(fs.readFileSync('src/data/videos.json', 'utf8')).map((v) => v.slug));
  const ids = new Set();
  for (const r of T.RELEASES) {
    assert.match(r.id, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.features.length >= 1 && r.features.length <= 8, `${r.id}: ${r.features.length} walkthroughs`);
    for (const f of r.features) {
      assert.ok(f.steps.length >= 1 && f.steps.length <= 4, `${f.id}: ${f.steps.length} steps`);
      assert.ok(fs.existsSync(`src/content/help/${f.article}.md`), `${f.id}: article ${f.article}`);
      if (f.clip) assert.ok(videos.has(f.clip), `${f.id}: clip ${f.clip}`);
      assert.ok(f.short.length <= 14, `${f.id}: short label`);
      assert.ok(f.steps[0].page ? f.steps[0].via : true, `${f.id}: the first step says how to get to its page`);
      assert.ok(ICONS.includes(`  ${f.icon}:`), `${f.id}: icon ${f.icon}`);
      for (const device of ['phone', 'desk']) assert.ok(T.featureSteps(f, ADMIN, device).length >= 1, `${f.id} has a step on ${device}`);
    }
  }
  for (const s of [...T.CORE, ...T.RELEASES.flatMap((r) => r.features.flatMap((f) => f.steps)), ...T.STEPS]) {
    assert.ok(!ids.has(s.id), `step id used twice: ${s.id}`);
    ids.add(s.id);
  }
  assert.equal(T.RELEASES[0].id, '2026-10-12');
  assert.equal(T.RELEASES[1].id, '2026-10-11');
  assert.equal(T.RELEASES[1].features.length, 8);
});
const ICONS = fs.readFileSync('src/data/icons.ts', 'utf8');

test('each walkthrough shows only to the people who can open the feature', () => {
  const titles = (who) => T.offersFor(who).map((o) => o.feature.id);
  assert.deepEqual(titles(roles.staff), ['requests', 'today-meetings', 'clips']);
  assert.deepEqual(titles({ ...roles.staff, clips: false }), ['requests', 'today-meetings']);
  assert.ok(titles({ ...roles.staff, chat: true }).includes('chat'));
  assert.ok(titles({ ...roles.staff, chat: true }).includes('chat-brain'));
  assert.ok(titles({ ...roles.staff, projects: true }).includes('projects'));
  assert.ok(titles(roles.rdd).includes('wc-groups'));
  assert.ok(!titles(roles.rdd).includes('receipts-statements'));
  assert.ok(titles(roles.marketing).includes('receipts-statements'));
  assert.equal(titles(ADMIN).length, 10);
  assert.ok(titles({ ...roles.staff, chat: true }).includes('dock'));
  assert.ok(!titles(roles.staff).includes('dock'));
});

test('copy: the device word comes from {tap}, and nothing says donor, names its tools or uses an em dash', () => {
  const texts = [];
  const add = (s, who) => {
    for (const part of [s, s.phone || {}, s.desk || {}]) {
      if (part.title) texts.push([s.id, part.title]);
      if (part.body) texts.push([s.id, typeof part.body === 'function' ? part.body(who) : part.body]);
    }
  };
  for (const who of [ADMIN, roles.staff]) {
    T.CORE.forEach((s) => add(s, who));
    T.RELEASES.forEach((r) => r.features.forEach((f) => { texts.push([f.id, f.title + ' ' + f.blurb]); f.steps.forEach((s) => add(s, who)); }));
  }
  for (const [id, t] of texts) {
    assert.doesNotMatch(t.replace(/[{][Tt]ap[}]/g, ''), /\b(click|tap|clicks|taps)\b/i, `${id}: write {tap}, not the word`);
    assert.doesNotMatch(t, /donors?\b|—|(^|[^.\w])AI([^.\w]|$)|\bChatGPT\b|\bClaude\b/, `${id}: ${t}`);
  }
  assert.equal(T.say('{Tap} a card, then {tap} Done.', 'phone'), 'Tap a card, then tap Done.');
  assert.equal(T.say('{Tap} a card, then {tap} Done.', 'desk'), 'Click a card, then click Done.');
  // A phone never reads keyboard shortcuts in the core tour or a walkthrough.
  for (const s of [...T.coreFor(ADMIN, 'phone'), ...T.offersFor(ADMIN).flatMap((o) => T.featureSteps(o.feature, ADMIN, 'phone'))]) {
    const body = typeof s.body === 'function' ? s.body(ADMIN) : s.body;
    assert.doesNotMatch(body, /\bCtrl\b|Command and|arrow key/, s.id);
  }
});

test('a step can differ by device, or be left out on one', () => {
  const cam = T.findStep('n-clip-cam');
  assert.equal(T.resolveStep(cam, 'phone'), null);
  assert.equal(T.resolveStep(cam, 'desk').at, '#clip-cam');
  assert.equal(T.resolveStep(T.findStep('core-menu'), 'phone').at, '#h-bar');
  assert.equal(T.resolveStep(T.findStep('core-menu'), 'desk').at, '.h-side .h-areas');
  assert.ok(T.pageSteps(ADMIN, '/work/', 'desk').length > 3);
  assert.equal(T.pageSteps(roles.staff, '/admin/', 'desk').length, 0);
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

test('two copies of a person\'s progress merge: done holds, and only Send again undoes it', () => {
  const done = { core: { s: 'done', n: 1, at: '2026-10-11T12:00:00.000Z' } };
  const laterSkip = { core: { s: 'snoozed', n: 2, until: '2026-10-12', at: '2026-10-11T13:00:00.000Z' } };
  assert.equal(S.merge(done, laterSkip).core.s, 'done');
  assert.equal(S.merge(laterSkip, done).core.s, 'done');
  const sent = S.requeue({}, 'core', '2026-10-11T14:00:00.000Z');
  assert.equal(S.merge(done, sent).core.s, 'queued');
  assert.equal(S.mayOpen(S.merge(done, sent), 'core', '2026-10-11'), true);
  const again = { core: { s: 'done', n: 0, at: '2026-10-11T15:00:00.000Z' } };
  assert.equal(S.merge(S.merge(done, sent), again).core.s, 'done');
  // Unknown names and broken rows are dropped.
  assert.deepEqual(Object.keys(S.cleanProgress({ core: { s: 'done', n: 0, at: '2026-10-11T12:00:00Z' }, 'x; DROP': { s: 'done', n: 0, at: '2026-10-11T12:00:00Z' }, 'f:2026-10-11.chat': { s: 'nope', n: 0, at: 'x' } })), ['core']);
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
  assert.equal(a.data.releases[0].title, 'October 12');
  assert.equal((await adminCall(w, WILL, 'POST', { what: 'core', emails: [GRANTS.email] })).status, 409);
});

test('with the table: progress is kept per person, finishing the tour completes the Learn lesson, admins see adoption and send again', async () => {
  const w = learnWorld();
  w.d1.exec(fs.readFileSync('db/tours.sql', 'utf8'));
  w.d1.exec(fs.readFileSync('db/tours.sql', 'utf8')); // safe to run twice
  await call(w, WILL, 'GET', 'home'); // writes the starter courses, FavorOS basics among them

  const first = await hubCall(w, GRANTS, 'POST', { items: { core: { s: 'snoozed', n: 1, until: '2026-10-12', at: AT }, 'f:2026-10-11.requests': { s: 'offered', n: 0, at: AT }, 'f:2026-10-11.nope': { s: 'done', n: 0, at: AT } } });
  assert.equal(first.ready, true);
  assert.deepEqual(Object.keys(first.items).sort(), ['core', 'f:2026-10-11.requests'], 'a feature that is not in the tours file is dropped');
  assert.equal((await hubCall(w, GRANTS, 'GET')).items.core.n, 1);
  assert.deepEqual((await hubCall(w, HR, 'GET')).items, {}, 'one person never reads another person\'s progress');

  await hubCall(w, GRANTS, 'POST', { items: { core: { s: 'done', n: 1, at: '2026-10-11T13:00:00.000Z' }, 'f:2026-10-11.requests': { s: 'done', n: 0, at: '2026-10-11T13:00:00.000Z' } } });
  const lesson = rows(w, "SELECT p.state FROM learn_progress p JOIN learn_lessons l ON l.id = p.lesson_id WHERE p.email = ? AND l.ref = 'guided-tour'", GRANTS.email);
  assert.deepEqual(lesson.map((r) => r.state), ['done'], 'the guided tour lesson of FavorOS basics is complete');
  // An older copy from another browser cannot undo it.
  assert.equal((await hubCall(w, GRANTS, 'POST', { items: { core: { s: 'snoozed', n: 3, until: '2026-10-13', at: '2026-10-11T14:00:00.000Z' } } })).items.core.s, 'done');

  assert.equal((await adminCall(w, GRANTS, 'GET')).status, 403, 'adoption is for admins');
  const a = (await adminCall(w, WILL, 'GET')).data;
  const gus = a.people.find((p) => p.email === GRANTS.email);
  assert.equal(gus.core.state, 'done');
  assert.deepEqual(gus.releases['2026-10-11'], { done: 1, shown: 1, skips: 0, at: '2026-10-11T13:00:00.000Z', features: { requests: 'done' } });
  assert.equal(a.people.find((p) => p.email === HR.email).core.state, '');

  // Send again to one person, then to a team.
  assert.equal((await adminCall(w, WILL, 'POST', { what: 'core', emails: [GRANTS.email] })).data.sent, 1);
  const after = (await hubCall(w, GRANTS, 'GET')).items;
  assert.equal(after.core.s, 'queued');
  assert.equal(S.mayOpen(after, 'core', '2026-10-11'), true);
  assert.equal(after['f:2026-10-11.requests'].s, 'done', 'the release was not sent');
  assert.equal((await adminCall(w, WILL, 'POST', { what: 'r:2026-10-11', team: 'Grants' })).data.sent, 1);
  const rel = (await hubCall(w, GRANTS, 'GET')).items;
  assert.equal(rel['f:2026-10-11.requests'].s, 'queued');
  assert.equal(rel['r:2026-10-11'].s, 'queued');
  assert.equal((await adminCall(w, WILL, 'POST', { what: 'r:1999-01-01', team: 'Grants' })).status, 400);
  assert.equal((await adminCall(w, WILL, 'POST', { what: 'core', team: 'Nobody' })).status, 400);
});

test('the rule for shipping a feature is written where the next person will read it, and the pages exist', () => {
  assert.match(fs.readFileSync('src/scripts/tours.ts', 'utf8'), /SHIPPING A FEATURE/);
  assert.ok(fs.existsSync('src/pages/admin/tours/index.astro'));
  assert.match(fs.readFileSync('src/data/areas.ts', 'utf8'), /id: 'admin-tours'/);
  assert.match(fs.readFileSync('src/content/help/whats-new.md', 'utf8'), /\*\*A shorter tour, and New in FavorOS\.\*\*/);
  assert.match(fs.readFileSync('src/content/help/guided-tour.md', 'utf8'), /Skip for now/);
  assert.match(fs.readFileSync('db/tours.sql', 'utf8'), /CREATE TABLE IF NOT EXISTS hub_tours/);
  assert.doesNotMatch(fs.readFileSync('db/tours.sql', 'utf8'), /\b(ALTER|DROP|DELETE|UPDATE)\b/);
});
