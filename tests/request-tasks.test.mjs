// Tasks on the request board: Send to with a note, comments with @mentions, followers, due date, Waiting on, notices on Today
// and the bell, the Chat card and replies that come back from Chat. Made-up people and requests only; the live database is
// never touched (an in-memory D1 built from the repository's own schema files).
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { DESIGN, FOUNDER, NOW, OUTSIDER, VIDEO, WILL, addRequest, call, chat, rows, world } from './support/request-world.mjs';

test('the people list: directory and roster together, a founder reads Leadership, people who left are gone', async () => {
  const w = world();
  const r = await call(w, WILL, 'GET', 'people');
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.data.people.map((p) => [p.email, p]));
  assert.equal(by[FOUNDER.email].team, 'Leadership', 'roster team exec is Leadership, never Other staff');
  assert.equal(by[VIDEO.email].title, 'Videographer');
  assert.equal(by['gone@favorintl.org'], undefined, 'a blocked account is not offered');
  assert.equal(by['left@favorintl.org'], undefined, 'someone the directory marks inactive is not offered');
});

test('Send to: the owner, the note and the history; the person hears about it on Today, the bell and in Chat', async () => {
  const w = world();
  const id = addRequest(w);
  const r = await call(w, WILL, 'POST', `${id}/send`, { to: VIDEO.email, note: 'Can you reshoot so we see faces? The current cut is all backs of heads.' });
  assert.equal(r.status, 200);
  assert.equal(r.data.request.task.owner, VIDEO.email);
  assert.equal(r.data.request.task.sent_by, WILL.email);
  const sent = r.data.request.events.find((e) => e.kind === 'sent');
  assert.equal(sent.payload.to, VIDEO.email);
  assert.match(sent.payload.note, /faces/);
  assert.equal(r.data.request.comments[0].source, 'send', 'the note opens the conversation');
  // Notice for Vic, none for Ada (she acted).
  const n = await call(w, VIDEO, 'GET', 'notices');
  assert.equal(n.data.count, 1);
  assert.equal(n.data.items[0].kind, 'sent');
  assert.equal(n.data.items[0].actor_name, WILL.name);
  assert.equal((await call(w, WILL, 'GET', 'notices')).data.count, 0);
  // A card in the direct message between Ada and Vic, from Ada.
  const cards = rows(w, `SELECT l.message_id, m.email, m.attachments, c.kind FROM request_chat_links l JOIN chat_messages m ON m.id = l.message_id JOIN chat_channels c ON c.id = l.channel_id WHERE l.request_id = ? AND l.kind = 'card'`, id);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].email, WILL.email);
  assert.equal(cards[0].kind, 'dm');
  assert.equal(JSON.parse(cards[0].attachments)[0].type, 'task');
  assert.equal(rows(w, 'SELECT * FROM chat_mentions WHERE message_id = ?', cards[0].message_id).length, 0, 'the bell counts the request notice, not a second Chat row');
  // The card reads the request as it is now.
  const { hydrateAttachments } = await import('../functions/_lib/chat/hydrate.ts');
  const [card] = await hydrateAttachments(w.env, JSON.parse(cards[0].attachments));
  assert.equal(card.title, 'Hero video: faces');
  assert.equal(card.owner, VIDEO.name);
  assert.match(card.note, /reshoot/);
  assert.equal(card.url, `/requests/?r=${id}`);
  // Today shows it as Sent to you.
  const { sentToYouCard } = await import('../functions/_lib/hub/today.ts');
  const today = await sentToYouCard(w.env, VIDEO.email);
  assert.equal(today.label, 'Sent to you');
  assert.equal(today.n, 1);
  assert.equal(today.href, `/requests/?r=${id}`);
});

test('with request notices off, nobody is told and no Chat card goes out; the hand-off is still recorded', async () => {
  const w = world({ notify: null });
  const id = addRequest(w);
  const r = await call(w, WILL, 'POST', `${id}/send`, { to: VIDEO.email, note: 'context' });
  assert.equal(r.data.request.task.owner, VIDEO.email);
  assert.equal(rows(w, 'SELECT * FROM request_notices').length, 0);
  assert.equal(rows(w, 'SELECT * FROM request_chat_links').length, 0);
  assert.equal(rows(w, 'SELECT * FROM chat_messages').length, 0);
  // The test list still reaches a test address only.
  w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('requests.notify.only', ?, 'test', ?)").run(DESIGN.email, NOW);
  await call(w, WILL, 'POST', `${id}/comments`, { body: `<@${DESIGN.email}> and <@${FOUNDER.email}> where did this land?` });
  assert.deepEqual(rows(w, 'SELECT email FROM request_notices').map((x) => x.email), [DESIGN.email]);
});

test('only the owner or an admin sends it on; someone not on the request cannot comment or close it', async () => {
  const w = world();
  const id = addRequest(w);
  assert.equal((await call(w, OUTSIDER, 'POST', `${id}/send`, { to: VIDEO.email, note: 'x' })).status, 403);
  assert.equal((await call(w, OUTSIDER, 'POST', `${id}/comments`, { body: 'hi' })).status, 403);
  assert.equal((await call(w, OUTSIDER, 'POST', `${id}/done`)).status, 403);
  await call(w, WILL, 'POST', `${id}/send`, { to: VIDEO.email, note: 'yours' });
  // Follow subscribes, it gives no rights.
  assert.equal((await call(w, OUTSIDER, 'POST', `${id}/follow`, { on: true })).status, 200);
  assert.equal((await call(w, OUTSIDER, 'POST', `${id}/comments`, { body: 'hi' })).status, 403);
  // The owner hands it on.
  const on = await call(w, VIDEO, 'POST', `${id}/send`, { to: DESIGN.email, note: 'Needs the edit' });
  assert.equal(on.status, 200);
  assert.equal(on.data.request.task.owner, DESIGN.email);
  assert.equal(on.data.request.can.send, false, 'Vic sent it on and is no longer the owner');
  assert.equal(on.data.request.can.comment, true, 'Vic is still on it');
  assert.equal((await call(w, WILL, 'POST', `${id}/send`, { to: 'stranger@example.com', note: 'x' })).status, 400, 'only people on the staff list');
  assert.equal((await call(w, WILL, 'POST', `${id}/send`, { to: 'gone@favorintl.org', note: 'x' })).status, 400, 'not someone who left');
});

test('@mentions: the people named follow, get a notice and a card, and can answer; everyone else following gets a comment notice', async () => {
  const w = world();
  const id = addRequest(w, 'Matching gift landing');
  await call(w, WILL, 'POST', `${id}/comments`, { body: `<@${DESIGN.email}> <@${FOUNDER.email}> where was this left?` });
  const f = rows(w, 'SELECT email, why FROM request_followers WHERE request_id = ? ORDER BY email', id);
  assert.deepEqual(f.map((x) => [x.email, x.why]), [[WILL.email, 'comment'], [DESIGN.email, 'mention'], [FOUNDER.email, 'mention']]);
  assert.equal((await call(w, DESIGN, 'GET', 'notices')).data.items[0].kind, 'mention');
  assert.equal(rows(w, `SELECT * FROM request_chat_links WHERE kind = 'card'`).length, 2, 'one card each');
  const ev = rows(w, `SELECT payload FROM events WHERE request_id = ? AND kind = 'mention'`, id);
  assert.deepEqual(JSON.parse(ev[0].payload).who, [DESIGN.name, FOUNDER.name]);
  // Dan answers; Ada and Flo hear about it, Dan does not.
  const ans = await call(w, DESIGN, 'POST', `${id}/comments`, { body: 'It was waiting on the foundation list.' });
  assert.equal(ans.status, 200);
  assert.equal((await call(w, WILL, 'GET', 'notices')).data.items[0].kind, 'comment');
  assert.equal((await call(w, FOUNDER, 'GET', 'notices')).data.count, 2);
  // Dan's comment is copied under the card in the Ada and Dan direct message, and nowhere Dan is not a member.
  const copies = rows(w, `SELECT l.channel_id, m.email, m.thread_id FROM request_chat_links l JOIN chat_messages m ON m.id = l.message_id WHERE l.kind = 'copy'`);
  assert.equal(copies.length, 1);
  assert.equal(copies[0].email, DESIGN.email);
  // Reading the request clears its notices.
  await call(w, FOUNDER, 'POST', `${id}/read`);
  assert.equal((await call(w, FOUNDER, 'GET', 'notices')).data.count, 0);
});

test('one conversation in two places: a reply under the card in Chat is a comment on the request, and a board comment lands under the card', async () => {
  const w = world();
  w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('chat.enabled', 'staff', 'test', ?)").run(NOW);
  const id = addRequest(w);
  await call(w, WILL, 'POST', `${id}/send`, { to: VIDEO.email, note: 'Faces, please' });
  const card = rows(w, `SELECT message_id, channel_id FROM request_chat_links WHERE kind = 'card'`)[0];
  const reply = await chat(w, VIDEO, 'POST', `channels/${card.channel_id}/messages`, { body: 'On it. Shooting Thursday.', thread_id: card.message_id });
  assert.equal(reply.status, 200);
  const c = rows(w, `SELECT body, source, chat_message_id, email FROM request_comments WHERE request_id = ? AND source = 'chat'`, id);
  assert.equal(c.length, 1);
  assert.equal(c[0].body, 'On it. Shooting Thursday.');
  assert.equal(c[0].chat_message_id, reply.data.message.id);
  assert.equal(rows(w, 'SELECT * FROM chat_mentions WHERE message_id = ? AND email = ?', reply.data.message.id, WILL.email).length, 0, 'Ada is told once, by the request notice');
  assert.equal((await call(w, WILL, 'GET', 'notices')).data.items[0].kind, 'comment');
  // No copy goes back into the thread the reply came from.
  assert.equal(rows(w, `SELECT * FROM request_chat_links WHERE kind = 'copy'`).length, 0);
  // Ada answers on the board: it lands under the card.
  await call(w, WILL, 'POST', `${id}/comments`, { body: 'Thank you' });
  const copy = rows(w, `SELECT m.thread_id, m.body, m.email FROM request_chat_links l JOIN chat_messages m ON m.id = l.message_id WHERE l.kind = 'copy'`);
  assert.deepEqual(copy.map((x) => [x.thread_id, x.body, x.email]), [[card.message_id, 'Thank you', WILL.email]]);
  // The thread shows both, in order.
  const t = await chat(w, VIDEO, 'GET', `threads/${card.message_id}`);
  assert.deepEqual(t.data.replies.map((m) => m.body), ['On it. Shooting Thursday.', 'Thank you']);
  // Deleting the reply in Chat deletes the comment.
  await chat(w, VIDEO, 'DELETE', `messages/${reply.data.message.id}`);
  assert.ok(rows(w, `SELECT deleted_at FROM request_comments WHERE chat_message_id = ?`, reply.data.message.id)[0].deleted_at);
  // Deleting a board comment deletes its copy in Chat.
  const mine = rows(w, `SELECT id FROM request_comments WHERE body = 'Thank you'`)[0];
  await call(w, WILL, 'DELETE', `${id}/comments/${mine.id}`);
  assert.ok(rows(w, `SELECT deleted_at FROM chat_messages WHERE thread_id = ? AND email = ?`, card.message_id, WILL.email)[0].deleted_at);
});

test('status, due date and Waiting on: the owner marks it done, a bad date is refused, Waiting on tells that person', async () => {
  const w = world();
  const id = addRequest(w);
  await call(w, WILL, 'POST', `${id}/send`, { to: VIDEO.email, note: 'yours' });
  assert.equal((await call(w, VIDEO, 'PATCH', `${id}/task`, { due_date: '2026-13-40' })).status, 400);
  const due = await call(w, VIDEO, 'PATCH', `${id}/task`, { due_date: '2026-10-20', waiting_on: DESIGN.email });
  assert.equal(due.status, 200);
  assert.equal(due.data.request.task.due_date, '2026-10-20');
  assert.equal(due.data.request.task.waiting_on, DESIGN.email);
  assert.equal((await call(w, DESIGN, 'GET', 'notices')).data.items[0].kind, 'waiting');
  assert.equal((await call(w, OUTSIDER, 'PATCH', `${id}/task`, { due_date: '2026-10-21' })).status, 403);
  // Dan, who is waited on, can comment and close it; Vic reopens.
  assert.equal((await call(w, DESIGN, 'POST', `${id}/comments`, { body: 'Sent the file' })).status, 200);
  const done = await call(w, VIDEO, 'POST', `${id}/done`);
  assert.equal(done.data.request.status, 'done');
  assert.equal(done.data.request.can.done, false);
  assert.equal((await call(w, WILL, 'GET', 'notices')).data.items.some((n) => n.kind === 'done'), true);
  assert.equal((await call(w, VIDEO, 'POST', `${id}/done`)).status, 400, 'already closed');
  const back = await call(w, VIDEO, 'POST', `${id}/reopen`);
  assert.equal(back.data.request.status, 'in_progress');
  const kinds = back.data.request.events.map((e) => e.kind);
  assert.deepEqual(kinds.filter((k) => k !== 'created').sort(), ['due', 'sent', 'status', 'status', 'waiting']);
});

test('the agent key acting as a staff member is that staff member, never an admin', async () => {
  const w = world();
  const id = addRequest(w);
  const agent = { email: 'agent', name: 'Agent', picture: '', role: 'admin', via: 'agent', kpi: true };
  const r = await call(w, agent, 'POST', `${id}/comments`, { body: 'hi' }, { 'X-Act-As': OUTSIDER.email });
  assert.equal(r.status, 403);
  await call(w, WILL, 'POST', `${id}/send`, { to: OUTSIDER.email, note: 'yours' });
  const ok = await call(w, agent, 'POST', `${id}/comments`, { body: 'on it' }, { 'X-Act-As': OUTSIDER.email });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.request.can.triage, false);
});

test('before db/request-tasks.sql is applied the task routes say so and nothing else breaks', async () => {
  const w = world({ tables: false });
  const id = addRequest(w);
  assert.equal((await call(w, WILL, 'POST', `${id}/send`, { to: VIDEO.email })).status, 503);
  assert.equal((await call(w, WILL, 'GET', 'people')).status, 200, 'the people list does not need the new tables');
  const { tasksFor, detailFor } = await import('../functions/_lib/requests/tasks.ts');
  assert.equal((await tasksFor(w.env, [id], WILL.email)).size, 0);
  assert.equal(await detailFor(w.env, { id, status: 'inbox' }, null), null);
  const { sentToYouCard } = await import('../functions/_lib/hub/today.ts');
  assert.equal(await sentToYouCard(w.env, VIDEO.email), null);
});

test('the board list carries each request\'s owner, followers, comment count and my unread count', async () => {
  const w = world();
  const id = addRequest(w);
  addRequest(w, 'Another one');
  await call(w, WILL, 'POST', `${id}/send`, { to: VIDEO.email, note: 'yours' });
  const { tasksFor } = await import('../functions/_lib/requests/tasks.ts');
  const t = await tasksFor(w.env, rows(w, 'SELECT id FROM requests').map((r) => r.id), VIDEO.email);
  assert.equal(t.get(id).owner, VIDEO.email);
  assert.deepEqual(t.get(id).followers.sort(), [WILL.email, VIDEO.email].sort());
  assert.equal(t.get(id).comments, 1);
  assert.equal(t.get(id).unread, 1);
  assert.equal(t.size, 1, 'a request nobody is on carries no task');
});
