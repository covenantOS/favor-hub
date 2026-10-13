// Chat email: the welcome, the first-message email and the unread follow-up, through the real selection and send code with a
// stand-in database and a mail hook. Made-up people only; nothing leaves the process.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { ADMIN, ADMIN2, ADMIN3, world } from './support/chat-world.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIN = 60 * 1000;

async function setup() {
  const w = world();
  w.d1.exec(read('db/chat-email.sql'));
  w.d1.exec('CREATE TABLE IF NOT EXISTS act_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const mail = [];
  w.env.MAIL_HOOK = (m) => {
    mail.push(m);
    return true;
  };
  const store = await import('../functions/_lib/chat/db.ts');
  const m = await import('../functions/_lib/chat/mail.ts');
  // The first run marks the start an hour in the past, so every message the test posts counts as after the deploy.
  await m.run(w.env, new Date(Date.now() - 60 * MIN));
  return { w, mail, store, m, at: (min) => new Date(Date.now() + min * MIN) };
}

// Reads happen on the real clock while the test moves the run clock forward, so a read is stamped at the moment the test means.
function readAt(w, email, channel, when) {
  w.d1.db.prepare('UPDATE chat_reads SET updated_at = ? WHERE email = ? AND channel_id = ?').run(when.toISOString(), email, channel);
  w.d1.db.prepare('UPDATE chat_mentions SET read_at = ? WHERE email = ? AND channel_id = ? AND read_at IS NOT NULL').run(when.toISOString(), email, channel);
}

const to = (mail, email) => mail.filter((x) => x.to === email);

test('the first run only marks the start: messages written before it are never emailed', async () => {
  const w = world();
  w.d1.exec(read('db/chat-email.sql'));
  const store = await import('../functions/_lib/chat/db.ts');
  const m = await import('../functions/_lib/chat/mail.ts');
  const mail = [];
  w.env.MAIL_HOOK = (x) => (mail.push(x), true);
  const dm = await store.openConversation(w.env, ADMIN.email, [ADMIN2.email]);
  await store.post(w.env, { channel_id: dm.id, email: ADMIN.email, body: 'written before the deploy' });
  const first = await m.run(w.env, new Date(Date.now() + MIN));
  assert.equal(first.note, 'first run');
  assert.equal((await m.run(w.env, new Date(Date.now() + 30 * MIN))).sent, 0);
  assert.equal(mail.length, 0);
});

test('welcome: the first message that notifies a person sends the welcome at once, to the person and not the sender', async () => {
  const { w, mail, store, m, at } = await setup();
  const dm = await store.openConversation(w.env, ADMIN.email, [ADMIN2.email, ADMIN3.email]);
  const posted = await store.post(w.env, { channel_id: dm.id, email: ADMIN.email, body: 'Hey team, welcome to FavorOS.\n\nSee https://dash.favorintl.org/chat/' });
  const r = await m.run(w.env, at(0));
  assert.equal(r.sent, 2, 'Bo and Cy, right now, no ten minute wait');
  assert.equal(to(mail, ADMIN.email).length, 0, 'never the sender');
  const bo = to(mail, ADMIN2.email)[0];
  assert.equal(bo.subject, 'Ada Admin added you to a group chat with Cy Writer in FavorOS');
  assert.ok(bo.html.includes('Bo, you&#39;re in.') || bo.html.includes("Bo, you're in."));
  assert.ok(bo.html.includes('Come join the party.'));
  assert.ok(bo.html.includes(`/chat/?c=${dm.id}&amp;m=${posted.message.id}`), 'the button opens the conversation at the message');
  assert.ok(bo.html.includes('Sign in with your Favor Google account'));
  assert.ok(bo.html.includes('Open the chat'));
  assert.ok(bo.html.includes('href="https://dash.favorintl.org/chat/"'), 'a link in the message is clickable');
  assert.equal(bo.fromName, 'FavorOS Chat');
  assert.ok(!/—/.test(bo.html + bo.text), 'no em dashes');
  assert.ok(!/\bAI\b/.test(bo.html + bo.text), 'no mention of AI');
});

test('welcome: each person gets exactly one, ever, however many runs and conversations follow', async () => {
  const { w, mail, store, m, at } = await setup();
  const dm = await store.openConversation(w.env, ADMIN.email, [ADMIN2.email]);
  await store.post(w.env, { channel_id: dm.id, email: ADMIN.email, body: 'first' });
  await m.run(w.env, at(0));
  await m.run(w.env, at(0));
  await m.run(w.env, at(1));
  assert.equal(to(mail, ADMIN2.email).length, 1);
  const other = await store.openConversation(w.env, ADMIN3.email, [ADMIN2.email]);
  await store.post(w.env, { channel_id: other.id, email: ADMIN3.email, body: 'a different chat' });
  await m.run(w.env, at(2));
  assert.equal(to(mail, ADMIN2.email).filter((x) => x.html.includes("you're in") || x.html.includes('you&#39;re in')).length, 1, 'welcomed once');
  assert.equal(w.d1.db.prepare('SELECT COUNT(*) AS n FROM chat_email_welcome WHERE email = ?').get(ADMIN2.email).n, 1);
});

test('welcome: a mention in a channel says who mentioned you and where', async () => {
  const { w, mail, store, m, at } = await setup();
  const ch = (await store.createChannel(w.env, ADMIN.email, { name: 'care-team' })).id;
  await store.joinChannel(w.env, ADMIN2.email, ch);
  await store.post(w.env, { channel_id: ch, email: ADMIN.email, body: `<@${ADMIN2.email}> can you look at this` });
  await m.run(w.env, at(0));
  const bo = to(mail, ADMIN2.email)[0];
  assert.equal(bo.subject, 'Ada Admin mentioned you in #care-team in FavorOS');
  assert.ok(bo.html.includes('@Bo Builder can you look at this'));
});

test('the Rachel and Michael seed: already welcomed and message 881 counts as emailed', async () => {
  const { w, mail, store, m, at } = await setup();
  const have = w.d1.db.prepare('SELECT email FROM chat_email_welcome ORDER BY email').all().map((x) => x.email);
  assert.deepEqual(have, ['michael@favorintl.org', 'rachel@favorintl.org']);
  assert.equal(w.d1.db.prepare(`SELECT COUNT(*) AS n FROM chat_email_sent WHERE message_id = 881`).get().n, 2);
  for (const e of ['rachel@favorintl.org', 'michael@favorintl.org']) {
    w.d1.db.prepare(`INSERT INTO hub_users (email, name, role, created_at, updated_at) VALUES (?, ?, 'staff', 'x', 'x')`).run(e, e.split('@')[0]);
  }
  // The real group: created by Ada (standing in for Will) before the start, message 881 already sent by hand.
  w.d1.db.prepare(`INSERT INTO chat_channels (id, kind, name, dm_key, created_by, created_at) VALUES ('dm_ed57bbc15ddd', 'group', '', 'k', ?, '2026-10-13T11:48:00.000Z')`).run(ADMIN.email);
  for (const e of [ADMIN.email, 'rachel@favorintl.org', 'michael@favorintl.org']) w.d1.db.prepare(`INSERT INTO chat_members (channel_id, email, joined_at) VALUES ('dm_ed57bbc15ddd', ?, '2026-10-13T11:48:00.000Z')`).run(e);
  w.d1.db.prepare(`INSERT INTO chat_messages (id, channel_id, email, body, created_at) VALUES (881, 'dm_ed57bbc15ddd', ?, 'the welcome', '2026-10-13T11:48:16.000Z')`).run(ADMIN.email);
  const g = { id: 'dm_ed57bbc15ddd' };
  await store.post(w.env, { channel_id: g.id, email: ADMIN.email, body: 'a new message to the group' });
  await m.run(w.env, at(0));
  await m.run(w.env, at(30));
  assert.equal(mail.length, 0, 'no welcome and no follow-up to people who were welcomed by hand and have not read since');
});

test('unread follow-up: one email ten minutes after, covering the last three, then nothing until it is read', async () => {
  const { w, mail, store, m, at } = await setup();
  const dm = await store.openConversation(w.env, ADMIN.email, [ADMIN2.email]);
  await store.post(w.env, { channel_id: dm.id, email: ADMIN.email, body: 'hello' });
  await m.run(w.env, at(0)); // the welcome
  assert.equal(to(mail, ADMIN2.email).length, 1);
  await store.markRead(w.env, ADMIN2.email, dm.id, 1e9); // Bo opens it
  mail.length = 0;
  for (const t of ['one', 'two', 'three', 'four']) await store.post(w.env, { channel_id: dm.id, email: ADMIN.email, body: t });
  assert.equal((await m.run(w.env, at(5))).sent, 0, 'not yet: ten minutes have not passed');
  // Bo read the chat at time 0 (now), so the window of activity ends at ten minutes.
  assert.equal((await m.run(w.env, at(9))).sent, 0, 'Bo was active in the last ten minutes');
  const r = await m.run(w.env, at(12));
  assert.equal(r.sent, 1);
  const x = mail[0];
  assert.equal(x.to, ADMIN2.email);
  assert.equal(x.subject, '4 unread messages in FavorOS from Ada Admin');
  assert.ok(x.html.includes('New messages from Ada Admin'));
  assert.ok(!x.html.includes('>one<') && x.html.includes('two') && x.html.includes('three') && x.html.includes('four'), 'the last three');
  assert.ok(x.html.includes('1 earlier unread message'));
  assert.equal((await m.run(w.env, at(13))).sent, 0, 'never twice for the same messages');
  await store.post(w.env, { channel_id: dm.id, email: ADMIN.email, body: 'five' });
  assert.equal((await m.run(w.env, at(40))).sent, 0, 'nothing more until Bo reads');
  await store.markRead(w.env, ADMIN2.email, dm.id, 1e9);
  readAt(w, ADMIN2.email, dm.id, at(45));
  await store.post(w.env, { channel_id: dm.id, email: ADMIN.email, body: 'six' });
  assert.equal((await m.run(w.env, at(70))).sent, 1, 'after a read, the next unread message emails again');
});

test('who is skipped: muted, already read, active, switched off, blocked, the test user, and the sender', async () => {
  const { w, mail, store, m, at } = await setup();
  const TESTER = 'tester@favorintl.org';
  for (const [e, blocked] of [[TESTER, 0], ['blocked@favorintl.org', 1]]) {
    w.d1.db.prepare(`INSERT INTO hub_users (email, name, role, blocked, created_at, updated_at) VALUES (?, ?, 'admin', ?, 'x', 'x')`).run(e, e, blocked);
  }
  // Everyone is welcomed already so these cases test the follow-up rules.
  for (const e of [ADMIN.email, ADMIN2.email, ADMIN3.email, TESTER, 'blocked@favorintl.org']) w.d1.db.prepare(`INSERT OR IGNORE INTO chat_email_welcome (email, sent_at) VALUES (?, 'x')`).run(e);
  const g = await store.openConversation(w.env, ADMIN.email, [ADMIN2.email, ADMIN3.email, TESTER, 'blocked@favorintl.org']);
  await store.setMuted(w.env, ADMIN2.email, g.id, true);
  await store.post(w.env, { channel_id: g.id, email: ADMIN.email, body: 'status update' });
  await store.markRead(w.env, ADMIN3.email, g.id, 1e9);
  // Cy read it before the window opened: move the read back so only the unread rule matters.
  w.d1.db.prepare(`UPDATE chat_reads SET updated_at = '2000-01-01T00:00:00.000Z' WHERE email = ?`).run(ADMIN3.email);
  const r = await m.run(w.env, at(15));
  assert.equal(r.sent, 0);
  assert.equal(mail.length, 0, 'muted (Bo), read (Cy), tester, blocked, and the sender (Ada) all get nothing');
  // Unmuted, Bo joined the group after the start, so the first message is the start email. Then nothing until Bo reads.
  await store.setMuted(w.env, ADMIN2.email, g.id, false);
  assert.equal((await m.run(w.env, at(16))).sent, 1);
  assert.match(mail[0].subject, /^Ada Admin started a group chat with you/);
  assert.ok(!mail[0].subject.includes('tester') && !mail[0].subject.includes('FavorOS Tester'), 'the test user is never named');
  await store.post(w.env, { channel_id: g.id, email: ADMIN.email, body: 'second update' });
  await m.run(w.env, at(30));
  assert.equal(to(mail, ADMIN2.email).length, 1, 'Bo has not read since the first email, so only the start email went');
  await store.markRead(w.env, ADMIN2.email, g.id, 1e9);
  readAt(w, ADMIN2.email, g.id, at(31));
  await store.post(w.env, { channel_id: g.id, email: ADMIN.email, body: 'third update' });
  mail.length = 0;
  assert.equal((await m.run(w.env, at(60))).sent, 1);
  assert.deepEqual(to(mail, ADMIN2.email).length, 1);
  // The off switch stops every kind.
  await store.markRead(w.env, ADMIN2.email, g.id, 1e9);
  readAt(w, ADMIN2.email, g.id, at(61));
  await m.setChatEmail(w.env, ADMIN2.email, false);
  mail.length = 0;
  await store.post(w.env, { channel_id: g.id, email: ADMIN.email, body: 'fourth update' });
  assert.equal((await m.run(w.env, at(100))).sent, 0, 'the off switch stops every kind');
  assert.equal(mail.length, 0);
});

test('a person who wrote in the conversation in the last ten minutes is not emailed', async () => {
  const { w, mail, store, m, at } = await setup();
  w.d1.db.prepare(`INSERT OR IGNORE INTO chat_email_welcome (email, sent_at) VALUES (?, 'x')`).run(ADMIN2.email);
  const dm = await store.openConversation(w.env, ADMIN.email, [ADMIN2.email]);
  const q = await store.post(w.env, { channel_id: dm.id, email: ADMIN.email, body: 'question' });
  const old = new Date(Date.now() - 30 * MIN).toISOString();
  w.d1.db.prepare('UPDATE chat_messages SET created_at = ? WHERE id = ?').run(old, q.message.id);
  w.d1.db.prepare('UPDATE chat_mentions SET created_at = ? WHERE message_id = ?').run(old, q.message.id);
  await store.post(w.env, { channel_id: dm.id, email: ADMIN2.email, body: 'answering from my phone' });
  await store.post(w.env, { channel_id: dm.id, email: ADMIN.email, body: 'thanks' });
  await m.run(w.env, at(5));
  assert.equal(to(mail, ADMIN2.email).length, 0, 'Bo wrote in the last ten minutes');
});

test('a first message to a member added to a private channel is the start email for a person already welcomed', async () => {
  const { w, mail, store, m, at } = await setup();
  w.d1.db.prepare(`INSERT OR IGNORE INTO chat_email_welcome (email, sent_at) VALUES (?, 'x')`).run(ADMIN2.email);
  const ch = (await store.createChannel(w.env, ADMIN.email, { name: 'board-prep', private: true })).id;
  await store.addMembers(w.env, ADMIN.email, ch, [ADMIN2.email]);
  await store.post(w.env, { channel_id: ch, email: ADMIN.email, body: 'agenda is in the folder' });
  await m.run(w.env, at(0));
  assert.equal(mail.length, 1);
  assert.equal(mail[0].subject, 'Ada Admin wrote in #board-prep, a channel you are in on FavorOS');
  await m.run(w.env, at(15));
  assert.equal(mail.length, 1, 'the unread follow-up does not repeat the first message');
});

test('a long message is cut at 600 characters with a link to the rest, and a clip link shows its poster', async () => {
  const { buildChatMail } = await import('../functions/_lib/chat/email.ts');
  const body = 'word '.repeat(200) + ' https://dash.favorintl.org/c/9e3d6c48e205f5082fe7df6661ed78c4';
  const out = buildChatMail({
    kind: 'welcome',
    to: { name: 'Bo Builder', email: 'bo@favorintl.org' },
    channel: { id: 'dm_x', kind: 'dm', name: '' },
    others: ['Ada Admin'],
    messages: [{ id: 5, who: { name: 'Ada Admin', picture: '' }, body, at: '2026-10-13T11:48:16.000Z' }],
    origin: 'https://dash.favorintl.org',
    off: 'https://dash.favorintl.org/chat-email/off?e=x&t=y',
    now: new Date('2026-10-13T13:00:00Z'),
  });
  assert.ok(out.html.includes('Read the rest in FavorOS'));
  assert.ok(!out.html.includes('word '.repeat(150)), 'the text is cut');
  const clip = buildChatMail({
    kind: 'welcome',
    to: { name: 'Bo Builder', email: 'bo@favorintl.org' },
    channel: { id: 'dm_x', kind: 'dm', name: '' },
    others: ['Ada Admin'],
    messages: [{ id: 5, who: { name: 'Ada Admin' }, body: 'Watch https://dash.favorintl.org/c/9e3d6c48e205f5082fe7df6661ed78c4', at: '2026-10-13T11:48:16.000Z' }],
    origin: 'https://dash.favorintl.org',
    off: 'x',
    now: new Date('2026-10-13T13:00:00Z'),
  });
  assert.ok(clip.html.includes('/api/clips/9e3d6c48e205f5082fe7df6661ed78c4/media?poster=1'));
  assert.ok(clip.html.includes('Today at 7:48 AM'));
});

test('the footer link turns email off only with the right token, and a GET changes nothing', async () => {
  const { w, m } = await setup();
  const link = await m.offLinkFor(w.env, ADMIN2.email);
  const u = new URL(link);
  const e = u.searchParams.get('e');
  const t = u.searchParams.get('t');
  assert.equal(await m.turnOffWithToken(w.env, e, 'wrong'), null);
  assert.equal(await m.chatEmailOn(w.env, ADMIN2.email), true);
  const page = await import('../functions/chat-email/off.ts');
  const get = await page.onRequestGet({ request: new Request(link), env: w.env });
  assert.equal(get.status, 200);
  assert.equal(await m.chatEmailOn(w.env, ADMIN2.email), true, 'opening the link alone turns nothing off');
  const post = await page.onRequestPost({ request: new Request(link, { method: 'POST' }), env: w.env });
  assert.equal(post.status, 200);
  assert.equal(await m.chatEmailOn(w.env, ADMIN2.email), false);
  assert.ok(t.length >= 30);
});
