// Favor Chat 2026-10-14 additions through the router with a stand-in database: the time reader, /remind, /schedule and the
// scheduled pass, /todo checklists that are Projects tasks (both ways), polls, /meet, status and out of office. Made-up people only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';
import { ADMIN, ADMIN2, call, world } from './support/chat-world.mjs';

const GEN = 'ch_general';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
function plusWorld() {
  const w = world();
  w.d1.exec(read('db/chat-plus.sql'));
  for (const f of ['db/projects.sql', 'db/projects-links.sql', 'db/projects-plan.sql']) {
    try {
      w.d1.exec(read(f));
    } catch {
      // Already there or not needed.
    }
  }
  try {
    w.d1.exec(read('db/work-reminders.sql'));
  } catch {
    // made below
  }
  try {
    w.d1.exec(read('db/people-dev.sql'));
  } catch {
    // meet_directory may already be there
  }
  for (const u of [ADMIN, ADMIN2]) w.d1.db.prepare('INSERT OR IGNORE INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, 1)').run(u.email, u.name, 'Staff', 'US');
  w.d1.exec(`CREATE TABLE IF NOT EXISTS act_reminders (id TEXT PRIMARY KEY, owner TEXT, kind TEXT, ref_id TEXT, cid TEXT, title TEXT, note TEXT, due_at TEXT, state TEXT, source TEXT, created_at TEXT, snoozed_until TEXT, done_at TEXT)`);
  return w;
}
const rows = (w, sql, ...a) => w.d1.db.prepare(sql).all(...a);
const send = (w, u, body, ch = GEN, extra = {}) => call(w, u, 'POST', `channels/${ch}/messages`, { body, ...extra });

test('the time reader: days, times, relative, Eastern clock, rest of the words', async () => {
  const { readWhen } = await import('../functions/_lib/chat/when.ts');
  const now = new Date('2026-10-14T15:00:00Z'); // Wed 11:00 AM Eastern
  const r1 = readWhen('tomorrow 9am to call Grace', now);
  assert.equal(r1.at.toISOString(), '2026-10-15T13:00:00.000Z');
  assert.equal(r1.rest, 'call Grace');
  assert.equal(readWhen('in 2 hours check the batch', now).at.toISOString(), '2026-10-14T17:00:00.000Z');
  assert.equal(readWhen('friday at 3 send photos', now).at.toISOString(), '2026-10-16T19:00:00.000Z');
  assert.equal(readWhen('9am monday standup', now).at.toISOString(), '2026-10-19T13:00:00.000Z');
  assert.equal(readWhen('10/20 9:30 board call', now).at.toISOString(), '2026-10-20T13:30:00.000Z');
  assert.equal(readWhen('at 10am retro', now).at.toISOString(), '2026-10-15T14:00:00.000Z', 'a time that passed today means tomorrow');
  assert.equal(readWhen('dec 1 gala', now).rest, 'gala');
  assert.equal(readWhen('next tuesday noon lunch', now).at.toISOString(), '2026-10-20T16:00:00.000Z');
  assert.equal(readWhen('3 programs to print', now), null, 'a bare number is words');
  assert.equal(readWhen('monster truck', now), null);
});

test('/remind me makes a bell reminder and a private note; nobody else sees it', async () => {
  const w = plusWorld();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  const r = await send(w, ADMIN, '/remind me tomorrow 9am to call Grace');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const att = r.data.message.attachments[0];
  assert.equal(att.type, 'note');
  assert.equal(att.kind, 'reminder');
  assert.equal(rows(w, 'SELECT * FROM act_reminders').length, 1);
  assert.match(rows(w, 'SELECT title FROM act_reminders')[0].title, /call Grace/);
  const seen = (await call(w, ADMIN2, 'GET', `channels/${GEN}/messages`)).data.messages;
  assert.equal(seen.length, 0, 'the note is private');
});

test('/schedule waits, shows in /scheduled, posts on the pass as the writer, once', async () => {
  const w = plusWorld();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  const r = await send(w, ADMIN, '/schedule in 1 hour Board packet is in the drive <@bo@favorintl.org>');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.message.attachments[0].kind, 'scheduled');
  assert.equal(r.data.message.attachments[0].status, 'waiting');
  const list = await call(w, ADMIN, 'GET', 'scheduled');
  assert.equal(list.data.items.length, 1);
  const { runScheduled } = await import('../functions/_lib/chat/plus.ts');
  assert.deepEqual(await runScheduled(w.env, new Date()), { sent: 0, failed: 0 }, 'not due yet');
  const later = new Date(Date.now() + 2 * 3600000);
  assert.equal((await runScheduled(w.env, later)).sent, 1);
  assert.equal((await runScheduled(w.env, later)).sent, 0, 'never twice');
  const msgs = (await call(w, ADMIN2, 'GET', `channels/${GEN}/messages`)).data.messages;
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].user_id || msgs[0].email, ADMIN.email);
  assert.equal(rows(w, `SELECT kind FROM chat_mentions WHERE email = ?`, ADMIN2.email)[0].kind, 'mention', 'the mention notifies when it posts');
  const note = (await call(w, ADMIN, 'GET', `channels/${GEN}/messages`)).data.messages.find((m) => m.attachments?.[0]?.type === 'note');
  assert.equal(note.attachments[0].status, 'sent');
});

test('cancel stops a scheduled message; only the writer can cancel', async () => {
  const w = plusWorld();
  await call(w, ADMIN, 'GET', 'boot');
  await send(w, ADMIN, '/schedule tomorrow 8am hello team');
  const id = rows(w, 'SELECT id FROM chat_scheduled')[0].id;
  assert.equal((await call(w, ADMIN2, 'POST', `scheduled/${id}/cancel`)).status, 404);
  assert.equal((await call(w, ADMIN, 'POST', `scheduled/${id}/cancel`)).status, 200);
  const { runScheduled } = await import('../functions/_lib/chat/plus.ts');
  assert.equal((await runScheduled(w.env, new Date(Date.now() + 3 * 86400000))).sent, 0);
});

test('/remind #channel posts the reminder there; /remind @person in the direct message', async () => {
  const w = plusWorld();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  assert.equal((await send(w, ADMIN, '/remind #hub-feedback friday 3pm send the photos')).status, 200);
  assert.equal((await send(w, ADMIN, '/remind <@bo@favorintl.org> in 10 minutes sign the checks')).status, 200);
  const s = rows(w, 'SELECT channel_id, body FROM chat_scheduled ORDER BY created_at');
  assert.equal(s[0].channel_id, 'ch_hub_feedback');
  assert.equal(s[0].body, 'Reminder: send the photos');
  assert.match(s[1].body, /^<@bo@favorintl.org> Reminder: sign the checks/);
  assert.notEqual(s[1].channel_id, GEN);
});

test('/todo makes a checklist of Projects tasks; ticking in Chat closes the task, Projects changes redraw it', async () => {
  const w = plusWorld();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  const r = await send(w, ADMIN, '/todo Gala prep: book the venue <@bo@favorintl.org> due friday; print programs; call the church');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cl = r.data.message.attachments[0];
  assert.equal(cl.type, 'checklist');
  assert.equal(cl.title, 'Gala prep');
  assert.equal(cl.total, 3);
  assert.equal(cl.items[0].owner_email, ADMIN2.email);
  assert.ok(cl.items[0].due, 'the due day is read');
  assert.equal(rows(w, 'SELECT COUNT(*) AS n FROM hub_tasks')[0].n, 3);
  const mid = r.data.message.id;
  const t = cl.items[1].id;
  const tick = await call(w, ADMIN2, 'POST', `messages/${mid}/check`, { task_id: t, done: true });
  assert.equal(tick.status, 200, JSON.stringify(tick.data));
  assert.equal(rows(w, 'SELECT status FROM hub_tasks WHERE id = ?', t)[0].status, 'done');
  assert.equal(tick.data.message.attachments[0].done, 1);
  const add = await call(w, ADMIN, 'POST', `messages/${mid}/check-add`, { text: 'order flowers' });
  assert.equal(add.data.message.attachments[0].total, 4);
  // Done in Projects: the checklist redraws for everyone.
  w.events.length = 0;
  const { refreshChecklists } = await import('../functions/_lib/chat/plus.ts');
  w.d1.db.prepare(`UPDATE hub_tasks SET status = 'done' WHERE id = ?`).run(cl.items[2].id);
  await refreshChecklists(w.env, cl.items[2].id);
  const ev = w.events.find((e) => e.event?.type === 'edit' || e.type === 'edit' || JSON.stringify(e).includes('"edit"'));
  assert.ok(ev, 'an edit went out');
  const again = (await call(w, ADMIN, 'GET', `channels/${GEN}/messages`)).data.messages.find((m) => m.id === mid);
  assert.equal(again.attachments[0].done, 2);
});

test('polls: one pick, change, multi, close by the asker only', async () => {
  const w = plusWorld();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  const r = await send(w, ADMIN, '/poll Which day for the staff lunch? | Tuesday | Wednesday | Thursday');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const mid = r.data.message.id;
  assert.equal(r.data.message.attachments[0].opts.length, 3);
  await call(w, ADMIN2, 'POST', `messages/${mid}/vote`, { choice: 0 });
  const v = await call(w, ADMIN2, 'POST', `messages/${mid}/vote`, { choice: 2 });
  assert.deepEqual(v.data.message.attachments[0].opts.map((o) => o.n), [0, 0, 1], 'one pick moves');
  assert.equal((await call(w, ADMIN2, 'POST', `messages/${mid}/vote`, { close: true })).status, 403);
  assert.equal((await call(w, ADMIN, 'POST', `messages/${mid}/vote`, { close: true })).status, 200);
  assert.equal((await call(w, ADMIN2, 'POST', `messages/${mid}/vote`, { choice: 1 })).status, 400);
  const short = await send(w, ADMIN, '/poll Pizza or tacos? pizza, tacos');
  assert.equal(short.data.message.attachments[0].opts.length, 2);
});

test('/away: a direct message gets a private out of office note, once; /back clears it', async () => {
  const w = plusWorld();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  assert.equal((await send(w, ADMIN2, '/away until monday In Uganda')).status, 200);
  const boot = (await call(w, ADMIN, 'GET', 'boot')).data;
  assert.equal(boot.status[ADMIN2.email].away, true);
  const dm = (await call(w, ADMIN, 'POST', 'conversations', { members: [ADMIN2.email] })).data.channel.id;
  await send(w, ADMIN, 'are you around?', dm);
  await send(w, ADMIN, 'one more thing', dm);
  const mine = (await call(w, ADMIN, 'GET', `channels/${dm}/messages`)).data.messages.filter((m) => m.attachments?.[0]?.kind === 'away');
  assert.equal(mine.length, 1);
  assert.match(mine[0].attachments[0].text, /out of office/);
  const theirs = (await call(w, ADMIN2, 'GET', `channels/${dm}/messages`)).data.messages.filter((m) => m.attachments?.[0]?.kind === 'away');
  assert.equal(theirs.length, 0);
  await send(w, ADMIN2, '/back');
  assert.equal((await call(w, ADMIN, 'GET', 'boot')).data.status[ADMIN2.email], undefined);
});

test('/meet with no time explains; text that is not a command posts as typed', async () => {
  const w = plusWorld();
  await call(w, ADMIN, 'GET', 'boot');
  const r = await send(w, ADMIN, '/meet');
  assert.equal(r.data.message.attachments[0].kind, 'tip');
  const plain = await send(w, ADMIN, '/remindme is not a command');
  assert.equal(plain.data.message.body, '/remindme is not a command');
});
