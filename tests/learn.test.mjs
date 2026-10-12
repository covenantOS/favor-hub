// Learn: courses and lessons, quizzes with a pass mark and retakes, progress and resume, completion and the certificate, assignments
// to a person, a team and everyone with tasks in Projects, reminders through the notice gate, and who may see what. Made-up people
// only; the live database is never touched (an in-memory D1 built from the repository's own schema files).
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { GRANTS, HR, OUTSIDER, VIDEO, WILL, call, learnWorld, rows } from './support/learn-world.mjs';

const course = async (w, title = 'Gift entry') => (await call(w, WILL, 'POST', 'admin/courses', { title, summary: 'How to enter a gift', audience: 'Everyone' })).data.course;

test('the first visit writes the starter courses and paths once', async () => {
  const w = learnWorld();
  const home = await call(w, WILL, 'GET', 'home');
  assert.equal(home.status, 200);
  const cat = await call(w, WILL, 'GET', 'catalog');
  const slugs = cat.data.courses.map((c) => c.slug);
  for (const s of ['favoros-basics', 'favor-who-we-are', 'blackbaud-first-week', 'work-center', 'rdd-actions', 'partner-care-gifts', 'grants-records']) assert.ok(slugs.includes(s), s);
  const paths = cat.data.paths.map((p) => p.title);
  for (const p of ['New hire: Favor', 'New hire: FavorOS', 'RDD', 'Partner Care', 'Support Team', 'Grants', 'Marketing', 'Admin desk']) assert.ok(paths.includes(p), p);
  const n = rows(w, 'SELECT COUNT(*) AS n FROM learn_courses')[0].n;
  await call(w, WILL, 'GET', 'catalog');
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM learn_courses')[0].n, n, 'never written twice');
  // Every seeded video lesson names a video that is in the help library, and the copy says partners and never mentions its tools.
  const lessons = rows(w, 'SELECT kind, ref, title, body FROM learn_lessons');
  const { helpVideos } = await import('../functions/_lib/learn/db.ts');
  const lib = new Set(helpVideos().map((v) => v.slug));
  for (const l of lessons.filter((x) => x.kind === 'video')) assert.ok(lib.has(l.ref), l.ref);
  const text = lessons.map((l) => `${l.title} ${l.body}`).join(' ');
  assert.doesNotMatch(text, /(^|[^.\w])AI([^.\w]|$)|donors?\b|—/);
});

test('every seeded quiz has a right answer inside its options and an explanation', async () => {
  const { COURSES } = await import('../functions/_lib/learn/seed.ts');
  for (const c of COURSES) {
    const quizzes = c.lessons.filter((l) => l.kind === 'quiz');
    assert.ok(quizzes.length >= 1, `${c.slug} has a quiz`);
    for (const q of quizzes) {
      assert.ok(q.quiz.questions.length >= 4, `${c.slug} has real questions`);
      for (const x of q.quiz.questions) {
        const n = x.kind === 'tf' ? 2 : x.options.length;
        assert.ok(n >= 2 && n <= 6, x.text);
        assert.ok(Number.isInteger(x.answer) && x.answer >= 0 && x.answer < n, x.text);
        assert.ok(x.explain.length > 10, `${x.text} explains itself`);
      }
    }
  }
});

test('only admins and HR build courses; staff cannot open authoring and see published courses only', async () => {
  const w = learnWorld({ learn: 'staff' });
  assert.equal((await call(w, VIDEO, 'POST', 'admin/courses', { title: 'Nope' })).status, 403);
  assert.equal((await call(w, VIDEO, 'GET', 'admin/overview')).status, 403);
  const c = (await call(w, HR, 'POST', 'admin/courses', { title: 'HR course' })).data.course;
  assert.equal(c.status, 'draft');
  assert.equal((await call(w, VIDEO, 'GET', `course/${c.slug}`)).status, 404, 'a draft is not visible to staff');
  assert.equal((await call(w, HR, 'GET', `course/${c.slug}`)).data.preview, true, 'an author previews a draft');
});

test('learn.enabled: admins and HR by default, staff when opened, nobody when off', async () => {
  let w = learnWorld({ learn: null });
  assert.equal((await call(w, VIDEO, 'GET', 'home')).status, 403);
  assert.equal((await call(w, HR, 'GET', 'home')).status, 200, 'HR counts with admins');
  assert.equal((await call(w, WILL, 'GET', 'home')).status, 200);
  w = learnWorld({ learn: 'staff' });
  assert.equal((await call(w, VIDEO, 'GET', 'home')).status, 200);
  w = learnWorld({ learn: 'off' });
  assert.equal((await call(w, WILL, 'GET', 'home')).status, 403);
});

test('before the tables exist every route answers not_ready', async () => {
  const w = learnWorld();
  w.d1.exec('DROP TABLE learn_courses');
  const r = await call(w, WILL, 'GET', 'home');
  assert.equal(r.status, 503);
  assert.equal(r.data.error, 'not_ready');
});

test('build a course: lessons check their references, reorder, publish needs a lesson', async () => {
  const w = learnWorld();
  const c = await course(w);
  assert.equal((await call(w, WILL, 'PATCH', `admin/course/${c.id}`, { status: 'published' })).status, 400, 'no lessons yet');
  const add = (b) => call(w, WILL, 'POST', `admin/course/${c.id}/lessons`, b);
  assert.equal((await add({ kind: 'video', ref: 'no-such-video' })).status, 400);
  assert.equal((await add({ kind: 'doc', title: 'Doc', ref: 'http://example.com/x' })).status, 400, 'a doc must be a Google address');
  assert.equal((await add({ kind: 'quiz', title: 'Q', quiz: { questions: [] } })).status, 400);
  const v = await add({ kind: 'video', ref: 'taking-a-gift-by-phone' });
  assert.equal(v.status, 201);
  assert.equal(v.data.lesson.title, 'Taking a gift by phone', 'a video takes its title from the library');
  assert.equal(v.data.lesson.minutes, 1);
  await add({ kind: 'article', ref: 'thank-you-receipts', title: 'Receipts' });
  const pg = await add({ kind: 'page', title: 'Rules', body: '## Rule one\n\nSearch first.' });
  const last = await add({ kind: 'doc', title: 'Policy', ref: 'https://docs.google.com/document/d/abc123/edit' });
  void pg;
  const ids = last.data.course.lessons.map((l) => l.id);
  const reordered = [ids[3], ids[0], ids[2], ids[1]];
  const o = await call(w, WILL, 'PUT', `admin/course/${c.id}/order`, { ids: reordered });
  assert.deepEqual(o.data.course.lessons.map((l) => l.id), reordered);
  assert.equal((await call(w, WILL, 'PATCH', `admin/course/${c.id}`, { status: 'published' })).data.course.status, 'published');
  assert.equal((await call(w, WILL, 'POST', 'admin/courses', { title: 'Gift entry' })).data.course.slug, 'gift-entry-2', 'slugs stay unique');
});

const quizCourse = async (w) => {
  const c = await course(w, 'Quiz course');
  await call(w, WILL, 'POST', `admin/course/${c.id}/lessons`, { kind: 'page', title: 'Read me', body: 'Hello' });
  const q = await call(w, WILL, 'POST', `admin/course/${c.id}/lessons`, {
    kind: 'quiz',
    title: 'Check',
    quiz: {
      pass: 70,
      questions: [
        { kind: 'choice', text: 'Pick b', options: ['a', 'b', 'c'], answer: 1, explain: 'It is b.' },
        { kind: 'tf', text: 'Sky is blue', answer: 0, explain: 'It is.' },
        { kind: 'choice', text: 'Pick c', options: ['a', 'b', 'c'], answer: 2, explain: 'It is c.' },
      ],
    },
  });
  await call(w, WILL, 'PATCH', `admin/course/${c.id}`, { status: 'published' });
  const lessons = q.data.course.lessons;
  return { c, page: lessons[0], quiz: lessons[1] };
};

test('quizzes: no answers leave the server, a pass mark, retakes, answers shown only after passing', async () => {
  const w = learnWorld({ learn: 'staff' });
  const { c, quiz } = await quizCourse(w);
  const seen = await call(w, VIDEO, 'GET', `course/${c.slug}`);
  const ql = seen.data.course.lesson_list.find((l) => l.kind === 'quiz');
  assert.ok(!JSON.stringify(seen.data).includes('explain'), 'no explanations before an attempt');
  assert.ok(!('answer' in ql.quiz.questions[0]), 'no answer key');
  assert.equal((await call(w, VIDEO, 'POST', `quiz/${quiz.id}`, { answers: { q1: 1 } })).status, 400, 'every question must be answered');
  const fail = await call(w, VIDEO, 'POST', `quiz/${quiz.id}`, { answers: { q1: 0, q2: 0, q3: 0 } });
  assert.equal(fail.data.passed, false);
  assert.equal(fail.data.score, 33);
  assert.equal(fail.data.results.find((r) => r.id === 'q1').correct, false);
  assert.ok(fail.data.results.every((r) => r.answer === undefined), 'a failed try shows which missed, not the answers');
  assert.equal(rows(w, 'SELECT * FROM learn_progress WHERE lesson_id = ? AND state = ?', quiz.id, 'done').length, 0);
  const edge = await call(w, VIDEO, 'POST', `quiz/${quiz.id}`, { answers: { q1: 1, q2: 0, q3: 0 } });
  assert.equal(edge.data.score, 67);
  assert.equal(edge.data.passed, false, '67 is under the 70 pass mark');
  const ok = await call(w, VIDEO, 'POST', `quiz/${quiz.id}`, { answers: { q1: 1, q2: 0, q3: 2 } });
  assert.equal(ok.data.passed, true);
  assert.equal(ok.data.attempts, 3);
  assert.equal(ok.data.results[0].answer, 1);
  assert.equal((await call(w, VIDEO, 'POST', 'progress', { lesson_id: quiz.id, state: 'done' })).status, 400, 'a quiz is only finished by passing');
});

test('progress resumes, completion writes a record and a certificate, and the certificate is private', async () => {
  const w = learnWorld({ learn: 'staff' });
  const { c, page, quiz } = await quizCourse(w);
  const first = await call(w, VIDEO, 'POST', 'progress', { lesson_id: page.id, state: 'started', position: 42 });
  assert.equal(first.data.lesson.position, 42);
  let v = (await call(w, VIDEO, 'GET', `course/${c.slug}`)).data.course;
  assert.equal(v.next_id, page.id, 'resume at the lesson in progress');
  assert.equal(v.lesson_list[0].position, 42);
  assert.equal(v.state, 'started');
  const done = await call(w, VIDEO, 'POST', 'progress', { lesson_id: page.id, state: 'done' });
  assert.equal(done.data.course.pct, 50);
  assert.equal(done.data.just_completed, false);
  assert.equal((await call(w, VIDEO, 'GET', `certificate/${c.slug}`)).status, 404, 'no certificate before it is earned');
  const pass = await call(w, VIDEO, 'POST', `quiz/${quiz.id}`, { answers: { q1: 1, q2: 0, q3: 2 } });
  assert.equal(pass.data.just_completed, true);
  assert.equal(pass.data.course.completed.cert.length, 8);
  v = (await call(w, VIDEO, 'GET', `course/${c.slug}`)).data.course;
  assert.equal(v.state, 'done');
  assert.equal(v.next_id, null);
  const cert = await call(w, VIDEO, 'GET', `certificate/${c.slug}`);
  assert.equal(cert.data.certificate.name, VIDEO.name);
  assert.equal(cert.data.certificate.course, 'Quiz course');
  assert.equal((await call(w, OUTSIDER, 'GET', `certificate/${c.slug}?email=${VIDEO.email}`)).status, 403);
  assert.equal((await call(w, HR, 'GET', `certificate/${c.slug}?email=${VIDEO.email}`)).status, 200, "HR reads anyone's");
  // Reading a lesson again never undoes it and never writes a second record.
  await call(w, VIDEO, 'POST', 'progress', { lesson_id: page.id, state: 'started', position: 3 });
  assert.equal(rows(w, 'SELECT * FROM learn_completions').length, 1);
  assert.equal((await call(w, VIDEO, 'GET', `course/${c.slug}`)).data.course.pct, 100);
});

test('a draft course records nothing when an author previews it', async () => {
  const w = learnWorld();
  const c = await course(w, 'Draft one');
  const l = await call(w, WILL, 'POST', `admin/course/${c.id}/lessons`, { kind: 'page', title: 'P', body: 'x' });
  const r = await call(w, WILL, 'POST', 'progress', { lesson_id: l.data.lesson.id, state: 'done' });
  assert.equal(r.data.preview, true);
  assert.equal(rows(w, 'SELECT * FROM learn_progress').length, 0);
});

test('assign a course to a person: a row, a notice, a task in Projects with a link back, one email', async () => {
  const w = learnWorld({ learn: 'staff' });
  const { c } = await quizCourse(w);
  const r = await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.slug, emails: [VIDEO.email], due_date: '2099-01-15', note: 'Please finish this week.' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.created, r.data.told, r.data.tasks], [1, 1, 1]);
  const n = rows(w, 'SELECT * FROM learn_notices WHERE email = ?', VIDEO.email);
  assert.equal(n.length, 1);
  assert.equal(n[0].kind, 'assigned');
  assert.equal(n[0].href, `/learn/c/?c=${c.slug}`);
  const t = rows(w, 'SELECT * FROM hub_tasks')[0];
  assert.equal(t.owner_email, VIDEO.email);
  assert.equal(t.title, 'Finish: Quiz course');
  assert.equal(t.due_date, '2099-01-15');
  assert.equal(t.project_id, null, 'a personal task');
  assert.match(t.description, /\/learn\/c\/\?c=quiz-course/);
  assert.equal(rows(w, 'SELECT url FROM hub_task_files WHERE task_id = ?', t.id)[0].url, `https://dash.favorintl.org/learn/c/?c=${c.slug}`);
  // The task in Projects tells the person, so Learn sends no second email for the same assignment.
  assert.equal(w.mail.filter((m) => /Learn|assigned you/.test(m.subject)).length, 0);
  // The same assignment again with the same date changes nothing and tells nobody twice.
  const again = await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.slug, emails: [VIDEO.email], due_date: '2099-01-15', note: 'Please finish this week.' });
  assert.deepEqual([again.data.created, again.data.updated, again.data.told], [0, 0, 0]);
  // A new date moves the date on the assignment and on the task.
  const moved = await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.slug, emails: [VIDEO.email], due_date: '2099-02-01' });
  assert.equal(moved.data.updated, 1);
  assert.equal(rows(w, 'SELECT due_date FROM hub_tasks')[0].due_date, '2099-02-01');
  // Home shows it, with the first lesson to open.
  const home = await call(w, VIDEO, 'GET', 'home');
  assert.equal(home.data.assigned.length, 1);
  assert.equal(home.data.assigned[0].due_date, '2099-02-01');
  assert.equal(home.data.assigned[0].next.kind, 'page');
  assert.notEqual(rows(w, 'SELECT read_at FROM learn_notices')[0].read_at, null, 'opening My learning reads the notice');
});

test('finishing the course closes the assignment and the task; removing it drops the task', async () => {
  const w = learnWorld({ learn: 'staff' });
  const { c, page, quiz } = await quizCourse(w);
  await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.id, emails: [VIDEO.email, GRANTS.email] });
  await call(w, VIDEO, 'POST', 'progress', { lesson_id: page.id, state: 'done' });
  await call(w, VIDEO, 'POST', `quiz/${quiz.id}`, { answers: { q1: 1, q2: 0, q3: 2 } });
  const a = rows(w, 'SELECT * FROM learn_assignments WHERE email = ?', VIDEO.email)[0];
  assert.equal(a.closed_why, 'complete');
  assert.equal(rows(w, 'SELECT status FROM hub_tasks WHERE id = ?', a.task_id)[0].status, 'done');
  const other = rows(w, 'SELECT * FROM learn_assignments WHERE email = ?', GRANTS.email)[0];
  await call(w, WILL, 'DELETE', `admin/assignments/${other.id}`);
  assert.equal(rows(w, 'SELECT status FROM hub_tasks WHERE id = ?', other.task_id)[0].status, 'dropped');
  assert.equal((await call(w, GRANTS, 'GET', 'home')).data.assigned.length, 0);
  // Given again, the same row opens again with its task.
  const back = await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.id, emails: [GRANTS.email] });
  assert.equal(back.data.reopened, 1);
  assert.equal(rows(w, 'SELECT status FROM hub_tasks WHERE id = ?', other.task_id)[0].status, 'open');
  // Someone who already finished it gets a record and no task or notice.
  const done = await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.id, emails: [VIDEO.email] });
  assert.equal(done.data.already_done, 1);
  assert.equal(rows(w, 'SELECT * FROM hub_tasks WHERE owner_email = ?', VIDEO.email).length, 1, 'no second task');
});

test('assign a path, a team and everyone; a path finishes when its courses do', async () => {
  const w = learnWorld({ learn: 'staff' });
  const one = await quizCourse(w);
  const two = await course(w, 'Second');
  const pg = await call(w, WILL, 'POST', `admin/course/${two.id}/lessons`, { kind: 'page', title: 'P', body: 'x' });
  await call(w, WILL, 'PATCH', `admin/course/${two.id}`, { status: 'published' });
  const path = (await call(w, WILL, 'POST', 'admin/paths', { title: 'Mini path', status: 'published', courses: [one.c.id, two.id] })).data.path;
  const t = await call(w, WILL, 'POST', 'admin/assign', { kind: 'path', target: path.slug, team: 'Grants', due_date: '2099-03-01' });
  assert.equal(t.data.created, 1, 'the Grants team is one person');
  const everyone = await call(w, WILL, 'POST', 'admin/assign', { kind: 'path', target: path.slug, everyone: true, due_date: '2099-03-01' });
  assert.ok(everyone.data.created >= 4, 'everyone in the directory');
  assert.equal(rows(w, 'SELECT email FROM learn_assignments WHERE email = ?', 'gone@favorintl.org').length, 0, 'blocked and departed people are not in it');
  assert.equal((await call(w, WILL, 'POST', 'admin/assign', { kind: 'path', target: path.slug, team: 'Nobody' })).status, 400);
  assert.equal((await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: one.c.id, emails: ['x@gmail.com'] })).status, 400, 'only Favor addresses');
  assert.equal((await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: one.c.id, emails: [VIDEO.email], due_date: '2001-01-01' })).data.error, 'past_due');
  // Finish both courses and the path assignment closes.
  await call(w, GRANTS, 'POST', 'progress', { lesson_id: one.page.id, state: 'done' });
  await call(w, GRANTS, 'POST', `quiz/${one.quiz.id}`, { answers: { q1: 1, q2: 0, q3: 2 } });
  assert.equal(rows(w, 'SELECT closed_at FROM learn_assignments WHERE email = ?', GRANTS.email)[0].closed_at, null, 'half done');
  const pv = (await call(w, GRANTS, 'GET', `path/${path.slug}`)).data.path;
  assert.equal(pv.next_course.slug, 'second');
  await call(w, GRANTS, 'POST', 'progress', { lesson_id: pg.data.lesson.id, state: 'done' });
  assert.equal(rows(w, 'SELECT closed_why FROM learn_assignments WHERE email = ?', GRANTS.email)[0].closed_why, 'complete');
  assert.equal((await call(w, GRANTS, 'GET', `path/${path.slug}`)).data.path.state, 'done');
});

test('reporting: who is assigned what, done, overdue, quiz scores; staff cannot read it', async () => {
  const w = learnWorld({ learn: 'staff' });
  const { c, page, quiz } = await quizCourse(w);
  await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.id, emails: [VIDEO.email, GRANTS.email, OUTSIDER.email], due_date: '2099-05-01' });
  w.d1.db.prepare("UPDATE learn_assignments SET due_date = '2020-01-01' WHERE email = ?").run(OUTSIDER.email);
  await call(w, VIDEO, 'POST', 'progress', { lesson_id: page.id, state: 'done' });
  await call(w, VIDEO, 'POST', `quiz/${quiz.id}`, { answers: { q1: 1, q2: 0, q3: 2 } });
  await call(w, GRANTS, 'POST', 'progress', { lesson_id: page.id, state: 'started', position: 5 });
  const rep = await call(w, HR, 'GET', 'admin/report');
  assert.deepEqual([rep.data.summary.assigned, rep.data.summary.done, rep.data.summary.overdue, rep.data.summary.in_progress], [3, 1, 1, 1]);
  assert.equal(rep.data.summary.avg_score, 100);
  const by = Object.fromEntries(rep.data.rows.map((r) => [r.email, r]));
  assert.equal(by[VIDEO.email].status, 'done');
  assert.equal(by[OUTSIDER.email].status, 'overdue');
  assert.equal(by[GRANTS.email].status, 'in_progress');
  assert.equal(by[VIDEO.email].best_score, 100);
  assert.equal((await call(w, HR, 'GET', 'admin/report?status=overdue')).data.rows.length, 1);
  assert.equal((await call(w, VIDEO, 'GET', 'admin/report')).status, 403);
  // The learning record (for Evaluations): the person, their supervisor and HR read it; others do not.
  w.d1.db.prepare('INSERT INTO hub_reporting (email, supervisor_email) VALUES (?, ?)').run(VIDEO.email, GRANTS.email);
  const rec = await call(w, VIDEO, 'GET', 'record');
  assert.equal(rec.data.record.completed[0].course, 'Quiz course');
  assert.equal((await call(w, GRANTS, 'GET', `record?email=${VIDEO.email}`)).status, 200, 'the supervisor');
  assert.equal((await call(w, OUTSIDER, 'GET', `record?email=${VIDEO.email}`)).status, 403);
});

test('notices obey the gate: off tells nobody; the test list still reaches one address', async () => {
  const w = learnWorld({ learn: 'staff', notify: null });
  const { c } = await quizCourse(w);
  const r = await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.id, emails: [VIDEO.email] });
  assert.deepEqual([r.data.created, r.data.told], [1, 0]);
  assert.equal(rows(w, 'SELECT * FROM learn_notices').length, 0);
  assert.equal(w.mail.length, 0, 'no email while notices are off');
  const home = await call(w, VIDEO, 'GET', 'home');
  assert.equal(home.data.assigned.length, 1, 'the assignment itself is still there');
  const { learnCards, learnCount } = await import('../functions/_lib/learn/today.ts');
  assert.deepEqual(await learnCards(w.env, VIDEO, { learn: true }), [], 'no Today card while notices are off');
  assert.equal(await learnCount(w.env, VIDEO, { learn: true }), 0);
  w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('requests.notify.only', ?, 'test', '2026-10-11T12:00:00Z')").run(GRANTS.email);
  await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.id, emails: [GRANTS.email] });
  assert.deepEqual(rows(w, 'SELECT email FROM learn_notices').map((x) => x.email), [GRANTS.email]);
  assert.equal(rows(w, 'SELECT * FROM learn_notices').length, 1, 'the notice for Today and the bell');
});

test('with no Projects the assignment email goes out once, in the Learn design', async () => {
  const w = learnWorld({ learn: 'staff', projects: false });
  const { c } = await quizCourse(w);
  await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.slug, emails: [VIDEO.email], note: 'Please finish this week.' });
  assert.equal(w.mail.length, 1);
  assert.equal(w.mail[0].to, VIDEO.email);
  assert.match(w.mail[0].subject, /Ada Admin assigned you: Quiz course/);
  assert.equal(w.mail[0].html.includes(String.fromCharCode(0x2014)), false);
});

test('a person with an assignment opens Learn while it is admins and HR only; a person without one does not', async () => {
  const w = learnWorld({ learn: 'admins' });
  const { c } = await quizCourse(w);
  assert.equal((await call(w, VIDEO, 'GET', 'home')).status, 403);
  await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.id, emails: [VIDEO.email] });
  assert.equal((await call(w, VIDEO, 'GET', 'home')).status, 200);
  assert.equal((await call(w, VIDEO, 'GET', 'admin/overview')).status, 403);
  assert.equal((await call(w, OUTSIDER, 'GET', 'home')).status, 403);
});

test('Today card and the menu number count assigned learning, and a late one warns', async () => {
  const w = learnWorld({ learn: 'staff' });
  const { c } = await quizCourse(w);
  await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.id, emails: [VIDEO.email], due_date: '2099-01-02' });
  const { learnCards, learnCount, learnAccess } = await import('../functions/_lib/learn/today.ts');
  const cards = await learnCards(w.env, VIDEO, { learn: true });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].n, 1);
  assert.equal(cards[0].href, `/learn/c/?c=${c.slug}`);
  assert.equal(cards[0].warn, false);
  assert.equal(await learnCount(w.env, VIDEO, { learn: true }), 1);
  w.d1.db.prepare("UPDATE learn_assignments SET due_date = '2020-01-01'").run();
  assert.equal((await learnCards(w.env, VIDEO, { learn: true }))[0].warn, true);
  assert.match((await learnCards(w.env, VIDEO, { learn: true }))[0].note, /past the due date/);
  assert.deepEqual(await learnAccess(w.env, VIDEO), { learn: true, learnAdmin: false });
  assert.deepEqual(await learnAccess(w.env, HR), { learn: true, learnAdmin: true });
  assert.deepEqual(await learnAccess(w.env, { ...WILL, via: 'agent' }), { learn: false, learnAdmin: false });
});

test('the morning pass writes due soon, due today and overdue once each and emails one summary per person', async () => {
  const w = learnWorld({ learn: 'staff' });
  const { c } = await quizCourse(w);
  const { learnDailyPass } = await import('../functions/_lib/learn/notices.ts');
  await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.id, emails: [VIDEO.email], due_date: '2099-01-01' });
  w.d1.db.prepare("UPDATE learn_assignments SET due_date = '2026-10-15'").run();
  w.mail.length = 0;
  w.d1.db.prepare('UPDATE learn_notices SET emailed_at = ?').run('2026-10-11T12:00:00Z');
  assert.equal((await learnDailyPass(w.env, new Date('2026-10-11T14:00:00Z'))).notes[0], 'weekend');
  assert.equal((await learnDailyPass(w.env, new Date('2026-10-12T11:00:00Z'))).notes[0], 'before 8:00 AM');
  // 2026-10-12 is a Monday: three days before the 15th.
  const mon = await learnDailyPass(w.env, new Date('2026-10-12T13:00:00Z'));
  assert.equal(mon.reminders, 1);
  assert.equal(mon.emails, 1);
  assert.match(w.mail[0].subject, /Due soon: Quiz course/);
  assert.equal((await learnDailyPass(w.env, new Date('2026-10-12T13:10:00Z'))).reminders, 0, 'once only');
  assert.equal(w.mail.length, 1, 'never the same notice twice');
  const thu = await learnDailyPass(w.env, new Date('2026-10-15T13:00:00Z'));
  assert.equal(thu.reminders, 1);
  assert.match(w.mail.at(-1).subject, /Due today/);
  const late = await learnDailyPass(w.env, new Date('2026-10-16T13:00:00Z'));
  assert.equal(late.reminders, 1);
  assert.match(w.mail.at(-1).subject, /Past due/);
  assert.equal((await learnDailyPass(w.env, new Date('2026-10-19T13:00:00Z'))).reminders, 0, 'a week apart, not before');
  assert.equal((await learnDailyPass(w.env, new Date('2026-10-23T13:00:00Z'))).reminders, 1);
  // A person who finished gets nothing.
  w.d1.db.prepare("UPDATE learn_assignments SET closed_at = '2026-10-24T00:00:00Z', closed_why = 'complete'").run();
  assert.equal((await learnDailyPass(w.env, new Date('2026-10-30T13:00:00Z'))).reminders, 0);
});

test('email choices are honored: none sends nothing, a daily summary waits for the morning', async () => {
  const w = learnWorld({ learn: 'staff' });
  const { c } = await quizCourse(w);
  w.d1.db.prepare("INSERT INTO request_email_prefs (email, mode, updated_at) VALUES (?, 'off', '2026-10-01T00:00:00Z')").run(VIDEO.email);
  w.d1.db.prepare("INSERT INTO request_email_prefs (email, mode, updated_at) VALUES (?, 'daily', '2026-10-01T00:00:00Z')").run(GRANTS.email);
  await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.id, emails: [VIDEO.email, GRANTS.email], due_date: '2099-01-01' });
  assert.equal(w.mail.length, 0, 'nothing right away');
  assert.equal(rows(w, 'SELECT * FROM learn_notices').length, 2, 'Today still shows both');
  const { learnDailyPass } = await import('../functions/_lib/learn/notices.ts');
  const run = await learnDailyPass(w.env, new Date('2026-10-12T13:00:00Z'));
  assert.equal(run.emails, 1);
  assert.equal(w.mail[0].to, GRANTS.email);
});

test('removing a lesson, archiving a used course, and deleting an unused one', async () => {
  const w = learnWorld({ learn: 'staff' });
  const { c, page } = await quizCourse(w);
  await call(w, VIDEO, 'POST', 'progress', { lesson_id: page.id, state: 'done' });
  const used = await call(w, WILL, 'DELETE', `admin/course/${c.id}`);
  assert.equal(used.data.result, 'archived', 'a course with records is archived, not deleted');
  assert.equal((await call(w, VIDEO, 'GET', `course/${c.slug}`)).status, 404);
  const fresh = await course(w, 'Unused');
  assert.equal((await call(w, WILL, 'DELETE', `admin/course/${fresh.id}`)).data.result, 'deleted');
  assert.equal((await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: c.id, emails: [VIDEO.email] })).data.error, 'archived');
});

test('Projects off: assignments work without tasks', async () => {
  let w = learnWorld({ learn: 'staff', projects: false });
  let q = await quizCourse(w);
  let r = await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: q.c.id, emails: [VIDEO.email] });
  assert.deepEqual([r.data.created, r.data.tasks], [1, 0], 'no hub_tasks table');
  w = learnWorld({ learn: 'staff' });
  w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('projects.enabled', 'off', 't', '2026-10-11T12:00:00Z')").run();
  q = await quizCourse(w);
  r = await call(w, WILL, 'POST', 'admin/assign', { kind: 'course', target: q.c.id, emails: [VIDEO.email] });
  assert.deepEqual([r.data.created, r.data.tasks], [1, 0], 'projects.enabled is off');
});

test('Ctrl K finds published courses and paths by title, summary or lesson name, and never a draft', async () => {
  const w = learnWorld({ learn: 'staff' });
  const { c } = await quizCourse(w);
  await course(w, 'Secret draft course');
  const r = await call(w, VIDEO, 'GET', 'search?q=quiz');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.results.map((x) => x.title), ['Quiz course']);
  assert.equal(r.data.results[0].href, `/learn/c/?c=${c.slug}`);
  assert.equal((await call(w, VIDEO, 'GET', 'search?q=Read me')).data.results.length, 1, 'a lesson name finds its course');
  assert.equal((await call(w, VIDEO, 'GET', 'search?q=secret')).data.results.length, 0, 'drafts stay hidden');
  assert.equal((await call(w, VIDEO, 'GET', 'search?q=a')).data.results.length, 0, 'one letter finds nothing');
  const seeded = await call(w, VIDEO, 'GET', 'search?q=new hire');
  assert.ok(seeded.data.results.some((x) => x.title === 'New hire: Favor'), 'starter paths are searchable');
});

test('the reminder email is built in the request board design, with no em dash and an Open button', async () => {
  const { buildLearnMail } = await import('../functions/_lib/learn/email.ts');
  const one = buildLearnMail({
    to: { name: 'Vic Video', email: VIDEO.email },
    items: [{ kind: 'due_soon', title: 'Gift entry', what: 'course', due_date: '2026-10-15', minutes: 20, lessons: 5, href: '/learn/c/?c=gift-entry', note: '', actor: '', at: '2026-10-12T13:00:00Z' }],
    now: new Date('2026-10-12T13:00:00Z'),
  });
  assert.equal(one.subject, 'Due soon: Gift entry');
  assert.match(one.html, /FavorOS Learn/);
  assert.match(one.html, /https:\/\/dash\.favorintl\.org\/learn\/c\/\?c=gift-entry/);
  assert.doesNotMatch(one.html + one.text, /—/);
  const many = buildLearnMail({
    to: { name: 'Vic Video', email: VIDEO.email },
    items: [
      { kind: 'overdue', title: 'One', what: 'course', due_date: '2026-10-01', minutes: 5, lessons: 2, href: '/learn/c/?c=one', note: '', actor: '', at: '2026-10-12T13:00:00Z' },
      { kind: 'assigned', title: 'Two', what: 'path', due_date: null, minutes: 40, lessons: 0, href: '/learn/p/?p=two', note: 'Start with the first course.', actor: 'Ada Admin', at: '2026-10-12T13:00:00Z' },
    ],
    now: new Date('2026-10-12T13:00:00Z'),
  });
  assert.equal(many.subject, 'Learn: 2 things to finish');
  assert.match(many.html, /Good morning, Vic/);
  assert.match(many.html, /Open My learning/);
  assert.throws(() => buildLearnMail({ to: { name: 'x', email: 'x@favorintl.org' }, items: [] }));
});

test('the markdown a written page is saved in survives a round trip and the lesson refuses an empty page', async () => {
  const w = learnWorld();
  const c = await course(w);
  const bad = await call(w, WILL, 'POST', `admin/course/${c.id}/lessons`, { kind: 'page', title: 'Empty', body: '   ' });
  assert.equal(bad.status, 400);
  const ok = await call(w, WILL, 'POST', `admin/course/${c.id}/lessons`, { kind: 'page', title: 'Page', body: '## Heading\n\n- one\n\n- two' });
  assert.equal(ok.status, 201);
  assert.equal(rows(w, 'SELECT body FROM learn_lessons WHERE id = ?', ok.data.lesson.id)[0].body,'## Heading\n\n- one\n\n- two');
  const edited = await call(w, WILL, 'PATCH', `admin/lesson/${ok.data.lesson.id}`, { title: 'Page two', body: 'New text' });
  assert.equal(edited.data.course.lessons[0].title, 'Page two');
  assert.equal(edited.data.course.lessons[0].body, 'New text');
  assert.equal(edited.data.course.lessons[0].kind, 'page', 'the kind never changes');
});

test('a clip lesson takes the clip title when none is given, and refuses a clip that does not exist', async () => {
  const w = learnWorld();
  const c = await course(w);
  w.d1.db.prepare("INSERT INTO hub_clips (id, owner_email, owner_name, title, status, mime, created_at, updated_at) VALUES (?, ?, ?, ?, 'ready', 'video/mp4', ?, ?)").run('abcdef123456', WILL.email, WILL.name, 'Entering a gift', '2026-10-11T12:00:00Z', '2026-10-11T12:00:00Z');
  const miss = await call(w, WILL, 'POST', `admin/course/${c.id}/lessons`, { kind: 'clip', ref: 'zzzzzz999999' });
  assert.equal(miss.status, 400);
  const hit = await call(w, WILL, 'POST', `admin/course/${c.id}/lessons`, { kind: 'clip', ref: 'abcdef123456' });
  assert.equal(hit.status, 201);
  assert.equal(hit.data.lesson.title, 'Entering a gift');
  const list = await call(w, WILL, 'GET', 'admin/clips?q=entering');
  assert.equal(list.data.clips.length, 1, 'the author lists their own clips');
  assert.equal((await call(w, VIDEO, 'GET', 'admin/clips')).status, 403);
});
