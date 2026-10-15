// Run with: npm test
// Evaluations: Rachel's three forms word for word, the three week cycle, who can read what, the averages, the plan, the signature and the
// filed document. In-memory database and made-up people only. Nothing here reaches the live database, Google or email.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOW = '2026-01-05T12:00:00.000Z';
const ADA = { email: 'ada@favorintl.org', name: 'Ada Admin', role: 'admin' };
const ANN = { email: 'ann@favorintl.org', name: 'Ann Employee', role: 'staff' };
const SAM = { email: 'sam@favorintl.org', name: 'Sam Supervisor', role: 'staff' };
const HAL = { email: 'hal@favorintl.org', name: 'Hal HR', role: 'staff' };
const OZZY = { email: 'ozzy@favorintl.org', name: 'Ozzy Other', role: 'staff' };
const REV = ['r1', 'r2', 'r3', 'r4'].map((n) => ({ email: `${n}@favorintl.org`, name: `Rae ${n}`, role: 'staff' }));
const PEOPLE = [ADA, ANN, SAM, HAL, OZZY, ...REV];

let M, S, R, F, A, X, G, db, env, sent, realFetch;

function world() {
  const d1 = memoryD1();
  for (const f of ['db/schema.sql', 'db/work.sql', 'db/expenses.sql', 'db/signin.sql', 'db/reports.sql', 'db/admin-home.sql', 'db/meetings.sql', 'db/people-dev.sql', 'db/evals-2026-10-15.sql']) d1.exec(read(f));
  for (const p of PEOPLE) {
    d1.db.prepare('INSERT INTO hub_users (email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(p.email, p.name, p.role, NOW, NOW);
    d1.db.prepare('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, 1)').run(p.email, p.name, 'Staff', 'Operations');
  }
  d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('requests.notify', 'on', 't', ?)").run(NOW);
  // The testing audience: everyone made up here is on the Early access list. One test removes the list to show the gate.
  d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('early_access', ?, 't', ?)").run(JSON.stringify({ emails: PEOPLE.map((p) => p.email), teams: [] }), NOW);
  d1.db.prepare('INSERT INTO hub_hr (email, set_by, set_at) VALUES (?, ?, ?)').run(HAL.email, 't', NOW);
  d1.db.prepare('INSERT INTO hub_reporting (email, supervisor_email, department, title, start_date) VALUES (?, ?, ?, ?, ?)').run(ANN.email, SAM.email, 'Operations', 'Assistant', '2025-03-01');
  d1.db.prepare('INSERT INTO hub_reporting (email, supervisor_email, department, title, start_date) VALUES (?, ?, ?, ?, ?)').run(OZZY.email, null, 'Support', 'Assistant', '2025-08-01');
  return d1;
}

const full = (form, over = {}) => {
  const out = [];
  for (const s of form.sections) for (const q of s.questions) {
    if (q.kind === 'rating') out.push({ qid: q.id, rating: over[q.id] ?? 4, example: '' });
    else if (q.kind === 'text') out.push({ qid: q.id, text: 'A written answer with a concrete example.' });
    else if (q.kind === 'choice') out.push({ qid: q.id, text: q.options[0] });
  }
  return out;
};

before(async () => {
  M = await import('../src/data/evaluation-forms.ts');
  S = await import('../functions/_lib/evals/service.ts');
  R = await import('../functions/_lib/evals/rules.ts');
  F = await import('../functions/_lib/people-dev.ts');
  A = await import('../functions/_lib/evals/api.ts');
  X = await import('../functions/_lib/evals/export.ts');
  G = await import('../functions/_lib/evals/settings.ts');
  realFetch = globalThis.fetch;
});

beforeEach(() => {
  db = world();
  sent = [];
  env = { DB: db, RESEND_API_KEY: 'test' };
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('resend')) sent.push(JSON.parse(init.body));
    return new Response('{}', { status: 200 });
  };
});

const call = (u, m, p, b) => A.handle(env, u, m, p.split('/').filter(Boolean), b);
const startTerm = async (emails = [ANN.email]) => S.startTerm(env, ADA, { startsOn: '2026-01-05', emails });
const caseFor = async (email = ANN.email) => db.db.prepare('SELECT id FROM eval_cases WHERE employee_email = ?').get(email).id;

describe('the forms are Rachel\'s, word for word', () => {
  it('counts match her questionnaire', () => {
    assert.equal(M.answerable(M.FORM_A).length, 74);
    assert.equal(M.answerable(M.FORM_B).length + 2, 50);
    assert.equal(M.FORM_A.sections.filter((s) => s.id !== 'a-info').length, 6);
    assert.equal(M.questionsOf(M.FORM_A).find((q) => q.id === 'a1').text, 'I understand my role, responsibilities, and the expectations outlined in my RR&E.');
    assert.equal(M.questionsOf(M.FORM_A).find((q) => q.id === 'a74').text, 'Is there anything else you would like to share during your evaluation?');
    assert.equal(M.questionsOf(M.FORM_B).find((q) => q.id === 'b50').text, 'Is there any additional feedback, encouragement, or recommendation you would like to share?');
  });

  it('keeps her scale, with Not Observed, and her introduction', () => {
    assert.deepEqual(M.SCALE.map((s) => s.label), ['Exceptional', 'Strong', 'Meets Expectations', 'Developing', 'Needs Significant Improvement', 'Not Observed']);
    assert.match(M.FORM_A.intro[0], /^At Favor International, our desire is to cultivate a culture of growth, accountability, encouragement, and excellence as we serve the Lord together\.$/);
  });

  it('asks nothing about marital status, children, tithing or church attendance', () => {
    const all = [M.FORM_A, M.FORM_B].flatMap((f) => M.questionsOf(f)).map((q) => q.text.toLowerCase()).join(' ');
    for (const w of ['marital', 'married', 'children', 'tithe', 'tithing', 'church attendance', 'attend church']) assert.ok(!all.includes(w), w);
  });

  it('requires every rating, 15 to 20 long answers on Form A, and says who reads each form', () => {
    const req = M.requiredText(M.FORM_A).length;
    assert.ok(req >= 15 && req <= 20, `required long answers on Form A: ${req}`);
    for (const f of [M.FORM_A, M.FORM_B]) assert.ok(f.readers.length > 40);
    assert.match(M.FORM_B.readers, /not anonymous/i);
    assert.ok(!/anonym/i.test(M.FORM_A.readers));
  });

  it('pairs each competency with real question ids', () => {
    const ids = new Set([...M.questionsOf(M.FORM_A), ...M.questionsOf(M.FORM_B)].map((q) => q.id));
    for (const c of M.COMPETENCIES) for (const id of [...c.a, ...c.b]) assert.ok(ids.has(id), id);
  });
});

describe('rules', () => {
  it('a rating of 1 or 2 needs an example, Not Observed does not', () => {
    const a = [{ qid: 'a1', rating: 2, example: '' }, { qid: 'a2', rating: 0, example: '' }, { qid: 'a3', rating: 1, example: 'Missed two deadlines in March.' }];
    const g = R.gapsOf(M.FORM_A, a);
    assert.deepEqual(g.examples, ['a1']);
    assert.ok(!g.ratings.includes('a2'));
    assert.ok(g.ratings.includes('a4'));
  });

  it('averages leave Not Observed out and never make one overall score', () => {
    const self = [{ qid: 'a1', rating: 4 }, { qid: 'a2', rating: 3 }];
    const others = [[{ qid: 'b5', rating: 5 }, { qid: 'b6', rating: 0 }], [{ qid: 'b5', rating: 3 }, { qid: 'b6', rating: 2 }]];
    const r = R.competencyAverages(self, others);
    const role = r.rows.find((x) => x.id === 'role');
    assert.deepEqual([role.self, role.others, role.raters, role.gap], [4, 4, 2, 0]);
    const follow = r.rows.find((x) => x.id === 'follow');
    assert.deepEqual([follow.self, follow.others, follow.raters], [3, 2, 1]);
    assert.ok(!('overall' in r));
  });

  it('themes name competencies and words several reviewers share', () => {
    const t = R.textThemes([['She communicates clearly and prays for the team'], ['Clearly strong prayer life'], ['Dependable']]);
    assert.ok(t.some((x) => x.word === 'clearly' && x.people === 2));
  });

  it('the employee never reads raw feedback about themselves, even as an admin', () => {
    const c = { employee: 'a@x', supervisor: 's@x' };
    assert.equal(R.mayReadRaw({ email: 'a@x', admin: true, hr: true }, c), false);
    assert.equal(R.mayReadRaw({ email: 's@x', admin: false, hr: false }, c), true);
    assert.equal(R.mayReadRaw({ email: 'o@x', admin: false, hr: false }, c), false);
    assert.equal(R.mayReadRaw({ email: 'h@x', admin: false, hr: true }, c), true);
  });

  it('the calendar runs two weeks of a length HR sets, and groups starters by half year', () => {
    assert.deepEqual(R.weekDue('2026-01-05'), { w1: '2026-01-12', w2: '2026-01-19', w3: '2026-01-19' });
    assert.deepEqual(R.weekDue('2026-01-05', 10, 5), { w1: '2026-01-15', w2: '2026-01-20', w3: '2026-01-20' });
    assert.equal(R.periodFor('2026-01-05'), 'January to June 2026');
    assert.equal(R.groupByStart('2025-03-01'), 'first');
    assert.equal(R.groupByStart('2025-08-01'), 'second');
    assert.equal(R.groupByStart(''), 'unknown');
  });
});

describe('shared reporting lines and hr', () => {
  it('answers supervisor, reports and hr from the table', async () => {
    assert.equal(await F.supervisorOf(env, 'ANN@favorintl.org'), SAM.email);
    assert.deepEqual(await F.reportsOf(env, SAM.email), [ANN.email]);
    assert.equal(await F.supervisorOf(env, OZZY.email), '');
    assert.equal(await F.isHr(env, HAL.email), true);
    assert.equal(await F.isHr(env, ANN.email), false);
    assert.equal(await F.isHrOrAdmin(env, ADA), true);
    assert.equal(await F.isHrOrAdmin(env, HAL), true);
    assert.equal(await F.isHrOrAdmin(env, OZZY), false);
  });

  it('answers empty before the tables exist', async () => {
    const bare = { DB: memoryD1() };
    assert.equal(await F.supervisorOf(bare, 'x@favorintl.org'), '');
    assert.deepEqual(await F.reportsOf(bare, 'x@favorintl.org'), []);
    assert.equal(await F.isHr(bare, 'x@favorintl.org'), false);
  });
});

describe('Admin > People: the reporting line and HR flag', () => {
  it('saves a supervisor, title, start date and HR by drop-down, audits each, and refuses loops', async () => {
    const P = await import('../functions/_lib/admin/people.ts');
    const me = { email: ADA.email, name: ADA.name };
    const p = await P.savePerson(env, me, { email: OZZY.email, supervisor: SAM.email, startDate: '2025-08-01', title: 'Support Assistant', hr: true });
    assert.deepEqual([p.supervisor, p.startDate, p.title, p.hr], [SAM.email, '2025-08-01', 'Support Assistant', true]);
    assert.equal(await F.supervisorOf(env, OZZY.email), SAM.email);
    assert.equal(await F.isHr(env, OZZY.email), true);
    const rows = db.db.prepare("SELECT key FROM hub_audit WHERE key LIKE 'ozzy@favorintl.org:%'").all().map((r) => r.key);
    assert.ok(rows.includes('ozzy@favorintl.org:supervisor') && rows.includes('ozzy@favorintl.org:hr'));
    await assert.rejects(() => P.savePerson(env, me, { email: SAM.email, supervisor: OZZY.email }), /circle/);
    await assert.rejects(() => P.savePerson(env, me, { email: SAM.email, supervisor: SAM.email }), /themselves/);
    await assert.rejects(() => P.savePerson(env, me, { email: SAM.email, startDate: '2025-13-40' }), /real start date/);
    const off = await P.savePerson(env, me, { email: OZZY.email, supervisor: '', hr: false });
    assert.deepEqual([off.supervisor, off.hr], ['', false]);
    assert.equal(off.startDate, '2025-08-01');
  });
});

describe('opening a term', () => {
  it('is for HR and admins, copies the supervisor, and lists who has none', async () => {
    await assert.rejects(() => S.startTerm(env, OZZY, { startsOn: '2026-01-05', emails: [ANN.email] }), /HR and hub administrators/);
    const t = await S.startTerm(env, HAL, { startsOn: '2026-01-05', emails: [ANN.email, OZZY.email, 'nobody@favorintl.org'] });
    assert.equal(t.opened, 2);
    assert.deepEqual(t.noSupervisor, [OZZY.email]);
    assert.equal(t.skipped[0].email, 'nobody@favorintl.org');
    const c = db.db.prepare('SELECT * FROM eval_cases WHERE employee_email = ?').get(ANN.email);
    assert.equal(c.supervisor_email, SAM.email);
    assert.deepEqual([c.w1_due, c.w2_due], ['2026-01-12', '2026-01-19']);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].to[0], ANN.email);
  });

  it('does not open the same person twice for a period', async () => {
    await startTerm();
    const again = await startTerm();
    assert.equal(again.opened, 0);
  });

  it('the picker lists staff with their start date and whether they have a supervisor', async () => {
    const list = await S.pickList(env, HAL);
    const ann = list.find((p) => p.email === ANN.email);
    assert.deepEqual([ann.startDate, ann.hasSupervisor], ['2025-03-01', true]);
    assert.equal(list.find((p) => p.email === OZZY.email).hasSupervisor, false);
  });
});

const answerAll = async (u, id, form, over) => {
  await call(u, 'PUT', `case/${id}/answers`, { form, answers: full(form === 'A' ? M.FORM_A : M.FORM_B, over), relationship: 'Colleague / Peer', frequency: 'Weekly' });
  await call(u, 'POST', `case/${id}/submit`, { form });
};
const selfAndReviewers = async (list = [SAM, REV[0]]) => {
  await startTerm();
  const id = await caseFor();
  await answerAll(ANN, id, 'A');
  await call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: list.map((r) => ({ email: r.email })) });
  return id;
};

describe('the forms are loaded from Rachel\'s documents', () => {
  it('uses her edited wording and keeps the question kinds', () => {
    const q = (f, id) => M.questionsOf(f).find((x) => x.id === id);
    assert.equal(q(M.FORM_A, 'a11').text, 'What are a few of your most significant accomplishments during this evaluation period?');
    assert.match(q(M.FORM_A, 'a73').text, /^If given the opportunity to visit the field/);
    assert.equal(q(M.FORM_A, 'a73').req, false);
    assert.match(q(M.FORM_B, 'b15').text, /^Have you observed any recurring patterns of behavior/);
    assert.equal(q(M.FORM_B, 'b45').text, 'What are some of the greatest strengths this employee brings to Favor?');
    assert.deepEqual([q(M.FORM_A, 'a1').kind, q(M.FORM_A, 'a11').kind, q(M.FORM_B, 'b3').kind, q(M.FORM_B, 'b4').kind], ['rating', 'text', 'choice', 'choice']);
    assert.equal(M.FORMS.C, undefined);
  });
});

describe('the reviewers: two or three, the supervisor always one', () => {
  it('refuses a list without the supervisor, or with one or four people', async () => {
    await startTerm();
    const id = await caseFor();
    await answerAll(ANN, id, 'A');
    const put = (list) => call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: list.map((r) => ({ email: r.email })) });
    await assert.rejects(() => put([REV[0], REV[1]]), /supervisor is always one/);
    await assert.rejects(() => put([SAM]), /2 or 3/);
    await assert.rejects(() => put([SAM, REV[0], REV[1], REV[2]]), /no more than 3/i);
    sent.length = 0;
    const ok = await put([SAM, REV[0]]);
    assert.equal(ok.stage, 'feedback');
    const to = sent.map((m) => m.to[0]);
    assert.ok(to.includes(SAM.email) && to.includes(REV[0].email), 'each reviewer gets an email');
    assert.ok(sent.some((m) => String(m.html).includes('/evaluations/?c=' + id)), 'the email carries the link to that evaluation');
  });

  it('a reviewer declines with a note, the supervisor hears, and the employee picks a replacement', async () => {
    const id = await selfAndReviewers([SAM, REV[0], REV[1]]);
    await assert.rejects(() => call(SAM, 'POST', `case/${id}/decline`, {}), /supervisor reviews every/);
    sent.length = 0;
    await call(REV[1], 'POST', `case/${id}/decline`, { note: 'On leave that week.' });
    const to = sent.map((m) => m.to[0]);
    assert.ok(to.includes(ANN.email) && to.includes(SAM.email));
    assert.ok(sent.some((m) => m.to[0] === SAM.email && String(m.html).includes('On leave that week.')));
    assert.ok(!sent.some((m) => m.to[0] === ANN.email && String(m.html).includes('On leave')), 'the employee does not read the note');
    const sv = (await call(SAM, 'GET', `case/${id}`)).view;
    assert.equal(sv.reviewers.find((r) => r.email === REV[1].email).declineNote, 'On leave that week.');
    const ev = (await call(ANN, 'GET', `case/${id}`)).view;
    assert.equal(ev.reviewers.find((r) => r.email === REV[1].email).status, 'declined');
    assert.equal(ev.reviewers.find((r) => r.email === REV[1].email).declineNote, undefined);
    await call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: [SAM, REV[0], REV[2]].map((r) => ({ email: r.email })) });
    assert.equal((await call(ANN, 'GET', `case/${id}`)).view.reviewers.filter((r) => r.status === 'asked').length, 3);
  });

  it('the supervisor hears about every form as it comes in, and the employee reads no reviewer words', async () => {
    const id = await selfAndReviewers([SAM, REV[0]]);
    sent.length = 0;
    const b = full(M.FORM_B);
    b.find((x) => x.qid === 'b13').text = 'SECRETWORDS about strengths';
    await call(REV[0], 'PUT', `case/${id}/answers`, { form: 'B', answers: b, relationship: 'Colleague / Peer', frequency: 'Weekly' });
    await call(REV[0], 'POST', `case/${id}/submit`, { form: 'B' });
    assert.ok(sent.some((m) => m.to[0] === SAM.email && /1 of 2/.test(m.subject)), 'one notice per form');
    await assert.rejects(() => call(OZZY, 'GET', `case/${id}`), /not part of/);
    const av = (await call(ANN, 'GET', `case/${id}`)).view;
    assert.ok(!JSON.stringify(av).includes('SECRETWORDS'));
    assert.equal(av.feedback, undefined);
    const sv = (await call(SAM, 'GET', `case/${id}`)).view;
    assert.ok(JSON.stringify(sv).includes('SECRETWORDS'));
    const hv = (await call(HAL, 'GET', `case/${id}`)).view;
    assert.equal(hv.feedback.length, 2);
  });
});

describe('export to Google Sheets', () => {
  it('builds the self-evaluation and each reviewer as separate sheets with the reviewer name beside every answer', async () => {
    const id = await selfAndReviewers([SAM, REV[0]]);
    const b = full(M.FORM_B);
    b.find((x) => x.qid === 'b13').text = 'Great with partners';
    await call(REV[0], 'PUT', `case/${id}/answers`, { form: 'B', answers: b, relationship: 'Colleague / Peer', frequency: 'Weekly' });
    await call(REV[0], 'POST', `case/${id}/submit`, { form: 'B' });
    const self = await X.exportSpec(env, SAM, id, { part: 'self' });
    assert.match(self.title, /^Self-evaluation, Ann Employee/);
    assert.equal(self.tab.rows.length, M.answerable(M.FORM_A).length);
    assert.ok(self.tab.rows.every((r) => r.reviewer === undefined));
    const rev = await X.exportSpec(env, HAL, id, { part: 'reviewer', email: REV[0].email });
    assert.match(rev.title, /^Feedback from Rae r1 on Ann Employee/);
    assert.equal(rev.tab.rows.length, M.answerable(M.FORM_B).length);
    assert.ok(rev.tab.rows.every((r) => r.reviewer === 'Rae r1'));
    assert.equal(rev.tab.rows.find((r) => String(r.question).startsWith('What do you consider')).answer, 'Great with partners');
    assert.equal(rev.tab.rows.find((r) => r.n === 5).rating, '4 Strong');
    await assert.rejects(() => X.exportSpec(env, SAM, id, { part: 'reviewer', email: SAM.email }), /has not submitted/);
  });

  it('is for the supervisor, HR and admins, never the employee or a reviewer', async () => {
    const id = await selfAndReviewers([SAM, REV[0]]);
    for (const u of [ANN, REV[0], OZZY]) await assert.rejects(() => X.exportSpec(env, u, id, { part: 'self' }), /Nobody exports their own/);
    await assert.rejects(() => call(ANN, 'POST', `case/${id}/export`, { part: 'self' }), /Nobody exports their own/);
    await assert.rejects(() => X.exportSpec(env, ADA, id, { part: 'nothing' }), /Pick the self-evaluation/);
  });
});

describe('the meeting, the final evaluation and the signature', () => {
  const DOC = 'https://docs.google.com/document/d/1abcdefghijklmnopqrstuvwxyz0123456789/edit';
  it('runs from the schedule to the signature without the system writing anything', async () => {
    const id = await selfAndReviewers([SAM, REV[0]]);
    await assert.rejects(() => call(ANN, 'POST', `case/${id}/meeting`, { date: '2026-01-14' }), /supervisor, HR or an administrator/);
    await assert.rejects(() => call(SAM, 'POST', `case/${id}/final`, { url: DOC }), /Schedule the review meeting/);
    sent.length = 0;
    await call(HAL, 'POST', `case/${id}/meeting`, { date: '2026-01-14', time: '14:30', link: 'https://zoom.us/j/123', leader: OZZY.email });
    assert.deepEqual(sent.map((m) => m.to[0]).sort(), [ANN.email, OZZY.email, SAM.email].sort());
    assert.ok(sent.every((m) => String(m.html).includes('2:30 PM Eastern')));
    await assert.rejects(() => call(HAL, 'POST', `case/${id}/meeting`, { date: '2026-01-14', link: 'zoom.us' }), /https/);
    const ov = (await call(OZZY, 'GET', `case/${id}`)).view;
    assert.equal(ov.role.leader, true);
    assert.equal(ov.self, undefined);
    assert.equal(ov.feedback, undefined);
    assert.equal((await call(OZZY, 'GET', 'me')).leads.length, 1);
    await assert.rejects(() => call(SAM, 'POST', `case/${id}/final`, { url: 'https://example.com/x' }), /Google Doc/);
    await assert.rejects(() => call(ANN, 'POST', `case/${id}/final`, { url: DOC }), /Only the supervisor/);
    assert.equal((await call(ANN, 'GET', `case/${id}`)).view.case.docUrl, '');
    sent.length = 0;
    await call(SAM, 'POST', `case/${id}/final`, { url: DOC });
    assert.ok(sent.some((m) => m.to[0] === ANN.email));
    const av = (await call(ANN, 'GET', `case/${id}`)).view;
    assert.equal(av.case.docUrl, DOC);
    assert.equal(av.final.templateUrl, '', 'the form template is for the people who write it');
    const sv = (await call(SAM, 'GET', `case/${id}`)).view;
    assert.match(sv.final.templateUrl, /\/copy$/);
    assert.match(sv.final.instructionsUrl, /^https:\/\/docs\.google\.com\//);
    await assert.rejects(() => S.acknowledge(env, ANN, id, '', new Date('2026-01-10T15:00:00Z')), /after the meeting/);
    await S.acknowledge(env, ANN, id, 'Thank you.', new Date('2026-01-15T15:00:00Z'));
    await assert.rejects(() => call(SAM, 'POST', `case/${id}/sign`), /HR signs/);
    const signed = await call(HAL, 'POST', `case/${id}/sign`);
    assert.equal(signed.stage, 'done');
  });

  it('the supervisor can take the final evaluation back until the employee acknowledges', async () => {
    const id = await selfAndReviewers();
    await call(HAL, 'POST', `case/${id}/meeting`, { date: '2026-01-14' });
    await call(SAM, 'POST', `case/${id}/final`, { url: DOC });
    await call(SAM, 'POST', `case/${id}/final-reopen`, {});
    assert.equal((await call(ANN, 'GET', `case/${id}`)).view.case.docUrl, '');
    await call(SAM, 'POST', `case/${id}/final`, { url: DOC });
    await S.acknowledge(env, ANN, id, '', new Date('2026-01-15T15:00:00Z'));
    await assert.rejects(() => call(SAM, 'POST', `case/${id}/final-reopen`, {}), /already acknowledged/);
  });
});

describe('opening a term, the settings and the gate', () => {
  it('uses the supervisor setting for people with no reporting line, and a line in People always wins', async () => {
    db.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('evals.supervisors', ?, 't', ?)").run(JSON.stringify({ [OZZY.email]: SAM.email, [ANN.email]: HAL.email }), NOW);
    const t = await S.startTerm(env, ADA, { startsOn: '2026-01-05', emails: [OZZY.email, ANN.email], w1Days: 10, w2Days: 5 });
    assert.deepEqual(t.noSupervisor, []);
    const rows = Object.fromEntries(db.db.prepare('SELECT employee_email AS e, supervisor_email AS s, w1_due, w2_due FROM eval_cases').all().map((r) => [r.e, r]));
    assert.equal(rows[OZZY.email].s, SAM.email);
    assert.equal(rows[ANN.email].s, SAM.email, 'Reports to in Admin > People wins');
    assert.deepEqual([rows[ANN.email].w1_due, rows[ANN.email].w2_due], ['2026-01-15', '2026-01-20']);
    assert.equal(db.db.prepare('SELECT supervisor_email AS s FROM hub_reporting WHERE email = ?').get(OZZY.email).s, null, 'the reporting table is not written');
  });

  it('defaults Rachel and Michael to Terry', async () => {
    const st = await G.evalSettings(env);
    assert.equal(st.supervisors['rachel@favorintl.org'], 'terry@favorintl.org');
    assert.equal(st.supervisors['michael@favorintl.org'], 'terry@favorintl.org');
  });

  it('opens only for the Early access list, Grace, HR and admins', async () => {
    db.db.prepare("DELETE FROM hub_settings WHERE key = 'early_access'").run();
    await assert.rejects(() => call(ANN, 'GET', 'forms'), /not open to everyone/);
    await assert.rejects(() => call(OZZY, 'GET', 'me'), /not open to everyone/);
    assert.ok((await call(ADA, 'GET', 'forms')).forms, 'admins keep it');
    assert.ok((await call(HAL, 'GET', 'me')).manage, 'HR keeps it');
    assert.equal((await S.waitingOn(env, ANN)).n, 0);
    const grace = { email: 'grace@favorintl.org', name: 'Grace', role: 'staff' };
    assert.equal(await G.mayUseEvals(env, grace), true, 'Grace is in evals.access by default');
    db.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('early_access', ?, 't', ?)").run(JSON.stringify({ emails: [ANN.email], teams: [] }), NOW);
    assert.ok((await call(ANN, 'GET', 'forms')).forms);
    await assert.rejects(() => call(SAM, 'GET', 'forms'), /not open to everyone/);
  });

  it('does not open the same person twice and reminders go once each, feedback due at the end of week 1', async () => {
    await startTerm();
    const id = await caseFor();
    await answerAll(ANN, id, 'A');
    await call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: [SAM, REV[0]].map((r) => ({ email: r.email })) });
    sent.length = 0;
    const one = await S.runNudges(env, new Date('2026-01-11T15:00:00Z'));
    assert.equal(one.sent, 2, 'both reviewers, two days before week 1 ends');
    assert.equal((await S.runNudges(env, new Date('2026-01-11T18:00:00Z'))).sent, 0);
    const behind = (await S.termReport(env, HAL, db.db.prepare('SELECT id FROM eval_terms').get().id, new Date('2026-01-14T15:00:00Z'))).cases[0].behind;
    assert.ok(behind.some((x) => x.what.startsWith('Feedback on')));
    assert.ok(behind.some((x) => x.what === 'Review meeting not scheduled'));
    assert.ok(!JSON.stringify(behind).includes('A written answer'));
  });
});

describe('the routes', () => {
  it('serve the forms and keep admin routes to HR and admins', async () => {
    const f = await call(OZZY, 'GET', 'forms');
    assert.equal(f.forms.A.sections.length, 7);
    assert.equal(f.limits.reviewersMin, 2);
    assert.equal(f.limits.reviewersMax, 3);
    assert.equal(f.forms.C, undefined);
    await assert.rejects(() => call(OZZY, 'GET', 'admin/terms'), /HR and hub administrators/);
    assert.ok((await call(HAL, 'GET', 'admin/terms')).terms);
    assert.ok((await call(ADA, 'GET', 'admin/pick')).people.length >= 3);
    await assert.rejects(() => call(OZZY, 'GET', 'nothing'), /nothing at that address/);
    await assert.rejects(() => call(OZZY, 'GET', 'courses'), /nothing at that address/);
  });
});
