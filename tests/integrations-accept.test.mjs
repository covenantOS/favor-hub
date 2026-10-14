// Accept on a request: the task (and Asana through the hook), the Chat card or the email to the person who asked, the gate, the
// focus time on the owner's own calendar (Google stubbed), and done in both directions with the done email.
// Made-up people only; mail lands in a list, Google answers from a stand-in, and the live database is never touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';
import { DESIGN, NOW, OUTSIDER, VIDEO, WILL, addRequest, call, rows, world } from './support/request-world.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

function acceptWorld(opts = {}) {
  const w = world(opts);
  for (const f of ['db/projects.sql', 'db/projects-links.sql', 'db/projects-asana.sql', 'db/projects-asana-sync.sql', 'db/meetings-scheduling.sql', 'db/google.sql', 'db/integrations.sql']) {
    for (const part of read(f).split(/;\s*(?:\r?\n|$)/)) if (part.trim()) { try { w.d1.exec(part + ';'); } catch { /* an ALTER on a table this world lacks */ } }
  }
  const set = (k, v) => w.d1.db.prepare('INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v, 'test', NOW);
  set('projects.enabled', 'staff');
  set('chat.enabled', 'staff');
  return { ...w, set };
}

async function project(w, key = 'MKT') {
  const { handle } = await import('../functions/_lib/projects/route.ts');
  const res = await handle({ request: new Request('https://dash.favorintl.org/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Website', key, members: [VIDEO.email, DESIGN.email] }) }), env: w.env, user: WILL, path: ['projects'], waitUntil: () => {} });
  return (await res.json()).project;
}

test('Accept makes the task, sets the owner, and posts an Accepted card in Chat from the owner to a staff requester', async () => {
  const w = acceptWorld();
  const p = await project(w);
  const id = addRequest(w, 'New donate button', VIDEO.email);
  const opts = await call(w, WILL, 'GET', `${id}/accept`);
  assert.equal(opts.status, 200);
  assert.ok(opts.data.projects.some((x) => x.key === 'MKT'));
  assert.equal(opts.data.requester.via, 'chat');
  const r = await call(w, WILL, 'POST', `${id}/accept`, { project_id: p.id, owner_email: DESIGN.email, due_date: '2026-10-20' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.request.status, 'approved');
  assert.equal(r.data.request.project_task.code, 'MKT-0001');
  const t = rows(w, 'SELECT * FROM hub_tasks WHERE request_id = ?', id)[0];
  assert.equal(t.owner_email, DESIGN.email);
  assert.equal(t.due_date, '2026-10-20');
  assert.ok(t.description.includes(`/requests/?r=${id}`));
  assert.equal(rows(w, 'SELECT owner_email FROM request_tasks WHERE request_id = ?', id)[0].owner_email, DESIGN.email);
  assert.equal(r.data.told.via, 'chat');
  const card = rows(w, `SELECT m.email, m.attachments FROM chat_messages m JOIN request_chat_links l ON l.message_id = m.id WHERE l.request_id = ? AND l.kind = 'card'`, id);
  assert.equal(card.length, 1);
  assert.equal(card[0].email, DESIGN.email, 'the card comes from the owner');
  assert.equal(JSON.parse(card[0].attachments)[0].kind, 'accepted');
  assert.equal(w.mail.filter((m) => m.subject.startsWith('Accepted')).length, 0, 'Chat, not email');
  // Pressed again: the same task, nobody told twice.
  const again = await call(w, WILL, 'POST', `${id}/accept`, { project_id: p.id, owner_email: DESIGN.email });
  assert.equal(again.data.task.existing, true);
  assert.equal(rows(w, 'SELECT * FROM hub_tasks WHERE request_id = ?', id).length, 1);
  assert.equal(rows(w, `SELECT * FROM request_chat_links WHERE request_id = ? AND kind = 'card'`, id).length, 1);
});

test('a requester outside the Chat group gets one email; a closed gate tells nobody; staff cannot accept', async () => {
  const w = acceptWorld();
  w.set('chat.enabled', 'group');
  w.set('chat.access', JSON.stringify({ emails: [DESIGN.email], teams: [] }));
  const id = addRequest(w, 'Fix the footer', OUTSIDER.email);
  const r = await call(w, WILL, 'POST', `${id}/accept`, { owner_email: DESIGN.email });
  assert.equal(r.data.told.via, 'email');
  const m = w.mail.filter((x) => x.to === OUTSIDER.email);
  assert.equal(m.length, 1);
  assert.equal(m[0].subject, 'Accepted: Fix the footer');
  assert.ok(!m[0].html.includes(String.fromCharCode(8212)) && !m[0].text.includes(String.fromCharCode(8212)), 'no long dash');
  assert.equal(rows(w, `SELECT * FROM request_chat_links WHERE request_id = ?`, id).length, 0);

  const g = acceptWorld({ notify: null });
  const id2 = addRequest(g, 'Quiet one', OUTSIDER.email);
  const r2 = await call(g, WILL, 'POST', `${id2}/accept`, {});
  assert.equal(r2.data.told.via, 'none');
  assert.match(r2.data.told.why, /notices are off/);
  assert.equal(g.mail.length, 0);
  assert.equal(rows(g, 'SELECT owner_email FROM hub_tasks WHERE request_id = ?', id2)[0].owner_email, WILL.email, 'the person accepting owns it by default');

  const s = await call(w, VIDEO, 'POST', `${addRequest(w)}/accept`, {});
  assert.equal(s.status, 403);
});

test('testers tell nobody and cannot hand work to real staff', async () => {
  const w = acceptWorld();
  const T = { email: 'tester@favorintl.org', name: 'FavorOS Tester', picture: '', role: 'admin', via: 'google', kpi: true };
  w.d1.db.prepare('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, 1)').run(T.email, T.name, 'Test', 'Marketing');
  const id = addRequest(w, 'Tester asks', VIDEO.email);
  assert.equal((await call(w, T, 'POST', `${id}/accept`, { owner_email: DESIGN.email })).status, 403);
  const ok = await call(w, T, 'POST', `${id}/accept`, { owner_email: T.email });
  assert.equal(ok.data.told.via, 'none');
  assert.equal(w.mail.length, 0);
});

test('done in both directions: ticking the task closes the request; closing the request ticks the task, each once', async () => {
  const w = acceptWorld();
  const id = addRequest(w, 'Ticked in Projects', OUTSIDER.email);
  await call(w, WILL, 'POST', `${id}/accept`, { owner_email: DESIGN.email });
  const t = rows(w, 'SELECT * FROM hub_tasks WHERE request_id = ?', id)[0];
  const { handle } = await import('../functions/_lib/projects/route.ts');
  const pending = [];
  const res = await handle({ request: new Request(`https://dash.favorintl.org/api/tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) }), env: w.env, user: DESIGN, path: ['tasks', t.id], waitUntil: (p) => pending.push(p) });
  assert.equal(res.status, 200, await res.clone().text());
  await Promise.allSettled(pending);
  assert.equal(rows(w, 'SELECT status FROM requests WHERE id = ?', id)[0].status, 'done');
  assert.ok(rows(w, 'SELECT completed_at FROM requests WHERE id = ?', id)[0].completed_at);
  const { sweepDoneTasks } = await import('../functions/_lib/integrations/accept.ts');
  assert.equal(await sweepDoneTasks(w.env), 0, 'nothing left for the sweep');

  // The other way: marked done on the board.
  const id2 = addRequest(w, 'Closed on the board', OUTSIDER.email);
  await call(w, WILL, 'POST', `${id2}/accept`, { owner_email: DESIGN.email });
  await call(w, DESIGN, 'POST', `${id2}/done`);
  assert.equal(rows(w, 'SELECT status FROM hub_tasks WHERE request_id = ?', id2)[0].status, 'done');

  // Ticked where no event fires (Asana writes the table): the sweep closes it.
  const id3 = addRequest(w, 'Ticked in Asana', OUTSIDER.email);
  await call(w, WILL, 'POST', `${id3}/accept`, { owner_email: DESIGN.email });
  w.d1.db.prepare(`UPDATE hub_tasks SET status = 'done', done_at = ? WHERE request_id = ?`).run(new Date().toISOString(), id3);
  assert.equal(await sweepDoneTasks(w.env), 1);
  assert.equal(rows(w, 'SELECT status FROM requests WHERE id = ?', id3)[0].status, 'done');
  assert.equal(await sweepDoneTasks(w.env), 0);
});

test('focus time: only the owner, on their own calendar with no guests, and removable', async () => {
  const w = acceptWorld();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ u, init });
    if (u.startsWith('https://oauth.test')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    if (u.includes('/freeBusy')) return Response.json({ calendars: { [DESIGN.email]: { busy: [] } } });
    if (u.includes('/events') && init.method === 'POST') return Response.json({ id: 'evt123' });
    if (u.includes('/events/') && init.method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json({});
  };
  try {
    Object.assign(w.env, { GOOGLE_TOKEN_KEY: 'ab'.repeat(32), GOOGLE_CLIENT_SECRET: 'x', GOOGLE_TOKEN_URL: 'https://oauth.test/token', MEET_CAL_URL: 'https://cal.test' });
    const id = addRequest(w, 'Focus please', OUTSIDER.email);
    await call(w, WILL, 'POST', `${id}/accept`, { owner_email: DESIGN.email });
    const later = new Date(Date.now() + 86400000).toISOString();
    assert.equal((await call(w, DESIGN, 'POST', `${id}/focus`, { start: later, minutes: 60 })).status, 409, 'no Google connection yet: asked to connect');
    const google = await import('../functions/_lib/hub/google.ts');
    w.d1.exec('CREATE TABLE IF NOT EXISTS hub_google (email TEXT PRIMARY KEY, refresh_enc TEXT, scopes TEXT, connected_at TEXT, last_used TEXT)');
    w.d1.db.prepare('INSERT INTO hub_google (email, refresh_enc, scopes, connected_at) VALUES (?, ?, ?, ?)').run(DESIGN.email, await google.seal(w.env, 'r1'), 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy', 'x');
    assert.equal((await call(w, WILL, 'POST', `${id}/focus`, { start: later, minutes: 60 })).status, 403, 'not on someone else\'s calendar');
    const slots = await call(w, DESIGN, 'GET', `${id}/focus?minutes=90`);
    assert.equal(slots.status, 200, JSON.stringify(slots.data));
    assert.ok(slots.data.slots.length > 0 && slots.data.slots.length <= 3);
    const h = await call(w, DESIGN, 'POST', `${id}/focus`, { start: slots.data.slots[0].start, minutes: 90 });
    assert.equal(h.status, 200, JSON.stringify(h.data));
    const post = calls.find((c) => c.init.method === 'POST' && c.u.includes('/events'));
    assert.ok(post.u.includes('/calendars/primary/events?sendUpdates=none'));
    const body = JSON.parse(post.init.body);
    assert.equal(body.attendees, undefined, 'no guests, so Google invites nobody');
    assert.ok(body.summary.startsWith('Focus: Focus please'));
    assert.equal(Date.parse(body.end.dateTime) - Date.parse(body.start.dateTime), 90 * 60000);
    assert.equal(rows(w, 'SELECT * FROM hub_focus_holds WHERE request_id = ?', id).length, 1);
    assert.equal((await call(w, WILL, 'DELETE', `${id}/focus/${h.data.hold.id}`)).status, 403);
    assert.equal((await call(w, DESIGN, 'DELETE', `${id}/focus/${h.data.hold.id}`)).status, 200);
    assert.ok(rows(w, 'SELECT removed_at FROM hub_focus_holds WHERE id = ?', h.data.hold.id)[0].removed_at);
  } finally {
    globalThis.fetch = realFetch;
  }
});
