// Projects planning: a draft plan from a sentence, the templates, the team workload with overload warnings and the Friday
// status update. Invented people only, an in-memory D1 built from the repository's schema files, a stand-in for the text model.
// Nothing real is touched and no real person is ever notified.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ADA, DAN, FLO, OZZY, VIC, call, read, world as baseWorld } from './projects-support.mjs';

const TODAY = '2026-10-12'; // a Monday
const realDate = Date;

function world(opts = {}) {
  const w = baseWorld({ mode: 'staff', ...opts });
  for (const f of ['favor-chat', 'favor-chat-private', 'google', 'projects-links', 'projects-plan']) w.d1.exec(read(`db/${f}.sql`));
  // Invented titles so roles resolve the way they do on the real staff list.
  const title = (u, t, team) => w.d1.db.prepare('UPDATE meet_directory SET title = ?, team = ? WHERE email = ?').run(t, team, u.email);
  title(ADA, 'Lead Developer', 'Marketing');
  title(VIC, 'Director of Media', 'Marketing');
  title(DAN, 'Graphic Designer', 'Marketing');
  title(FLO, 'Creative Director', 'Marketing');
  title(OZZY, 'Uganda/SS Director', 'Leadership');
  w.env.AI = undefined;
  return w;
}

// The calendar the plan code reads is pinned: Date.now() and new Date() answer 2026-10-12 12:00 Eastern.
function pin(iso = '2026-10-12T16:00:00Z') {
  const at = realDate.parse(iso);
  globalThis.Date = class extends realDate {
    constructor(...a) { super(...(a.length ? a : [at])); }
    static now() { return at; }
  };
  return () => { globalThis.Date = realDate; };
}

const aiReturning = (obj) => ({ run: async () => ({ response: typeof obj === 'string' ? obj : JSON.stringify(obj) }) });

test('dateIn reads dates written in a sentence', async () => {
  const { dateIn } = await import('../functions/_lib/projects/plan/draft.ts');
  assert.equal(dateIn('Appeal mailing on 2026-11-20', TODAY), '2026-11-20');
  assert.equal(dateIn('banquet on November 14th', TODAY), '2026-11-14');
  assert.equal(dateIn('newsletter for Oct 24', TODAY), '2026-10-24');
  assert.equal(dateIn('due 12/5', TODAY), '2026-12-05');
  assert.equal(dateIn('grant due Jan 9', TODAY), '2027-01-09', 'a date already past this year rolls to next year');
  assert.equal(dateIn('ready in 3 weeks', TODAY), '2026-11-02');
  assert.equal(dateIn('Feb 31', TODAY), null);
  assert.equal(dateIn('no date here', TODAY), null);
});

test('a newsletter sentence picks the newsletter template, snaps to a Saturday and matches owners by title', async () => {
  const restore = pin();
  try {
    const w = world();
    const r = await call(w, ADA, 'POST', 'projects/plan/draft', { prompt: 'Weekly newsletter for Oct 24' });
    assert.equal(r.status, 200);
    const { plan, source } = r.data;
    assert.equal(source, 'template', 'no model: the template stands');
    assert.equal(plan.template, 'newsletter');
    assert.equal(plan.anchor, '2026-10-24', 'Oct 24 2026 is a Saturday');
    const all = plan.sections.flatMap((s) => s.tasks);
    const send = all.find((t) => /Schedule and send/.test(t.title));
    assert.equal(send.due_date, '2026-10-24', 'the Saturday send keeps its weekend date');
    assert.equal(send.owner_email, ADA.email, 'Tech role goes to the developer');
    assert.equal(all.find((t) => /Build the art/.test(t.title)).owner_email, DAN.email, 'design goes to the graphic designer');
    assert.equal(all.find((t) => /content approval/.test(t.title)).owner_email, OZZY.email, 'program facts go to the program director');
    for (const t of all) {
      assert.ok(t.due_date >= TODAY && t.due_date <= '2026-11-30', `${t.title} is on a real date: ${t.due_date}`);
      const dow = new Date(t.due_date + 'T12:00:00Z').getUTCDay();
      if (!/Schedule and send/.test(t.title)) assert.ok(dow !== 0 && dow !== 6, `${t.title} avoids the weekend`);
    }
    assert.ok(!/[–—]/.test(JSON.stringify(plan)), 'no dashes');
  } finally { restore(); }
});

test('every template builds a dated plan whose roles resolve, and a sentence that fits none gets the generic outline', async () => {
  const restore = pin();
  try {
    const w = world();
    for (const [prompt, id] of [
      ['Plan the November appeal letter mailing', 'appeal'],
      ['Host a banquet on December 6', 'banquet'],
      ['Submit a grant application to a foundation, due Dec 15', 'grant'],
      ['Print order for 500 flyers', 'print'],
      ['Church newsletter for the winter issue', 'church-newsletter'],
      ['Move the storage room', 'generic'],
    ]) {
      const r = await call(w, ADA, 'POST', 'projects/plan/draft', { prompt });
      assert.equal(r.data.plan.template, id, prompt);
      const tasks = r.data.plan.sections.flatMap((s) => s.tasks);
      assert.ok(tasks.length >= 4, `${id} has tasks`);
      const staff = new Set([ADA, VIC, DAN, FLO, OZZY].map((u) => u.email));
      for (const t of tasks) assert.ok(staff.has(t.owner_email), `${id}: ${t.title} has an owner on the staff list`);
    }
    const g = await call(w, ADA, 'POST', 'projects/plan/draft', { prompt: 'Move the storage room' });
    assert.equal(g.data.plan.name, 'Move the storage room');
    assert.deepEqual(g.data.plan.sections.map((s) => s.name), ['Plan', 'Prepare', 'Launch', 'Wrap up']);
  } finally { restore(); }
});

test('the model reshapes the plan; owners and dates are checked, and bad output falls back to the template', async () => {
  const restore = pin();
  try {
    const w = world();
    w.env.AI = aiReturning({
      name: 'Fall banquet',
      description: 'A dinner for partners in Houston.',
      sections: [
        { name: 'Plan', tasks: [{ title: 'Book the hall', owner_email: VIC.email, due_date: '2026-10-20', priority: 'high' }, { title: 'Pick the menu', owner_email: 'nobody@favorintl.org', due_date: '2020-01-01' }] },
        { name: 'Invitations', tasks: [{ title: 'Send the invitations', owner_email: DAN.email, due_date: '2099-01-01' }, { title: 'Count RSVPs — daily', owner_email: DAN.email, due_date: '2026-11-20' }] },
      ],
    });
    const r = await call(w, ADA, 'POST', 'projects/plan/draft', { prompt: 'Banquet in Houston on Dec 6' });
    assert.equal(r.data.source, 'drafted');
    const { plan } = r.data;
    assert.equal(plan.name, 'Fall banquet');
    const t = plan.sections.flatMap((s) => s.tasks);
    assert.equal(t.find((x) => x.title === 'Pick the menu').owner_email, ADA.email, 'a stranger becomes the lead');
    assert.equal(t.find((x) => x.title === 'Pick the menu').due_date, TODAY, 'a past date moves to today');
    assert.equal(t.find((x) => x.title === 'Send the invitations').due_date, '2027-01-20', 'a date far past the project date is capped at six weeks after it');
    assert.ok(t.some((x) => x.title === 'Count RSVPs, daily'), 'dashes are removed');

    w.env.AI = aiReturning('I cannot do that.');
    const bad = await call(w, ADA, 'POST', 'projects/plan/draft', { prompt: 'Banquet in Houston on Dec 6' });
    assert.equal(bad.data.source, 'template');
    assert.equal(bad.data.plan.template, 'banquet');
    w.env.AI = { run: async () => { throw new Error('model down'); } };
    const down = await call(w, ADA, 'POST', 'projects/plan/draft', { prompt: 'Banquet in Houston on Dec 6' });
    assert.equal(down.data.source, 'template');
  } finally { restore(); }
});

test('a draft saves nothing; Create makes the project, sections and tasks and tells each person once', async () => {
  const restore = pin();
  try {
    const w = world({ notify: 'on' });
    const d = await call(w, ADA, 'POST', 'projects/plan/draft', { prompt: 'Weekly newsletter for Oct 24' });
    assert.equal(w.rows('SELECT id FROM hub_projects').length, 0, 'drafting writes nothing');
    assert.equal(w.rows('SELECT id FROM hub_tasks').length, 0);
    const plan = d.data.plan;
    plan.name = 'Newsletter Oct 24';
    const r = await call(w, ADA, 'POST', 'projects/plan/create', { plan });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const n = plan.sections.reduce((a, s) => a + s.tasks.length, 0);
    assert.equal(r.data.tasks, n);
    assert.equal(w.rows('SELECT id FROM hub_tasks').length, n);
    assert.equal(w.rows('SELECT id FROM hub_project_sections').length, plan.sections.length);
    const members = w.rows('SELECT email FROM hub_project_members').map((m) => m.email);
    for (const e of new Set(plan.sections.flatMap((s) => s.tasks.map((t) => t.owner_email)))) assert.ok(members.includes(e), `${e} is a member`);
    // One notice per person other than the maker, not one per task.
    const notices = w.rows('SELECT email, COUNT(*) AS c FROM hub_task_notices GROUP BY email');
    assert.ok(notices.length >= 2);
    for (const x of notices) assert.equal(x.c, 1, `${x.email} is told once`);
    assert.ok(!notices.some((x) => x.email === ADA.email), 'the maker is not told');
    const first = w.rows('SELECT body FROM hub_task_notices WHERE email = ?', DAN.email)[0];
    assert.match(first.body, /^\d+ tasks? in Newsletter Oct 24$/);
    assert.equal(w.rows(`SELECT COUNT(*) AS c FROM hub_task_events WHERE kind = 'plan_created'`)[0].c, 1);
  } finally { restore(); }
});

test('Create rejects people who are not on the staff list, empty plans and oversized plans', async () => {
  const restore = pin();
  try {
    const w = world();
    const one = (over) => ({ plan: { name: 'X project', sections: [{ name: 'S', tasks: [{ title: 'T', owner_email: ADA.email, due_date: '2026-10-20', ...over }] }] } });
    assert.equal((await call(w, ADA, 'POST', 'projects/plan/create', one({ owner_email: 'ghost@favorintl.org' }))).status, 400);
    assert.equal((await call(w, ADA, 'POST', 'projects/plan/create', one({ due_date: 'soon' }))).status, 400);
    assert.equal((await call(w, ADA, 'POST', 'projects/plan/create', { plan: { name: 'Empty', sections: [{ name: 'S', tasks: [] }] } })).status, 400);
    assert.equal((await call(w, ADA, 'POST', 'projects/plan/create', { plan: { name: '', sections: [] } })).status, 400);
    const big = { plan: { name: 'Big', sections: [{ name: 'S', tasks: Array.from({ length: 25 }, (_, i) => ({ title: 'T' + i })) }, { name: 'S2', tasks: Array.from({ length: 25 }, (_, i) => ({ title: 'U' + i })) }, { name: 'S3', tasks: Array.from({ length: 25 }, (_, i) => ({ title: 'V' + i })) }] } };
    assert.equal((await call(w, ADA, 'POST', 'projects/plan/create', big)).status, 400);
    assert.equal(w.rows('SELECT id FROM hub_projects').length, 0, 'a refused plan leaves nothing behind');
    assert.equal((await call(w, ADA, 'POST', 'projects/plan/draft', { prompt: '' })).status, 400);
  } finally { restore(); }
});

async function seedLoad(w, who, n, due, extra = {}) {
  const { createTask } = await import('../functions/_lib/projects/tasks.ts');
  for (let i = 0; i < n; i++) await createTask(w.env, { email: ADA.email, name: ADA.name, admin: true }, { title: `Task ${who.name} ${i} ${due}`, owner_email: who.email, due_date: due, ...extra }, { quiet: true });
}

test('the workload view flags a week well above the person\'s own usual week, and a pile of overdue work', async () => {
  const restore = pin();
  try {
    const w = world();
    // Dan usually has 3 tasks due a week for the last 6 weeks; Vic has no history.
    const ins = w.d1.db.prepare(`INSERT INTO hub_tasks (id, title, status, owner_email, due_date, created_by, created_at, updated_at) VALUES (?, 'old', 'done', ?, ?, 'x', ?, ?)`);
    let k = 0;
    for (const monday of ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']) for (let i = 0; i < 3; i++) ins.run('old' + k++, DAN.email, monday, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
    await seedLoad(w, DAN, 12, '2026-10-21'); // week of Oct 19: usual 3, heavy above 6, over above 10
    await seedLoad(w, DAN, 4, '2026-10-14'); // week of Oct 12: 4, fine
    await seedLoad(w, VIC, 5, '2026-10-29'); // no history, usual 4: 5 is fine
    await seedLoad(w, OZZY, 6, '2026-09-30'); // overdue
    const r = await call(w, ADA, 'GET', 'projects/workload?weeks=6');
    assert.equal(r.status, 200);
    assert.equal(r.data.weeks.length, 6);
    assert.equal(r.data.weeks[0], '2026-10-12');
    const dan = r.data.people.find((p) => p.email === DAN.email);
    assert.equal(dan.usual, 3);
    assert.equal(dan.weeks[1].count, 12);
    assert.equal(dan.weeks[1].level, 'over');
    assert.equal(dan.weeks[0].level, 'ok');
    assert.equal(dan.level, 'over');
    const vic = r.data.people.find((p) => p.email === VIC.email);
    assert.equal(vic.level, 'ok');
    const ozzy = r.data.people.find((p) => p.email === OZZY.email);
    assert.equal(ozzy.overdue, 6);
    assert.equal(ozzy.behind, true);
    const kinds = r.data.warnings.map((x) => `${x.email}:${x.level}`);
    assert.ok(kinds.includes(`${DAN.email}:over`));
    assert.ok(kinds.includes(`${OZZY.email}:behind`));
    assert.equal(r.data.warnings[0].level, 'over', 'the worst warning is first');
    assert.match(r.data.warnings[0].text, /Dan Design has 12 tasks due the week of 2026-10-19/);
    // Cell tasks open from the grid.
    assert.ok(dan.weeks[1].tasks.length > 0 && dan.weeks[1].tasks[0].title);
    // The team filter keeps only that team.
    const only = await call(w, ADA, 'GET', 'projects/workload?team=Leadership');
    assert.deepEqual(only.data.people.map((p) => p.email), [OZZY.email]);
  } finally { restore(); }
});

test('high priority weighs more: eight urgent tasks overload a week that eight routine ones do not', async () => {
  const restore = pin();
  try {
    const w = world();
    await seedLoad(w, VIC, 8, '2026-10-14');
    await seedLoad(w, FLO, 8, '2026-10-14', { priority: 'high' });
    const r = await call(w, ADA, 'GET', 'projects/workload');
    assert.equal(r.data.people.find((p) => p.email === VIC.email).weeks[0].level, 'heavy', '8 routine tasks against a usual 4 is heavy');
    assert.equal(r.data.people.find((p) => p.email === FLO.email).weeks[0].level, 'over', '8 urgent tasks weigh 12');
  } finally { restore(); }
});

test('a draft warns about owners who are already full, and the check route re-reads the edited plan', async () => {
  const restore = pin();
  try {
    const w = world();
    await seedLoad(w, DAN, 9, '2026-10-16');
    const r = await call(w, ADA, 'POST', 'projects/plan/check', { tasks: [{ owner_email: DAN.email, due_date: '2026-10-15', priority: 'normal' }, { owner_email: DAN.email, due_date: '2026-10-15', priority: 'normal' }] });
    assert.equal(r.status, 200);
    assert.equal(r.data.warnings.length, 1);
    assert.equal(r.data.warnings[0].email, DAN.email);
    assert.equal(r.data.warnings[0].count, 11);
    const clear = await call(w, ADA, 'POST', 'projects/plan/check', { tasks: [{ owner_email: VIC.email, due_date: '2026-10-15' }] });
    assert.deepEqual(clear.data.warnings, []);
  } finally { restore(); }
});

async function projectWithWork(w) {
  const p = await call(w, ADA, 'POST', 'projects', { name: 'Fall newsletter', key: 'FNL', members: [VIC.email, DAN.email] });
  assert.equal(p.status, 201);
  const mk = async (title, over) => (await call(w, ADA, 'POST', 'tasks', { title, project_id: 'FNL', ...over })).data.task;
  const a = await mk('Write the issue', { owner_email: DAN.email, due_date: '2026-10-14' });
  const b = await mk('Pick the photos', { owner_email: VIC.email, due_date: '2026-10-15' });
  const c = await mk('Schedule the send', { owner_email: ADA.email, due_date: '2026-10-08' });
  await mk('Resend', { owner_email: ADA.email, due_date: '2026-10-19' });
  await call(w, DAN, 'PATCH', `tasks/${a.code}`, { done: true });
  await call(w, VIC, 'PATCH', `tasks/${b.code}`, { status: 'doing' });
  await call(w, ADA, 'PATCH', `tasks/${c.code}`, { due_date: '2026-10-10' });
  return p.data.project;
}

test('the Friday update is built from what moved and is off until the lead turns it on', async () => {
  const restore = pin('2026-10-16T19:30:00Z'); // Friday 3:30 PM Eastern
  try {
    const w = world();
    const p = await projectWithWork(w);
    const g = await call(w, VIC, 'GET', 'projects/FNL/status');
    assert.equal(g.data.status.enabled, false);
    assert.equal(g.data.can.manage, false);
    // A member cannot switch it on; neither can a draft post.
    assert.equal((await call(w, VIC, 'PUT', 'projects/FNL/status', { enabled: true })).status, 403);
    assert.equal((await call(w, ADA, 'POST', 'projects/FNL/status/post', {})).status, 409, 'off means nothing posts');
    const draft = await call(w, VIC, 'GET', 'projects/FNL/status/draft');
    assert.equal(draft.status, 200);
    const t = draft.data.text;
    assert.match(t, /^Friday update, Fall newsletter\. Week of Oct 12\./);
    assert.match(t, /Done\n- Write the issue \(Dan Design\)/);
    assert.match(t, /Started\n- Pick the photos \(Vic Video\)/);
    assert.match(t, /Pushed back\n- Schedule the send \(Ada Admin, 2026-10-08 to 2026-10-10\)/);
    assert.match(t, /Late\n/);
    assert.match(t, /Due in the next 7 days\n/);
    assert.ok(!/[–—]/.test(t), 'no dashes');
    assert.ok(!/\bAI\b/.test(t));
    assert.equal(w.rows('SELECT id FROM chat_messages').length, 0, 'a draft posts nothing');
    void p;
  } finally { restore(); }
});

test('turning the update on makes the channel; posting writes one message as the lead; the Friday pass posts once a week', async () => {
  let restore = pin('2026-10-16T19:30:00Z');
  try {
    const w = world();
    await projectWithWork(w);
    const on = await call(w, ADA, 'PUT', 'projects/FNL/status', { enabled: true });
    assert.equal(on.status, 200);
    assert.equal(on.data.status.enabled, true);
    assert.ok(on.data.channel && on.data.channel.name);
    const posted = await call(w, ADA, 'POST', 'projects/FNL/status/post', {});
    assert.equal(posted.status, 200);
    const msgs = w.rows('SELECT email, body, channel_id FROM chat_messages');
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].email, ADA.email);
    assert.match(msgs[0].body, /^Friday update, Fall newsletter/);
    assert.equal(msgs[0].channel_id, on.data.channel.id, 'it lands in the project channel');
    assert.equal(w.rows('SELECT last_week FROM hub_project_status')[0].last_week, '2026-10-12');

    const { runDue } = await import('../functions/_lib/projects/plan/status.ts');
    // Already posted this week: the scheduled pass adds nothing.
    assert.deepEqual((await runDue(w.env, new Date())).posted, []);
    // Next week's Friday morning: too early. Friday 3 PM: posts. Again: nothing.
    const nextFriMorning = new realDate('2026-10-23T13:00:00Z');
    assert.equal((await runDue(w.env, nextFriMorning)).skipped, 'not Friday afternoon');
    const nextFri = new realDate('2026-10-23T19:10:00Z');
    restore(); restore = pin('2026-10-23T19:10:00Z');
    assert.deepEqual((await runDue(w.env, nextFri)).posted, ['FNL']);
    assert.deepEqual((await runDue(w.env, new realDate('2026-10-23T19:15:00Z'))).posted, []);
    assert.equal(w.rows('SELECT id FROM chat_messages').length, 2);
    // Switched off: the pass skips it.
    await call(w, ADA, 'PUT', 'projects/FNL/status', { enabled: false });
    assert.deepEqual((await runDue(w.env, new realDate('2026-10-30T19:10:00Z'))).posted, []);
    // Only the scheduler's key reaches the run route.
    assert.equal((await call(w, ADA, 'POST', 'projects/status/run', {})).status, 403);
  } finally { restore(); }
});

test('the opening sentence may be phrased by the model, but a number it invents is thrown out', async () => {
  const restore = pin('2026-10-16T19:30:00Z');
  try {
    const w = world();
    await projectWithWork(w);
    w.env.AI = aiReturning('placeholder');
    w.env.AI = { run: async () => ({ response: 'The team finished the issue draft and started on the photos this week.' }) };
    const ok = await call(w, VIC, 'GET', 'projects/FNL/status/draft');
    assert.match(ok.data.text, /The team finished the issue draft and started on the photos this week\./);
    w.env.AI = { run: async () => ({ response: 'The team finished 47 tasks and cleared the backlog completely.' }) };
    const bad = await call(w, VIC, 'GET', 'projects/FNL/status/draft');
    assert.ok(!/47/.test(bad.data.text), 'an invented number is dropped for the counts');
    assert.match(bad.data.text, /1 task finished, 1 task started/);
  } finally { restore(); }
});
