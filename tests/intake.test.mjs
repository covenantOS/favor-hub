// Requests inside Projects: sending from the composer, the Intake card, triage (accept, ask, decline), My requests, the privacy rules,
// the stages keeping the request in step, the done email, and Asana. Made-up people only; mail lands in a list and fetch is stubbed,
// so nothing is sent and the live database is never touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { DESIGN, FOUNDER, OUTSIDER, T, VIDEO, WILL, ic, iw, pc, rows } from './support/intake-world.mjs';
import { NOW } from './support/request-world.mjs';

const send = async (w, user, text, extra = {}) => {
  const r = await ic(w, user, 'POST', 'submit', { text, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.request;
};
const sec = (w, projectId, name) => rows(w, 'SELECT id FROM hub_project_sections WHERE project_id = ? AND lower(name) = lower(?)', projectId, name)[0]?.id;
const proj = (w, key) => rows(w, 'SELECT * FROM hub_projects WHERE key = ?', key)[0];

async function plainProject(w, key = 'WEB') {
  const r = await pc(w, WILL, 'POST', 'projects', { name: 'Website work', key, members: [VIDEO.email, DESIGN.email] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const s = await pc(w, WILL, 'POST', `projects/${key}/sections`, { name: 'Doing' });
  const s2 = await pc(w, WILL, 'POST', `projects/${key}/sections`, { name: 'Shipped' });
  return { project: r.data.project, doing: s.data.section || s.data, shipped: s2.data.section || s2.data };
}

test('sending a request makes a card in Intake at the start of the Tech pipeline, and nothing the asker can open', async () => {
  const w = iw();
  const item = await send(w, VIDEO, "Could we add Sarah's bio to the team page on the website? Needed by October 30");
  assert.equal(item.team, 'tech');
  assert.equal(item.place, 'website');
  assert.equal(item.kind, 'add');
  assert.equal(item.word, 'Sent');
  assert.equal(item.stage, 'Intake');
  assert.equal(item.due_date, '2026-10-30');
  assert.equal(item.task.code, 'TRQ-0001');
  assert.equal(item.submitter.email, VIDEO.email);
  const p = proj(w, 'TRQ');
  assert.equal(p.name, 'Tech requests');
  assert.equal(p.visibility, 'members');
  assert.equal(p.lead_email, WILL.email);
  assert.deepEqual(rows(w, 'SELECT name FROM hub_project_sections WHERE project_id = ? ORDER BY sort', p.id).map((s) => s.name), ['Intake', 'Triage', 'In progress', 'Review', 'Done']);
  const card = rows(w, 'SELECT * FROM hub_tasks WHERE request_id = ?', item.id)[0];
  assert.equal(card.section_id, sec(w, p.id, 'Intake'));
  assert.equal(card.created_by, WILL.email, 'the lead is the creator, not the asker');
  assert.equal(card.status, 'open');
  assert.equal(rows(w, 'SELECT * FROM hub_task_people WHERE task_id = ?', card.id).length, 0, 'the asker does not follow the team\'s card');
  const r = rows(w, 'SELECT * FROM requests WHERE id = ?', item.id)[0];
  assert.equal(r.status, 'inbox');
  assert.equal(r.source, 'projects');
  assert.equal(r.surface, 'website');
  assert.equal(rows(w, 'SELECT due_date FROM request_tasks WHERE request_id = ?', item.id)[0].due_date, '2026-10-30');
  const i = rows(w, 'SELECT * FROM hub_intake WHERE request_id = ?', item.id)[0];
  assert.equal(i.team, 'tech');
  assert.equal(i.task_id, card.id);
  assert.ok(JSON.parse(i.chips).place.why.length > 5, 'each chip keeps its reason');
  // The lead hears about it on Today and the bell (the notice gate is on in this world).
  assert.equal(rows(w, "SELECT email, kind FROM request_notices WHERE request_id = ?", item.id)[0].email, WILL.email);
  // The asker can open Projects but not the team's board.
  const list = await pc(w, VIDEO, 'GET', 'tasks?project=TRQ&status=all');
  assert.equal(list.data?.tasks?.length || 0, 0);
  const byId = await pc(w, VIDEO, 'GET', `tasks/${card.id}`);
  assert.equal(byId.status, 404, 'the card is the team\'s, not the asker\'s');
});

test('a request for Marketing goes to the Marketing pipeline led by its director, and money goes to the expense form', async () => {
  const w = iw();
  const m = await send(w, VIDEO, 'We need a flyer for the banquet by Friday');
  assert.equal(m.team, 'marketing');
  assert.equal(m.place, 'print');
  assert.equal(m.place_label, 'Print');
  assert.equal(m.task.code, 'MRQ-0001');
  assert.equal(proj(w, 'MRQ').lead_email, DESIGN.email);
  assert.equal(rows(w, 'SELECT surface FROM requests WHERE id = ?', m.id)[0].surface, 'marketing');
  assert.equal(proj(w, 'TRQ'), undefined, 'the Tech pipeline is made only when Tech gets a request');
  const before = rows(w, 'SELECT COUNT(*) AS n FROM requests')[0].n;
  const e = await ic(w, VIDEO, 'POST', 'submit', { text: 'Please reimburse my hotel for the trip' });
  assert.equal(e.status, 409);
  assert.equal(e.data.error, 'expense');
  assert.match(e.data.href, /^\/expenses\/new\/\?reason=/);
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM requests')[0].n, before, 'no request, no card');
});

test('edited chips win over the words, and a chip that is not allowed is refused', async () => {
  const w = iw();
  const item = await send(w, VIDEO, 'Fix the footer link on the website', { team: 'marketing', place: 'social', kind: 'other', audience: 'Churches', due_date: '2026-11-02', assignee: DESIGN.email });
  assert.equal(item.team, 'marketing');
  assert.equal(item.place, 'social');
  assert.equal(item.kind, 'other');
  assert.equal(item.audience, 'Churches');
  assert.equal(item.due_date, '2026-11-02');
  assert.equal(item.assignee_hint.email, DESIGN.email);
  assert.equal(item.owner, null, 'the owner is chosen at Accept');
  assert.equal((await ic(w, VIDEO, 'POST', 'submit', { text: 'Fix it', assignee: 'nobody@favorintl.org' })).status, 400);
  assert.equal((await ic(w, VIDEO, 'POST', 'submit', { text: 'Fix it', due_date: '2026-13-45' })).status, 400);
  assert.equal((await ic(w, VIDEO, 'POST', 'submit', { text: 'x' })).status, 400);
  assert.equal((await ic(w, null, 'POST', 'submit', { text: 'Fix the footer' })).status, 401);
});

test('the parse route returns the chips with a reason for each, and the people for the assignee chip', async () => {
  const w = iw();
  const r = await ic(w, VIDEO, 'POST', 'parse', { text: 'The giving history on the partner portal is wrong, ask Ada to fix it ASAP' });
  assert.equal(r.status, 200);
  const p = r.data.parsed;
  assert.equal(p.team.value, 'tech');
  assert.equal(p.place.value, 'portal');
  assert.equal(p.audience.value, 'Partners on the portal');
  assert.equal(p.assignee.value, WILL.email);
  assert.match(p.assignee.why, /Ada/);
  for (const k of ['team', 'kind', 'place', 'audience', 'due']) assert.ok(p[k].why && p[k].label, k);
  assert.ok(r.data.people.some((x) => x.email === DESIGN.email));
});

test('privacy: the asker reads their own requests only; the team and admins read the queue; nobody else reads anything', async () => {
  const w = iw();
  const mine = await send(w, VIDEO, 'Add a banner to the home page of the website');
  const other = await send(w, OUTSIDER, 'Fix the careers page on the website');
  const mk = await send(w, OUTSIDER, 'Design a flyer for the banquet');
  // My requests.
  assert.deepEqual((await ic(w, VIDEO, 'GET', 'mine')).data.requests.map((x) => x.id), [mine.id]);
  assert.deepEqual((await ic(w, OUTSIDER, 'GET', 'mine')).data.requests.map((x) => x.id).sort(), [other.id, mk.id].sort());
  // By id: the asker reads theirs; a stranger gets a 404 that says nothing.
  assert.equal((await ic(w, VIDEO, 'GET', `r/${mine.id}`)).status, 200);
  assert.equal((await ic(w, VIDEO, 'GET', `r/${other.id}`)).status, 404);
  assert.equal((await ic(w, FOUNDER, 'GET', `r/${mine.id}`)).status, 404);
  assert.equal((await ic(w, FOUNDER, 'GET', `r/${mine.id}/options`)).status, 404);
  // Triage: an admin reads both teams; the Marketing director reads Marketing only; the asker and a stranger read no queue.
  const all = (await ic(w, WILL, 'GET', 'queue')).data.requests.map((x) => x.id).sort();
  assert.deepEqual(all, [mine.id, other.id, mk.id].sort());
  assert.deepEqual((await ic(w, DESIGN, 'GET', 'queue')).data.requests.map((x) => x.id), [mk.id]);
  assert.equal((await ic(w, DESIGN, 'GET', `r/${mine.id}`)).status, 404, 'the Marketing director does not read Tech requests');
  assert.deepEqual((await ic(w, VIDEO, 'GET', 'queue')).data.requests, []);
  assert.deepEqual((await ic(w, FOUNDER, 'GET', 'queue')).data.requests, []);
  assert.deepEqual((await ic(w, FOUNDER, 'GET', 'teams')).data.teams, []);
  assert.deepEqual((await ic(w, DESIGN, 'GET', 'teams')).data.teams.map((t) => t.team), ['marketing']);
  const t = (await ic(w, WILL, 'GET', 'teams')).data.teams;
  assert.deepEqual(t.map((x) => [x.team, x.counts.intake]), [['tech', 2], ['marketing', 1]]);
  // The asker cannot triage their own request; a stranger cannot reply to it.
  for (const act of ['accept', 'ask', 'decline']) assert.equal((await ic(w, VIDEO, 'POST', `r/${mine.id}/${act}`, { question: 'q', reason: 'because' })).status, 403, act);
  assert.equal((await ic(w, FOUNDER, 'POST', `r/${mine.id}/reply`, { body: 'hi' })).status, 404);
  // The old board's open list is not used here, and signed out reads nothing.
  assert.equal((await ic(w, null, 'GET', 'mine')).status, 401);
  assert.equal((await ic(w, null, 'GET', 'queue')).status, 401);
});

test('a test account\'s requests are for the test accounts alone, and it tells nobody', async () => {
  const w = iw();
  const t = await send(w, T, 'Add a test banner to the website');
  assert.equal((await ic(w, WILL, 'GET', 'queue')).data.requests.length, 0, 'a real admin does not see the test request');
  assert.equal((await ic(w, WILL, 'GET', `r/${t.id}`)).status, 404);
  assert.deepEqual((await ic(w, WILL, 'GET', 'teams')).data.teams, [], 'no real pipeline was made for a test request');
  assert.equal((await ic(w, T, 'GET', 'queue')).data.requests.length, 1, 'a test account sees it');
  // Its card sits in a separate test pipeline that only the test accounts can open, so no real board shows it.
  const tp = rows(w, "SELECT p.* FROM hub_intake_teams t JOIN hub_projects p ON p.id = t.project_id WHERE t.team = 'tech-test'")[0];
  assert.equal(tp.lead_email, T.email);
  assert.equal(proj(w, 'TRQ'), undefined, 'the real Tech pipeline was not made for a test request');
  assert.equal((await pc(w, WILL, 'GET', `tasks?project=${tp.key}&status=all`)).status, 403);
  assert.equal((await pc(w, WILL, 'GET', 'tasks?status=all')).data.tasks.length, 0);
  const real = await send(w, VIDEO, 'Add a banner to the website');
  assert.equal(real.task.code.startsWith('TRQ'), true);
  assert.equal((await pc(w, T, 'GET', `tasks?project=${tp.key}&status=all`)).data.tasks.length, 1);
  // A test account accepting its own request keeps the card in its own pipeline.
  const acc = await ic(w, T, 'POST', `r/${t.id}/accept`, {});
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.equal(acc.data.request.project.id, tp.id);
  assert.equal(acc.data.request.stage, 'Triage');
  assert.equal(rows(w, 'SELECT * FROM request_notices WHERE request_id = ?', t.id).length, 0, 'the lead was not told');
  assert.ok(w.mail.every((m) => !String(m.to).includes('tester')), 'no mail to a test account');
});

test('Accept moves the card to the project and stage picked, makes the owner, and tells the asker once', async () => {
  const w = iw();
  const { project, doing } = await plainProject(w);
  const item = await send(w, VIDEO, 'Add a banner to the home page of the website');
  const opts = await ic(w, WILL, 'GET', `r/${item.id}/options`);
  assert.equal(opts.status, 200);
  const web = opts.data.projects.find((p) => p.key === 'WEB');
  assert.ok(web.sections.some((s) => s.name === 'Doing'));
  assert.equal(opts.data.projects[0].pipeline, 'tech', 'the team\'s own pipeline is first');
  const r = await ic(w, WILL, 'POST', `r/${item.id}/accept`, { project_id: project.id, section_id: doing.id, owner_email: DESIGN.email, due_date: '2026-10-28', note: 'On it' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.request.status, 'in_progress', 'a stage called Doing reads as In progress');
  assert.equal(r.data.request.word, 'In progress');
  assert.equal(r.data.request.project.key, 'WEB');
  assert.equal(r.data.request.section.name, 'Doing');
  assert.equal(r.data.request.owner.email, DESIGN.email);
  assert.equal(r.data.request.task.code, 'WEB-0001', 'the card takes the new project\'s code');
  const t = rows(w, 'SELECT * FROM hub_tasks WHERE request_id = ?', item.id);
  assert.equal(t.length, 1, 'the same card moved, no second one');
  assert.equal(t[0].owner_email, DESIGN.email);
  assert.equal(t[0].due_date, '2026-10-28');
  assert.equal(rows(w, 'SELECT owner_email FROM request_tasks WHERE request_id = ?', item.id)[0].owner_email, DESIGN.email);
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM events WHERE request_id = ? AND kind = 'accepted'", item.id)[0].n, 1);
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM request_chat_links WHERE request_id = ? AND kind = 'card'", item.id)[0].n, 1, 'one Chat card to the asker');
  // Again: moves it again, tells nobody twice.
  await ic(w, WILL, 'POST', `r/${item.id}/accept`, { project_id: project.id, section_id: doing.id, owner_email: DESIGN.email });
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM events WHERE request_id = ? AND kind = 'accepted'", item.id)[0].n, 1);
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM request_chat_links WHERE request_id = ? AND kind = 'card'", item.id)[0].n, 1);
  // The asker sees where it stands on My requests.
  const mine = (await ic(w, VIDEO, 'GET', 'mine')).data.requests[0];
  assert.equal(mine.word, 'In progress');
  assert.equal(mine.owner.email, DESIGN.email);
  assert.equal(mine.steps.find((s) => s.key === 'in_progress').state, 'now');
});

test('Accept with no project keeps the card in its team pipeline at Triage, which reads as Approved', async () => {
  const w = iw();
  const item = await send(w, VIDEO, 'Add a banner to the home page of the website');
  const r = await ic(w, WILL, 'POST', `r/${item.id}/accept`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.request.stage, 'Triage');
  assert.equal(r.data.request.word, 'Approved');
  assert.equal(r.data.request.task.code, 'TRQ-0001', 'same project, same code');
  assert.equal(r.data.request.owner.email, WILL.email, 'the one accepting owns it when no one else is picked');
  assert.equal((await ic(w, WILL, 'GET', 'queue')).data.requests.length, 0, 'it has left Intake');
  assert.equal((await ic(w, WILL, 'GET', 'queue?scope=open')).data.requests.length, 1);
  assert.equal((await ic(w, WILL, 'POST', `r/${item.id}/accept`, { owner_email: 'nobody@favorintl.org' })).status, 400);
  assert.equal((await ic(w, WILL, 'POST', `r/${item.id}/accept`, { project_id: 'prj_missing' })).status, 404);
});

test('Accept into a project linked to Asana queues the card for Asana and adds no section there; the pipeline itself never syncs', async () => {
  const w = iw();
  w.set('projects.asana.sync', 'on');
  const { project, doing } = await plainProject(w, 'MDY');
  w.d1.db.prepare("INSERT INTO hub_asana_sync_projects (project_gid, hub_project_id, name, enabled, enabled_by, created_at, updated_at) VALUES ('1200', ?, 'Daily', 1, 'test', ?, ?)").run(project.id, NOW, NOW);
  const item = await send(w, VIDEO, 'Add a banner to the home page of the website');
  const cardId = rows(w, 'SELECT id FROM hub_tasks WHERE request_id = ?', item.id)[0].id;
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM hub_asana_outbox WHERE hub_id = ?", cardId)[0].n, 0, 'a card in Intake makes no noise in Asana');
  const sectionsBefore = rows(w, 'SELECT COUNT(*) AS n FROM hub_project_sections WHERE project_id = ?', project.id)[0].n;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 500 });
  try {
    const r = await ic(w, WILL, 'POST', `r/${item.id}/accept`, { project_id: project.id, section_id: doing.id, owner_email: DESIGN.email });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  } finally {
    globalThis.fetch = realFetch;
  }
  const out = rows(w, "SELECT kind, actor FROM hub_asana_outbox WHERE hub_id = ?", cardId);
  assert.ok(out.length >= 1 && out.every((o) => o.kind === 'task'), 'the move reaches the Asana queue as a task change');
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_project_sections WHERE project_id = ?', project.id)[0].n, sectionsBefore, 'no section added to the synced project');
  assert.equal(proj(w, 'TRQ').id && rows(w, 'SELECT COUNT(*) AS n FROM hub_asana_sync_projects WHERE hub_project_id = ?', proj(w, 'TRQ').id)[0].n, 0);
  const { isPipelineProject } = await import('../functions/_lib/intake/pipeline.ts');
  assert.equal(await isPipelineProject(w.env, proj(w, 'TRQ').id), true);
  assert.equal(await isPipelineProject(w.env, project.id), false);
});

test('Ask a question comments on the request, tells the asker, and holds the card in Intake until they answer', async () => {
  const w = iw();
  const item = await send(w, VIDEO, 'Fix the form on the website');
  assert.equal((await ic(w, WILL, 'POST', `r/${item.id}/ask`, { question: '   ' })).status, 400);
  const r = await ic(w, WILL, 'POST', `r/${item.id}/ask`, { question: 'Which form do you mean, the give form or the contact form?' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.request.stage, 'Intake');
  assert.equal(r.data.request.word, 'Sent');
  assert.match(r.data.request.question.body, /give form/);
  assert.equal(r.data.request.question.by.email, WILL.email);
  const c = rows(w, 'SELECT email, body FROM request_comments WHERE request_id = ?', item.id);
  assert.equal(c.length, 1);
  assert.equal(c[0].email, WILL.email);
  const n = rows(w, "SELECT kind FROM request_notices WHERE request_id = ? AND email = ?", item.id, VIDEO.email);
  assert.equal(n.length, 1, 'the asker is told');
  const mine = (await ic(w, VIDEO, 'GET', 'mine')).data.requests[0];
  assert.ok(mine.question && /give form/.test(mine.question.body), 'the asker sees the question');
  assert.equal((await ic(w, WILL, 'GET', 'teams')).data.teams[0].counts.questions, 1);
  // The asker answers; the question closes and the owner is told.
  const a = await ic(w, VIDEO, 'POST', `r/${item.id}/reply`, { body: 'The give form.' });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.request.question, null);
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM request_notices WHERE request_id = ? AND email = ?", item.id, WILL.email)[0].n >= 1, true);
  const d = await ic(w, WILL, 'GET', `r/${item.id}`);
  assert.deepEqual(d.data.comments.map((x) => x.body), ['Which form do you mean, the give form or the contact form?', 'The give form.']);
  assert.equal(d.data.standing.triage, true);
  assert.equal((await ic(w, VIDEO, 'GET', `r/${item.id}`)).data.standing.triage, false);
});

test('Decline closes the request with the reason, drops the card, and the asker reads why', async () => {
  const w = iw();
  const item = await send(w, VIDEO, 'Rebuild the whole website in a week');
  assert.equal((await ic(w, WILL, 'POST', `r/${item.id}/decline`, { reason: ' ' })).status, 400);
  const r = await ic(w, WILL, 'POST', `r/${item.id}/decline`, { reason: 'Too big for one week. Send the pieces you need first.' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.request.word, 'Declined');
  assert.equal(r.data.request.declined_reason, 'Too big for one week. Send the pieces you need first.');
  const t = rows(w, 'SELECT status FROM hub_tasks WHERE request_id = ?', item.id)[0];
  assert.equal(t.status, 'dropped');
  const q = rows(w, 'SELECT status, declined_reason FROM requests WHERE id = ?', item.id)[0];
  assert.equal(q.status, 'declined');
  assert.equal((await ic(w, WILL, 'GET', 'queue?scope=open')).data.requests.length, 0);
  const mine = (await ic(w, VIDEO, 'GET', 'mine')).data.requests[0];
  assert.equal(mine.declined_reason, 'Too big for one week. Send the pieces you need first.');
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM request_notices WHERE request_id = ? AND email = ?", item.id, VIDEO.email)[0].n, 1, 'the asker is told');
  assert.equal((await ic(w, WILL, 'POST', `r/${item.id}/decline`, { reason: 'again' })).status, 400, 'a closed request cannot be declined again');
  assert.equal((await ic(w, WILL, 'POST', `r/${item.id}/accept`, {})).status, 400);
});

test('dragging a card moves the request with it, and the first move out of Intake tells the asker once', async () => {
  const w = iw();
  const item = await send(w, VIDEO, 'Add a banner to the home page of the website');
  const p = proj(w, 'TRQ');
  const card = rows(w, 'SELECT id FROM hub_tasks WHERE request_id = ?', item.id)[0].id;
  const drag = async (name) => pc(w, WILL, 'PATCH', `tasks/${card}`, { move: { section_id: sec(w, p.id, name) } });
  assert.equal((await drag('Triage')).status, 200);
  assert.equal(rows(w, 'SELECT status FROM requests WHERE id = ?', item.id)[0].status, 'approved');
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM events WHERE request_id = ? AND kind = 'accepted'", item.id)[0].n, 1);
  assert.equal((await drag('In progress')).status, 200);
  assert.equal(rows(w, 'SELECT status FROM requests WHERE id = ?', item.id)[0].status, 'in_progress');
  assert.ok(rows(w, 'SELECT started_at FROM requests WHERE id = ?', item.id)[0].started_at);
  assert.equal((await drag('Review')).status, 200);
  assert.equal(rows(w, 'SELECT status FROM requests WHERE id = ?', item.id)[0].status, 'in_progress', 'Review reads as In progress');
  assert.equal((await ic(w, VIDEO, 'GET', 'mine')).data.requests[0].word, 'In progress');
  assert.equal((await drag('Intake')).status, 200);
  assert.equal(rows(w, 'SELECT status FROM requests WHERE id = ?', item.id)[0].status, 'inbox', 'back to Intake is Sent again');
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM events WHERE request_id = ? AND kind = 'accepted'", item.id)[0].n, 1, 'nobody is told twice');
});

test('landing in Done, or ticking the card, closes the request and sends the done email once', async () => {
  const w = iw();
  w.env.RESEND_API_KEY = 'test-key';
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('api.resend.com')) { sent.push(JSON.parse(init.body)); return new Response('{"id":"x"}', { status: 200 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    const a = await send(w, VIDEO, 'Add a banner to the home page of the website');
    const p = proj(w, 'TRQ');
    const cardA = rows(w, 'SELECT id FROM hub_tasks WHERE request_id = ?', a.id)[0].id;
    // Dragged into Done.
    assert.equal((await pc(w, WILL, 'PATCH', `tasks/${cardA}`, { move: { section_id: sec(w, p.id, 'Done') } })).status, 200);
    await Promise.allSettled(w.pending.splice(0));
    const q = rows(w, 'SELECT status, completed_at FROM requests WHERE id = ?', a.id)[0];
    assert.equal(q.status, 'done');
    assert.ok(q.completed_at);
    assert.equal(rows(w, 'SELECT status FROM hub_tasks WHERE id = ?', cardA)[0].status, 'done', 'the card is ticked');
    const done = sent.filter((m) => m.subject === 'Done: Add a banner to the home page of the website');
    assert.equal(done.length, 1);
    assert.ok(done[0].to.includes(VIDEO.email), 'the asker gets the done email');
    // Moved around inside Done again: still one email.
    await pc(w, WILL, 'PATCH', `tasks/${cardA}`, { move: { section_id: sec(w, p.id, 'Done') } });
    assert.equal(sent.filter((m) => m.subject.startsWith('Done:')).length, 1);

    // Ticked with the checkbox: it moves to Done and the email goes.
    const b = await send(w, OUTSIDER, 'Fix the careers page on the website');
    const cardB = rows(w, 'SELECT id FROM hub_tasks WHERE request_id = ?', b.id)[0].id;
    assert.equal((await pc(w, WILL, 'PATCH', `tasks/${cardB}`, { status: 'done' })).status, 200);
    await Promise.allSettled(w.pending.splice(0));
    assert.equal(rows(w, 'SELECT status FROM requests WHERE id = ?', b.id)[0].status, 'done');
    assert.equal(rows(w, 'SELECT section_id FROM hub_tasks WHERE id = ?', cardB)[0].section_id, sec(w, p.id, 'Done'));
    assert.equal(sent.filter((m) => m.subject === 'Done: Fix the careers page on the website').length, 1);
    assert.ok(sent.every((m) => !JSON.stringify(m).includes(String.fromCharCode(8212))), 'no long dash in the email');

    // Reopened: back to In progress.
    assert.equal((await pc(w, WILL, 'PATCH', `tasks/${cardB}`, { status: 'open' })).status, 200);
    await Promise.allSettled(w.pending.splice(0));
    assert.equal(rows(w, 'SELECT status FROM requests WHERE id = ?', b.id)[0].status, 'in_progress');
    assert.equal(rows(w, 'SELECT section_id FROM hub_tasks WHERE id = ?', cardB)[0].section_id, sec(w, p.id, 'In progress'));

    // A test account's request closes without any mail to a real person.
    const before = sent.length;
    const t = await send(w, T, 'Add a test banner to the website');
    const cardT = rows(w, 'SELECT id FROM hub_tasks WHERE request_id = ?', t.id)[0].id;
    const tp = rows(w, "SELECT project_id FROM hub_intake_teams WHERE team = 'tech-test'")[0].project_id;
    await pc(w, T, 'PATCH', `tasks/${cardT}`, { move: { section_id: sec(w, tp, 'Done') } });
    await Promise.allSettled(w.pending.splice(0));
    assert.equal(rows(w, 'SELECT status FROM requests WHERE id = ?', t.id)[0].status, 'done');
    for (const m of sent.slice(before)) assert.ok(!m.to.includes(T.email), 'the test account is never an addressee');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the old Accept on a request that already has a card finds the card and does not make a second one', async () => {
  const w = iw();
  const item = await send(w, VIDEO, 'Add a banner to the home page of the website');
  const { call } = await import('./support/request-world.mjs');
  const r = await call(w, WILL, 'POST', `${item.id}/accept`, { owner_email: DESIGN.email });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.task.existing, true);
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_tasks WHERE request_id = ?', item.id)[0].n, 1);
});

test('a request that was never given a card gets one the first time its team triages it', async () => {
  const w = iw();
  const id = 'req_old1';
  w.d1.db.prepare("INSERT INTO requests (id, title, body, surface, status, submitter_name, submitter_email, source, created_at, updated_at) VALUES (?, 'Old ask', 'Words', 'portal', 'inbox', 'Vic Video', ?, 'form', ?, ?)").run(id, VIDEO.email, NOW, NOW);
  assert.equal((await ic(w, VIDEO, 'GET', `r/${id}`)).status, 200, 'the asker reads it before it has a card');
  assert.equal((await ic(w, VIDEO, 'GET', `r/${id}`)).data.item.task, null);
  const r = await ic(w, WILL, 'POST', `r/${id}/ask`, { question: 'Which page?' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.request.stage, 'Intake');
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_tasks WHERE request_id = ?', id)[0].n, 1);
  assert.equal(rows(w, 'SELECT team FROM hub_intake WHERE request_id = ?', id)[0].team, 'tech');
});

test('files sent with a request are kept and listed; the asker and the team read them, a stranger does not', async () => {
  const w = iw();
  const form = new FormData();
  form.set('payload', JSON.stringify({ text: 'Fix the picture on the team page of the website' }));
  form.append('files', new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }));
  const { handle } = await import('../functions/_lib/projects/route.ts');
  const res = await handle({ request: new Request('https://dash.favorintl.org/api/tasks/intake/submit', { method: 'POST', body: form }), env: w.env, user: VIDEO, path: ['tasks', 'intake', 'submit'], waitUntil: (p) => w.pending.push(p) });
  assert.equal(res.status, 201, await res.clone().text());
  const id = (await res.json()).request.id;
  const d = await ic(w, VIDEO, 'GET', `r/${id}`);
  assert.equal(d.data.attachments.length, 1);
  assert.equal(d.data.attachments[0].filename, 'shot.png');
  assert.equal((await ic(w, WILL, 'GET', `r/${id}`)).data.attachments.length, 1);
  assert.equal((await ic(w, OUTSIDER, 'GET', `r/${id}`)).status, 404);
});

test('the intake routes answer 503 until the tables exist', async () => {
  const w = iw();
  w.d1.exec('DROP TABLE hub_intake');
  assert.equal((await ic(w, VIDEO, 'GET', 'mine')).status, 503);
});
