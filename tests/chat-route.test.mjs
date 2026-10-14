// Favor Chat through its router with a stand-in database, room and bucket: who may use it, who may read what, posting, threads,
// mentions and the bell, reactions, edits, search, uploads, clips, meetings and the Favor Brain. Made-up people only; the live
// database is never touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { ADMIN, ADMIN2, ADMIN3, STAFF, call, world } from './support/chat-world.mjs';

const GEN = 'ch_general';

test('a signed-out request is 401, a staff member 403, an admin gets in', async () => {
  const w = world();
  assert.equal((await call(w, null, 'GET', 'boot')).status, 401);
  assert.equal((await call(w, STAFF, 'GET', 'boot')).status, 403);
  const ok = await call(w, ADMIN, 'GET', 'boot');
  assert.equal(ok.status, 200);
  assert.equal(ok.data.me.id, ADMIN.email);
});

test('the agent key and the script password session cannot chat', async () => {
  const w = world();
  const agent = { email: 'agent', name: 'Agent', role: 'admin', via: 'agent', kpi: true };
  assert.equal((await call(w, agent, 'GET', 'boot')).status, 403);
});

test('the setting opens Chat to staff, or switches it off for admins too', async () => {
  const staff = world({ mode: 'staff' });
  assert.equal((await call(staff, STAFF, 'GET', 'boot')).status, 200);
  const off = world({ mode: 'off' });
  assert.equal((await call(off, ADMIN, 'GET', 'boot')).status, 403);
});

test('boot seeds #general and #hub-feedback for every admin and lists only admins', async () => {
  const w = world();
  const b = (await call(w, ADMIN, 'GET', 'boot')).data;
  assert.deepEqual(b.channels.map((c) => c.name).sort(), ['general', 'hub-feedback']);
  assert.ok(b.users[ADMIN2.email]);
  assert.equal(b.users[STAFF.email], undefined, 'a staff account is not in the admin directory');
  assert.equal(b.users[ADMIN.email].presence, 'online', 'the room says who is connected');
});

test('private channels: only members read, post, search or react', async () => {
  const w = world();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  const made = await call(w, ADMIN, 'POST', 'channels', { name: 'Care Team', private: true, topic: 'private' });
  assert.equal(made.status, 200);
  const id = made.data.channel.id;
  assert.equal(made.data.channel.name, 'care-team');
  const sent = await call(w, ADMIN, 'POST', `channels/${id}/messages`, { body: 'secret salmon plan' });
  assert.equal(sent.status, 200);
  const mid = sent.data.message.id;
  // Bo is an admin but not a member.
  assert.equal((await call(w, ADMIN2, 'GET', `channels/${id}/messages`)).status, 403);
  assert.equal((await call(w, ADMIN2, 'POST', `channels/${id}/messages`, { body: 'hello' })).status, 403);
  assert.equal((await call(w, ADMIN2, 'GET', `threads/${mid}`)).status, 403);
  assert.equal((await call(w, ADMIN2, 'POST', `messages/${mid}/reactions`, { emoji: '👍' })).status, 403);
  assert.equal((await call(w, ADMIN2, 'POST', `channels/${id}/join`)).status, 404, 'joining is for public channels');
  const hit = await call(w, ADMIN2, 'GET', 'search?q=salmon');
  assert.equal(hit.data.results.length, 0, 'search never leaks a private channel');
  const mine = await call(w, ADMIN, 'GET', 'search?q=salmon');
  assert.equal(mine.data.results.length, 1);
  // Adding Bo opens it.
  await call(w, ADMIN, 'POST', `channels/${id}/members`, { emails: [ADMIN2.email] });
  assert.equal((await call(w, ADMIN2, 'GET', `channels/${id}/messages`)).status, 200);
});

test('direct messages: the same people always land in the same conversation, outsiders cannot read it', async () => {
  const w = world();
  const a = (await call(w, ADMIN, 'POST', 'conversations', { members: [ADMIN2.email] })).data.channel;
  const b = (await call(w, ADMIN2, 'POST', 'conversations', { members: [ADMIN.email] })).data.channel;
  assert.equal(a.id, b.id);
  assert.equal(a.kind, 'dm');
  assert.equal((await call(w, ADMIN3, 'GET', `channels/${a.id}/messages`)).status, 403);
  const g = (await call(w, ADMIN, 'POST', 'conversations', { members: [ADMIN2.email, ADMIN3.email] })).data.channel;
  assert.equal(g.kind, 'group');
  assert.equal(g.members.length, 3);
  // Someone who is not in the directory cannot be pulled in by email.
  const odd = (await call(w, ADMIN, 'POST', 'conversations', { members: ['stranger@example.com'] })).data.channel;
  assert.deepEqual(odd.members, [ADMIN.email], 'a stranger is dropped; the conversation is with yourself');
});

test('a message in a direct message notifies the other person and the badge counts it', async () => {
  const w = world();
  const dm = (await call(w, ADMIN, 'POST', 'conversations', { members: [ADMIN2.email] })).data.channel;
  await call(w, ADMIN2, 'GET', 'boot');
  await call(w, ADMIN, 'POST', `channels/${dm.id}/messages`, { body: 'ping' });
  const inbox = (await call(w, ADMIN2, 'GET', 'inbox')).data;
  assert.equal(inbox.count, 1);
  assert.equal(inbox.items[0].kind, 'dm');
  const boot = (await call(w, ADMIN2, 'GET', 'boot')).data;
  const mine = boot.channels.find((c) => c.id === dm.id);
  assert.equal(mine.unread, 1);
  assert.equal(mine.mentions, 1);
  await call(w, ADMIN2, 'POST', `channels/${dm.id}/read`, { upTo: 999999 });
  const after = (await call(w, ADMIN2, 'GET', 'boot')).data.channels.find((c) => c.id === dm.id);
  assert.equal(after.unread, 0);
  assert.equal(after.mentions, 0);
  assert.equal((await call(w, ADMIN2, 'GET', 'inbox')).data.count, 0);
});

test('mentions reach the bell; @channel reaches everyone; a muted channel keeps the quiet except for a direct mention', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2, ADMIN3]) await call(w, u, 'GET', 'boot');
  await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: `hello <@${ADMIN2.email}>` });
  assert.equal((await call(w, ADMIN2, 'GET', 'inbox')).data.count, 1);
  assert.equal((await call(w, ADMIN3, 'GET', 'inbox')).data.count, 0);
  await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: 'all hands <@channel>' });
  assert.equal((await call(w, ADMIN3, 'GET', 'inbox')).data.count, 1);
  assert.equal((await call(w, ADMIN, 'GET', 'inbox')).data.count, 0, 'you never notify yourself');
  await call(w, ADMIN3, 'POST', `channels/${GEN}/mute`, { muted: true });
  await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: 'another <@channel>' });
  assert.equal((await call(w, ADMIN3, 'GET', 'inbox')).data.count, 1, 'a muted channel adds nothing for @channel');
  await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: `direct <@${ADMIN3.email}>` });
  assert.equal((await call(w, ADMIN3, 'GET', 'inbox')).data.count, 2, 'naming someone still reaches them');
  const clear = await call(w, ADMIN3, 'POST', 'inbox/read', {});
  assert.equal(clear.data.count, 0);
});

test('threads: replies count, the thread author is told, and a thread opens for members only', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const root = (await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: 'question' })).data.message;
  const reply = await call(w, ADMIN2, 'POST', `channels/${GEN}/messages`, { body: 'answer', thread_id: root.id });
  assert.equal(reply.status, 200);
  assert.equal(reply.data.message.thread_id, root.id);
  const page = (await call(w, ADMIN, 'GET', `channels/${GEN}/messages`)).data.messages;
  assert.equal(page.length, 1, 'replies stay out of the channel line');
  assert.equal(page[0].reply_count, 1);
  assert.deepEqual(page[0].reply_users, [ADMIN2.email]);
  const inbox = (await call(w, ADMIN, 'GET', 'inbox')).data;
  assert.equal(inbox.items[0].kind, 'reply');
  const t = (await call(w, ADMIN, 'GET', `threads/${root.id}`)).data;
  assert.equal(t.replies.length, 1);
  assert.equal((await call(w, ADMIN, 'GET', 'inbox')).data.count, 0, 'opening the thread reads its replies');
  // A reply to a reply is refused: threads are one deep.
  assert.equal((await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: 'deeper', thread_id: reply.data.message.id })).status, 404);
});

test('edit and delete are the author’s own; deleting blanks the message and keeps the thread count', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const m = (await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: 'first draft' })).data.message;
  assert.equal((await call(w, ADMIN2, 'PATCH', `messages/${m.id}`, { body: 'hijack' })).status, 403);
  assert.equal((await call(w, ADMIN2, 'DELETE', `messages/${m.id}`)).status, 403);
  const e = await call(w, ADMIN, 'PATCH', `messages/${m.id}`, { body: 'second draft' });
  assert.equal(e.data.message.body, 'second draft');
  assert.ok(e.data.message.edited_at);
  assert.equal((await call(w, ADMIN, 'PATCH', `messages/${m.id}`, { body: '   ' })).status, 400);
  assert.equal((await call(w, ADMIN, 'DELETE', `messages/${m.id}`)).status, 200);
  const list = (await call(w, ADMIN, 'GET', `channels/${GEN}/messages`)).data.messages;
  assert.equal(list[0].deleted, true);
  assert.equal(list[0].body, '');
  assert.equal((await call(w, ADMIN, 'DELETE', `messages/${m.id}`)).status, 404);
});

test('reactions toggle per person and cap at twenty kinds', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const m = (await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: 'react to me' })).data.message;
  await call(w, ADMIN, 'POST', `messages/${m.id}/reactions`, { emoji: '👍' });
  const two = await call(w, ADMIN2, 'POST', `messages/${m.id}/reactions`, { emoji: '👍' });
  assert.deepEqual(two.data.reactions, [{ emoji: '👍', users: [ADMIN.email, ADMIN2.email] }]);
  const off = await call(w, ADMIN, 'POST', `messages/${m.id}/reactions`, { emoji: '👍' });
  assert.deepEqual(off.data.reactions, [{ emoji: '👍', users: [ADMIN2.email] }]);
  assert.equal((await call(w, ADMIN, 'POST', `messages/${m.id}/reactions`, { emoji: 'nope' })).status, 400);
});

test('every post and edit is pushed to the members, and only the members', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2, ADMIN3]) await call(w, u, 'GET', 'boot');
  const priv = (await call(w, ADMIN, 'POST', 'channels', { name: 'two-of-us', private: true })).data.channel;
  await call(w, ADMIN, 'POST', `channels/${priv.id}/members`, { emails: [ADMIN2.email] });
  w.events.length = 0;
  await call(w, ADMIN, 'POST', `channels/${priv.id}/messages`, { body: 'hello' });
  const msg = w.events.find((e) => e.event.type === 'message');
  assert.deepEqual([...msg.audience].sort(), [ADMIN.email, ADMIN2.email].sort());
  assert.ok(!msg.audience.includes(ADMIN3.email));
  w.events.length = 0;
  await call(w, ADMIN, 'POST', `channels/${priv.id}/typing`);
  assert.deepEqual(w.events[0].audience, [ADMIN2.email], 'typing goes to the others, not back to the typist');
});

test('search finds messages in public channels and conversations you are in, with filters', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: 'The banquet is on March 14' });
  await call(w, ADMIN, 'POST', `channels/ch_hub_feedback/messages`, { body: 'banquet search finds nothing', attachments: [] });
  const dm = (await call(w, ADMIN, 'POST', 'conversations', { members: [ADMIN3.email] })).data.channel;
  await call(w, ADMIN, 'POST', `channels/${dm.id}/messages`, { body: 'banquet gossip' });
  const all = (await call(w, ADMIN, 'GET', 'search?q=banquet')).data.results;
  assert.equal(all.length, 3);
  const bo = (await call(w, ADMIN2, 'GET', 'search?q=banquet')).data.results;
  assert.equal(bo.length, 2, 'Bo is not in the direct message');
  const here = (await call(w, ADMIN, 'GET', `search?q=banquet&filter=here&channel=${GEN}`)).data.results;
  assert.equal(here.length, 1);
  assert.equal(here[0].channel_name, 'general');
  assert.equal((await call(w, ADMIN, 'GET', 'search?q=b')).data.results.length, 0, 'one letter searches nothing');
  assert.equal((await call(w, ADMIN, 'GET', 'search?q=100%25_%5C')).data.results.length, 0, 'wildcards are plain characters');
});

test('files upload to the bucket, post as a card and download with safe headers', async () => {
  const w = world();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  const up = await call(w, ADMIN, 'POST', 'upload', undefined, { raw: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), headers: { 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('pic one.png') } });
  assert.equal(up.status, 200);
  assert.equal(up.data.name, 'pic one.png');
  const sent = await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: '', attachments: [{ type: 'file', id: up.data.id, url: 'https://evil.example/x', name: 'forged' }] });
  const att = sent.data.message.attachments[0];
  assert.equal(att.name, 'pic one.png', 'the server fills the card from its own record');
  assert.equal(att.url, `/api/chat/file/${up.data.id}`, 'a forged address is replaced');
  const got = await call(w, ADMIN2, 'GET', `file/${up.data.id}`);
  assert.equal(got.res.headers.get('Content-Type'), 'image/png');
  assert.equal(got.res.headers.get('X-Content-Type-Options'), 'nosniff');
  // Another person cannot attach someone else's upload.
  const stolen = await call(w, ADMIN2, 'POST', `channels/${GEN}/messages`, { body: 'mine now', attachments: [{ type: 'file', id: up.data.id }] });
  assert.deepEqual(stolen.data.message.attachments, []);
  // A script or html file never renders inline.
  const html = await call(w, ADMIN, 'POST', 'upload', undefined, { raw: '<script>alert(1)</script>', headers: { 'Content-Type': 'text/html', 'X-File-Name': 'x.html' } });
  const served = await call(w, ADMIN, 'GET', `file/${html.data.id}`);
  assert.equal(served.res.headers.get('Content-Type'), 'application/octet-stream');
  assert.match(served.res.headers.get('Content-Disposition'), /^attachment/);
  assert.equal((await call(w, ADMIN, 'GET', 'file/not-a-real-id')).status, 404);
  const big = await call(w, ADMIN, 'POST', 'upload', undefined, { raw: 'x', headers: { 'Content-Length': String(30 * 1024 * 1024), 'X-File-Name': 'big.bin' } });
  assert.equal(big.status, 413);
});

test('Drive cards keep only Google addresses; link text for a hub clip becomes a clip card', async () => {
  const w = world();
  await call(w, ADMIN, 'GET', 'boot');
  w.d1.db.prepare("INSERT INTO hub_clips (id, owner_email, owner_name, title, summary, status, mime, created_at, updated_at, duration_ms, has_poster) VALUES (?, ?, ?, ?, ?, 'ready', 'video/webm', ?, ?, 134000, 1)")
    .run('c'.repeat(32), ADMIN.email, 'Ada Admin', 'Giving page copy review', 'Walkthrough of the new copy', '2026-10-11T10:00:00Z', '2026-10-11T10:00:00Z');
  const drive = await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: 'file', attachments: [
    { type: 'drive', name: 'Q4 Grants', kind: 'sheet', path: 'US Team Files / Grants', url: 'https://docs.google.com/spreadsheets/d/abc' },
    { type: 'drive', name: 'Bad', url: 'https://evil.example/x' },
  ] });
  assert.equal(drive.data.message.attachments.length, 1);
  assert.equal(drive.data.message.attachments[0].kind, 'sheet');
  const clip = await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: `watch https://dash.favorintl.org/c/${'c'.repeat(32)} please` });
  const card = clip.data.message.attachments[0];
  assert.equal(card.type, 'clip');
  assert.equal(card.title, 'Giving page copy review');
  assert.equal(card.duration, '2:14');
  assert.equal(card.thumb, `/api/clips/${'c'.repeat(32)}/poster`);
  const picker = (await call(w, ADMIN, 'GET', 'clips')).data.clips;
  assert.equal(picker.length, 1);
  assert.equal((await call(w, ADMIN2, 'GET', 'clips')).data.clips.length, 0, 'the picker lists your own clips');
});

test('the Drive picker asks the Brain as the person and keeps Google links', async () => {
  const { driveSearch } = await import('../functions/_lib/chat/route.ts');
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ files: [
      { name: 'Run of Show', type: 'Google Doc', owner: 'Cy', modified: '2026-10-08', folder: 'Events', link: 'https://docs.google.com/document/d/x' },
      { name: 'Elsewhere', type: 'PDF', link: 'https://example.com/a.pdf' },
    ] }));
  };
  const out = await driveSearch({ BRAIN_HUB_KEY: 'k' }, ADMIN, 'banquet', fetcher);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'doc');
  assert.equal(seen[0].init.headers['X-Acting-Email'], ADMIN.email);
  assert.deepEqual(await driveSearch({ BRAIN_HUB_KEY: 'k' }, ADMIN, 'a', fetcher), [], 'one letter searches nothing');
});

test('the meeting button opens one meeting per channel: a second press joins it, a stale one is ended and replaced', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const first = await call(w, ADMIN, 'POST', `channels/${GEN}/meeting`);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.joined, false);
  const id = first.data.message.attachments[0].id;
  assert.equal(first.data.url, `/meet/room/?m=${id}`);
  assert.equal(first.data.id, id);
  const again = await call(w, ADMIN2, 'POST', `channels/${GEN}/meeting`);
  assert.equal(again.data.joined, true, 'a second press joins the open meeting');
  assert.equal(again.data.url, `/meet/room/?m=${id}`);
  assert.equal(again.data.message, undefined, 'no second card');
  assert.equal(w.d1.db.prepare('SELECT COUNT(*) AS n FROM chat_meetings').get().n, 1);
  // A minute on with nobody in the room: the card reads ended, and the next press ends it and starts a new one.
  w.d1.db.prepare("UPDATE hub_meetings SET created_at = '2026-01-01T00:00:00Z' WHERE id = ?").run(id);
  const later = await call(w, ADMIN, 'POST', `channels/${GEN}/meeting`);
  assert.equal(later.data.joined, false);
  assert.notEqual(later.data.message.attachments[0].id, id);
  assert.equal(w.d1.db.prepare('SELECT status FROM hub_meetings WHERE id = ?').get(id).status, 'ended');
});

test('the huddle bar: who is in the room comes from heartbeats, and a room everyone left reads ended within 20 seconds', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  assert.equal((await call(w, ADMIN, 'GET', `channels/${GEN}/huddle`)).data.huddle, null, 'no huddle yet');
  w.events.length = 0;
  const first = await call(w, ADMIN, 'POST', `channels/${GEN}/meeting`);
  const id = first.data.id;
  const news = w.events.find((e) => e.event.type === 'huddle');
  assert.ok(news, 'starting a huddle tells the channel');
  assert.equal(news.event.huddle.id, id);
  assert.match(w.d1.db.prepare('SELECT title FROM hub_meetings WHERE id = ?').get(id).title, /^Huddle in #general$/);
  // Two people in the room, one of them on two devices: two faces.
  const now = Date.now();
  const add = (pid, email, name, seen) => w.d1.db.prepare("INSERT INTO hub_meeting_presence (meeting_id, pid, email, name, role, session_id, tracks, mic, cam, joined_at, seen) VALUES (?, ?, ?, ?, 'staff', 's', '[]', 1, 0, ?, ?)").run(id, pid, email, name, now - 5000, seen);
  w.d1.db.prepare('UPDATE hub_meetings SET started_at = ? WHERE id = ?').run(new Date(now - 5000).toISOString(), id);
  add('aaaaaaaaaaaa', ADMIN.email, 'Ann Admin', now);
  add('bbbbbbbbbbbb', ADMIN2.email, 'Bo', now);
  add('cccccccccccc', ADMIN2.email, 'Bo', now);
  const live = (await call(w, ADMIN2, 'GET', `channels/${GEN}/huddle`)).data.huddle;
  assert.equal(live.id, id);
  assert.equal(live.live, true);
  assert.equal(live.people.length, 2, 'one face per person');
  const card = (await call(w, ADMIN2, 'GET', `channels/${GEN}/messages`)).data.messages.find((m) => m.attachments && m.attachments[0] && m.attachments[0].type === 'meeting').attachments[0];
  assert.equal(card.status, 'live');
  assert.equal(card.count, 2);
  // Everyone closed the tab without pressing Leave: 21 seconds after the last heartbeat nobody is in the room.
  w.d1.db.prepare('UPDATE hub_meeting_presence SET seen = ? WHERE meeting_id = ?').run(now - 21_000, id);
  const card2 = (await call(w, ADMIN2, 'GET', `channels/${GEN}/messages`)).data.messages.find((m) => m.attachments && m.attachments[0] && m.attachments[0].type === 'meeting').attachments[0];
  assert.equal(card2.status, 'ended', 'the card stops reading Live now');
  assert.equal(card2.count, 0);
  assert.equal((await call(w, ADMIN, 'GET', `channels/${GEN}/huddle`)).data.huddle, null, 'the bar goes away');
  assert.equal(w.d1.db.prepare('SELECT status FROM hub_meetings WHERE id = ?').get(id).status, 'ended', 'and the empty room is closed');
});

test('a meeting started from a channel posts a Join card; ending it and its notes post back', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const started = await call(w, ADMIN, 'POST', `channels/${GEN}/meeting`);
  assert.equal(started.status, 200, JSON.stringify(started.data));
  const card = started.data.message.attachments[0];
  assert.equal(card.type, 'meeting');
  assert.equal(card.status, 'live');
  assert.match(card.url, /^\/meet\/room\/\?m=[0-9a-f]{24}$/);
  const row = w.d1.db.prepare('SELECT * FROM hub_meetings WHERE id = ?').get(card.id);
  assert.equal(row.access, 'invited', 'a huddle is invited-only, public channels included (2026-10-14)');
  assert.equal(w.d1.db.prepare('SELECT COUNT(*) AS n FROM chat_meetings').get().n, 1);
  // The meeting ends: the card refreshes.
  const { chatMeetingEnded, chatNotesReady } = await import('../functions/_lib/chat/meet.ts');
  w.d1.db.prepare("UPDATE hub_meetings SET status = 'ended', started_at = '2026-10-11T10:00:00Z', ended_at = '2026-10-11T10:30:00Z' WHERE id = ?").run(card.id);
  w.events.length = 0;
  await chatMeetingEnded(w.env, card.id);
  const edit = w.events.find((e) => e.event.type === 'edit');
  assert.equal(edit.event.message.attachments[0].status, 'ended');
  assert.equal(edit.event.message.attachments[0].duration, '30 min');
  // The notes are ready: a summary lands in the card's thread, once.
  w.d1.db.prepare("UPDATE hub_meetings SET notes_status = 'ready', summary = 'We agreed the date.', notes_json = ? WHERE id = ?")
    .run(JSON.stringify({ actions: [{ owner: 'Bo', text: 'Book the room' }] }), card.id);
  w.events.length = 0;
  await chatNotesReady(w.env, card.id);
  await chatNotesReady(w.env, card.id);
  const posted = w.events.filter((e) => e.event.type === 'message');
  assert.equal(posted.length, 1, 'notes post once');
  const m = posted[0].event.message;
  assert.equal(m.user_id, 'meetings');
  assert.equal(m.thread_id, started.data.message.id);
  // A public channel is readable by all staff, so the notes themselves stay on the notes page (privacy pass 2026-10-14).
  assert.equal(m.body, 'Notes are ready for Huddle in #general.');
  assert.doesNotMatch(m.body, /We agreed the date|Book the room/);
  assert.equal((await call(w, ADMIN, 'GET', 'inbox')).data.items.filter((i) => i.kind === 'reply').length, 1, 'the person who started it is told');
  const t = (await call(w, ADMIN, 'GET', `threads/${started.data.message.id}`)).data;
  assert.equal(t.root.attachments[0].notes, true);
});

test('a private channel meeting is invitation only, and nobody gets an email', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const priv = (await call(w, ADMIN, 'POST', 'channels', { name: 'closed-door', private: true })).data.channel;
  await call(w, ADMIN, 'POST', `channels/${priv.id}/members`, { emails: [ADMIN2.email] });
  const r = await call(w, ADMIN, 'POST', `channels/${priv.id}/meeting`);
  const row = w.d1.db.prepare('SELECT access, invitees FROM hub_meetings WHERE id = ?').get(r.data.message.attachments[0].id);
  assert.equal(row.access, 'invited');
  assert.match(row.invitees, /bo@favorintl\.org/);
  assert.equal((await call(w, ADMIN3, 'POST', `channels/${priv.id}/meeting`)).status, 403);
});

test('@Favor Brain in a conversation with only the asker posts a thinking message, asks as the sender, and fills in the answer blocks', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const GEN = (await call(w, ADMIN2, 'POST', 'conversations', { members: [] })).data.channel.id;
  const asks = [];
  const answer = { ok: true, blocks: [
    { type: 'tiles', items: [{ label: 'Gifts', value: '12' }] },
    { type: 'choice', q: 'which?' },
    { type: 'table', cols: ['a'], rows: Array.from({ length: 20 }, (_, i) => [i]), preview: 3 },
  ], follow: ['Show more', 7] };
  const fetcher = async (url, init) => { asks.push({ url, init, body: JSON.parse(init.body) }); return new Response(JSON.stringify(answer)); };
  const { askInThread } = await import('../functions/_lib/chat/brain.ts');
  const root = (await call(w, ADMIN2, 'POST', `channels/${GEN}/messages`, { body: 'how many gifts today?' })).data.message;
  w.events.length = 0;
  await askInThread({ ...w.env, BRAIN_URL: 'https://brain.test' }, { channel_id: GEN, root_id: root.id, asker: { email: ADMIN2.email, name: 'Bo Builder' }, text: '<@brain> how many gifts today?' }, fetcher);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].url, 'https://brain.test/hub/ask');
  assert.equal(asks[0].init.headers['X-Acting-Email'], ADMIN2.email, 'the Brain applies the asker’s own access');
  assert.equal(asks[0].body.question, 'how many gifts today?');
  assert.deepEqual(w.events.map((e) => e.event.type), ['message', 'edit']);
  assert.deepEqual(w.events[0].event.message.brain, { status: 'thinking' });
  const done = w.events[1].event.message;
  assert.equal(done.user_id, 'brain');
  assert.equal(done.thread_id, root.id);
  assert.deepEqual(done.brain.blocks.map((b) => b.type), ['tiles', 'choice', 'table'], 'every block the Brain page draws is kept');
  assert.equal(done.brain.blocks[2].rows.length, 3);
  assert.deepEqual(done.brain.follow, ['Show more']);
  const t = (await call(w, ADMIN2, 'GET', `threads/${root.id}`)).data;
  assert.equal(t.replies.length, 1);
});

test('the Brain failing or being unset leaves a plain message, never a stuck spinner', async () => {
  const w = world();
  await call(w, ADMIN, 'GET', 'boot');
  const GEN = (await call(w, ADMIN, 'POST', 'conversations', { members: [] })).data.channel.id;
  const { askInThread } = await import('../functions/_lib/chat/brain.ts');
  const root = (await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: 'question' })).data.message;
  const boom = async () => { throw new Error('network'); };
  await askInThread({ ...w.env }, { channel_id: GEN, root_id: root.id, asker: { email: ADMIN.email, name: 'Ada' }, text: '@Favor Brain hello' }, boom);
  let t = (await call(w, ADMIN, 'GET', `threads/${root.id}`)).data;
  assert.equal(t.replies[0].brain, null);
  assert.match(t.replies[0].body, /did not answer/);
  await askInThread({ ...w.env, BRAIN_HUB_KEY: undefined }, { channel_id: GEN, root_id: root.id, asker: { email: ADMIN.email, name: 'Ada' }, text: '@Favor Brain hello' }, boom);
  t = (await call(w, ADMIN, 'GET', `threads/${root.id}`)).data;
  assert.match(t.replies[1].body, /not connected/);
  await askInThread({ ...w.env }, { channel_id: GEN, root_id: root.id, asker: { email: ADMIN.email, name: 'Ada' }, text: '<@brain>' }, boom);
  t = (await call(w, ADMIN, 'GET', `threads/${root.id}`)).data;
  assert.match(t.replies[2].body, /question/);
});

test('sending an @Favor Brain message from the route starts the Brain without a second request', async () => {
  const w = world();
  await call(w, ADMIN, 'GET', 'boot');
  const GEN = (await call(w, ADMIN, 'POST', 'conversations', { members: [] })).data.channel.id;
  // BRAIN_URL points nowhere reachable, so the answer is the plain failure line, which proves the trigger ran in waitUntil.
  const sent = await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: '@Favor Brain ping' }, { env: { BRAIN_HUB_KEY: undefined } });
  assert.equal(sent.status, 200);
  const t = (await call(w, ADMIN, 'GET', `threads/${sent.data.message.id}`)).data;
  assert.equal(t.replies.length, 1);
  assert.equal(t.replies[0].user_id, 'brain');
});

test('channel names are unique, topics are editable by members, leaving works, DMs cannot be left', async () => {
  const w = world();
  for (const u of [ADMIN, ADMIN2]) await call(w, u, 'GET', 'boot');
  const a = await call(w, ADMIN, 'POST', 'channels', { name: 'grants' });
  assert.equal(a.status, 200);
  assert.equal((await call(w, ADMIN2, 'POST', 'channels', { name: 'Grants' })).status, 409);
  assert.equal((await call(w, ADMIN, 'POST', 'channels', { name: '!!!' })).status, 400);
  const id = a.data.channel.id;
  assert.equal((await call(w, ADMIN2, 'PATCH', `channels/${id}`, { topic: 'nope' })).status, 403, 'a non-member cannot edit');
  assert.equal((await call(w, ADMIN, 'PATCH', `channels/${id}`, { topic: 'Deadlines' })).data.topic, 'Deadlines');
  const browse = (await call(w, ADMIN2, 'GET', 'channels/browse')).data.channels;
  assert.ok(browse.some((c) => c.name === 'grants'));
  await call(w, ADMIN2, 'POST', `channels/${id}/join`);
  await call(w, ADMIN2, 'POST', `channels/${id}/leave`);
  assert.ok(!(await call(w, ADMIN2, 'GET', 'boot')).data.channels.some((c) => c.id === id));
  const dm = (await call(w, ADMIN, 'POST', 'conversations', { members: [ADMIN2.email] })).data.channel;
  assert.equal((await call(w, ADMIN, 'POST', `channels/${dm.id}/leave`)).status, 400);
});

test('an unknown route is a 404 and a bad message id a 400', async () => {
  const w = world();
  await call(w, ADMIN, 'GET', 'boot');
  assert.equal((await call(w, ADMIN, 'GET', 'nope')).status, 404);
  assert.equal((await call(w, ADMIN, 'PATCH', 'messages/abc', { body: 'x' })).status, 400);
  assert.equal((await call(w, ADMIN, 'GET', `channels/${GEN}/messages?before=1`)).status, 200);
});
