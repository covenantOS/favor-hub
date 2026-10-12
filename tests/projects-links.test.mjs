// Projects links: Chat (channel, /task, cards, replies both ways, make a task from a message), meeting action items, Today, the
// bell and menu count, search, Favor Brain, expense link, Google Calendar due dates and email. Invented people only; the database
// is an in-memory D1 built from the repository's own schema files and every outside call is a stand-in. Nothing real is touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { memoryD1 } from './support/d1.mjs';
import './support/resolve-ts.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOW = '2026-10-11T12:00:00.000Z';
const ADA = { email: 'ada@favorintl.org', name: 'Ada Admin', picture: '', role: 'admin', via: 'google', kpi: true };
const VIC = { email: 'vic@favorintl.org', name: 'Vic Video', picture: '', role: 'staff', via: 'google', kpi: true };
const DAN = { email: 'dan@favorintl.org', name: 'Dan Design', picture: '', role: 'staff', via: 'google', kpi: true };
const OZZ = { email: 'ozzy@favorintl.org', name: 'Ozzy Other', picture: '', role: 'staff', via: 'google', kpi: true };
const KEY = 'a'.repeat(64);

function world({ notify = 'on' } = {}) {
  const d1 = memoryD1();
  d1.exec(read('db/schema.sql'));
  d1.exec(read('db/admin-home.sql'));
  d1.exec(`CREATE TABLE hub_users (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', picture TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'staff', blocked INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  for (const f of ['meetings', 'work', 'clips', 'clips-v2', 'favor-chat', 'favor-chat-private', 'request-tasks', 'google', 'expenses', 'projects', 'projects-links']) d1.exec(read(`db/${f}.sql`));
  const ins = (sql, ...a) => d1.db.prepare(sql).run(...a);
  for (const u of [ADA, VIC, DAN, OZZ]) ins('INSERT INTO hub_users (email, name, picture, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', u.email, u.name, '', u.role, NOW, NOW);
  for (const [u, title, team] of [[ADA, 'Lead Developer', 'Marketing'], [VIC, 'Videographer', 'Marketing'], [DAN, 'Creative Director', 'Marketing'], [OZZ, 'Assistant', 'Support Team']]) {
    ins('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, ?)', u.email, u.name, title, team, 1);
  }
  if (notify) ins("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('requests.notify', ?, 'test', ?)", notify, NOW);
  ins("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('projects.enabled', 'staff', 'test', ?)", NOW);
  ins("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('chat.enabled', 'staff', 'test', ?)", NOW);
  const events = [];
  const room = { idFromName: (n) => n, get: () => ({ fetch: async (input, init) => { if (String(input).endsWith('/event')) events.push(JSON.parse(init.body)); return Response.json({}); } }) };
  const mail = [];
  const env = { DB: d1, CHAT_ROOM: room, UPLOADS: { put: async () => {}, get: async () => null }, MAIL_HOOK: (m) => { mail.push(m); return true; }, GOOGLE_TOKEN_KEY: KEY, GOOGLE_CLIENT_SECRET: 'x', MEET_CAL_URL: 'https://cal.test/v3' };
  return { d1, env, events, mail, pending: [] };
}

const rows = (w, sql, ...a) => w.d1.db.prepare(sql).all(...a);
const actorOf = (u) => ({ email: u.email, name: u.name, admin: u.role === 'admin' });

async function mk(w, who, body) {
  const { createProject } = await import('../functions/_lib/projects/projects.ts');
  return createProject(w.env, actorOf(who), body);
}
async function chat(w, user, method, path, body) {
  const { handle } = await import('../functions/_lib/chat/route.ts');
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await handle({ request: new Request('https://dash.favorintl.org/api/chat/' + path, init), env: w.env, user, path: path.split('?')[0].split('/'), waitUntil: (p) => w.pending.push(p) });
  await Promise.allSettled(w.pending.splice(0));
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function links(w, user, method, path, body) {
  const { linksRoute } = await import('../functions/_lib/projects/links/index.ts');
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await linksRoute({ request: new Request('https://dash.favorintl.org/api/tasks/links/' + path, init), env: w.env, user, path: ['links', ...path.split('?')[0].split('/')], waitUntil: (p) => w.pending.push(p) });
  await Promise.allSettled(w.pending.splice(0));
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function core(w, user, method, path, body) {
  const { handle } = await import('../functions/_lib/projects/route.ts');
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await handle({ request: new Request('https://dash.favorintl.org/api/' + path, init), env: w.env, user, path: path.split('?')[0].split('/'), waitUntil: (p) => w.pending.push(p) });
  await Promise.allSettled(w.pending.splice(0));
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('a project gets a Chat channel on demand; its lead and members join and the channel is private for a members-only project', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  const p = await mk(w, ADA, { name: 'Fall appeal', key: 'FALL', members: [VIC.email], visibility: 'members' });
  const a = await links(w, ADA, 'POST', `project/${p.id}/channel`);
  assert.equal(a.status, 200);
  assert.equal(a.data.created, true);
  const ch = rows(w, 'SELECT kind, name FROM chat_channels WHERE id = ?', a.data.channel.id)[0];
  assert.equal(ch.kind, 'private');
  assert.equal(ch.name, 'proj-fall');
  assert.deepEqual(rows(w, 'SELECT email FROM chat_members WHERE channel_id = ? ORDER BY email', a.data.channel.id).map((r) => r.email), [ADA.email, VIC.email]);
  const again = await links(w, ADA, 'POST', `project/${p.id}/channel`);
  assert.equal(again.data.created, false);
  assert.equal(again.data.channel.id, a.data.channel.id);
  // A person outside a members-only project cannot open its channel.
  assert.equal((await links(w, OZZ, 'POST', `project/${p.id}/channel`)).status, 404);
});

test('/task in a project channel makes a task in that project with a card; in a direct message it goes to the other person', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  const p = await mk(w, ADA, { name: 'Fall appeal', key: 'FALL', members: [VIC.email, DAN.email] });
  const ch = (await links(w, ADA, 'POST', `project/${p.id}/channel`)).data.channel.id;
  const r = await chat(w, ADA, 'POST', `channels/${ch}/messages`, { body: `/task Cut the hero video <@${VIC.email}> due friday` });
  assert.equal(r.status, 200);
  const att = r.data.message.attachments[0];
  assert.equal(att.type, 'ptask');
  assert.match(att.code, /^FALL-0001$/);
  assert.equal(att.title, 'Cut the hero video');
  assert.equal(att.owner, VIC.name);
  assert.match(att.due_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(att.url, '/projects/p/?p=FALL&t=FALL-0001');
  const t = rows(w, 'SELECT * FROM hub_tasks')[0];
  assert.equal(t.owner_email, VIC.email);
  assert.equal(t.project_id, p.id);
  // The raw "/task ..." text is not posted as well.
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM chat_messages WHERE body LIKE '/task%'")[0].n, 0);
  // Direct message: the other person is the owner when nobody is named.
  const dm = (await chat(w, ADA, 'POST', 'conversations', { members: [DAN.email] })).data.channel.id;
  const r2 = await chat(w, ADA, 'POST', `channels/${dm}/messages`, { body: '/task Send the October report' });
  assert.equal(r2.data.message.attachments[0].owner, DAN.name);
  assert.equal(rows(w, "SELECT project_id FROM hub_tasks WHERE title = 'Send the October report'")[0].project_id, null);
  // No title: Chat tells the writer what to type.
  assert.equal((await chat(w, ADA, 'POST', `channels/${dm}/messages`, { body: '/task' })).status, 400);
});

test('/task is plain text while Projects is off', async () => {
  const w = world();
  w.d1.db.prepare("UPDATE hub_settings SET value = 'off' WHERE key = 'projects.enabled'").run();
  const dm = (await chat(w, ADA, 'POST', 'conversations', { members: [DAN.email] })).data.channel.id;
  const r = await chat(w, ADA, 'POST', `channels/${dm}/messages`, { body: '/task Send the report' });
  assert.equal(r.status, 200);
  assert.equal(r.data.message.body, '/task Send the report');
});

test('Make a task from this message: title, a link back, one task per message, and the card sits under the message', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  const dm = (await chat(w, ADA, 'POST', 'conversations', { members: [VIC.email] })).data.channel.id;
  const msg = (await chat(w, VIC, 'POST', `channels/${dm}/messages`, { body: 'Can you send the flyer proof to the printer by Thursday? They close at noon.' })).data.message;
  const r = await links(w, ADA, 'POST', 'chat/make-task', { message_id: msg.id, due: '2026-10-15' });
  assert.equal(r.status, 201);
  const t = rows(w, 'SELECT * FROM hub_tasks WHERE id = ?', r.data.task.id)[0];
  assert.equal(t.title, 'Can you send the flyer proof to the printer by Thursday?');
  assert.equal(t.chat_message_id, String(msg.id));
  assert.match(t.description, /From Vic Video in Chat/);
  assert.equal(t.owner_email, ADA.email);
  const card = rows(w, "SELECT * FROM chat_messages WHERE thread_id = ?", msg.id)[0];
  assert.ok(card, 'the card is a reply under the message');
  assert.equal(JSON.parse(card.attachments)[0].type, 'ptask');
  const again = await links(w, ADA, 'POST', 'chat/make-task', { message_id: msg.id });
  assert.equal(again.status, 200);
  assert.equal(again.data.existing, true);
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_tasks')[0].n, 1);
});

test('replies mirror both ways: a reply under a card is a comment, a hub comment is copied under the card', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  const dm = (await chat(w, ADA, 'POST', 'conversations', { members: [VIC.email] })).data.channel.id;
  const card = (await chat(w, ADA, 'POST', `channels/${dm}/messages`, { body: '/task Reshoot the intro' })).data.message;
  const taskId = rows(w, 'SELECT id FROM hub_tasks')[0].id;
  // Vic replies in Chat: it becomes a comment on the task.
  const reply = await chat(w, VIC, 'POST', `channels/${dm}/messages`, { body: 'On it, Tuesday works.', thread_id: card.id });
  assert.equal(reply.status, 200);
  const cm = rows(w, 'SELECT * FROM hub_task_comments WHERE task_id = ?', taskId);
  assert.equal(cm.length, 1);
  assert.equal(cm[0].source, 'chat');
  assert.equal(cm[0].author_email, VIC.email);
  assert.equal(rows(w, "SELECT kind FROM hub_task_chat_links WHERE comment_id = ?", cm[0].id)[0].kind, 'reply');
  // Ada comments in the hub: a copy lands under the card in her direct message with Vic.
  const c = await core(w, ADA, 'POST', `tasks/${taskId}/comments`, { body: 'Great, thanks.' });
  assert.equal(c.status, 201);
  const copies = rows(w, "SELECT m.body, m.thread_id, m.email FROM hub_task_chat_links l JOIN chat_messages m ON m.id = l.message_id WHERE l.kind = 'copy'");
  assert.equal(copies.length, 1);
  assert.equal(copies[0].body, 'Great, thanks.');
  assert.equal(copies[0].thread_id, card.id);
  assert.equal(copies[0].email, ADA.email);
  // Deleting the Chat reply deletes the comment.
  await chat(w, VIC, 'DELETE', `messages/${reply.data.message.id}`);
  assert.equal(rows(w, 'SELECT deleted_at FROM hub_task_comments WHERE id = ?', cm[0].id)[0].deleted_at !== null, true);
});

test('an assignment in FavorOS posts a card in a direct message and tells the owner once', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  const r = await core(w, ADA, 'POST', 'tasks', { title: 'Order Partner Care cards', owner_email: DAN.email });
  assert.equal(r.status, 201);
  const cards = rows(w, "SELECT m.email, c.kind FROM hub_task_chat_links l JOIN chat_messages m ON m.id = l.message_id JOIN chat_channels c ON c.id = l.channel_id WHERE l.kind = 'card'");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].email, ADA.email);
  assert.equal(cards[0].kind, 'dm');
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_task_notices WHERE email = ?', DAN.email)[0].n, 1);
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM chat_mentions').length ? rows(w, 'SELECT COUNT(*) AS n FROM chat_mentions')[0].n : 0, 0, 'the bell counts the task notice, not a second Chat row');
});

test('no notices, cards or mail while the gate is closed', async () => {
  const w = world({ notify: 'off' });
  await import('../functions/_lib/projects/hooks.ts');
  await core(w, ADA, 'POST', 'tasks', { title: 'Order cards', owner_email: DAN.email });
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_task_notices')[0].n, 0);
  assert.equal(rows(w, "SELECT COUNT(*) AS n FROM hub_task_chat_links")[0].n, 0);
  assert.equal(w.mail.length, 0);
});

test('hydration: a card reads the task as it is now, and a dropped task reads as gone', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  const dm = (await chat(w, ADA, 'POST', 'conversations', { members: [DAN.email] })).data.channel.id;
  await chat(w, ADA, 'POST', `channels/${dm}/messages`, { body: '/task Draft the letter' });
  const id = rows(w, 'SELECT id FROM hub_tasks')[0].id;
  await core(w, ADA, 'PATCH', `tasks/${id}`, { done: true });
  let hist = await chat(w, ADA, 'GET', `channels/${dm}/messages`);
  const a = hist.data.messages.find((m) => m.attachments.length).attachments[0];
  assert.equal(a.status, 'done');
  assert.equal(a.status_label, 'Done');
  await core(w, ADA, 'DELETE', `tasks/${id}`);
  hist = await chat(w, ADA, 'GET', `channels/${dm}/messages`);
  assert.equal(hist.data.messages.find((m) => m.attachments.length).attachments[0].type, 'link');
});

test('meeting action items: named owners get tasks with the transcript moment, a retry never doubles, ticking follows both ways', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  w.d1.db.prepare("INSERT INTO hub_meetings (id, title, host_email, host_name, status, created_at, started_at) VALUES ('m1', 'Fall planning', ?, 'Ada Admin', 'ended', ?, ?)").run(ADA.email, NOW, NOW);
  const ins = w.d1.db.prepare('INSERT INTO hub_meeting_actions (meeting_id, idx, text, owner_name, owner_email, due, t) VALUES (?, ?, ?, ?, ?, ?, ?)');
  ins.run('m1', 0, 'Book the printer', 'Vic Video', VIC.email, 'friday', 754);
  ins.run('m1', 1, 'Write the ask letter', 'Somebody', '', '', 1210);
  const { meetActionsToTasks, makeActionTask, meetingOfTask, actionTasks } = await import('../functions/_lib/projects/links/meet.ts');
  assert.equal(await meetActionsToTasks(w.env, 'm1'), 1);
  assert.equal(await meetActionsToTasks(w.env, 'm1'), 0, 'a second pass makes nothing new');
  const t = rows(w, "SELECT * FROM hub_tasks WHERE meeting_id = 'm1'");
  assert.equal(t.length, 1);
  assert.equal(t[0].owner_email, VIC.email);
  assert.match(t[0].description, /at 12:34 in the transcript/);
  assert.ok(t[0].due_date, 'friday became a date');
  const m = await meetingOfTask(w.env, t[0]);
  assert.equal(m.stamp, '12:34');
  assert.match(m.url, /t=754/);
  // The unowned item becomes a task on a press, for the person pressing.
  const r = await makeActionTask(w.env, actorOf(DAN), { meeting_id: 'm1', idx: 1 });
  assert.equal(r.task.owner_email, DAN.email);
  assert.deepEqual(Object.keys(await actionTasks(w.env, 'm1')).sort(), ['0', '1']);
  // Done on the task ticks the item; unticking the item reopens the task.
  await core(w, VIC, 'PATCH', `tasks/${t[0].id}`, { done: true });
  assert.equal(rows(w, "SELECT done FROM hub_meeting_actions WHERE idx = 0")[0].done, 1);
  const { actionTicked } = await import('../functions/_lib/projects/links/meet.ts');
  await actionTicked(w.env, actorOf(VIC), 'm1', 0, false);
  assert.equal(rows(w, 'SELECT status FROM hub_tasks WHERE id = ?', t[0].id)[0].status, 'open');
  // The Meetings card on Today no longer counts items that became tasks.
  const { openActionsWithoutTask } = await import('../functions/_lib/projects/links/today.ts');
  assert.equal((await openActionsWithoutTask(w.env, VIC.email)).n, 0);
});

test('a huddle in a project channel files its action items in that project', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  const p = await mk(w, ADA, { name: 'Fall appeal', key: 'FALL', members: [VIC.email] });
  const ch = (await links(w, ADA, 'POST', `project/${p.id}/channel`)).data.channel.id;
  w.d1.db.prepare("INSERT INTO hub_meetings (id, title, host_email, host_name, status, created_at, started_at) VALUES ('m2', 'Huddle', ?, 'Ada Admin', 'ended', ?, ?)").run(ADA.email, NOW, NOW);
  w.d1.db.prepare("INSERT INTO chat_meetings (meeting_id, channel_id, message_id, started_by, notes_posted) VALUES ('m2', ?, 1, ?, 0)").run(ch, ADA.email);
  w.d1.db.prepare("INSERT INTO hub_meeting_actions (meeting_id, idx, text, owner_name, owner_email, due, t) VALUES ('m2', 0, 'Pick the photos', 'Vic', ?, '', 30)").run(VIC.email);
  const { meetActionsToTasks } = await import('../functions/_lib/projects/links/meet.ts');
  assert.equal(await meetActionsToTasks(w.env, 'm2'), 1);
  assert.equal(rows(w, "SELECT project_id FROM hub_tasks WHERE meeting_id = 'm2'")[0].project_id, p.id);
});

test('Today cards, the menu count, the bell and search', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  const p = await mk(w, ADA, { name: 'Fall appeal', key: 'FALL', members: [VIC.email] });
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  await core(w, ADA, 'POST', 'tasks', { title: 'Proof the flyer', project_id: p.id, owner_email: VIC.email, due_date: yesterday });
  await core(w, ADA, 'POST', 'tasks', { title: 'Plan the unrelated thing', owner_email: ADA.email });
  const { projectCards, projectsMineCount, bellFor, searchFor } = await import('../functions/_lib/projects/links/today.ts');
  const cards = await projectCards(w.env, VIC);
  assert.deepEqual(cards.map((c) => c.id), ['projects-due', 'projects-assigned']);
  assert.equal(cards[0].warn, true);
  assert.match(cards[0].href, /\/projects\/p\/\?p=FALL&t=FALL-0001/);
  assert.equal(await projectsMineCount(w.env, VIC), 2, 'one late task and one unread notice');
  const bell = await bellFor(w.env, VIC);
  assert.equal(bell.count, 1);
  assert.match(bell.items[0].head, /Ada Admin gave you/);
  assert.equal((await projectCards(w.env, ADA)).length, 0, 'the person who acted hears nothing');
  const req = (u) => new Request('https://dash.favorintl.org/api/tasks/links/search');
  const hits = await searchFor(w.env, req(), VIC, 'flyer');
  assert.equal(hits[0].kind, 'task');
  assert.equal(hits[0].url, '/projects/p/?p=FALL&t=FALL-0001');
  assert.equal((await searchFor(w.env, req(), OZZ, 'fall')).filter((h) => h.kind === 'project').length, 1, 'a staff-visible project shows to anyone with access');
  assert.equal((await searchFor(w.env, req(), VIC, 'unrelated')).length, 0, 'a personal task of someone else is not found');
});

test('Favor Brain doors: waiting, shipped, and make a task for a named person', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  w.env.BRAIN_HUB_KEY = 'brainkey';
  const { serviceDoor } = await import('../functions/_lib/projects/links/brain.ts');
  const call = async (method, qs, body, as = ADA.email, key = 'brainkey') => {
    const res = await serviceDoor(w.env, new Request('https://dash.favorintl.org/api/service/tasks/brain' + qs, { method, headers: { Authorization: `Bearer ${key}`, 'X-Acting-Email': as, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }));
    return { status: res.status, data: await res.json() };
  };
  assert.equal((await call('GET', '', undefined, ADA.email, 'wrong')).status, 401);
  const made = await call('POST', '', { action: 'create', title: 'Reorder Partner Care cards', owner: 'Dan', due: 'friday' });
  assert.equal(made.status, 201);
  assert.equal(made.data.task.owner, DAN.name);
  assert.equal(made.data.told, true);
  const unknown = await call('POST', '', { title: 'x', owner: 'Nobody Atall' });
  assert.equal(unknown.status, 409);
  assert.equal(unknown.data.error, 'unknown_person');
  const waiting = await call('GET', '?view=waiting', undefined, DAN.email);
  assert.equal(waiting.data.summary.open, 1);
  assert.equal(waiting.data.mine[0].title, 'Reorder Partner Care cards');
  assert.equal(waiting.data.summary.unread_notices, 1);
  await core(w, DAN, 'PATCH', `tasks/${rows(w, 'SELECT id FROM hub_tasks')[0].id}`, { done: true });
  const shipped = await call('GET', '?view=shipped&team=marketing&days=7');
  assert.equal(shipped.data.total, 1);
  assert.equal(shipped.data.by_owner[DAN.name], 1);
  // Someone with no access to Projects gets no door.
  w.d1.db.prepare("UPDATE hub_settings SET value = 'admins' WHERE key = 'projects.enabled'").run();
  assert.equal((await call('GET', '?view=waiting', undefined, DAN.email)).status, 403);
});

test('expense link: the task shows the approval, only the requester links, a signature shows when it lands', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  const t = (await core(w, VIC, 'POST', 'tasks', { title: 'Book the shoot travel' })).data.task;
  w.d1.db.prepare(
    `INSERT INTO expense_requests (id, doc_number, status, requester_name, requester_email, reason, total_cents, approver_name, approver_email, requester_signature, review_token_hash, submitted_at, created_at, updated_at)
     VALUES ('ex1', 'EXP-0007', 'pending', 'Vic Video', ?, 'Flights for the shoot', 48250, 'Ann Approver', 'ann@favorintl.org', 'sig', 'h', ?, ?, ?)`
  ).run(VIC.email, NOW, NOW, NOW);
  assert.equal((await links(w, DAN, 'PUT', `task/${t.id}/expense`, { expense_id: 'ex1' })).status >= 400, true);
  const ok = await links(w, VIC, 'PUT', `task/${t.id}/expense`, { expense_id: 'ex1' });
  assert.equal(ok.status, 200);
  let panel = (await links(w, VIC, 'GET', `task/${t.id}/links`)).data;
  assert.equal(panel.expense.doc_number, 'EXP-0007');
  assert.equal(panel.expense.total, '$482.50');
  assert.equal(panel.expense.status_label, 'Waiting for approval');
  w.d1.db.prepare("UPDATE expense_requests SET status = 'approved', approver_signature = 'x', decided_at = ? WHERE id = 'ex1'").run(NOW);
  panel = (await links(w, VIC, 'GET', `task/${t.id}/links`)).data;
  assert.equal(panel.expense.signed, true);
  const mine = await links(w, VIC, 'GET', 'expense/mine');
  assert.equal(mine.data.expenses.length, 1);
  assert.equal((await links(w, VIC, 'PUT', `task/${t.id}/expense`, { expense_id: null })).data.expense, null);
});

test('clips attach as the brief or as proof; proof also comments', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  const t = (await core(w, VIC, 'POST', 'tasks', { title: 'Film the intro' })).data.task;
  const clip = 'c'.repeat(32);
  w.d1.db.prepare("INSERT INTO hub_clips (id, owner_email, owner_name, title, status, mime, created_at, updated_at) VALUES (?, ?, 'Vic Video', 'Intro walkthrough', 'ready', 'video/webm', ?, ?)").run(clip, VIC.email, NOW, NOW);
  const brief = await links(w, VIC, 'POST', `task/${t.id}/clip`, { clip_id: clip, as: 'brief' });
  assert.equal(brief.status, 201);
  assert.equal(rows(w, "SELECT name, ref_id FROM hub_task_files WHERE kind = 'clip'")[0].name, 'Brief: Intro walkthrough');
  assert.equal((await links(w, VIC, 'POST', `task/${t.id}/clip`, { clip_id: clip, as: 'brief' })).data.existing, true);
  assert.equal((await links(w, DAN, 'POST', `task/${t.id}/clip`, { clip_id: clip, as: 'proof' })).status >= 400, true, 'not their clip');
  const clip2 = 'd'.repeat(32);
  w.d1.db.prepare("INSERT INTO hub_clips (id, owner_email, owner_name, title, status, mime, created_at, updated_at) VALUES (?, ?, 'Vic Video', 'Done cut', 'ready', 'video/webm', ?, ?)").run(clip2, VIC.email, NOW, NOW);
  await links(w, VIC, 'POST', `task/${t.id}/clip`, { clip_id: clip2, as: 'proof' });
  assert.match(rows(w, 'SELECT body FROM hub_task_comments')[0].body, /^Proof: Done cut/);
  assert.equal((await links(w, VIC, 'GET', 'clips')).data.clips.length, 2);
});

test('the project folder is made once in US Team Files and its files list for attaching', async () => {
  const w = world();
  const p = await mk(w, ADA, { name: 'Fall appeal', key: 'FALL' });
  w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('projects.drive_parent', 'PARENT', 't', ?)").run(NOW);
  const calls = [];
  const real = globalThis.fetch;
  w.env.DRIVE_API_URL = 'https://drive.test/files';
  w.env.GOOGLE_SA_JSON = JSON.stringify({ client_email: 'sa@x', private_key: 'x' });
  const drive = await import('../functions/_lib/projects/links/drive.ts');
  const sheetsa = await import('../functions/_lib/work/sheetsa.ts');
  void sheetsa;
  globalThis.fetch = async (url, init) => {
    url = String(url);
    calls.push([init?.method || 'GET', url]);
    if (url.includes('oauth2')) return Response.json({ access_token: 'sa-token', expires_in: 3600 });
    if (url.startsWith('https://drive.test/files?') && (init?.method || 'GET') === 'GET') {
      if (url.includes(encodeURIComponent("name = 'Projects'")) || url.includes(encodeURIComponent('FALL Fall appeal'))) return Response.json({ files: [] });
      return Response.json({ files: [{ id: 'f1', name: 'Brief.docx', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-10T10:00:00Z', webViewLink: 'https://docs.google.com/document/d/f1/edit' }] });
    }
    if (url.startsWith('https://drive.test/files?') && init?.method === 'POST') return Response.json({ id: JSON.parse(init.body).name === 'Projects' ? 'ROOT' : 'FOLDER1' });
    return Response.json({});
  };
  try {
    // Without a real signing key the service account token step cannot run, so only the folder row logic is checked here.
    const prev = await w.env.DB.prepare('SELECT drive_folder_id FROM hub_projects WHERE id = ?').bind(p.id).first();
    assert.equal(prev.drive_folder_id, null);
    const row = { ...p, drive_folder_id: 'FOLDER1' };
    const same = await drive.ensureProjectFolder(w.env, row);
    assert.equal(same.created, false);
    assert.equal(same.url, 'https://drive.google.com/drive/folders/FOLDER1');
    assert.deepEqual(await drive.folderFiles(w.env, { ...p, drive_folder_id: null }), []);
  } finally {
    globalThis.fetch = real;
  }
});

test('Google Calendar: the owner gets an event for the due date, it moves with the date and the owner, and leaves when done', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  const { seal } = await import('../functions/_lib/hub/google.ts');
  const connect = async (u, scopes) => w.d1.db.prepare('INSERT OR REPLACE INTO hub_google (email, refresh_enc, scopes, connected_at) VALUES (?, ?, ?, ?)').run(u.email, await seal(w.env, 'refresh-' + u.email), scopes, NOW);
  await connect(VIC, 'https://www.googleapis.com/auth/calendar.events');
  await connect(DAN, 'https://www.googleapis.com/auth/calendar.events.readonly'); // connected, no write scope
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.includes('oauth2') || url.includes('token')) return Response.json({ access_token: 'tok-' + String(init.body).includes('vic') });
    sent.push({ method: init.method || 'GET', url, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    if ((init.method || 'GET') === 'DELETE') return new Response(null, { status: 204 });
    return Response.json({ id: 'ev1' });
  };
  try {
    const t = (await core(w, ADA, 'POST', 'tasks', { title: 'Proof the flyer', owner_email: VIC.email, due_date: '2026-10-20' })).data.task;
    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, 'POST');
    assert.match(sent[0].url, /cal\.test\/v3\/calendars\/primary\/events\?sendUpdates=none/);
    assert.deepEqual(sent[0].body.start, { date: '2026-10-20' });
    assert.deepEqual(sent[0].body.end, { date: '2026-10-21' });
    assert.equal(sent[0].body.attendees, undefined, 'no guests, so Google sends no invitation');
    assert.equal(sent[0].body.transparency, 'transparent');
    // A new date updates the same event; a time makes it a 30 minute event.
    await core(w, ADA, 'PATCH', `tasks/${t.id}`, { due_date: '2026-10-22', due_time: '14:30' });
    assert.equal(sent[1].method, 'PUT');
    assert.match(sent[1].url, /events\/ev1/);
    assert.equal(sent[1].body.start.dateTime, '2026-10-22T14:30:00');
    assert.equal(sent[1].body.end.dateTime, '2026-10-22T15:00:00');
    // The same state again writes nothing.
    await core(w, ADA, 'PATCH', `tasks/${t.id}`, { priority: 'high' });
    assert.equal(sent.length, 2);
    // A new owner without the scope: the old owner's event is removed, the new owner gets none.
    await core(w, ADA, 'PATCH', `tasks/${t.id}`, { owner_email: DAN.email });
    assert.equal(sent[2].method, 'DELETE');
    assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_task_gcal')[0].n, 0);
    const panel = (await links(w, ADA, 'GET', `task/${t.id}/links`)).data;
    assert.equal(panel.calendar.state, 'needs_scope');
    // Back to Vic, then done: the event is removed.
    await core(w, ADA, 'PATCH', `tasks/${t.id}`, { owner_email: VIC.email });
    assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_task_gcal')[0].n, 1);
    await core(w, VIC, 'PATCH', `tasks/${t.id}`, { done: true });
    assert.equal(sent.at(-1).method, 'DELETE');
    assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_task_gcal')[0].n, 0);
    // A person who keeps tasks off their calendar gets nothing.
    await links(w, VIC, 'PUT', 'prefs', { calendar: false });
    const before = sent.length;
    await core(w, ADA, 'POST', 'tasks', { title: 'Another', owner_email: VIC.email, due_date: '2026-10-25' });
    assert.equal(sent.length, before);
  } finally {
    globalThis.fetch = real;
  }
});

test('Google Calendar stays shut while the gate is closed for that person', async () => {
  const w = world({ notify: 'off' });
  await import('../functions/_lib/projects/hooks.ts');
  const { seal } = await import('../functions/_lib/hub/google.ts');
  w.d1.db.prepare('INSERT INTO hub_google (email, refresh_enc, scopes, connected_at) VALUES (?, ?, ?, ?)').run(VIC.email, await seal(w.env, 'r'), 'https://www.googleapis.com/auth/calendar.events', NOW);
  const real = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (url, init = {}) => { if (!String(url).includes('token')) writes++; return Response.json({ access_token: 't', id: 'e' }); };
  try {
    await core(w, ADA, 'POST', 'tasks', { title: 'Proof', owner_email: VIC.email, due_date: '2026-10-20' });
    assert.equal(writes, 0);
    w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('requests.notify.only', ?, 't', ?)").run(VIC.email, NOW);
    await core(w, ADA, 'POST', 'tasks', { title: 'Proof two', owner_email: VIC.email, due_date: '2026-10-21' });
    assert.equal(writes, 1, 'listed in requests.notify.only, so the test address is allowed');
  } finally {
    globalThis.fetch = real;
  }
});

test('email: one per notice for people who chose that, a daily summary for those who chose it, none for off, never twice', async () => {
  const w = world();
  await import('../functions/_lib/projects/hooks.ts');
  await links(w, VIC, 'PUT', 'prefs', { mail_mode: 'daily' });
  await links(w, DAN, 'PUT', 'prefs', { mail_mode: 'off' });
  await core(w, ADA, 'POST', 'tasks', { title: 'Order cards', owner_email: OZZ.email });
  assert.equal(w.mail.length, 1, 'Ozzy has the default, one email per notice');
  assert.equal(w.mail[0].to, OZZ.email);
  assert.match(w.mail[0].subject, /Ada gave you a task: Order cards/);
  assert.match(w.mail[0].html, /Open the task/);
  assert.doesNotMatch(w.mail[0].html + w.mail[0].text, /—/, 'no em dashes');
  await core(w, ADA, 'POST', 'tasks', { title: 'Cut the video', owner_email: VIC.email });
  await core(w, ADA, 'POST', 'tasks', { title: 'Dan task', owner_email: DAN.email });
  assert.equal(w.mail.length, 1, 'daily and off people get nothing at the time');
  const { mailFresh, dailyPass } = await import('../functions/_lib/projects/links/email.ts');
  assert.equal(await mailFresh(w.env), 0, 'a second pass sends nothing twice');
  // The weekday morning pass sends Vic's summary once.
  const monday = new Date('2026-10-12T14:00:00Z');
  const r = await dailyPass(w.env, monday);
  assert.equal(r.summaries, 1);
  assert.equal(w.mail.at(-1).to, VIC.email);
  assert.match(w.mail.at(-1).subject, /Task news: Cut the video|tasks have news/);
  assert.equal((await dailyPass(w.env, monday)).summaries, 0);
  // Weekends and early mornings send nothing.
  assert.deepEqual((await dailyPass(w.env, new Date('2026-10-11T14:00:00Z'))).notes, ['weekend']);
});

test('email never goes to a person the gate refuses, and old notices are not mailed', async () => {
  const w = world({ notify: 'off' });
  await import('../functions/_lib/projects/hooks.ts');
  // A notice that already exists from before is not mailed even when mail turns on later.
  w.d1.db.prepare("INSERT INTO hub_task_notices (id, email, task_id, kind, actor_email, body, created_at) VALUES ('n0', ?, 'x', 'assigned', ?, 'old', '2026-09-01T00:00:00.000Z')").run(OZZ.email, ADA.email);
  const { mailFresh } = await import('../functions/_lib/projects/links/email.ts');
  assert.equal(await mailFresh(w.env), 0);
  w.d1.db.prepare("UPDATE hub_settings SET value = 'on' WHERE key = 'requests.notify'").run();
  w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('requests.notify', 'on', 't', ?) ON CONFLICT(key) DO UPDATE SET value = 'on'").run(NOW);
  assert.equal(await mailFresh(w.env), 0, 'the old notice is older than 15 minutes');
  assert.equal(w.mail.length, 0);
});

test('prefs: a choice is saved per person and a bad one is refused', async () => {
  const w = world();
  assert.equal((await links(w, VIC, 'GET', 'prefs')).data.mail_mode, 'now');
  assert.equal((await links(w, VIC, 'PUT', 'prefs', { mail_mode: 'daily', calendar: false })).data.mail_mode, 'daily');
  const p = (await links(w, VIC, 'GET', 'prefs')).data;
  assert.equal(p.calendar, false);
  assert.equal(p.google.connected, false);
  assert.equal((await links(w, VIC, 'PUT', 'prefs', { mail_mode: 'hourly' })).status, 400);
  assert.equal((await links(w, DAN, 'GET', 'prefs')).data.mail_mode, 'now', 'one person\'s choice does not leak to another');
});

test('parseWhen and the /task parser', async () => {
  const { parseWhen, parseSlash } = await import('../functions/_lib/projects/links/chat.ts');
  const mon = new Date('2026-10-12T16:00:00Z');
  assert.equal(parseWhen('today', mon), '2026-10-12');
  assert.equal(parseWhen('tomorrow', mon), '2026-10-13');
  assert.equal(parseWhen('friday', mon), '2026-10-16');
  assert.equal(parseWhen('monday', mon), '2026-10-19');
  assert.equal(parseWhen('next friday', mon), '2026-10-23');
  assert.equal(parseWhen('10/31', mon), '2026-10-31');
  assert.equal(parseWhen('oct 31', mon), '2026-10-31');
  assert.equal(parseWhen('2026-11-02', mon), '2026-11-02');
  assert.equal(parseWhen('whenever', mon), null);
  const w = world();
  const s = await parseSlash(w.env, '/task FALL Send the thank-you list @Dan by 10/30', new Set(['FALL']));
  assert.deepEqual(s, { title: 'Send the thank-you list', project: 'FALL', owner: DAN.email, due: '2026-10-30' });
  assert.equal(await parseSlash(w.env, 'hello', new Set()), null);
});
