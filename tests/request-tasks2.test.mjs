// Request board tasks, round 2: whether a person was told, email (one per event, the daily summary, each person's choice, the
// gate and the admin switch), due soon, search, the Favor Brain's read, Today's cards and mentions written as names.
// Made-up people only; email lands in a list in memory and the live database is never touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { DESIGN, FOUNDER, NOW, OUTSIDER, VIDEO, WILL, addRequest, call, chat, rows, world } from './support/request-world.mjs';

const setting = (w, key, value) => w.d1.db.prepare('INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value, 'test', NOW);

test('the drawer says whether the person was told, and Tell sends the notice once notices are on', async () => {
  const w = world({ notify: null });
  const id = addRequest(w);
  await call(w, WILL, 'PATCH', `${id}/task`, { waiting_on: VIDEO.email });
  let r = (await call(w, WILL, 'POST', `${id}/send`, { to: DESIGN.email, note: 'yours' })).data.request;
  assert.deepEqual(r.told.waiting, { email: VIDEO.email, told: false, open: false }, 'notices are off: not told, and cannot be yet');
  assert.equal(r.told.owner.told, false);
  assert.equal(r.events.find((e) => e.kind === 'waiting').payload.told, false, 'the history line carries it too');
  assert.equal((await call(w, WILL, 'POST', `${id}/tell`, { email: VIDEO.email })).status, 409, 'Tell cannot get past the gate');
  // Notices are switched on later: nothing fires for the old events by itself.
  setting(w, 'requests.notify', 'on');
  r = (await call(w, WILL, 'POST', `${id}/comments`, { body: 'checking in' })).data.request;
  assert.equal(rows(w, `SELECT * FROM request_notices WHERE kind IN ('waiting', 'sent')`).length, 0);
  assert.deepEqual(r.told.waiting, { email: VIDEO.email, told: false, open: true });
  // The person presses Tell.
  r = (await call(w, WILL, 'POST', `${id}/tell`, { email: VIDEO.email })).data.request;
  assert.equal(r.told.waiting.told, true);
  assert.equal(rows(w, `SELECT * FROM request_notices WHERE kind = 'waiting' AND email = ?`, VIDEO.email).length, 1);
  await call(w, WILL, 'POST', `${id}/tell`, { email: VIDEO.email });
  assert.equal(rows(w, `SELECT * FROM request_notices WHERE kind = 'waiting' AND email = ?`, VIDEO.email).length, 1, 'never twice');
  assert.equal((await call(w, OUTSIDER, 'POST', `${id}/tell`, { email: VIDEO.email })).status, 403);
});

test('email: one per event, none to the person who acted, built for the event with the thread and the three links', async () => {
  const w = world();
  const id = addRequest(w);
  await call(w, WILL, 'POST', `${id}/send`, { to: VIDEO.email, note: 'Faces, please' });
  assert.equal(w.mail.length, 1);
  const m = w.mail[0];
  assert.equal(m.to, VIDEO.email);
  assert.equal(m.subject, `${WILL.name} sent you: Hero video: faces`);
  assert.ok(m.html.includes('Faces, please') && m.html.includes(`/requests/?r=${id}`) && m.html.includes(`r=${id}&amp;do=done`) && m.html.includes(`r=${id}&amp;reply=1`));
  assert.ok(m.html.includes('Owner') && m.html.includes(VIDEO.name), 'the chips say who has it');
  const dash = String.fromCharCode(8212);
  assert.ok(!m.html.includes(dash) && !m.text.includes(dash), 'no long dash');
  // A comment that names Dan: Dan gets a mention email with names written out, Vic a comment email, Ada (who wrote it) nothing.
  await call(w, WILL, 'POST', `${id}/comments`, { body: `<@${DESIGN.email}> can you send Vic the b-roll?` });
  assert.deepEqual(w.mail.slice(1).map((x) => [x.to, x.subject.split(':')[0]]).sort(), [[DESIGN.email, `${WILL.name} mentioned you`], [VIDEO.email, `${WILL.name} commented`]].sort());
  const mention = w.mail.find((x) => x.to === DESIGN.email);
  assert.ok(mention.html.includes('@Dan Design can you send Vic the b-roll?'), 'the mention reads as a name');
  assert.ok(mention.html.includes('Earlier in the thread') && mention.html.includes('Faces, please'));
  assert.equal(w.mail.filter((x) => x.to === WILL.email).length, 0);
  assert.equal(rows(w, `SELECT * FROM request_email_log WHERE state = 'sent'`).length, 3, 'each notice is logged once');
});

test('email: each person chooses now, a daily summary or none; the admin switch and the gate both stop it', async () => {
  const w = world();
  const id = addRequest(w);
  assert.equal((await call(w, VIDEO, 'GET', 'prefs')).data.mode, 'now');
  assert.equal((await call(w, VIDEO, 'PUT', 'prefs', { mode: 'weekly' })).status, 400);
  await call(w, VIDEO, 'PUT', 'prefs', { mode: 'off' });
  await call(w, DESIGN, 'PUT', 'prefs', { mode: 'daily' });
  await call(w, WILL, 'POST', `${id}/comments`, { body: `<@${VIDEO.email}> <@${DESIGN.email}> <@${FOUNDER.email}> look` });
  assert.deepEqual(w.mail.map((m) => m.to), [FOUNDER.email], 'off gets none, daily waits for morning, now gets it');
  assert.equal(rows(w, 'SELECT * FROM request_notices').length, 3, 'the notices themselves still reach Today and the bell');
  // The daily summary: a weekday after 8:00 AM Eastern, once.
  const { dailyPass } = await import('../functions/_lib/requests/mail.ts');
  const id2 = addRequest(w, 'Second request');
  await call(w, WILL, 'POST', `${id2}/send`, { to: DESIGN.email, note: 'This too' });
  assert.equal((await dailyPass(w.env, new Date('2026-10-12T11:00:00Z'))).notes[0], 'before 8:00 AM');
  assert.equal((await dailyPass(w.env, new Date('2026-10-11T14:00:00Z'))).notes[0], 'weekend');
  const run = await dailyPass(w.env, new Date('2026-10-12T13:00:00Z'));
  assert.equal(run.summaries, 1);
  const sum = w.mail.find((m) => m.to === DESIGN.email);
  assert.equal(sum.subject, 'Requests: 2 with news for you');
  assert.ok(sum.html.includes('Hero video: faces') && sum.html.includes('Second request') && sum.html.includes('This too'));
  assert.equal((await dailyPass(w.env, new Date('2026-10-12T13:10:00Z'))).summaries, 0, 'never the same notices twice');
  // Admin switch off, then the gate closed with one test address allowed.
  setting(w, 'requests.email', 'off');
  const n = w.mail.length;
  await call(w, WILL, 'POST', `${id}/comments`, { body: `<@${FOUNDER.email}> again` });
  assert.equal(w.mail.length, n, 'the admin switch stops email, not the notice');
  setting(w, 'requests.email', 'on');
  setting(w, 'requests.notify', 'off');
  setting(w, 'requests.notify.only', WILL.email);
  await call(w, FOUNDER, 'POST', `${id}/comments`, { body: `<@${OUTSIDER.email}> and everyone following` });
  assert.deepEqual(w.mail.slice(n).map((m) => m.to), [WILL.email], 'with notices off only the test address is mailed');
});

test('before db/request-email.sql is applied notices work and no email is attempted', async () => {
  const w = world({ email: false });
  const id = addRequest(w);
  const r = await call(w, WILL, 'POST', `${id}/send`, { to: VIDEO.email, note: 'yours' });
  assert.equal(r.status, 200);
  assert.equal(w.mail.length, 0);
  assert.equal((await call(w, VIDEO, 'GET', 'notices')).data.count, 1);
  assert.equal((await call(w, VIDEO, 'GET', 'prefs')).data.email_on, false);
});

test('due soon: the owner hears once per due date, on Today, the bell and by email', async () => {
  const w = world();
  const id = addRequest(w);
  await call(w, WILL, 'POST', `${id}/send`, { to: VIDEO.email, note: '' });
  await call(w, WILL, 'PATCH', `${id}/task`, { due_date: '2026-10-13' });
  const { dailyPass } = await import('../functions/_lib/requests/mail.ts');
  w.mail.length = 0;
  const run = await dailyPass(w.env, new Date('2026-10-12T13:00:00Z'));
  assert.equal(run.due, 1);
  assert.equal(w.mail[0].subject, 'Due tomorrow: Hero video: faces');
  assert.equal((await dailyPass(w.env, new Date('2026-10-12T13:20:00Z'))).due, 0);
  assert.equal((await call(w, VIDEO, 'GET', 'notices')).data.items[0].kind, 'due');
});

test('search finds a request by title or by a person on it; the Brain door answers what waits on me and what I sent', async () => {
  const w = world();
  const id = addRequest(w, 'Hero video: faces');
  const id2 = addRequest(w, 'Annual report layout');
  await call(w, WILL, 'POST', `${id}/send`, { to: VIDEO.email, note: 'yours' });
  await call(w, WILL, 'POST', `${id2}/send`, { to: DESIGN.email, note: 'layout' });
  await call(w, DESIGN, 'PATCH', `${id2}/task`, { waiting_on: WILL.email });
  const byTitle = (await call(w, OUTSIDER, 'GET', 'search?q=hero')).data.results;
  assert.deepEqual(byTitle.map((x) => x.id), [id]);
  const byPerson = (await call(w, OUTSIDER, 'GET', 'search?q=vic')).data.results;
  assert.equal(byPerson[0].id, id);
  assert.equal(byPerson[0].owner, VIDEO.name);
  assert.equal((await call(w, OUTSIDER, 'GET', 'search?q=h')).data.results.length, 0, 'two letters at least');
  const { brainView } = await import('../functions/_lib/requests/views.ts');
  const mine = await brainView(w.env, WILL.email);
  assert.deepEqual(mine.sent_by_me.map((x) => x.id).sort(), [id, id2].sort());
  assert.deepEqual(mine.waiting_on_me.map((x) => x.id), [id2]);
  assert.deepEqual((await brainView(w.env, WILL.email, 'vic')).sent_by_me.map((x) => x.id), [id], 'narrowed to one person');
  assert.deepEqual((await brainView(w.env, VIDEO.email)).mine.map((x) => [x.id, x.sent_by]), [[id, WILL.name]]);
});

test('Today: Sent to you, Waiting on you and Mentions each count requests, and show nothing while notices are off', async () => {
  const w = world();
  const a = addRequest(w, 'One');
  const b = addRequest(w, 'Two');
  const c = addRequest(w, 'Three');
  await call(w, WILL, 'POST', `${a}/send`, { to: VIDEO.email, note: '' });
  await call(w, WILL, 'POST', `${b}/send`, { to: VIDEO.email, note: '' });
  await call(w, WILL, 'PATCH', `${c}/task`, { waiting_on: VIDEO.email });
  await call(w, WILL, 'POST', `${c}/comments`, { body: `<@${VIDEO.email}> see this` });
  const { taskCards } = await import('../functions/_lib/hub/today.ts');
  const cards = Object.fromEntries((await taskCards(w.env, VIDEO.email)).map((x) => [x.id, x]));
  assert.equal(cards.tasks.n, 2);
  assert.equal(cards.tasks.href, '/requests/?view=mine');
  assert.equal(cards['tasks-waiting'].n, 1);
  assert.equal(cards['tasks-waiting'].href, `/requests/?r=${c}`);
  assert.equal(cards['tasks-news'].label, 'Mentions');
  // Finishing one takes it off Sent to you.
  await call(w, VIDEO, 'POST', `${a}/done`);
  assert.equal((await taskCards(w.env, VIDEO.email)).find((x) => x.id === 'tasks').n, 1);
  setting(w, 'requests.notify', 'off');
  assert.deepEqual(await taskCards(w.env, VIDEO.email), [], 'closed gate: Today is silent');
  // A hand-off made while notices were off stays off Today after they come on, until someone presses Tell.
  const d = addRequest(w, 'Four');
  await call(w, WILL, 'POST', `${d}/send`, { to: DESIGN.email, note: '' });
  setting(w, 'requests.notify', 'on');
  assert.deepEqual(await taskCards(w.env, DESIGN.email), [], 'old events do not fire');
  await call(w, WILL, 'POST', `${d}/tell`, { email: DESIGN.email });
  assert.equal((await taskCards(w.env, DESIGN.email))[0].n, 1);
});

test('a notice and a Chat card write a mention as the name of the person', async () => {
  const w = world();
  const id = addRequest(w);
  await call(w, WILL, 'POST', `${id}/comments`, { body: `<@${DESIGN.email}> with <@${FOUNDER.email}>` });
  const n = (await call(w, DESIGN, 'GET', 'notices')).data.items[0];
  assert.equal(n.note, '@Dan Design with @Flo Founder');
  const card = rows(w, `SELECT m.attachments FROM request_chat_links l JOIN chat_messages m ON m.id = l.message_id WHERE l.kind = 'card' LIMIT 1`)[0];
  const { hydrateAttachments } = await import('../functions/_lib/chat/hydrate.ts');
  const [c] = await hydrateAttachments(w.env, JSON.parse(card.attachments));
  assert.deepEqual(c.names, { [DESIGN.email]: 'Dan Design', [FOUNDER.email]: 'Flo Founder' });
});

test('replies mirror both ways through real routes, with mentions kept as tokens on both sides', async () => {
  const w = world();
  setting(w, 'chat.enabled', 'staff');
  const id = addRequest(w);
  await call(w, WILL, 'POST', `${id}/send`, { to: VIDEO.email, note: 'Faces, please' });
  const card = rows(w, `SELECT message_id, channel_id FROM request_chat_links WHERE kind = 'card'`)[0];
  // Chat to the request: Vic replies under the card and names Dan.
  const reply = await chat(w, VIDEO, 'POST', `channels/${card.channel_id}/messages`, { body: `On it. <@${DESIGN.email}> has the b-roll.`, thread_id: card.message_id });
  assert.equal(reply.status, 200);
  const { fullRequest } = await import('../functions/_lib/requests/route.ts');
  let r = await fullRequest(w.env, id, { email: WILL.email, name: WILL.name, admin: true });
  const fromChat = r.comments.find((c) => c.source === 'chat');
  assert.equal(fromChat.body, `On it. <@${DESIGN.email}> has the b-roll.`, 'the token arrives whole');
  assert.ok(r.task.followers.includes(DESIGN.email), 'the person named in Chat now follows the request');
  // The request to Chat: Ada answers on the board and it lands in the same thread, in order.
  await call(w, WILL, 'POST', `${id}/comments`, { body: `Thanks. <@${VIDEO.email}> Thursday works.` });
  const thread = (await chat(w, VIDEO, 'GET', `threads/${card.message_id}`)).data.replies.map((m) => [m.user_id, m.body]);
  assert.deepEqual(thread, [[VIDEO.email, `On it. <@${DESIGN.email}> has the b-roll.`], [WILL.email, `Thanks. <@${VIDEO.email}> Thursday works.`]]);
  // Neither side doubled: one comment per message, one message per comment.
  r = await fullRequest(w.env, id, { email: WILL.email, name: WILL.name, admin: true });
  assert.equal(r.comments.filter((c) => !c.deleted).length, 3, 'the note, the reply from Chat, the board comment');
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM chat_messages WHERE thread_id = ?', card.message_id)[0].n, 2);
});
