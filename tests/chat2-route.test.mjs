// Favor Chat, second round, through its router with a stand-in database: the Threads list and thread unread counts, mark
// unread, a reply also sent to the channel, the mentions and reactions list, pins and bookmarks (with and without their
// tables), a private follow-up question for the Brain, a confirm card pressed in a Brain answer, and a request made from Chat.
// Made-up people only; the live database and the real Brain are never touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';
import { ADMIN, ADMIN2, ADMIN3, world as baseWorld } from './support/chat-world.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const GEN = 'ch_general';

function world({ pins = true, requests = false } = {}) {
  const w = baseWorld();
  if (pins) w.d1.exec(read('db/favor-chat2.sql'));
  if (requests) {
    w.d1.exec(read('db/schema.sql'));
    w.d1.exec(read('db/work.sql'));
    w.d1.exec(read('db/request-tasks.sql'));
  }
  return w;
}

async function call(w, user, method, path, body, extra = {}) {
  const { handle } = await import('../functions/_lib/chat/route.ts');
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const res = await handle({
    request: new Request('https://dash.favorintl.org/api/chat/' + path, init),
    env: { ...w.env, ...(extra.env || {}) },
    user,
    path: path.split('?')[0].split('/'),
    waitUntil: (p) => w.pending.push(p),
    fetcher: extra.fetcher,
  });
  await Promise.allSettled(w.pending.splice(0));
  const data = (res.headers.get('Content-Type') || '').includes('json') ? await res.json() : null;
  return { status: res.status, data };
}
const boot = async (w, ...users) => { for (const u of users) await call(w, u, 'GET', 'boot'); };
const say = async (w, user, ch, body, extra = {}) => (await call(w, user, 'POST', `channels/${ch}/messages`, { body, ...extra })).data.message;

test('a reply in a thread is counted on Threads and on its parent, and opening the channel does not read it', async () => {
  const w = world();
  await boot(w, ADMIN, ADMIN2, ADMIN3);
  const root = await say(w, ADMIN, GEN, 'who has the banner files?');
  await say(w, ADMIN2, GEN, 'I do', { thread_id: root.id });
  await say(w, ADMIN2, GEN, 'sending now', { thread_id: root.id });

  const b = (await call(w, ADMIN, 'GET', 'boot')).data;
  assert.equal(b.threads_unread, 2);
  assert.equal(b.channels.find((c) => c.id === GEN).mentions, 0, 'a thread reply is not a badge on the channel');
  const hist = (await call(w, ADMIN, 'GET', `channels/${GEN}/messages`)).data;
  assert.equal(hist.messages.find((m) => m.id === root.id).thread_unread, 2);

  // Reading the channel leaves the thread unread.
  await call(w, ADMIN, 'POST', `channels/${GEN}/read`, { upTo: 999999 });
  assert.equal((await call(w, ADMIN, 'GET', 'boot')).data.threads_unread, 2);

  const list = (await call(w, ADMIN, 'GET', 'threads')).data;
  assert.equal(list.unread, 2);
  assert.equal(list.threads.length, 1);
  assert.equal(list.threads[0].root.id, root.id);
  assert.equal(list.threads[0].unread, 2);
  assert.deepEqual(list.threads[0].latest.map((m) => m.body), ['I do', 'sending now']);
  // Cy never touched the thread, so it is not on Cy's list.
  assert.equal((await call(w, ADMIN3, 'GET', 'threads')).data.threads.length, 0);
  // Bo replied in it: on Bo's list, with nothing unread.
  const bo = (await call(w, ADMIN2, 'GET', 'threads')).data;
  assert.equal(bo.threads.length, 1);
  assert.equal(bo.unread, 0);

  // Opening the thread says what was new, then reads it.
  const t = (await call(w, ADMIN, 'GET', `threads/${root.id}`)).data;
  assert.equal(t.unread, 2);
  assert.equal(t.threads_unread, 0);
  assert.equal((await call(w, ADMIN, 'GET', 'threads')).data.unread, 0);
  assert.equal((await call(w, ADMIN, 'GET', `channels/${GEN}/messages`)).data.messages.find((m) => m.id === root.id).thread_unread, undefined);
});

test('threads in a private conversation stay with its members', async () => {
  const w = world();
  await boot(w, ADMIN, ADMIN2, ADMIN3);
  const dm = (await call(w, ADMIN, 'POST', 'conversations', { members: [ADMIN2.email] })).data.channel;
  const root = await say(w, ADMIN, dm.id, 'lunch?');
  await say(w, ADMIN2, dm.id, 'noon', { thread_id: root.id });
  assert.equal((await call(w, ADMIN, 'GET', 'threads')).data.threads.length, 1);
  assert.equal((await call(w, ADMIN3, 'GET', 'threads')).data.threads.length, 0);
  assert.equal((await call(w, ADMIN3, 'GET', `threads/${root.id}`)).status, 403);
});

test('mark unread moves the read pointer back and brings the badge back', async () => {
  const w = world();
  await boot(w, ADMIN, ADMIN2);
  const a = await say(w, ADMIN2, GEN, 'one');
  const b = await say(w, ADMIN2, GEN, `two <@${ADMIN.email}>`);
  await say(w, ADMIN2, GEN, 'three');
  await call(w, ADMIN, 'POST', `channels/${GEN}/read`, { upTo: 999999 });
  let ch = (await call(w, ADMIN, 'GET', 'boot')).data.channels.find((c) => c.id === GEN);
  assert.equal(ch.unread, 0);
  assert.equal(ch.mentions, 0);

  const r = await call(w, ADMIN, 'POST', `channels/${GEN}/unread`, { from: b.id });
  assert.equal(r.status, 200);
  assert.equal(r.data.last_read, b.id - 1);
  assert.equal(r.data.unread, 2);
  assert.equal(r.data.mentions, 1);
  ch = (await call(w, ADMIN, 'GET', 'boot')).data.channels.find((c) => c.id === GEN);
  assert.equal(ch.unread, 2);
  assert.equal(ch.last_read, a.id);
  // A message from another conversation cannot be used.
  const dm = (await call(w, ADMIN2, 'POST', 'conversations', { members: [ADMIN3.email] })).data.channel;
  const other = await say(w, ADMIN2, dm.id, 'elsewhere');
  assert.equal((await call(w, ADMIN, 'POST', `channels/${GEN}/unread`, { from: other.id })).status, 404);
});

test('a reply also sent to the channel shows in both places, tells people once, and is edited and deleted together', async () => {
  const w = world();
  await boot(w, ADMIN, ADMIN2, ADMIN3);
  const root = await say(w, ADMIN, GEN, 'draft of the appeal letter is up');
  w.events.length = 0;
  const reply = await say(w, ADMIN2, GEN, `looks good <@${ADMIN3.email}>`, { thread_id: root.id, also: true });
  assert.equal(reply.thread_id, root.id);
  const sent = reply.attachments.find((x) => x.type === 'sent');
  assert.ok(sent && sent.copy, 'the reply knows its channel copy');

  const hist = (await call(w, ADMIN, 'GET', `channels/${GEN}/messages`)).data.messages;
  const copy = hist.find((m) => m.id === sent.copy);
  assert.ok(copy, 'the copy is a top level message in the channel');
  assert.equal(copy.body, reply.body);
  const ref = copy.attachments.find((x) => x.type === 'threadref');
  assert.equal(ref.root, root.id);
  assert.equal(ref.reply, reply.id);
  assert.match(ref.text, /appeal letter/);
  assert.equal(hist.find((m) => m.id === root.id).reply_count, 1, 'the copy is not a second reply');
  assert.ok(w.events.some((e) => e.event.type === 'message' && e.event.message.id === copy.id), 'the copy is pushed live');

  // Cy was named once: one notice, on the reply.
  const cy = w.d1.db.prepare('SELECT message_id FROM chat_mentions WHERE email = ?').all(ADMIN3.email);
  assert.deepEqual(cy.map((x) => x.message_id), [reply.id]);

  // A reply under the copy lands in the original thread.
  const under = await say(w, ADMIN, GEN, 'thanks', { thread_id: copy.id });
  assert.equal(under.thread_id, root.id);

  // Edit one, both change. Delete one, both go.
  await call(w, ADMIN2, 'PATCH', `messages/${reply.id}`, { body: 'looks great' });
  assert.equal(w.d1.db.prepare('SELECT body FROM chat_messages WHERE id = ?').get(copy.id).body, 'looks great');
  const del = await call(w, ADMIN2, 'DELETE', `messages/${copy.id}`);
  assert.equal(del.data.also, reply.id);
  assert.ok(w.d1.db.prepare('SELECT deleted_at FROM chat_messages WHERE id = ?').get(reply.id).deleted_at);
});

test('mentions and reactions: where I was named, replies to me, and reactions other people left on my messages', async () => {
  const w = world();
  await boot(w, ADMIN, ADMIN2, ADMIN3);
  const mine = await say(w, ADMIN, GEN, 'the report is ready');
  await call(w, ADMIN2, 'POST', `messages/${mine.id}/reactions`, { emoji: '🎉' });
  await call(w, ADMIN, 'POST', `messages/${mine.id}/reactions`, { emoji: '👍' });
  await say(w, ADMIN3, GEN, `nice work <@${ADMIN.email}>`);
  await say(w, ADMIN2, GEN, 'which tab?', { thread_id: mine.id });
  const items = (await call(w, ADMIN, 'GET', 'activity')).data.items;
  assert.deepEqual(items.map((i) => i.kind).sort(), ['mention', 'reaction', 'reply']);
  const rx = items.find((i) => i.kind === 'reaction');
  assert.equal(rx.emoji, '🎉');
  assert.equal(rx.by, ADMIN2.email);
  assert.equal(rx.by_name, 'Bo Builder');
  assert.equal(rx.message.id, mine.id);
  assert.ok(items.find((i) => i.kind === 'mention').unread);
  // My own reaction on my own message is not news.
  assert.equal(items.filter((i) => i.kind === 'reaction').length, 1);
});

test('a skin tone and a flag are reactions; text is not', async () => {
  const w = world();
  await boot(w, ADMIN);
  const m = await say(w, ADMIN, GEN, 'hello');
  assert.equal((await call(w, ADMIN, 'POST', `messages/${m.id}/reactions`, { emoji: '👍🏽' })).status, 200);
  assert.equal((await call(w, ADMIN, 'POST', `messages/${m.id}/reactions`, { emoji: '🇺🇬' })).status, 200);
  assert.equal((await call(w, ADMIN, 'POST', `messages/${m.id}/reactions`, { emoji: 'ok' })).status, 400);
});

test('pins: a member pins and unpins, the count rides on boot, the list shows who pinned', async () => {
  const w = world();
  await boot(w, ADMIN, ADMIN2);
  const m = await say(w, ADMIN, GEN, 'Staff meeting is Tuesday at 9');
  w.events.length = 0;
  const p = await call(w, ADMIN2, 'POST', `messages/${m.id}/pin`, { on: true });
  assert.equal(p.status, 200);
  assert.equal(p.data.pins, 1);
  assert.ok(w.events.some((e) => e.event.type === 'pin' && e.event.on === true && e.event.pins === 1));
  const b = (await call(w, ADMIN, 'GET', 'boot')).data;
  assert.equal(b.features.pins, true);
  assert.equal(b.channels.find((c) => c.id === GEN).pins, 1);
  assert.equal((await call(w, ADMIN, 'GET', `channels/${GEN}/messages`)).data.messages.find((x) => x.id === m.id).pinned, true);
  const list = (await call(w, ADMIN, 'GET', `channels/${GEN}/pins`)).data;
  assert.equal(list.pins.length, 1);
  assert.equal(list.pins[0].pinned_by, ADMIN2.email);
  await call(w, ADMIN, 'POST', `messages/${m.id}/pin`, { on: false });
  assert.equal((await call(w, ADMIN, 'GET', `channels/${GEN}/pins`)).data.pins.length, 0);
});

test('pins: only a member of the conversation, and never a private Brain answer', async () => {
  const w = world();
  await boot(w, ADMIN, ADMIN2, ADMIN3);
  const dm = (await call(w, ADMIN, 'POST', 'conversations', { members: [ADMIN2.email] })).data.channel;
  const m = await say(w, ADMIN, dm.id, 'the door code changed');
  assert.equal((await call(w, ADMIN3, 'POST', `messages/${m.id}/pin`, { on: true })).status, 403);
  assert.equal((await call(w, ADMIN3, 'GET', `channels/${dm.id}/pins`)).status, 403);
  const hidden = w.d1.db.prepare(`INSERT INTO chat_messages (channel_id, email, body, attachments, brain, created_at, visible_to) VALUES (?, 'brain', '', '[]', '{"status":"done","blocks":[]}', '2026-10-11T12:00:00.000Z', ?)`).run(GEN, ADMIN.email);
  assert.equal((await call(w, ADMIN, 'POST', `messages/${hidden.lastInsertRowid}/pin`, { on: true })).status, 404);
});

test('bookmarks: a web address or a FavorOS page, cleaned, listed on boot, removed by a member', async () => {
  const w = world();
  await boot(w, ADMIN, ADMIN2);
  const add = await call(w, ADMIN, 'POST', `channels/${GEN}/bookmarks`, { url: 'docs.google.com/document/d/abc', title: '  Staff   handbook ' });
  assert.equal(add.status, 200);
  assert.equal(add.data.bookmarks[0].url, 'https://docs.google.com/document/d/abc');
  assert.equal(add.data.bookmarks[0].title, 'Staff handbook');
  const page = await call(w, ADMIN2, 'POST', `channels/${GEN}/bookmarks`, { url: '/reports/' });
  assert.equal(page.data.bookmarks[1].title, '/reports/');
  assert.equal((await call(w, ADMIN, 'POST', `channels/${GEN}/bookmarks`, { url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await call(w, ADMIN, 'POST', `channels/${GEN}/bookmarks`, { url: '//evil.example/x' })).data.bookmarks.at(-1).url, 'https://evil.example/x', 'a protocol-relative address is read as a web address, never as a FavorOS page');
  const b = (await call(w, ADMIN, 'GET', 'boot')).data.channels.find((c) => c.id === GEN);
  assert.equal(b.bookmarks.length, 3);
  const rm = await call(w, ADMIN2, 'DELETE', `channels/${GEN}/bookmarks/${add.data.bookmarks[0].id}`);
  assert.equal(rm.data.bookmarks.length, 2);
});

test('without the pins tables Chat works as before: boot says so, reads are empty, writes answer not ready', async () => {
  const w = world({ pins: false });
  await boot(w, ADMIN);
  const b = (await call(w, ADMIN, 'GET', 'boot')).data;
  assert.equal(b.features.pins, false);
  assert.equal(b.channels.find((c) => c.id === GEN).pins, 0);
  const m = await say(w, ADMIN, GEN, 'hello');
  assert.equal((await call(w, ADMIN, 'GET', `channels/${GEN}/messages`)).data.messages[0].pinned, undefined);
  assert.equal((await call(w, ADMIN, 'POST', `messages/${m.id}/pin`, { on: true })).status, 503);
  assert.equal((await call(w, ADMIN, 'POST', `channels/${GEN}/bookmarks`, { url: 'https://favorintl.org' })).status, 503);
  const list = await call(w, ADMIN, 'GET', `channels/${GEN}/pins`);
  assert.equal(list.status, 200);
  assert.equal(list.data.ready, false);
  assert.deepEqual(list.data.pins, []);
});

test('typing in a thread says which thread', async () => {
  const w = world();
  await boot(w, ADMIN, ADMIN2);
  const root = await say(w, ADMIN, GEN, 'root');
  w.events.length = 0;
  await call(w, ADMIN2, 'POST', `channels/${GEN}/typing`, { thread_id: root.id });
  await call(w, ADMIN2, 'POST', `channels/${GEN}/typing`, {});
  assert.equal(w.events[0].event.thread_id, root.id);
  assert.equal(w.events[1].event.thread_id, undefined);
  assert.ok(!w.events[0].audience.includes(ADMIN2.email), 'never sent back to the person typing');
});

test('search can be narrowed to one person', async () => {
  const w = world();
  await boot(w, ADMIN, ADMIN2);
  await say(w, ADMIN, GEN, 'banner proof attached');
  await say(w, ADMIN2, GEN, 'banner looks right');
  assert.equal((await call(w, ADMIN, 'GET', 'search?q=banner')).data.results.length, 2);
  const one = (await call(w, ADMIN, 'GET', `search?q=banner&from=${encodeURIComponent(ADMIN2.email)}`)).data.results;
  assert.equal(one.length, 1);
  assert.equal(one[0].user_id, ADMIN2.email);
});

const brainAnswer = (blocks, more = {}) => async () => new Response(JSON.stringify({ ok: true, blocks, follow: ['Only major partners'], asked_as: 'q', lists: [{ token: 'tok1', label: 'partners' }], ...more }));

test('a Brain answer keeps every block the Brain page draws, how many rows its list has, and the list tokens', async () => {
  const w = world();
  await boot(w, ADMIN);
  const dm = (await call(w, ADMIN, 'POST', 'conversations', { members: [] })).data.channel;
  const blocks = [
    { type: 'tiles', tiles: [{ label: 'Partners', value: 12 }] },
    { type: 'table', title: 'Partners', token: 'tok1', count: 6104, cols: [{ key: 'name', label: 'Partner', type: 'name' }], rows: Array.from({ length: 500 }, (_, i) => ({ name: 'Partner ' + i })), preview: 8 },
    { type: 'choice', q: 'Which one?', opts: [{ label: 'A', ask: 'ask a' }] },
    { type: 'confirm', id: 'cf1', title: 'Refresh', status: 'ready', actions: [{ id: 'approve', label: 'Go' }] },
    { type: 'mystery', x: 1 },
  ];
  await call(w, ADMIN, 'POST', `channels/${dm.id}/messages`, { body: '<@brain> how many partners do we have' }, { fetcher: brainAnswer(blocks) });
  const done = w.events.filter((e) => e.event.type === 'edit').pop().event.message;
  assert.deepEqual(done.brain.blocks.map((b) => b.type), ['tiles', 'table', 'choice', 'confirm']);
  assert.equal(done.brain.blocks[1].rows.length, 8, 'only the preview rows are stored');
  assert.equal(done.brain.blocks[1].count, 6104, 'Show all knows the whole list is longer');
  assert.equal(done.brain.blocks[1].token, 'tok1');
  assert.deepEqual(done.brain.lists, [{ token: 'tok1', title: 'partners' }]);
  assert.equal(done.brain.q, 'how many partners do we have');
});

test('a table that arrives whole still records its length', async () => {
  const { readAnswer } = await import('../functions/_lib/chat/brain.ts');
  const a = readAnswer({ ok: true, blocks: [{ type: 'table', cols: [], rows: Array.from({ length: 20 }, () => ({})), preview: 5 }] });
  assert.equal(a.blocks[0].count, 20);
  assert.equal(a.blocks[0].rows.length, 5);
});

test('a follow-up pressed in a private answer stays private, and carries what kind of answer it asks for', async () => {
  const w = world();
  await boot(w, ADMIN, ADMIN2);
  const asks = [];
  const fetcher = async (url, init) => { asks.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, blocks: [{ type: 'text', md: 'A partner.' }] })); };
  w.events.length = 0;
  const q = await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: '<@brain> Tell me about lookup 50000', private: true, intent: 'partner_lookup' }, { fetcher });
  assert.equal(q.data.message.visible_to, ADMIN.email, 'the question is the asker’s alone');
  assert.equal(asks[0].intent, 'partner_lookup');
  assert.equal(asks[0].question, 'Tell me about lookup 50000');
  // Nothing about it reaches anyone else: no event, no row in their history, no unread.
  for (const e of w.events) assert.deepEqual(e.audience, [ADMIN.email]);
  const bo = (await call(w, ADMIN2, 'GET', `channels/${GEN}/messages`)).data.messages;
  assert.equal(bo.length, 0);
  assert.equal((await call(w, ADMIN2, 'GET', 'boot')).data.channels.find((c) => c.id === GEN).unread, 0);
  // The asker reads both the question and the answer.
  assert.equal((await call(w, ADMIN, 'GET', `channels/${GEN}/messages`)).data.messages.length, 2);
  // An intent that is not a plain word is dropped.
  await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: '<@brain> again', intent: 'x"}; drop' }, { fetcher });
  assert.equal(asks[1].intent, undefined);
  // "private" on a message that is not for the Brain is ignored.
  const plain = await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: 'hello all', private: true });
  assert.equal(plain.data.message.visible_to, null);
});

test('a confirm card pressed in a message goes to the Brain as that person and the card in the message changes for everyone', async () => {
  const w = world();
  await boot(w, ADMIN, ADMIN2);
  const dm = (await call(w, ADMIN, 'POST', 'conversations', { members: [] })).data.channel;
  const card = { type: 'confirm', id: 'cf_9', kind: 'iwave_refresh', title: 'Refresh', status: 'ready', actions: [{ id: 'approve', label: 'Go' }] };
  await call(w, ADMIN, 'POST', `channels/${dm.id}/messages`, { body: '<@brain> refresh' }, { fetcher: brainAnswer([{ type: 'text', md: 'Ready.' }, card]) });
  const msg = w.events.filter((e) => e.event.type === 'edit').pop().event.message;
  const seen = [];
  const fetcher = async (url, init) => { seen.push({ url, body: JSON.parse(init.body), as: init.headers['X-Acting-Email'] }); return new Response(JSON.stringify({ ok: true, blocks: [{ ...card, status: 'done', actions: [] }, { type: 'bogus' }] })); };
  w.events.length = 0;
  const r = await call(w, ADMIN, 'POST', `messages/${msg.id}/confirm`, { bi: 1, action: 'approve' }, { fetcher, env: { BRAIN_URL: 'https://brain.test' } });
  assert.equal(r.status, 200);
  assert.equal(seen[0].url, 'https://brain.test/hub/confirm');
  assert.deepEqual(seen[0].body, { id: 'cf_9', action: 'approve' });
  assert.equal(seen[0].as, ADMIN.email);
  assert.deepEqual(r.data.blocks.map((b) => b.type), ['confirm']);
  assert.equal(r.data.message.brain.blocks[1].status, 'done');
  assert.equal(r.data.message.brain.blocks[0].type, 'text');
  assert.ok(w.events.some((e) => e.event.type === 'edit'));
  // Not a card, a wrong index, a message someone cannot read, a Brain that says no.
  assert.equal((await call(w, ADMIN, 'POST', `messages/${msg.id}/confirm`, { bi: 0, action: 'approve' }, { fetcher })).status, 400);
  assert.equal((await call(w, ADMIN, 'POST', `messages/${msg.id}/confirm`, { bi: 9, action: 'approve' }, { fetcher })).status, 400);
  assert.equal((await call(w, ADMIN2, 'POST', `messages/${msg.id}/confirm`, { bi: 1, action: 'approve' }, { fetcher })).status, 403);
  const no = async () => new Response(JSON.stringify({ ok: false, message: 'Only leadership can approve that.' }), { status: 403 });
  const refused = await call(w, ADMIN, 'POST', `messages/${msg.id}/confirm`, { bi: 1, action: 'approve' }, { fetcher: no });
  assert.equal(refused.status, 403);
  assert.equal(refused.data.message, 'Only leadership can approve that.');
});

test('a request made from Chat goes on the board and its card is posted where it was made', async () => {
  const w = world({ requests: true });
  await boot(w, ADMIN, ADMIN2);
  const r = await call(w, ADMIN, 'POST', `channels/${GEN}/request`, { title: 'Fix the giving page footer', body: 'The phone number is wrong.', surface: 'website' });
  assert.equal(r.status, 200);
  const row = w.d1.db.prepare('SELECT title, body, surface, status, submitter_email, source FROM requests WHERE id = ?').get(r.data.request.id);
  assert.equal(row.title, 'Fix the giving page footer');
  assert.equal(row.status, 'inbox');
  assert.equal(row.submitter_email, ADMIN.email);
  assert.equal(row.source, 'chat');
  const card = r.data.message.attachments[0];
  assert.equal(card.type, 'task');
  assert.equal(card.kind, 'made');
  assert.equal(card.title, 'Fix the giving page footer');
  assert.equal(card.url, `/requests/?r=${r.data.request.id}`);
  // A reply under the card is a comment on the request.
  await say(w, ADMIN2, GEN, 'I can take this one', { thread_id: r.data.message.id });
  const c = w.d1.db.prepare('SELECT body, source FROM request_comments WHERE request_id = ?').all(r.data.request.id);
  assert.deepEqual(c.map((x) => x.body), ['I can take this one']);
  assert.equal(c[0].source, 'chat');
  // No summary, no request. A surface the board does not have is refused.
  assert.equal((await call(w, ADMIN, 'POST', `channels/${GEN}/request`, { title: '   ' })).status, 400);
  assert.equal((await call(w, ADMIN, 'POST', `channels/${GEN}/request`, { title: 'x', surface: 'moon' })).status, 400);
});

test('a request made from a message quotes it, links back to it, and only for a message the person can read', async () => {
  const w = world({ requests: true });
  await boot(w, ADMIN, ADMIN2, ADMIN3);
  const src = await say(w, ADMIN2, GEN, `The banner on the events page still says 2025 <@${ADMIN.email}>`);
  const r = await call(w, ADMIN, 'POST', `channels/${GEN}/request`, { from_message: src.id });
  assert.equal(r.status, 200);
  const row = w.d1.db.prepare('SELECT title, body FROM requests WHERE id = ?').get(r.data.request.id);
  assert.match(row.title, /^The banner on the events page still says 2025/);
  assert.match(row.body, /Bo Builder wrote in Chat:/);
  assert.match(row.body, new RegExp(`/chat/\\?c=${GEN}&m=${src.id}`));
  assert.match(r.data.message.attachments[0].note, /^Bo Builder: The banner/);
  // A message in a conversation the person is not in cannot be turned into a request.
  const dm = (await call(w, ADMIN2, 'POST', 'conversations', { members: [ADMIN3.email] })).data.channel;
  const secret = await say(w, ADMIN2, dm.id, 'private note');
  assert.equal((await call(w, ADMIN, 'POST', `channels/${GEN}/request`, { from_message: secret.id })).status, 404);
  assert.equal((await call(w, ADMIN, 'POST', `channels/${dm.id}/request`, { title: 'x' })).status, 403);
});

test('a link card carries the page’s own picture and site name when it names them', async () => {
  const { readMeta } = await import('../functions/_lib/chat/unfurl.ts');
  const m = readMeta('<head><title>T</title><meta property="og:site_name" content="Example News"><meta property="og:image" content="https://cdn.example.com/a.jpg"></head>');
  assert.equal(m.site, 'Example News');
  assert.equal(m.image, 'https://cdn.example.com/a.jpg');
  assert.equal(readMeta('<title>T</title><meta property="og:image" content="http://insecure.example/a.jpg">').image, '');
  assert.equal(readMeta('<title>T</title><meta property="og:image" content="/relative.jpg">').image, '');
});
