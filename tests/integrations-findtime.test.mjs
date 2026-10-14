// Find a time from anywhere: the people and title read from a place (only for someone who can see it), the meeting card going back
// to the conversation, task or request it was booked from (host only, once), the scheduled card in Chat, and the notes coming back
// after the meeting with the summary only where every member may read the notes. Made-up people; nothing leaves the test.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';
import { DESIGN, NOW, OUTSIDER, VIDEO, WILL, addRequest, rows, world } from './support/request-world.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

function w0() {
  const w = world();
  for (const f of ['db/projects.sql', 'db/projects-links.sql', 'db/meetings-auto.sql', 'db/meetings-scheduling.sql', 'db/integrations.sql']) {
    for (const part of read(f).split(/;\s*(?:\r?\n|$)/)) if (part.trim()) { try { w.d1.exec(part + ';'); } catch { /* already there */ } }
  }
  w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('projects.enabled', 'staff', 'test', ?)").run(NOW);
  w.d1.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('chat.enabled', 'staff', 'test', ?)").run(NOW);
  return w;
}

function channel(w, id, kind, name, members) {
  w.d1.db.prepare('INSERT INTO chat_channels (id, kind, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(id, kind, name, members[0], NOW);
  for (const m of members) w.d1.db.prepare('INSERT INTO chat_members (channel_id, email, joined_at) VALUES (?, ?, ?)').run(id, m, NOW);
}

function meeting(w, id, host, invitees, over = {}) {
  const starts = new Date(Date.now() + 2 * 86400000).toISOString();
  w.d1.db.prepare(`INSERT INTO hub_meetings (id, title, agenda, host_email, host_name, starts_at, ends_at, duration_min, rec_mode, access, invitees, status, created_at)
    VALUES (?, ?, '', ?, ?, ?, ?, 30, 'video', 'invited', ?, 'scheduled', ?)`).run(id, over.title || 'Footer review', host, host, starts, new Date(Date.parse(starts) + 1800000).toISOString(), JSON.stringify(invitees.map((e) => ({ email: e, name: '' }))), NOW);
}

async function ix(w, user, method, path, body) {
  const { handle } = await import('../functions/_lib/integrations/route.ts');
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const url = new URL('https://dash.favorintl.org/api/integrations/' + path);
  const res = await handle({ request: new Request(url, init), env: w.env, user, path: url.pathname.replace('/api/integrations/', '').split('/'), waitUntil: (p) => w.pending.push(p) });
  await Promise.allSettled(w.pending.splice(0));
  return { status: res.status, data: await res.json() };
}

test('context: the people and a title from a conversation, a task and a request, for someone who can see it', async () => {
  const w = w0();
  channel(w, 'ch_web', 'private', 'website', [WILL.email, VIDEO.email, DESIGN.email, 'tester@favorintl.org']);
  const c = await ix(w, WILL, 'GET', 'context?kind=chat&ref=ch_web');
  assert.equal(c.status, 200);
  assert.equal(c.data.title, '#website');
  assert.deepEqual(c.data.people.map((p) => p.email).sort(), [DESIGN.email, VIDEO.email], 'me and the test user left out');
  assert.equal((await ix(w, OUTSIDER, 'GET', 'context?kind=chat&ref=ch_web')).status, 404, 'not a member: nothing');
  const id = addRequest(w, 'Footer fix', OUTSIDER.email);
  const r = await ix(w, VIDEO, 'GET', `context?kind=request&ref=${id}`);
  assert.equal(r.data.title, 'Footer fix');
  assert.ok(r.data.people.some((p) => p.email === OUTSIDER.email));
  assert.equal((await ix(w, WILL, 'GET', 'context?kind=nope&ref=x')).status, 400);
  assert.equal((await ix(w, null, 'GET', 'context?kind=chat&ref=ch_web')).status, 401);
});

test('origin: the host ties the meeting to the conversation once; the scheduled card names it for its members', async () => {
  const w = w0();
  channel(w, 'ch_web', 'private', 'website', [WILL.email, VIDEO.email, DESIGN.email]);
  meeting(w, 'aaaaaaaaaaaaaaaaaaaaaaaa', WILL.email, [VIDEO.email, DESIGN.email]);
  assert.equal((await ix(w, VIDEO, 'POST', 'origin', { meeting_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', kind: 'chat', ref: 'ch_web' })).status, 403, 'only the host');
  const o = await ix(w, WILL, 'POST', 'origin', { meeting_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', kind: 'chat', ref: 'ch_web' });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.posted, 'chat');
  const msg = rows(w, 'SELECT * FROM chat_messages WHERE channel_id = ?', 'ch_web');
  assert.equal(msg.length, 1);
  assert.equal(JSON.parse(msg[0].attachments)[0].type, 'meeting');
  assert.equal((await ix(w, WILL, 'POST', 'origin', { meeting_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', kind: 'chat', ref: 'ch_web' })).data.posted, 'none', 'once');
  const { hydrateAttachments } = await import('../functions/_lib/chat/hydrate.ts');
  const [card] = await hydrateAttachments(w.env, [{ type: 'meeting', id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }], 'ch_web');
  assert.equal(card.status, 'scheduled');
  assert.equal(card.title, 'Footer review');
  assert.ok(card.starts_at);
  // A conversation with someone not on the meeting sees a private card, scheduled all the same.
  channel(w, 'ch_all', 'public', 'town-square', [WILL.email, VIDEO.email, OUTSIDER.email]);
  const [pub] = await hydrateAttachments(w.env, [{ type: 'meeting', id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }], 'ch_all');
  assert.equal(pub.title, 'Private meeting');
  assert.equal(pub.status, 'scheduled');
});

test('notes come back once: the summary into a private conversation of notes readers, one line into a public channel and a task', async () => {
  const w = w0();
  channel(w, 'ch_web', 'private', 'website', [WILL.email, VIDEO.email]);
  channel(w, 'ch_pub', 'public', 'town-square', [WILL.email, VIDEO.email, OUTSIDER.email]);
  meeting(w, 'bbbbbbbbbbbbbbbbbbbbbbbb', WILL.email, [VIDEO.email]);
  meeting(w, 'cccccccccccccccccccccccc', WILL.email, [VIDEO.email]);
  await ix(w, WILL, 'POST', 'origin', { meeting_id: 'bbbbbbbbbbbbbbbbbbbbbbbb', kind: 'chat', ref: 'ch_web' });
  await ix(w, WILL, 'POST', 'origin', { meeting_id: 'cccccccccccccccccccccccc', kind: 'chat', ref: 'ch_pub' });
  for (const id of ['bbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccc']) {
    w.d1.db.prepare(`UPDATE hub_meetings SET status = 'ended', notes_status = 'ready', summary = 'We picked the new footer.', notes_json = ? WHERE id = ?`).run(JSON.stringify({ actions: [{ owner: 'Vic', text: 'Ship the footer' }] }), id);
  }
  const { originNotes } = await import('../functions/_lib/integrations/findtime.ts');
  assert.equal(await originNotes(w.env, 'bbbbbbbbbbbbbbbbbbbbbbbb'), true);
  assert.equal(await originNotes(w.env, 'bbbbbbbbbbbbbbbbbbbbbbbb'), false, 'once');
  const priv = rows(w, `SELECT body, thread_id, email FROM chat_messages WHERE channel_id = 'ch_web' ORDER BY id`);
  assert.equal(priv.length, 2);
  assert.equal(priv[1].email, 'meetings');
  assert.equal(priv[1].thread_id, priv[0].thread_id === null ? rows(w, `SELECT id FROM chat_messages WHERE channel_id = 'ch_web' ORDER BY id`)[0].id : priv[1].thread_id, 'under the card');
  assert.ok(priv[1].body.includes('We picked the new footer.') && priv[1].body.includes('Ship the footer'));
  await originNotes(w.env, 'cccccccccccccccccccccccc');
  const pub = rows(w, `SELECT body FROM chat_messages WHERE channel_id = 'ch_pub' AND email = 'meetings'`);
  assert.equal(pub.length, 1);
  assert.ok(!pub[0].body.includes('We picked'), 'a public channel gets one line, not the notes');

  // A task: the booking and the notes land as comments with links only.
  const { createTask } = await import('../functions/_lib/projects/tasks.ts');
  const made = await createTask(w.env, { email: WILL.email, name: WILL.name, admin: true }, { title: 'Footer', owner_email: VIDEO.email });
  meeting(w, 'dddddddddddddddddddddddd', WILL.email, [VIDEO.email]);
  const t = await ix(w, WILL, 'POST', 'origin', { meeting_id: 'dddddddddddddddddddddddd', kind: 'task', ref: made.task.id });
  assert.equal(t.data.posted, 'task', JSON.stringify(t.data));
  w.d1.db.prepare(`UPDATE hub_meetings SET status = 'ended', notes_status = 'ready', summary = 'Secret plan' WHERE id = ?`).run('dddddddddddddddddddddddd');
  await originNotes(w.env, 'dddddddddddddddddddddddd');
  const cm = rows(w, 'SELECT body, source FROM hub_task_comments WHERE task_id = ? ORDER BY created_at', made.task.id);
  assert.equal(cm.length, 2);
  assert.ok(cm[0].body.startsWith('Booked: Footer review'));
  assert.ok(cm[1].body.includes('/meet/notes/?m=dddddddddddddddddddddddd') && !cm[1].body.includes('Secret plan'));
});
