// Clip replies: a clip sent into a Chat thread or onto a task, its comments flowing both ways once each, Make this a task and
// adjustments (who may, linked both ways), and the contact log suggestion that logs nothing until its sender presses Log it.
// Made-up people; the Blackbaud writer is a stand-in and nothing leaves the test.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';
import { DESIGN, NOW, OUTSIDER, VIDEO, WILL, rows, world } from './support/request-world.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const CLIP = 'abcdef0123456789abcdef0123456789';

function w0() {
  const w = world();
  for (const f of ['db/clip-share.sql', 'db/projects.sql', 'db/projects-links.sql', 'db/integrations.sql']) {
    for (const part of read(f).split(/;\s*(?:\r?\n|$)/)) if (part.trim()) { try { w.d1.exec(part + ';'); } catch { /* already there */ } }
  }
  w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('projects.enabled', 'staff', 'test', ?)").run(NOW);
  w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('chat.enabled', 'staff', 'test', ?)").run(NOW);
  w.d1.db.prepare(`INSERT INTO hub_clips (id, owner_email, owner_name, title, status, share, mime, created_at, updated_at, duration_ms, access) VALUES (?, ?, ?, 'Footer walkthrough', 'ready', 0, 'video/webm', ?, ?, 90000, 'people')`).run(CLIP, VIDEO.email, VIDEO.name, NOW, NOW);
  w.d1.db.prepare('INSERT INTO chat_channels (id, kind, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run('ch_web', 'private', 'website', VIDEO.email, NOW);
  for (const m of [VIDEO.email, DESIGN.email]) w.d1.db.prepare('INSERT INTO chat_members (channel_id, email, joined_at) VALUES (?, ?, ?)').run('ch_web', m, NOW);
  return w;
}

async function ix(w, user, method, path, body) {
  const { handle } = await import('../functions/_lib/integrations/route.ts');
  await import('../functions/_lib/integrations/register.ts');
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const url = new URL('https://dash.favorintl.org/api/integrations/' + path);
  const res = await handle({ request: new Request(url, init), env: w.env, user, path: url.pathname.replace('/api/integrations/', '').split('/'), waitUntil: (p) => w.pending.push(p) });
  await Promise.allSettled(w.pending.splice(0));
  return { status: res.status, data: await res.json() };
}

async function postClipMessage(w, user) {
  const store = await import('../functions/_lib/chat/db.ts');
  const p = await store.post(w.env, { channel_id: 'ch_web', email: user.email, body: '', attachments: [{ type: 'clip', id: CLIP }] });
  return p.message.id;
}

test('a clip in a Chat thread: only its maker ties it; comments go to the thread and replies come back, once each', async () => {
  const w = w0();
  const mid = await postClipMessage(w, VIDEO);
  assert.equal((await ix(w, DESIGN, 'POST', 'clip-place', { clip_id: CLIP, kind: 'chat', ref: 'ch_web', message_id: mid })).status, 403);
  assert.equal((await ix(w, VIDEO, 'POST', 'clip-place', { clip_id: CLIP, kind: 'chat', ref: 'ch_web', message_id: 999 })).status, 400);
  const ok = await ix(w, VIDEO, 'POST', 'clip-place', { clip_id: CLIP, kind: 'chat', ref: 'ch_web', message_id: mid });
  assert.equal(ok.data.posted, 'chat');
  const cl = await import('../functions/_lib/integrations/cliplinks.ts');
  // Dan comments on the clip at 0:42: it lands in the thread under the clip, as Dan.
  w.d1.db.prepare(`INSERT INTO hub_clip_comments (id, clip_id, at_seconds, author_email, author_name, body, created_at) VALUES ('cm1', ?, 42, ?, ?, 'Make the logo bigger', ?)`).run(CLIP, DESIGN.email, DESIGN.name, NOW);
  assert.equal(await cl.fromClipComment(w.env, CLIP, { id: 'cm1', at_seconds: 42, author_email: DESIGN.email, author_name: DESIGN.name, body: 'Make the logo bigger' }, DESIGN), 1);
  const thread = rows(w, 'SELECT id, email, body FROM chat_messages WHERE thread_id = ?', mid);
  assert.equal(thread.length, 1);
  assert.equal(thread[0].email, DESIGN.email);
  assert.equal(thread[0].body, 'At 0:42: Make the logo bigger');
  // The copy is never copied back.
  assert.equal(await cl.fromChatReply(w.env, { ...thread[0], thread_id: mid, channel_id: 'ch_web' }, DESIGN), false);
  // Vic answers in the thread: it lands on the clip.
  const store = await import('../functions/_lib/chat/db.ts');
  const reply = (await store.post(w.env, { channel_id: 'ch_web', email: VIDEO.email, body: 'Done, see v2', thread_id: mid })).message;
  assert.equal(await cl.fromChatReply(w.env, reply, VIDEO), true);
  assert.equal(await cl.fromChatReply(w.env, reply, VIDEO), false, 'once');
  const cms = rows(w, 'SELECT author_email, body FROM hub_clip_comments WHERE clip_id = ? ORDER BY created_at', CLIP);
  assert.deepEqual(cms.map((c) => c.body), ['Make the logo bigger', 'Done, see v2']);
});

test('a clip on a task: the link goes in the comments; task comments land on the clip and clip comments on the task', async () => {
  const w = w0();
  const { createTask } = await import('../functions/_lib/projects/tasks.ts');
  const made = await createTask(w.env, { email: VIDEO.email, name: VIDEO.name, admin: false }, { title: 'Footer', owner_email: VIDEO.email, followers: [DESIGN.email] });
  const r = await ix(w, VIDEO, 'POST', 'clip-place', { clip_id: CLIP, kind: 'task', ref: made.task.id });
  assert.equal(r.data.posted, 'task', JSON.stringify(r.data));
  const first = rows(w, 'SELECT * FROM hub_task_comments WHERE task_id = ?', made.task.id);
  assert.equal(first.length, 1);
  assert.ok(first[0].body.includes(`/c/${CLIP}`));
  assert.equal(rows(w, 'SELECT * FROM hub_clip_comments').length, 0, 'the link itself is not a clip comment');
  const cl = await import('../functions/_lib/integrations/cliplinks.ts');
  // A comment typed on the task.
  const { addComment } = await import('../functions/_lib/projects/tasks.ts');
  const c = await addComment(w.env, { email: VIDEO.email, name: VIDEO.name, admin: false }, made.task.id, { body: 'Second take is better' });
  await cl.fromTaskComment(w.env, { kind: 'task.comment', actor: VIDEO.email, task: made.task, detail: { comment: c.comment } });
  await cl.fromTaskComment(w.env, { kind: 'task.comment', actor: VIDEO.email, task: made.task, detail: { comment: c.comment } });
  assert.equal(rows(w, `SELECT * FROM hub_clip_comments WHERE body = 'Second take is better'`).length, 1, 'once');
  // A comment on the clip goes to the task as its author.
  assert.equal(await cl.fromClipComment(w.env, CLIP, { id: 'cm9', at_seconds: 5, author_email: VIDEO.email, author_name: VIDEO.name, body: 'Trim the start' }, VIDEO), 1);
  assert.equal(rows(w, `SELECT * FROM hub_task_comments WHERE task_id = ? AND body = 'At 0:05: Trim the start' AND source = 'clip'`, made.task.id).length, 1);
});

test('Make this a task and adjustments: the clip maker or the comment writer, linked both ways', async () => {
  const w = w0();
  w.d1.db.prepare(`INSERT INTO hub_clip_comments (id, clip_id, at_seconds, author_email, author_name, body, created_at) VALUES ('cm1', ?, 75, ?, ?, 'Fix the typo in the title card', ?)`).run(CLIP, DESIGN.email, DESIGN.name, NOW);
  for (const e of [OUTSIDER.email, DESIGN.email]) w.d1.db.prepare('INSERT INTO hub_clip_people (clip_id, email, added_by, created_at) VALUES (?, ?, ?, ?)').run(CLIP, e, VIDEO.email, NOW);
  assert.equal((await ix(w, OUTSIDER, 'POST', 'clip-comments/cm1/task', {})).status, 403, 'a viewer who wrote nothing cannot');
  const t = await ix(w, VIDEO, 'POST', 'clip-comments/cm1/task', {});
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const task = rows(w, 'SELECT * FROM hub_tasks WHERE id = ?', t.data.task.id)[0];
  assert.equal(task.title, 'Fix the typo in the title card');
  assert.ok(task.description.includes(`/c/${CLIP}?t=75`) && task.description.includes('at 1:15'));
  assert.equal((await ix(w, VIDEO, 'POST', 'clip-comments/cm1/task', {})).data.task.existing, true, 'one task per comment');
  await ix(w, DESIGN, 'POST', 'clip-comments/cm1/adjust', { on: true });
  let marks = (await ix(w, DESIGN, 'GET', `clip-marks?clip=${CLIP}`)).data.marks;
  assert.equal(marks[0].task.id, t.data.task.id);
  assert.equal(marks[0].adjustment, true);
  await ix(w, VIDEO, 'POST', 'clip-comments/cm1/adjust', { on: true, done: true });
  marks = (await ix(w, VIDEO, 'GET', `clip-marks?clip=${CLIP}`)).data.marks;
  assert.equal(marks[0].adjustment_done, true);
  assert.equal((await ix(w, { ...OUTSIDER, email: 'nobody@favorintl.org' }, 'GET', `clip-marks?clip=${CLIP}`)).status, 404, 'someone who cannot watch sees nothing');
});

test('contact log: only by choice, only its sender sees the suggestion, nothing logged without Log it, testers refused', async () => {
  const w = w0();
  const cl = await import('../functions/_lib/integrations/cliplinks.ts');
  const logged = [];
  cl.logWriter.current = { log: async (env, user, cid, f) => { logged.push({ cid, ...f }); return { state: 'logged', detail: 'Logged on the record.' }; } };
  await ix(w, VIDEO, 'POST', 'clip-place', { clip_id: CLIP, kind: 'partner', ref: '27202' });
  assert.equal(rows(w, 'SELECT * FROM hub_clip_contact_log').length, 0, 'no tick, no suggestion');
  await ix(w, VIDEO, 'POST', 'clip-place', { clip_id: CLIP, kind: 'partner', ref: '27202', suggest_log: true });
  assert.equal(rows(w, `SELECT state FROM hub_clip_contact_log`)[0].state, 'suggested');
  assert.equal(logged.length, 0, 'suggesting logs nothing');
  assert.equal((await ix(w, DESIGN, 'GET', 'clip-log?partner=27202')).data.suggestions.length, 0, 'only the sender sees it');
  assert.equal((await ix(w, VIDEO, 'GET', 'clip-log?partner=27202')).data.suggestions.length, 1);
  assert.equal((await ix(w, VIDEO, 'POST', 'clip-log/act', { clip_id: CLIP, partner_id: '27202', action: 'log' })).status, 400, 'needs the confirm');
  const r = await ix(w, VIDEO, 'POST', 'clip-log/act', { clip_id: CLIP, partner_id: '27202', action: 'log', confirm: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(logged.length, 1);
  assert.ok(logged[0].summary.startsWith('Sent a short video') && logged[0].description.includes(`/c/${CLIP}`));
  assert.equal((await ix(w, VIDEO, 'GET', 'clip-log?partner=27202')).data.suggestions.length, 0);
  const T = { email: 'tester@favorintl.org', name: 'Tester', role: 'admin', via: 'google', picture: '', kpi: true };
  w.d1.db.prepare(`UPDATE hub_clips SET owner_email = ? WHERE id = ?`).run(T.email, CLIP);
  await ix(w, T, 'POST', 'clip-place', { clip_id: CLIP, kind: 'partner', ref: '1', suggest_log: true });
  assert.equal((await ix(w, T, 'POST', 'clip-log/act', { clip_id: CLIP, partner_id: '1', action: 'log', confirm: true })).status, 403);
  assert.equal(logged.length, 1);
});
