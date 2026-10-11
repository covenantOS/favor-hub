// Private Favor Brain answers: in a channel or a conversation with anyone else in it, the answer belongs to the asker alone.
// Every read path is checked with a second member who must never see it. Made-up people and figures only.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { ADMIN, ADMIN2, ADMIN3, call, world } from './support/chat-world.mjs';

const GEN = 'ch_general';
const SECRET = 'Zelda Quartz';
const answer = { ok: true, blocks: [{ type: 'text', md: `Top partner this month is ${SECRET}.` }, { type: 'table', cols: ['Partner'], rows: [[SECRET]] }], follow: ['Show more'] };
const fetcher = async () => new Response(JSON.stringify(answer));

/** Ada asks the Brain in a channel (Bo and Cy are in it). Returns the world, the question and the private answer as Ada sees it. */
async function asked({ channel = GEN, threadId = null, kind } = {}) {
  const w = world();
  for (const u of [ADMIN, ADMIN2, ADMIN3]) await call(w, u, 'GET', 'boot');
  let ch = channel;
  if (kind === 'group') ch = (await call(w, ADMIN, 'POST', 'conversations', { members: [ADMIN2.email, ADMIN3.email] })).data.channel.id;
  if (kind === 'dm') ch = (await call(w, ADMIN, 'POST', 'conversations', { members: [ADMIN2.email] })).data.channel.id;
  if (kind === 'self') ch = (await call(w, ADMIN, 'POST', 'conversations', { members: [] })).data.channel.id;
  const q = (await call(w, ADMIN, 'POST', `channels/${ch}/messages`, { body: 'who gave most this month' })).data.message;
  const root = threadId === 'self' ? q.id : null;
  w.events.length = 0;
  const { askInThread } = await import('../functions/_lib/chat/brain.ts');
  await askInThread({ ...w.env, BRAIN_URL: 'https://brain.test' }, { channel_id: ch, root_id: root || q.id, thread_id: root, asker: { email: ADMIN.email, name: 'Ada Admin' }, text: '<@brain> who gave most this month' }, fetcher);
  const mine = (await call(w, ADMIN, 'GET', `channels/${ch}/messages`)).data.messages.find((m) => m.user_id === 'brain' && m.brain);
  return { w, ch, q, mine };
}

const dump = (x) => JSON.stringify(x);

test('in a public channel the answer reaches the asker alone: stored, listed and pushed to one person', async () => {
  const { w, ch, mine } = await asked();
  assert.ok(mine, 'the asker sees the answer in the message list');
  assert.equal(mine.visible_to, ADMIN.email);
  assert.equal(mine.thread_id, null, 'a top level question gets a top level private answer');
  assert.match(dump(mine.brain), /Zelda Quartz/);
  assert.ok(w.events.length >= 2, 'thinking and the answer are pushed');
  for (const e of w.events) assert.deepEqual(e.audience, [ADMIN.email], 'the Durable Object event names the asker only');
  const row = w.d1.db.prepare('SELECT visible_to FROM chat_messages WHERE id = ?').get(mine.id);
  assert.equal(row.visible_to, ADMIN.email);
  const bo = (await call(w, ADMIN2, 'GET', `channels/${ch}/messages`)).data.messages;
  assert.ok(bo.some((m) => m.body.includes('who gave most')), 'the question itself is an ordinary message');
  assert.ok(!bo.some((m) => m.user_id === 'brain'), 'no answer and no placeholder for another member');
  assert.ok(!dump(bo).includes(SECRET));
});

test('a second member never sees it in message lists, threads, search, unread counts, bell or badge', async () => {
  for (const kind of [undefined, 'group']) {
    const { w, ch, q, mine } = await asked({ kind });
    for (const u of [ADMIN2, ADMIN3]) {
      const list = await call(w, u, 'GET', `channels/${ch}/messages`);
      assert.ok(!dump(list.data).includes(SECRET) && !list.data.messages.some((m) => m.id === mine.id));
      const th = await call(w, u, 'GET', `threads/${q.id}`);
      assert.equal(th.data.replies.length, 0);
      assert.equal(th.data.root.reply_count, 0, 'no reply count leaks the answer');
      assert.equal(th.data.root.reply_users.length, 0);
      const direct = await call(w, u, 'GET', `threads/${mine.id}`);
      assert.notEqual(direct.status, 200, 'the private message is no thread root for anyone else');
      for (const f of ['all', 'here', 'files', 'mine']) {
        const s = await call(w, u, 'GET', `search?q=${encodeURIComponent('Quartz')}&filter=${f}&channel=${ch}`);
        assert.equal(s.data.results.length, 0, `search (${f}) finds nothing`);
      }
      const boot = (await call(w, u, 'GET', 'boot')).data;
      const c = boot.channels.find((x) => x.id === ch);
      assert.equal(c.unread, 1, 'only the real question counts as unread');
      assert.equal(c.mentions, 0);
      const inbox = (await call(w, u, 'GET', 'inbox')).data;
      assert.ok(!dump(inbox).includes(SECRET));
      assert.ok(!inbox.items.some((i) => i.id === mine.id));
      assert.equal((await call(w, u, 'POST', `messages/${mine.id}/reactions`, { emoji: '👍' })).status, 404);
      assert.equal((await call(w, u, 'POST', `messages/${mine.id}/share`)).status, 404, 'only the asker can share it');
      assert.equal((await call(w, u, 'POST', `messages/${mine.id}/dismiss`)).status, 404, 'only the asker can dismiss it');
    }
    // The asker still has all of it, including the bell entry.
    const inbox = (await call(w, ADMIN, 'GET', 'inbox')).data;
    assert.ok(inbox.items.some((i) => i.id === mine.id), 'the asker is told when the answer lands');
    assert.equal(inbox.count, 1);
    const s = await call(w, ADMIN, 'GET', `search?q=Quartz`);
    assert.equal(s.status, 200);
  }
});

test('the question asked in a thread keeps its answer in that thread for the asker only', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const root = (await call(w, ADMIN2, 'POST', `channels/${GEN}/messages`, { body: 'topic' })).data.message;
  const reply = (await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: 'asking', thread_id: root.id })).data.message;
  w.events.length = 0;
  const { askInThread } = await import('../functions/_lib/chat/brain.ts');
  await askInThread({ ...w.env, BRAIN_URL: 'https://brain.test' }, { channel_id: GEN, root_id: root.id, thread_id: root.id, asker: { email: ADMIN.email, name: 'Ada' }, text: '@Favor Brain who gave most' }, fetcher);
  assert.equal(reply.thread_id, root.id);
  const mine = (await call(w, ADMIN, 'GET', `threads/${root.id}`)).data;
  assert.equal(mine.replies.filter((m) => m.user_id === 'brain').length, 1);
  assert.equal(mine.root.reply_count, 1, 'the count is the one real reply');
  const bo = (await call(w, ADMIN2, 'GET', `threads/${root.id}`)).data;
  assert.equal(bo.replies.filter((m) => m.user_id === 'brain').length, 0);
  assert.ok(!dump(bo).includes(SECRET));
  const top = (await call(w, ADMIN2, 'GET', `channels/${GEN}/messages`)).data.messages;
  assert.equal(top.find((m) => m.id === root.id).reply_count, 1);
  assert.equal(top.find((m) => m.id === root.id).reply_users.includes('brain'), false);
});

test('a private answer sets off no notification, channel activity or live event for anyone else', async () => {
  const { w, ch } = await asked({ kind: 'dm' });
  const row = w.d1.db.prepare(`SELECT m.* FROM chat_mentions m JOIN chat_messages x ON x.id = m.message_id WHERE m.channel_id = ? AND x.email = 'brain' AND m.email != ?`).all(ch, ADMIN.email);
  assert.equal(row.length, 0, 'Bo has no mention or bell row for the answer');
  const n = w.d1.db.prepare(`SELECT COUNT(*) AS n FROM chat_mentions m JOIN chat_messages x ON x.id = m.message_id WHERE x.visible_to IS NOT NULL AND m.email != ?`).get(ADMIN.email);
  assert.equal(n.n, 0);
  assert.ok(w.events.every((e) => e.audience.length === 1 && e.audience[0] === ADMIN.email), 'every push went to Ada alone');
  assert.ok(!w.events.some((e) => dump(e).includes('bo@favorintl.org')));
});

test('Share to channel posts a normal Brain message labelled with who shared it and removes the private copy', async () => {
  const { w, ch, mine } = await asked();
  w.events.length = 0;
  const r = await call(w, ADMIN, 'POST', `messages/${mine.id}/share`);
  assert.equal(r.status, 200);
  assert.equal(r.data.message.visible_to, null);
  assert.equal(r.data.message.user_id, 'brain');
  assert.equal(r.data.message.brain.shared_by, ADMIN.email);
  assert.equal(r.data.message.brain.status, 'done');
  assert.equal(w.d1.db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE id = ?').get(mine.id).n, 0, 'the private copy is gone');
  const shareEvent = w.events.find((e) => e.event.type === 'message');
  assert.ok(shareEvent.audience.includes(ADMIN2.email) && shareEvent.audience.includes(ADMIN3.email), 'the channel is told');
  for (const u of [ADMIN, ADMIN2, ADMIN3]) {
    const list = (await call(w, u, 'GET', `channels/${ch}/messages`)).data.messages;
    const brain = list.filter((m) => m.user_id === 'brain');
    assert.equal(brain.length, 1, `${u.email} sees one Brain message`);
    assert.equal(brain[0].brain.shared_by, ADMIN.email);
  }
  assert.equal((await call(w, ADMIN, 'POST', `messages/${mine.id}/share`)).status, 404, 'sharing twice does nothing');
});

test('Share keeps a thread answer in its thread, and a thinking answer cannot be shared', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const root = (await call(w, ADMIN2, 'POST', `channels/${GEN}/messages`, { body: 'topic' })).data.message;
  const { askInThread } = await import('../functions/_lib/chat/brain.ts');
  await askInThread({ ...w.env, BRAIN_URL: 'https://brain.test' }, { channel_id: GEN, root_id: root.id, thread_id: root.id, asker: { email: ADMIN.email, name: 'Ada' }, text: '@Favor Brain who gave most' }, fetcher);
  const priv = (await call(w, ADMIN, 'GET', `threads/${root.id}`)).data.replies.find((m) => m.user_id === 'brain');
  const shared = await call(w, ADMIN, 'POST', `messages/${priv.id}/share`);
  assert.equal(shared.data.message.thread_id, root.id);
  const bo = (await call(w, ADMIN2, 'GET', `threads/${root.id}`)).data;
  assert.equal(bo.replies.filter((m) => m.user_id === 'brain').length, 1);
  assert.equal(bo.root.reply_count, 1);
  // A placeholder that is still thinking is not shareable.
  const { store } = { store: await import('../functions/_lib/chat/db.ts') };
  const thinking = await store.post(w.env, { channel_id: GEN, email: 'brain', body: '', brain: { status: 'thinking' }, visible_to: ADMIN.email });
  assert.equal((await call(w, ADMIN, 'POST', `messages/${thinking.message.id}/share`)).status, 400);
});

test('Dismiss removes the private answer for the asker and tells nobody else', async () => {
  const { w, ch, mine } = await asked();
  w.events.length = 0;
  const r = await call(w, ADMIN, 'POST', `messages/${mine.id}/dismiss`);
  assert.equal(r.status, 200);
  assert.equal(w.d1.db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE id = ?').get(mine.id).n, 0);
  assert.equal(w.d1.db.prepare('SELECT COUNT(*) AS n FROM chat_mentions WHERE message_id = ?').get(mine.id).n, 0);
  assert.ok(w.events.every((e) => e.audience.length === 1 && e.audience[0] === ADMIN.email));
  assert.ok(!(await call(w, ADMIN, 'GET', `channels/${ch}/messages`)).data.messages.some((m) => m.user_id === 'brain'));
  assert.equal((await call(w, ADMIN, 'POST', `messages/${mine.id}/dismiss`)).status, 404);
  assert.equal((await call(w, ADMIN, 'GET', 'inbox')).data.count, 0);
});

test('in a conversation with only the asker the answer stays a normal thread reply', async () => {
  const { w, ch, q } = await asked({ kind: 'self', threadId: 'self' });
  const t = (await call(w, ADMIN, 'GET', `threads/${q.id}`)).data;
  const a = t.replies.find((m) => m.user_id === 'brain');
  assert.ok(a, 'the answer is in the thread');
  assert.equal(a.visible_to, null);
  assert.equal(w.d1.db.prepare('SELECT visible_to FROM chat_messages WHERE id = ?').get(a.id).visible_to, null);
  assert.ok(ch);
});

test('in a two person conversation the other person does not see the answer', async () => {
  const { w, ch, mine } = await asked({ kind: 'dm' });
  assert.equal(mine.visible_to, ADMIN.email);
  const bo = await call(w, ADMIN2, 'GET', `channels/${ch}/messages`);
  assert.ok(!dump(bo.data).includes(SECRET));
  assert.equal(bo.data.messages.filter((m) => m.user_id === 'brain').length, 0);
});

test('a message another person cannot see is also gone from the bell count on the hub home', async () => {
  const { w, mine } = await asked();
  const { unreadMentionCount } = await import('../functions/_lib/chat/db.ts');
  assert.equal(await unreadMentionCount(w.env, ADMIN2.email), 0);
  assert.equal(await unreadMentionCount(w.env, ADMIN.email), 1);
  await call(w, ADMIN, 'POST', `messages/${mine.id}/dismiss`);
  assert.equal(await unreadMentionCount(w.env, ADMIN.email), 0);
});

test('a private failure line is searchable by the asker only', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const { askInThread } = await import('../functions/_lib/chat/brain.ts');
  const boom = async () => { throw new Error('network'); };
  await askInThread({ ...w.env }, { channel_id: GEN, root_id: 1, thread_id: null, asker: { email: ADMIN.email, name: 'Ada' }, text: '@Favor Brain hello' }, boom);
  for (const f of ['all', 'here']) {
    const mine = await call(w, ADMIN, 'GET', `search?q=did%20not%20answer&filter=${f}&channel=${GEN}`);
    assert.equal(mine.data.results.length, 1, 'the asker finds it');
    const bo = await call(w, ADMIN2, 'GET', `search?q=did%20not%20answer&filter=${f}&channel=${GEN}`);
    assert.equal(bo.data.results.length, 0, 'another member does not');
  }
});
