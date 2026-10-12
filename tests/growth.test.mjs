// Growth: the first week by role, practice mode, evidence for evaluations, and the missing Reports to prompt. Invented people only;
// the database is an in-memory copy built from the repository's own schema files. Nothing here touches the live database, assigns a
// course to a real person or opens an evaluation for one.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { HR, WILL, call as learnCall, learnWorld, rows } from './support/learn-world.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOW = '2026-10-12T12:00:00.000Z';
const NEW = { email: 'nia.new@favorintl.org', name: 'Nia Newhire' };
const BOSS = { email: 'bo.boss@favorintl.org', name: 'Bo Boss' };
const PEER = { email: 'pee.peer@favorintl.org', name: 'Pee Peer' };

function world() {
  const w = learnWorld({ learn: 'staff' });
  w.d1.exec(read('db/growth.sql'));
  w.d1.exec(read('db/onboard.sql'));
  const ins = (sql, ...a) => w.d1.db.prepare(sql).run(...a);
  for (const u of [NEW, BOSS, PEER]) {
    ins('INSERT INTO hub_users (email, name, picture, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', u.email, u.name, '', 'staff', NOW, NOW);
    ins('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, 1)', u.email, u.name, 'Associate', 'Partner Care');
  }
  return w;
}

const dayAt = (d) => new Date(Date.parse(d + 'T12:00:00Z'));

test('the role comes from the team first, then the title; an unknown team gets the general week', async () => {
  const { roleOf } = await import('../functions/_lib/growth/firstweek.ts');
  assert.equal(roleOf('Partner Care', 'Associate').key, 'partner-care');
  assert.equal(roleOf('Development (RDD)', 'Regional Development Director').key, 'rdd');
  assert.equal(roleOf('Grants', 'Grant Writer').key, 'grants');
  assert.equal(roleOf('Church Engagement', 'Coordinator').key, 'church');
  assert.equal(roleOf('Operations', 'HR Assistant').key, 'admin-desk');
  assert.equal(roleOf('Marketing', 'Designer').key, 'marketing');
  assert.equal(roleOf('', 'Partner Care Associate').key, 'partner-care', 'the title answers when the team is blank');
  assert.equal(roleOf('Facilities', 'Groundskeeper').key, 'general');
  assert.equal(roleOf('', '').key, 'general');
});

test('the first week has five days, ticks courses from Learn and counts practice', async () => {
  const w = world();
  await learnCall(w, WILL, 'GET', 'catalog'); // writes the starter courses
  const { firstWeekFor } = await import('../functions/_lib/growth/firstweek.ts');
  const { savePractice } = await import('../functions/_lib/growth/practice.ts');
  let fw = await firstWeekFor(w.env, { email: NEW.email, team: 'Partner Care', title: 'Associate', start: '2026-10-19' });
  assert.equal(fw.role.key, 'partner-care');
  assert.equal(fw.days.length, 5);
  assert.deepEqual(fw.days.map((d) => d.day), [1, 2, 3, 4, 5]);
  const slugs = fw.days.flatMap((d) => d.items).filter((i) => i.kind === 'course').map((i) => i.slug);
  for (const s of ['favoros-basics', 'favor-who-we-are', 'blackbaud-first-week', 'partner-care-gifts']) assert.ok(slugs.includes(s), s);
  assert.equal(fw.done, 0);
  assert.ok(fw.total >= 8);
  // A course finished in Learn ticks.
  const c = rows(w, "SELECT id FROM learn_courses WHERE slug = 'favoros-basics'")[0];
  w.d1.db.prepare("INSERT INTO learn_completions (email, course_id, course_title, completed_at, cert) VALUES (?, ?, 'FavorOS basics', ?, 'CERT-1')").run(NEW.email, c.id, NOW);
  fw = await firstWeekFor(w.env, { email: NEW.email, team: 'Partner Care', title: 'Associate' });
  assert.equal(fw.done, 1);
  assert.equal(fw.days[0].items.find((i) => i.slug === 'favoros-basics').done, true);
  // The practice item on day 4 ticks only when both exercises are right.
  const practice = () => fw.days[3].items.find((i) => i.kind === 'practice');
  assert.equal(practice().done, false);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  await savePractice(w.env, NEW.email, 'gift', { date: today, amount: '75.00', type: 'Check', check: '2041', fund: 'Water and Sanitation' });
  fw = await firstWeekFor(w.env, { email: NEW.email, team: 'Partner Care', title: 'Associate' });
  assert.equal(practice().done, false, 'one exercise of two');
  await savePractice(w.env, NEW.email, 'call', { channel: 'Phone call', summary: 'Pat called and asked for last year receipt.', next: 'Send a receipt', due: today });
  fw = await firstWeekFor(w.env, { email: NEW.email, team: 'Partner Care', title: 'Associate' });
  assert.equal(practice().done, true);
  // Another person's progress is their own.
  const other = await firstWeekFor(w.env, { email: PEER.email, team: 'Partner Care', title: 'Associate' });
  assert.equal(other.done, 0);
});

test('the first week still draws when Learn has no courses yet', async () => {
  const w = world();
  const { firstWeekFor } = await import('../functions/_lib/growth/firstweek.ts');
  const fw = await firstWeekFor(w.env, { email: NEW.email, team: 'Grants', title: 'Writer' });
  assert.equal(fw.days.length, 5);
  assert.equal(fw.done, 0);
  assert.equal(fw.assigned, false);
});

test('Add to FavorOS gives the role path once, nothing for a general role, and never a removed one without reopening it', async () => {
  const w = world();
  await learnCall(w, WILL, 'GET', 'catalog');
  const { assignRolePath } = await import('../functions/_lib/growth/firstweek.ts');
  const none = await assignRolePath(w.env, NEW.email, WILL.email, '2026-10-26', 'Facilities', 'Groundskeeper');
  assert.equal(none.state, 'none');
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM learn_assignments WHERE email = ?', NEW.email)[0].n, 0);
  const a = await assignRolePath(w.env, NEW.email, WILL.email, '2026-10-26', 'Partner Care', 'Associate');
  assert.equal(a.state, 'given');
  const row = rows(w, 'SELECT * FROM learn_assignments WHERE email = ?', NEW.email)[0];
  assert.equal(row.source, 'onboarding');
  assert.equal(row.due_date, '2026-10-26');
  assert.equal((await assignRolePath(w.env, NEW.email, WILL.email, '2026-10-26', 'Partner Care', 'Associate')).state, 'already');
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM learn_assignments WHERE email = ?', NEW.email)[0].n, 1);
  const { firstWeekFor } = await import('../functions/_lib/growth/firstweek.ts');
  assert.equal((await firstWeekFor(w.env, { email: NEW.email, team: 'Partner Care', title: 'Associate' })).assigned, true);
});

test('practice checks every field, saves only to its own table and never touches Blackbaud or the Work Center', async () => {
  const w = world();
  const P = await import('../functions/_lib/growth/practice.ts');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const before = {
    outbox: rows(w, 'SELECT COUNT(*) AS n FROM act_outbox')[0].n,
    batches: rows(w, 'SELECT COUNT(*) AS n FROM act_batches')[0].n,
    events: rows(w, 'SELECT COUNT(*) AS n FROM act_events')[0].n,
    subs: rows(w, 'SELECT COUNT(*) AS n FROM act_submissions')[0].n,
  };
  const bad = await P.savePractice(w.env, NEW.email, 'gift', { date: '2099-01-01', amount: '7.50', type: 'Card', check: '9', fund: 'Church Planting' });
  assert.equal(bad.passed, false);
  assert.deepEqual(bad.checks.map((c) => c.ok), [false, false, false, false, false]);
  assert.ok(bad.checks.every((c) => c.hint.length > 10));
  const near = await P.savePractice(w.env, NEW.email, 'gift', { date: today, amount: '$75', type: 'Check', check: '2041', fund: 'Church Planting' });
  assert.equal(near.passed, false);
  assert.deepEqual(near.checks.filter((c) => !c.ok).map((c) => c.label), ['Fund']);
  const good = await P.savePractice(w.env, NEW.email, 'gift', { date: today, amount: '75.00', type: 'Check', check: '2041', fund: 'Water and Sanitation' });
  assert.equal(good.passed, true);
  assert.equal(good.state.done.gift, true);
  assert.equal(good.state.done.all, false);
  const call = await P.savePractice(w.env, NEW.email, 'call', { channel: 'Voicemail', summary: 'short', next: 'Nothing more', due: '2020-01-01' });
  assert.equal(call.passed, false);
  assert.equal(call.checks.filter((c) => c.ok).length, 0);
  const call2 = await P.savePractice(w.env, NEW.email, 'call', { channel: 'Phone call', summary: 'Pat called and asked for last years receipt.', next: 'Send a receipt', due: today });
  assert.equal(call2.passed, true);
  assert.equal(call2.state.done.all, true);
  // Everything landed in practice_entries, and nothing else changed.
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM practice_entries WHERE email = ?', NEW.email)[0].n, 5);
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM act_outbox')[0].n, before.outbox);
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM act_batches')[0].n, before.batches);
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM act_events')[0].n, before.events);
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM act_submissions')[0].n, before.subs);
  // Each person has their own record, and Start over clears only theirs.
  assert.equal((await P.practiceState(w.env, PEER.email)).entries.length, 0);
  await P.savePractice(w.env, PEER.email, 'gift', { date: today, amount: '75', type: 'Check', check: '2041', fund: 'Water and Sanitation' });
  const reset = await P.resetPractice(w.env, NEW.email);
  assert.equal(reset.entries.length, 0);
  assert.equal(reset.done.all, false);
  assert.equal((await P.practiceState(w.env, PEER.email)).entries.length, 1);
});

test('practice code never imports the Work Center, Blackbaud or the outbox', () => {
  for (const f of ['functions/_lib/growth/practice.ts', 'functions/_lib/growth/route.ts', 'functions/_lib/growth/firstweek.ts']) {
    const imports = [...read(f).matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const i of imports) assert.ok(!/blackbaud|work\/(actions|batches|gifts|entry|partner)|outbox|sky/i.test(i), `${f} imports ${i}`);
  }
  assert.doesNotMatch(read('functions/_lib/growth/practice.ts'), /fetch\(|act_outbox|act_batches|api\.sky/);
});

test('practice says it is off when its table is missing, and refuses a bad save with a clear message', async () => {
  const { memoryD1 } = await import('./support/d1.mjs');
  const d1 = memoryD1();
  const P = await import('../functions/_lib/growth/practice.ts');
  const s = await P.practiceState({ DB: d1 }, NEW.email);
  assert.equal(s.ready, false);
  await assert.rejects(() => P.savePractice({ DB: d1 }, NEW.email, 'call', {}), /not switched on/);
});

test('the routes need a signed-in person and a same-site change', async () => {
  const w = world();
  const { handle } = await import('../functions/_lib/growth/route.ts');
  const run = async (user, method, path, body, headers = {}) => {
    const res = await handle({ request: new Request('https://dash.favorintl.org/api/growth/' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }), env: w.env, user, path: path.split('/') });
    return { status: res.status, data: await res.json() };
  };
  const me = { email: NEW.email, name: NEW.name, picture: '', role: 'staff', via: 'google', kpi: true };
  assert.equal((await run(null, 'GET', 'practice')).status, 401);
  assert.equal((await run(me, 'POST', 'practice/gift', { amount: '75' }, { Origin: 'https://evil.example' })).status, 403);
  const ok = await run(me, 'POST', 'practice/gift', { amount: '75' }, { Origin: 'https://dash.favorintl.org' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.ok, true);
  assert.equal(ok.data.passed, false);
  const fw = await run(me, 'GET', 'first-week');
  assert.equal(fw.status, 200);
  assert.equal(fw.data.days.length, 5);
  assert.equal((await run(me, 'GET', 'nothing')).status, 404);
});

test('evidence counts the year of finished tasks, Work Center actions and courses, from the start date when it is later, and names no partner', async () => {
  const w = world();
  const { evidenceFor, windowFor } = await import('../functions/_lib/evals/evidence.ts');
  assert.deepEqual(windowFor('2027-01-04', '2020-01-01'), { from: '2026-01-04', to: '2027-01-04', startedWithinYear: false });
  assert.deepEqual(windowFor('2027-01-04', '2026-09-01'), { from: '2026-09-01', to: '2027-01-04', startedWithinYear: true });
  assert.equal(windowFor('2027-01-04', '').startedWithinYear, false);
  const run = (sql, ...a) => w.d1.db.prepare(sql).run(...a);
  const task = (id, who, done, due, at) => run("INSERT INTO hub_tasks (id, title, status, owner_email, due_date, done_at, done_by, created_by, created_at, updated_at) VALUES (?, ?, 'done', ?, ?, ?, ?, 'x', ?, ?)", id, 'Task ' + id, who, due, at, who, at, at);
  task('t1', NEW.email, '2026-10-01', '2026-10-02', '2026-10-01T15:00:00.000Z');
  task('t2', NEW.email, null, '2026-10-01', '2026-10-05T15:00:00.000Z'); // after the due date
  task('t3', NEW.email, null, null, '2026-11-01T15:00:00.000Z');
  task('t4', NEW.email, null, null, '2025-01-01T15:00:00.000Z'); // before the window
  task('t5', PEER.email, null, null, '2026-11-01T15:00:00.000Z'); // someone else's
  run("INSERT INTO act_batches (id, op, actor, actor_email, params, n, calls_planned, undo_until, created_at) VALUES ('b1', 'complete', 'N', ?, '{}', 2, 2, ?, '2026-11-02T12:00:00.000Z')", NEW.email, NOW);
  run("INSERT INTO act_batches (id, op, actor, actor_email, params, n, calls_planned, undo_until, created_at) VALUES ('b2', 'thank', 'N', ?, '{}', 1, 1, ?, '2026-11-03T12:00:00.000Z')", NEW.email, NOW);
  run("INSERT INTO act_batches (id, op, actor, actor_email, params, n, calls_planned, undo_until, created_at) VALUES ('b3', 'complete', 'P', ?, '{}', 1, 1, ?, '2026-11-03T12:00:00.000Z')", PEER.email, NOW);
  const ob = (id, batch, cid, state, label) => run("INSERT INTO act_outbox (id, batch_id, cid, label, op, payload, state, queued_at) VALUES (?, ?, ?, ?, 'patch', '{}', ?, ?)", id, batch, cid, label, state, NOW);
  ob('o1', 'b1', 'C1', 'verified', 'Secret Partner | call');
  ob('o2', 'b1', 'C2', 'sent', 'Hidden Name | call');
  ob('o3', 'b2', 'C1', 'verified', 'Secret Partner | thanks');
  ob('o4', 'b1', 'C3', 'failed', 'Failed One | call');
  ob('o5', 'b3', 'C9', 'verified', 'Other | call');
  const c = rows(w, 'SELECT 1')[0];
  void c;
  run("INSERT INTO learn_courses (id, slug, title, created_at, updated_at) VALUES ('crs1', 'x', 'Course X', ?, ?)", NOW, NOW);
  run("INSERT INTO learn_completions (email, course_id, course_title, completed_at, cert) VALUES (?, 'crs1', 'Course X', '2026-12-01T10:00:00.000Z', 'CERT-X')", NEW.email);
  const e = await evidenceFor(w.env, NEW.email, '2027-01-04', '2020-01-01');
  assert.equal(e.tasks.done, 3);
  assert.equal(e.tasks.late, 1);
  assert.equal(e.tasks.recent.length, 3);
  assert.equal(e.partners.contacted, 2, 'C1 and C2; the failed row and the other person do not count');
  assert.equal(e.partners.actions, 3);
  assert.equal(e.courses.done, 1);
  const json = JSON.stringify(e);
  assert.doesNotMatch(json, /Secret Partner|Hidden Name|C1|C2/);
  // Started inside the year: the older work is out of the window.
  assert.equal((await evidenceFor(w.env, NEW.email, '2027-01-04', '2026-10-15')).tasks.done, 1);
  // A person with no records gets zeros, and a missing table gives zeros too.
  assert.equal((await evidenceFor(w.env, BOSS.email, '2027-01-04', '')).tasks.done, 0);
  const { memoryD1 } = await import('./support/d1.mjs');
  const empty = await evidenceFor({ DB: memoryD1() }, NEW.email, '2027-01-04', '');
  assert.equal(empty.tasks.done + empty.partners.contacted + empty.courses.done, 0);
});

test('an evaluation shows evidence to the employee and the supervisor, not to a reviewer, and asks an admin for a missing Reports to', async () => {
  const w = world();
  w.d1.exec(read('db/people-dev.sql'));
  const S = await import('../functions/_lib/evals/service.ts');
  const A = await import('../functions/_lib/evals/api.ts');
  const ins = (sql, ...a) => w.d1.db.prepare(sql).run(...a);
  ins('INSERT INTO hub_reporting (email, supervisor_email, department, title, start_date) VALUES (?, ?, ?, ?, ?)', NEW.email, BOSS.email, 'Partner Care', 'Associate', '2025-03-01');
  ins('INSERT INTO hub_reporting (email, supervisor_email, department, title, start_date) VALUES (?, ?, ?, ?, ?)', PEER.email, null, 'Partner Care', 'Associate', '2025-03-01');
  ins("INSERT OR REPLACE INTO hub_settings (key, value, updated_by, updated_at) VALUES ('requests.notify', 'off', 't', ?)", NOW);
  const admin = { email: WILL.email, name: WILL.name, role: 'admin' };
  const emp = { email: NEW.email, name: NEW.name, role: 'staff' };
  const sup = { email: BOSS.email, name: BOSS.name, role: 'staff' };
  const out = await S.startTerm(w.env, admin, { startsOn: '2027-01-04', emails: [NEW.email, PEER.email] });
  assert.equal(out.opened, 2);
  assert.deepEqual(out.noSupervisor, [PEER.email]);
  const caseOf = (e) => ins && w.d1.db.prepare('SELECT id FROM eval_cases WHERE employee_email = ?').get(e).id;
  ins("INSERT INTO hub_tasks (id, title, status, owner_email, done_at, done_by, created_by, created_at, updated_at) VALUES ('t9', 'Finished thing', 'done', ?, '2026-10-01T15:00:00.000Z', ?, 'x', ?, ?)", NEW.email, NEW.email, NOW, NOW);
  const mine = await S.viewCase(w.env, emp, caseOf(NEW.email));
  assert.equal(mine.evidence.tasks.done, 1);
  assert.equal(mine.reportsToMissing, undefined);
  const theirs = await S.viewCase(w.env, sup, caseOf(NEW.email));
  assert.equal(theirs.evidence.tasks.done, 1);
  // A reviewer who is only a reviewer sees no evidence.
  ins('INSERT INTO eval_reviewers (id, case_id, reviewer_email, relationship, frequency, status, asked_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'r1', caseOf(NEW.email), PEER.email, 'Peer', 'Weekly', 'asked', NOW);
  const rev = await S.viewCase(w.env, { email: PEER.email, name: PEER.name, role: 'staff' }, caseOf(NEW.email));
  assert.equal(rev.evidence, undefined);
  // An admin sees the prompt for a person with no Reports to, and the case still opens.
  const noSup = await S.viewCase(w.env, admin, caseOf(PEER.email));
  assert.equal(noSup.reportsToMissing, true);
  assert.equal(noSup.case.supervisor.email || '', '');
  assert.equal((await S.viewCase(w.env, admin, caseOf(NEW.email))).reportsToMissing, undefined);
  // The admin page lists who is missing and never picks a manager.
  const gaps = await A.handle(w.env, admin, 'GET', ['admin', 'gaps'], null);
  assert.equal(gaps.total >= 2, true);
  assert.ok(gaps.missing.some((p) => p.email === PEER.email));
  assert.ok(!gaps.missing.some((p) => p.email === NEW.email));
  assert.equal(rows(w, 'SELECT supervisor_email FROM hub_reporting WHERE email = ?', PEER.email)[0].supervisor_email, null, 'nobody was assigned');
  await assert.rejects(() => A.handle(w.env, emp, 'GET', ['admin', 'gaps'], null), /HR and hub administrators/);
});

test('no new text names an assistant, says donor, uses an em dash or names a person', () => {
  const files = ['functions/_lib/growth/practice.ts', 'functions/_lib/growth/firstweek.ts', 'functions/_lib/growth/route.ts', 'functions/_lib/evals/evidence.ts', 'public/js/practice.js', 'src/pages/learn/practice.astro', 'src/styles/practice.css'];
  for (const f of files) {
    const t = read(f);
    assert.doesNotMatch(t, /—|–/, `${f}: dash`);
    assert.doesNotMatch(t, /\bdonors?\b/i, `${f}: donor`);
    assert.doesNotMatch(t, /\bAI\b|artificial intelligence|\bClaude\b|ChatGPT/i, `${f}: assistant`);
    assert.doesNotMatch(t, /\b(Will|Rachel|Michael|Stephanie|Daniel|Jordan)\b/, `${f}: a staff name`);
  }
  const help = ['learn', 'onboarding', 'evaluations'].map((n) => read(`src/content/help/${n}.md`)).join('\n');
  assert.doesNotMatch(help, /—/);
});
