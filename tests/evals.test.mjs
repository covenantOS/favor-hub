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

let M, S, R, F, A, D, db, env, sent, realFetch;

function world() {
  const d1 = memoryD1();
  for (const f of ['db/schema.sql', 'db/work.sql', 'db/expenses.sql', 'db/signin.sql', 'db/reports.sql', 'db/admin-home.sql', 'db/meetings.sql', 'db/people-dev.sql']) d1.exec(read(f));
  for (const p of PEOPLE) {
    d1.db.prepare('INSERT INTO hub_users (email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(p.email, p.name, p.role, NOW, NOW);
    d1.db.prepare('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, 1)').run(p.email, p.name, 'Staff', 'Operations');
  }
  d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('requests.notify', 'on', 't', ?)").run(NOW);
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
  D = await import('../functions/_lib/evals/drive.ts');
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
    assert.equal(M.answerable(M.FORM_C).length, 10);
    assert.equal(M.FORM_A.sections.filter((s) => s.id !== 'a-info').length, 6);
    assert.equal(M.questionsOf(M.FORM_A).find((q) => q.id === 'a1').text, 'I understand my role, responsibilities, and the expectations outlined in my RR&E.');
    assert.equal(M.questionsOf(M.FORM_A).find((q) => q.id === 'a74').text, 'Is there anything else you would like to share during your evaluation?');
    assert.equal(M.questionsOf(M.FORM_B).find((q) => q.id === 'b50').text, 'Is there any additional feedback, encouragement, or recommendation you would like to share?');
  });

  it('keeps her scale, with Not Observed, and her introduction', () => {
    assert.deepEqual(M.SCALE.map((s) => s.label), ['Exceptional', 'Strong', 'Meets Expectations', 'Developing', 'Needs Significant Improvement', 'Not Observed']);
    assert.match(M.FORM_A.intro[0], /^At Favor International, our desire is to cultivate a culture of growth, accountability, encouragement, and excellence as we serve the Lord together\.$/);
    assert.equal(M.PLAN_AREAS.length, 4);
  });

  it('asks nothing about marital status, children, tithing or church attendance', () => {
    const all = [M.FORM_A, M.FORM_B, M.FORM_C].flatMap((f) => M.questionsOf(f)).map((q) => q.text.toLowerCase()).join(' ');
    for (const w of ['marital', 'married', 'children', 'tithe', 'tithing', 'church attendance', 'attend church']) assert.ok(!all.includes(w), w);
  });

  it('requires every rating, 15 to 20 long answers on Form A, and says who reads each form', () => {
    const req = M.requiredText(M.FORM_A).length;
    assert.ok(req >= 15 && req <= 20, `required long answers on Form A: ${req}`);
    for (const f of [M.FORM_A, M.FORM_B, M.FORM_C]) assert.ok(f.readers.length > 40);
    assert.match(M.FORM_B.readers, /not anonymous/i);
    assert.ok(!/anonym/i.test(M.FORM_A.readers + M.FORM_C.readers));
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

  it('the calendar runs three weeks and groups starters by half year', () => {
    assert.deepEqual(R.weekDue('2026-01-05'), { w1: '2026-01-12', w2: '2026-01-19', w3: '2026-01-26' });
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
    assert.deepEqual([c.w1_due, c.w2_due, c.w3_due], ['2026-01-12', '2026-01-19', '2026-01-26']);
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

describe('the cycle, week by week', () => {
  it('walks one person from self-assessment to a filed document', async () => {
    await startTerm();
    const id = await caseFor();

    // Week 1: self-assessment, saved as she goes.
    const half = full(M.FORM_A).slice(0, 20);
    const saved = await call(ANN, 'PUT', `case/${id}/answers`, { form: 'A', answers: half });
    assert.equal(saved.saved, 20);
    await assert.rejects(() => call(ANN, 'POST', `case/${id}/submit`, { form: 'A' }), /not finished/);
    const bad = full(M.FORM_A, { a1: 2 });
    await call(ANN, 'PUT', `case/${id}/answers`, { form: 'A', answers: bad });
    await assert.rejects(() => call(ANN, 'POST', `case/${id}/submit`, { form: 'A' }), /need an example/);
    const ok = full(M.FORM_A, { a1: 2 });
    ok.find((a) => a.qid === 'a1').example = 'I missed the January filing.';
    await call(ANN, 'PUT', `case/${id}/answers`, { form: 'A', answers: ok });
    await call(ANN, 'POST', `case/${id}/submit`, { form: 'A' });
    let v = (await call(ANN, 'GET', `case/${id}`)).view;
    assert.equal(v.case.stage, 'self');
    assert.equal(v.case.selfSubmitted, true);
    // Locked after submit.
    await assert.rejects(() => call(ANN, 'PUT', `case/${id}/answers`, { form: 'A', answers: ok }), /submitted/);

    // Reviewers: 3 to 5, from the staff list, never herself.
    await assert.rejects(() => call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: [{ email: REV[0].email }, { email: REV[1].email }] }), /3 to 5/);
    await assert.rejects(() => call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: [{ email: ANN.email }, { email: REV[0].email }, { email: REV[1].email }] }), /other than/);
    sent.length = 0;
    const set = await call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: REV.slice(0, 3).map((r) => ({ email: r.email })) });
    assert.equal(set.stage, 'feedback');
    const to = sent.map((m) => m.to[0]);
    for (const r of REV.slice(0, 3)) assert.ok(to.includes(r.email), 'each reviewer is asked by email');
    assert.ok(to.includes(SAM.email), 'the supervisor hears the self-assessment is in');

    // Week 2: reviewers write their own Form B and see nothing else.
    for (const [i, r] of REV.slice(0, 3).entries()) {
      const rv = (await call(r, 'GET', `case/${id}`)).view;
      assert.equal(rv.self, undefined);
      assert.equal(rv.feedback, undefined);
      assert.equal(rv.reviewers, undefined);
      assert.equal(rv.analysis, undefined);
      assert.equal(rv.role.reviewer, true);
      const bans = full(M.FORM_B, { b5: i === 0 ? 5 : 3 });
      bans.find((x) => x.qid === 'b13').text = 'SECRETWORDS about strengths';
      await call(r, 'PUT', `case/${id}/answers`, { form: 'B', answers: bans, relationship: 'Colleague / Peer', frequency: 'Weekly' });
      await call(r, 'POST', `case/${id}/submit`, { form: 'B' });
      await assert.rejects(() => call(r, 'PUT', `case/${id}/answers`, { form: 'B', answers: [] }), /already submitted/);
    }

    // The employee sees who was asked and whether they answered, never what they said.
    v = (await call(ANN, 'GET', `case/${id}`)).view;
    assert.equal(v.reviewers.length, 3);
    assert.ok(v.reviewers.every((r) => r.status === 'submitted'));
    assert.equal(v.feedback, undefined);
    assert.equal(v.analysis, undefined);
    assert.equal(v.summary, undefined);

    // An outsider and a person not asked see nothing.
    await assert.rejects(() => call(OZZY, 'GET', `case/${id}`), /not part of/);
    await assert.rejects(() => call(REV[3], 'GET', `case/${id}`), /not part of/);
    await assert.rejects(() => call(REV[3], 'PUT', `case/${id}/answers`, { form: 'B', answers: [] }), /not asked/);

    // The supervisor sees both sides with names, per competency, and no overall score.
    const sv = (await call(SAM, 'GET', `case/${id}`)).view;
    assert.equal(sv.feedback.length, 3);
    assert.ok(sv.feedback[0].reviewer.startsWith('Rae'));
    const role = sv.analysis.rows.find((r) => r.id === 'role');
    assert.deepEqual([role.self, role.others, role.raters], [2, 3.67, 3]);
    assert.equal(sv.analysis.categories.length, 4);
    assert.ok(!('overall' in sv.analysis));
    const hv = (await call(HAL, 'GET', `case/${id}`)).view;
    assert.equal(hv.feedback.length, 3);

    // Week 2 to 3: the supervisor's summary and plan.
    await assert.rejects(() => call(ANN, 'PUT', `case/${id}/answers`, { form: 'C', answers: [] }), /supervisor writes/);
    await assert.rejects(() => call(OZZY, 'PUT', `case/${id}/goals`, { goals: [] }), /supervisor writes/);
    await call(SAM, 'PUT', `case/${id}/answers`, { form: 'C', answers: full(M.FORM_C) });
    await assert.rejects(() => call(SAM, 'POST', `case/${id}/submit`, { form: 'C', meetingOn: '2026-01-26' }), /priority goals/);
    const goals = (await call(SAM, 'PUT', `case/${id}/goals`, {
      goals: [
        { area: M.PLAN_AREAS[0], goal: 'Finish the Blackbaud course', steps: 'Two lessons a week', support: 'Time on Fridays', targetDate: '2026-04-30' },
        { area: M.PLAN_AREAS[1], goal: 'Send weekly updates', steps: 'Friday note to the team', targetDate: '2026-03-31' },
      ],
    })).goals;
    assert.equal(goals.length, 2);
    // The employee cannot see the summary or plan until it is shared.
    assert.equal((await call(ANN, 'GET', `case/${id}`)).view.summary, undefined);
    sent.length = 0;
    const shared = await call(SAM, 'POST', `case/${id}/submit`, { form: 'C', meetingOn: '2026-01-26' });
    assert.equal(shared.stage, 'meeting');
    assert.ok(sent.some((m) => m.to[0] === ANN.email));
    const av = (await call(ANN, 'GET', `case/${id}`)).view;
    assert.equal(av.summary.goals.length, 2);
    assert.equal(av.summary.answers.length, 10);
    assert.equal(av.feedback, undefined, 'the employee gets the summary, not the words');
    assert.equal(av.analysis, undefined);
    assert.equal(av.self.answers.length > 0, true);
    assert.ok(!JSON.stringify(av).includes('SECRETWORDS'), 'no reviewer words reach the employee');

    // Week 3: acknowledgment waits for the meeting, then HR signs.
    await assert.rejects(() => S.acknowledge(env, ANN, id, '', new Date('2026-01-20T15:00:00Z')), /after the meeting/);
    await assert.rejects(() => call(SAM, 'POST', `case/${id}/acknowledge`, {}), /Only the employee/);
    await S.acknowledge(env, ANN, id, 'Thank you.', new Date('2026-01-27T15:00:00Z'));
    await assert.rejects(() => call(SAM, 'POST', `case/${id}/sign`), /HR signs/);
    await assert.rejects(() => call(ANN, 'POST', `case/${id}/sign`), /HR signs/);
    const signed = await call(HAL, 'POST', `case/${id}/sign`);
    assert.equal(signed.stage, 'done');
    assert.match(signed.docError, /No evaluation folder/);
    const c = db.db.prepare('SELECT * FROM eval_cases WHERE id = ?').get(id);
    assert.equal(c.signed_by, HAL.email);
  });

  it('the supervisor may go ahead with fewer than three feedback forms, but must confirm', async () => {
    await startTerm();
    const id = await caseFor();
    await call(ANN, 'PUT', `case/${id}/answers`, { form: 'A', answers: full(M.FORM_A) });
    await call(ANN, 'POST', `case/${id}/submit`, { form: 'A' });
    await call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: REV.slice(0, 3).map((r) => ({ email: r.email })) });
    await call(REV[0], 'PUT', `case/${id}/answers`, { form: 'B', answers: full(M.FORM_B), relationship: 'Colleague / Peer', frequency: 'Daily' });
    await call(REV[0], 'POST', `case/${id}/submit`, { form: 'B' });
    await call(SAM, 'PUT', `case/${id}/answers`, { form: 'C', answers: full(M.FORM_C) });
    await call(SAM, 'PUT', `case/${id}/goals`, { goals: [{ area: M.PLAN_AREAS[0], goal: 'g1', steps: 's', targetDate: '2026-04-01' }, { area: M.PLAN_AREAS[2], goal: 'g2', steps: 's', targetDate: '2026-05-01' }] });
    await assert.rejects(() => call(SAM, 'POST', `case/${id}/submit`, { form: 'C', meetingOn: '2026-01-26' }), /Confirm to go ahead with 1/);
    const r = await call(SAM, 'POST', `case/${id}/submit`, { form: 'C', meetingOn: '2026-01-26', proceedWithFewer: true });
    assert.equal(r.stage, 'meeting');
  });

  it('a reviewer who never answers can be replaced, and the decline shows', async () => {
    await startTerm();
    const id = await caseFor();
    await call(ANN, 'PUT', `case/${id}/answers`, { form: 'A', answers: full(M.FORM_A) });
    await call(ANN, 'POST', `case/${id}/submit`, { form: 'A' });
    await call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: REV.slice(0, 3).map((r) => ({ email: r.email })) });
    await call(REV[2], 'POST', `case/${id}/decline`, {});
    const v = (await call(SAM, 'GET', `case/${id}`)).view;
    assert.equal(v.reviewers.find((r) => r.email === REV[2].email).status, 'declined');
    await call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: [REV[0], REV[1], REV[3]].map((r) => ({ email: r.email })) });
    const after = (await call(ANN, 'GET', `case/${id}`)).view;
    assert.equal(after.reviewers.filter((r) => r.status === 'asked').length, 3);
    await assert.rejects(() => call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: REV.map((r) => ({ email: r.email })).concat([{ email: OZZY.email }, { email: HAL.email }]) }), /no more than 5/);
  });

  it('the employee cannot take back a reviewer who already submitted', async () => {
    await startTerm();
    const id = await caseFor();
    await call(ANN, 'PUT', `case/${id}/answers`, { form: 'A', answers: full(M.FORM_A) });
    await call(ANN, 'POST', `case/${id}/submit`, { form: 'A' });
    await call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: REV.slice(0, 3).map((r) => ({ email: r.email })) });
    await call(REV[0], 'PUT', `case/${id}/answers`, { form: 'B', answers: full(M.FORM_B), relationship: 'Colleague / Peer', frequency: 'Daily' });
    await call(REV[0], 'POST', `case/${id}/submit`, { form: 'B' });
    await assert.rejects(() => call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: [REV[1], REV[2], REV[3]].map((r) => ({ email: r.email })) }), /already submitted/);
    await call(SAM, 'PUT', `case/${id}/reviewers`, { reviewers: [REV[1], REV[2], REV[3]].map((r) => ({ email: r.email })) });
  });

  it('reopening a submitted form lets its author change it', async () => {
    await startTerm();
    const id = await caseFor();
    await call(ANN, 'PUT', `case/${id}/answers`, { form: 'A', answers: full(M.FORM_A) });
    await call(ANN, 'POST', `case/${id}/submit`, { form: 'A' });
    await assert.rejects(() => call(OZZY, 'POST', `case/${id}/reopen`, { form: 'A' }), /Only the supervisor/);
    await call(SAM, 'POST', `case/${id}/reopen`, { form: 'A' });
    await call(ANN, 'PUT', `case/${id}/answers`, { form: 'A', answers: [{ qid: 'a1', rating: 5 }] });
  });

  it('the evaluation with no supervisor waits for one, and admins set it by drop-down', async () => {
    await S.startTerm(env, ADA, { startsOn: '2026-01-05', emails: [OZZY.email] });
    const id = await caseFor(OZZY.email);
    await assert.rejects(() => call(OZZY, 'PUT', `case/${id}/answers`, { form: 'C', answers: [] }), /supervisor writes/);
    await assert.rejects(() => call(SAM, 'POST', `case/${id}/supervisor`, { email: SAM.email }), /HR and hub administrators/);
    await call(HAL, 'POST', `case/${id}/supervisor`, { email: SAM.email });
    assert.equal(db.db.prepare('SELECT supervisor_email AS s FROM eval_cases WHERE id = ?').get(id).s, SAM.email);
    await assert.rejects(() => call(HAL, 'POST', `case/${id}/supervisor`, { email: OZZY.email }), /their own evaluation/);
  });
});

describe('what each person is told they have to do', () => {
  it('me lists my evaluation, the reviews I owe and my team', async () => {
    await startTerm();
    const id = await caseFor();
    await call(ANN, 'PUT', `case/${id}/answers`, { form: 'A', answers: full(M.FORM_A) });
    await call(ANN, 'POST', `case/${id}/submit`, { form: 'A' });
    await call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: REV.slice(0, 3).map((r) => ({ email: r.email })) });
    const mineAnn = await call(ANN, 'GET', 'me');
    assert.equal(mineAnn.own.length, 1);
    assert.equal(mineAnn.own[0].stage, 'feedback');
    const mineRev = await call(REV[0], 'GET', 'me');
    assert.equal(mineRev.owe.length, 1);
    assert.equal(mineRev.own.length, 0);
    const mineSam = await call(SAM, 'GET', 'me');
    assert.equal(mineSam.team.length, 1);
    assert.equal(mineSam.team[0].reviewers, 3);
    assert.equal(mineSam.manage, false);
    assert.equal((await call(HAL, 'GET', 'me')).manage, true);
    assert.equal((await S.waitingOn(env, REV[0])).n, 1);
    assert.equal((await S.waitingOn(env, OZZY)).n, 0);
  });

  it('who is behind shows past-due people by role, without answers', async () => {
    await startTerm();
    const id = await caseFor();
    const r = await S.termReport(env, HAL, db.db.prepare('SELECT id FROM eval_terms').get().id, new Date('2026-01-14T15:00:00Z'));
    assert.equal(r.cases.length, 1);
    assert.ok(r.cases[0].behind.some((b) => b.what === 'Self-assessment'));
    assert.ok(!JSON.stringify(r).includes('A written answer'));
    await assert.rejects(() => S.termReport(env, SAM, db.db.prepare('SELECT id FROM eval_terms').get().id), /HR and hub administrators/);
    void id;
  });

  it('reminders go once each, through the same gate as other notices', async () => {
    await startTerm();
    sent.length = 0;
    const one = await S.runNudges(env, new Date('2026-01-11T15:00:00Z'));
    assert.equal(one.sent, 1);
    const two = await S.runNudges(env, new Date('2026-01-11T18:00:00Z'));
    assert.equal(two.sent, 0);
    const late = await S.runNudges(env, new Date('2026-01-13T15:00:00Z'));
    assert.equal(late.sent, 1);
    db.db.prepare("DELETE FROM hub_settings WHERE key = 'requests.notify'").run();
    db.db.prepare("DELETE FROM eval_nudges").run();
    sent.length = 0;
    await S.runNudges(env, new Date('2026-01-11T15:00:00Z'));
    assert.equal(sent.length, 0, 'gate off: nothing leaves');
  });
});

describe('the plan carries into the next cycle', () => {
  it('last term\'s goals show on the next evaluation and take a verdict', async () => {
    await startTerm();
    const id = await caseFor();
    await call(SAM, 'PUT', `case/${id}/goals`, { goals: [{ area: M.PLAN_AREAS[0], goal: 'Finish the course', steps: 'Weekly', targetDate: '2026-04-30' }] });
    db.db.prepare("UPDATE eval_cases SET stage = 'done' WHERE id = ?").run(id);
    db.db.prepare("UPDATE eval_terms SET status = 'closed'").run();
    await S.startTerm(env, ADA, { startsOn: '2026-07-06', emails: [ANN.email] });
    const id2 = db.db.prepare("SELECT id FROM eval_cases WHERE id != ?").get(id).id;
    const v = (await call(SAM, 'GET', `case/${id2}`)).view;
    assert.equal(v.priorGoals.length, 1);
    assert.equal(v.priorGoals[0].goal, 'Finish the course');
    await call(SAM, 'POST', `case/${id2}/goal-review`, { goalId: v.priorGoals[0].id, status: 'partly', note: 'Four of six lessons.' });
    assert.equal(db.db.prepare('SELECT review_status AS s FROM eval_goals').get().s, 'partly');
    await assert.rejects(() => call(OZZY, 'POST', `case/${id2}/goal-review`, { goalId: v.priorGoals[0].id, status: 'met' }), /Only the supervisor/);
  });

  it('goals become tasks for the employee when Projects is installed, and are skipped when it is not', async () => {
    await startTerm();
    const id = await caseFor();
    await call(SAM, 'PUT', `case/${id}/goals`, { goals: [{ area: M.PLAN_AREAS[0], goal: 'Learn it', steps: 'Daily', targetDate: '2026-04-30' }] });
    assert.equal(await S.makeGoalTasks(env, id), 0);
    db.exec(`CREATE TABLE hub_tasks (id TEXT PRIMARY KEY, project_id TEXT, section_id TEXT, code TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal', owner_email TEXT, start_date TEXT, due_date TEXT, due_time TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    assert.equal(await S.makeGoalTasks(env, id), 1);
    const t = db.db.prepare('SELECT * FROM hub_tasks').get();
    assert.equal(t.owner_email, ANN.email);
    assert.equal(t.due_date, '2026-04-30');
    assert.match(t.description, /\/evaluations\/\?c=/);
    assert.equal(await S.makeGoalTasks(env, id), 0);
  });
});

describe('the filed document', () => {
  it('files a Google Doc and a PDF in the employee folder, without reviewer words', async () => {
    await startTerm();
    const id = await caseFor();
    await call(ANN, 'PUT', `case/${id}/answers`, { form: 'A', answers: full(M.FORM_A) });
    await call(ANN, 'POST', `case/${id}/submit`, { form: 'A' });
    await call(ANN, 'PUT', `case/${id}/reviewers`, { reviewers: REV.slice(0, 3).map((r) => ({ email: r.email })) });
    for (const r of REV.slice(0, 3)) {
      const ans = full(M.FORM_B);
      ans.find((a) => a.qid === 'b13').text = 'SECRETWORDS from a reviewer';
      await call(r, 'PUT', `case/${id}/answers`, { form: 'B', answers: ans, relationship: 'Colleague / Peer', frequency: 'Daily' });
      await call(r, 'POST', `case/${id}/submit`, { form: 'B' });
    }
    await call(SAM, 'PUT', `case/${id}/answers`, { form: 'C', answers: full(M.FORM_C) });
    await call(SAM, 'PUT', `case/${id}/goals`, { goals: [{ area: M.PLAN_AREAS[0], goal: 'g1', steps: 's1', targetDate: '2026-04-01' }, { area: M.PLAN_AREAS[3], goal: 'g2', steps: 's2', targetDate: '2026-05-01' }] });
    await call(SAM, 'POST', `case/${id}/submit`, { form: 'C', meetingOn: '2026-01-26' });
    await S.acknowledge(env, ANN, id, '', new Date('2026-01-27T15:00:00Z'));
    await call(ADA, 'PUT', 'admin/folder', { folder: 'https://drive.google.com/drive/folders/ROOTFOLDER123456' });
    assert.equal(await D.evalFolder(env), 'ROOTFOLDER123456');

    const calls = [];
    const deps = {
      token: async () => 't',
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || 'GET', body: init.body });
        if (String(url).includes('/upload/')) return Response.json({ id: 'f' + calls.length, webViewLink: 'https://docs.google.com/document/d/abc/edit' });
        if ((init.method || 'GET') === 'GET') return Response.json({ files: [] });
        return Response.json({ id: 'folder1' });
      },
      assets: async (p) => new Uint8Array(readFileSync(new URL('../public' + p, import.meta.url))),
    };
    const r = await D.publish(env, id, deps);
    assert.equal(r.error, '');
    assert.match(r.url, /docs\.google\.com/);
    const uploads = calls.filter((c) => c.url.includes('/upload/'));
    assert.equal(uploads.length, 2);
    const text = uploads.map((u) => Buffer.from(u.body).toString('latin1')).join('\n');
    assert.ok(text.includes('google-apps.document'));
    assert.ok(text.includes('Employee Evaluation: Ann Employee'));
    assert.ok(!text.includes('SECRETWORDS'), 'a reviewer\'s words never reach the document');
    assert.ok(!text.includes('Rae r1'), 'a reviewer\'s name never reaches the document');
    assert.equal(db.db.prepare('SELECT doc_url AS u FROM eval_cases WHERE id = ?').get(id).u, r.url);
    const pdf = await D.pdfFor(env, id, deps);
    assert.equal(Buffer.from(pdf.bytes.subarray(0, 4)).toString(), '%PDF');
  });

  it('keeps the error and the PDF when Drive refuses', async () => {
    await startTerm();
    const id = await caseFor();
    await D.setEvalFolder(env, 'x', 'ROOTFOLDER123456');
    const r = await D.publish(env, id, { token: async () => 't', fetch: async () => new Response('{"error":{"message":"no access"}}', { status: 403 }), assets: async () => null });
    assert.match(r.error, /403/);
    assert.match(db.db.prepare('SELECT doc_error AS e FROM eval_cases WHERE id = ?').get(id).e, /no access/);
  });

  it('PDF download opens for the employee only after the summary is shared', async () => {
    await startTerm();
    const id = await caseFor();
    await assert.rejects(() => call(ANN, 'GET', `case/${id}/pdf`), /once your supervisor shares/);
    await assert.rejects(() => call(OZZY, 'GET', `case/${id}/pdf`), /once your supervisor shares/);
  });
});

describe('the routes', () => {
  it('serve the forms to anyone signed in and keep admin routes to HR and admins', async () => {
    const f = await call(OZZY, 'GET', 'forms');
    assert.equal(f.forms.A.sections.length, 7);
    assert.equal(f.limits.reviewersMin, 3);
    await assert.rejects(() => call(OZZY, 'GET', 'admin/terms'), /HR and hub administrators/);
    assert.ok((await call(HAL, 'GET', 'admin/terms')).terms);
    assert.ok((await call(ADA, 'GET', 'admin/pick')).people.length >= 3);
    await assert.rejects(() => call(OZZY, 'GET', 'nothing'), /nothing at that address/);
  });
});
