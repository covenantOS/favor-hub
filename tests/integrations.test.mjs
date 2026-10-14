// Run with: npm test
//
// Cross-app work on Today: the Inbox (mentions, task notices, hand-offs, approvals), the Waiting on list (questions with no answer,
// tasks that have not moved), Nudge in each line's own channel, and Hand off with "picked up". Made-up people on an in-memory database
// with every table; no mail leaves the process (MAIL_HOOK) and the chat room is a stand-in.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { fullSchemaD1 } from './support/full-schema.mjs';

const { fastItems, clearItem, unclearItem, plainText } = await import('../functions/_lib/integrations/inbox.ts');
const { fastWaiting, nudge, stopWaiting, isQuestion } = await import('../functions/_lib/integrations/waiting.ts');
const { handOff, pickUp, handoffFor, syncPickups } = await import('../functions/_lib/integrations/handoff.ts');
const { mayReach, peopleFor, ping } = await import('../functions/_lib/integrations/ping.ts');

const ANN = { email: 'ann@favorintl.org', name: 'Ann Able', picture: '', role: 'admin', via: 'google', kpi: true };
const BEN = { email: 'ben@favorintl.org', name: 'Ben Baker', picture: '', role: 'staff', via: 'google', kpi: true };
const CAL = { email: 'cal@favorintl.org', name: 'Cal Cook', picture: '', role: 'staff', via: 'google', kpi: true };
const T1 = { email: 'tester@favorintl.org', name: 'FavorOS Tester', picture: '', role: 'admin', via: 'password', kpi: true };
const T2 = { email: 'tester2@favorintl.org', name: 'FavorOS Tester Two', picture: '', role: 'staff', via: 'password', kpi: true };
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const H = 3600e3;
const req = (path = '/api/today/inbox') => new Request('https://dash.favorintl.org' + path, { headers: { 'X-Hub-Request': '1' } });

function world({ chat = 'staff' } = {}) {
  const d1 = fullSchemaD1();
  const at = ago(0);
  const mails = [];
  for (const [k, v] of [['chat.enabled', chat], ['projects.enabled', 'staff'], ['meet.release', 'staff'], ['requests.notify', 'on']]) {
    d1.db.prepare('INSERT OR REPLACE INTO hub_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)').run(k, v, 'test', at);
  }
  for (const u of [ANN, BEN, CAL, T1, T2]) {
    d1.db.prepare(`INSERT INTO hub_users (email, name, picture, role, blocked, note, sign_ins, created_at, updated_at) VALUES (?, ?, '', ?, 0, '', 1, ?, ?)`).run(u.email, u.name, u.role, at, at);
  }
  for (const u of [ANN, BEN, CAL]) d1.db.prepare('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, 1)').run(u.email, u.name, 'Staff', 'Operations');
  const events = [];
  const CHAT_ROOM = { idFromName: (n) => n, get: () => ({ fetch: async (input, init) => { if (String(input.url || input).endsWith('/event')) events.push(JSON.parse(init.body)); return new Response('ok'); } }) };
  const env = { DB: d1, CHAT_ROOM, MAIL_HOOK: (m) => { mails.push(m); return true; }, MEET_RELEASE: 'staff' };
  return { d1, env, mails, events };
}
const run = (w, sql, ...args) => w.d1.db.prepare(sql).run(...args);
const one = (w, sql, ...args) => w.d1.db.prepare(sql).get(...args);

async function dm(w, from, to, body, when) {
  const store = await import('../functions/_lib/chat/db.ts');
  const ch = await store.openConversation(w.env, from.email, [to.email]);
  const p = await store.post(w.env, { channel_id: ch.id, email: from.email, body });
  if (when) {
    run(w, 'UPDATE chat_messages SET created_at = ? WHERE id = ?', when, p.message.id);
    run(w, 'UPDATE chat_mentions SET created_at = ? WHERE message_id = ?', when, p.message.id);
  }
  return { ch, id: p.message.id };
}

describe('questions', () => {
  it('a question mark ending a sentence is a question; one inside a link is not', () => {
    assert.equal(isQuestion('Can you send it today?'), true);
    assert.equal(isQuestion('see https://x.org/a?b=1 for it'), false);
    assert.equal(isQuestion('Done.'), false);
  });
  it('tokens read as names', () => {
    assert.equal(plainText('<@ben@favorintl.org> and <~p:12|Ada Partner>', new Map([['ben@favorintl.org', 'Ben Baker']])), '@Ben Baker and Ada Partner');
  });
});

describe('the test-account wall', () => {
  it('testers reach only each other, real staff never reach a tester', () => {
    assert.equal(mayReach(T1.email, T2.email), true);
    assert.equal(mayReach(T1.email, BEN.email), false);
    assert.equal(mayReach(BEN.email, T2.email), false);
    assert.equal(mayReach(BEN.email, CAL.email), true);
    assert.equal(mayReach(BEN.email, BEN.email), false);
  });
  it('a tester picks only the other tester; staff never see testers', async () => {
    const w = world();
    assert.deepEqual((await peopleFor(w.env, T1.email)).map((p) => p.email), [T2.email]);
    const staff = (await peopleFor(w.env, BEN.email)).map((p) => p.email);
    assert.ok(staff.includes(CAL.email) && !staff.includes(BEN.email) && !staff.includes(T1.email) && !staff.includes(T2.email));
  });
  it('a ping from a tester to a real person goes nowhere', async () => {
    const w = world();
    const r = await ping(w.env, { from: { email: T1.email, name: T1.name }, to: BEN.email, chat: 'hi', subject: 'hi', lines: ['hi'], href: '/', button: 'Open' });
    assert.equal(r.channel, 'none');
    assert.equal(w.mails.length, 0);
  });
});

describe('ping', () => {
  it('goes by Chat when both are in the Chat group, by email when not', async () => {
    const w = world({ chat: 'staff' });
    const a = await ping(w.env, { from: { email: BEN.email, name: BEN.name }, to: CAL.email, chat: 'Handed to you', subject: 's', lines: ['l'], href: '/h/x', button: 'Open' });
    assert.equal(a.channel, 'chat');
    assert.ok(one(w, 'SELECT message_id FROM chat_mentions WHERE email = ? AND kind = ?', CAL.email, 'dm'));
    const w2 = world({ chat: 'admins' });
    const b = await ping(w2.env, { from: { email: BEN.email, name: BEN.name }, to: CAL.email, chat: 'Handed to you', subject: 'Ben handed you a task', lines: ['Ben handed you a task.'], href: '/h/x', button: 'Open it' });
    assert.equal(b.channel, 'email');
    assert.equal(w2.mails.length, 1);
    assert.equal(w2.mails[0].to, CAL.email);
    assert.match(w2.mails[0].html, /https:\/\/dash\.favorintl\.org\/h\/x/);
  });
});

describe('Inbox', () => {
  it('lists a chat mention, a task notice and an expense to sign, and clears each at its source', async () => {
    const w = world();
    const m = await dm(w, BEN, ANN, 'Can you look at the banquet list?');
    run(w, "INSERT INTO hub_tasks (id, title, status, owner_email, created_by, created_at, updated_at) VALUES ('t1', 'Book the room', 'open', ?, ?, ?, ?)", ANN.email, BEN.email, ago(0), ago(0));
    run(w, "INSERT INTO hub_task_notices (id, email, task_id, kind, actor_email, body, created_at) VALUES ('n1', ?, 't1', 'assigned', ?, '', ?)", ANN.email, BEN.email, ago(0));
    const items = await fastItems(w.env, req(), ANN);
    const ids = items.map((i) => i.id);
    assert.ok(ids.includes(`chat:${m.id}`), 'chat mention listed');
    assert.ok(ids.includes('tn:n1'), 'task notice listed');
    const chat = items.find((i) => i.id === `chat:${m.id}`);
    assert.equal(chat.app, 'Chat');
    assert.match(chat.title, /Ben Baker wrote to you/);
    await clearItem(w.env, ANN, `chat:${m.id}`);
    assert.ok(one(w, 'SELECT read_at FROM chat_mentions WHERE message_id = ? AND email = ?', m.id, ANN.email).read_at, 'read at the source');
    await clearItem(w.env, ANN, 'tn:n1');
    assert.ok(one(w, "SELECT read_at FROM hub_task_notices WHERE id = 'n1'").read_at);
    const after = (await fastItems(w.env, req(), ANN)).map((i) => i.id);
    assert.ok(!after.includes(`chat:${m.id}`) && !after.includes('tn:n1'));
    await unclearItem(w.env, ANN, `chat:${m.id}`);
    assert.ok((await fastItems(w.env, req(), ANN)).some((i) => i.id === `chat:${m.id}`), 'Undo puts it back');
  });
  it('a person never sees another person\'s mentions or notices', async () => {
    const w = world();
    await dm(w, BEN, ANN, 'Private to Ann?');
    run(w, "INSERT INTO hub_tasks (id, title, status, owner_email, created_by, created_at, updated_at) VALUES ('t1', 'Ann only', 'open', ?, ?, ?, ?)", ANN.email, BEN.email, ago(0), ago(0));
    run(w, "INSERT INTO hub_task_notices (id, email, task_id, kind, actor_email, body, created_at) VALUES ('n1', ?, 't1', 'assigned', ?, '', ?)", ANN.email, BEN.email, ago(0));
    const cal = await fastItems(w.env, req(), CAL);
    assert.equal(cal.length, 0);
    await assert.rejects(clearItem(w.env, CAL, 'exp:x'), /decide/);
  });
});

describe('Waiting on', () => {
  it('your unanswered question shows with Nudge; an answer takes it off', async () => {
    const w = world();
    const q = await dm(w, ANN, BEN, 'Did the check arrive?', ago(5 * H));
    let list = await fastWaiting(w.env, req(), ANN);
    const line = list.find((i) => i.id === `wc:${q.id}`);
    assert.ok(line, 'listed');
    assert.equal(line.dir, 'out');
    assert.equal(line.nudge.channel, 'chat');
    // Ben sees it as waiting on him.
    const bens = await fastWaiting(w.env, req(), BEN);
    assert.ok(bens.some((i) => i.id === `wi:${q.id}` && i.dir === 'in'));
    // Nudge posts in the same conversation, once a day.
    await nudge(w.env, req(), ANN, `wc:${q.id}`, 'Following up on my question above.');
    const last = one(w, 'SELECT body, email FROM chat_messages WHERE channel_id = ? ORDER BY id DESC LIMIT 1', q.ch.id);
    assert.equal(last.email, ANN.email);
    assert.match(last.body, /Following up/);
    await assert.rejects(nudge(w.env, req(), ANN, `wc:${q.id}`, 'again'), /today/);
    list = await fastWaiting(w.env, req(), ANN);
    assert.ok(list.find((i) => i.id === `wc:${q.id}`).nudged, 'marked nudged');
    // Ben answers: off both lists.
    await dm(w, BEN, ANN, 'Yes, it came Tuesday.');
    assert.ok(!(await fastWaiting(w.env, req(), ANN)).some((i) => i.id === `wc:${q.id}`));
    assert.ok(!(await fastWaiting(w.env, req(), BEN)).some((i) => i.id === `wi:${q.id}`));
  });
  it('a task you gave that has not moved in three days shows; Nudge comments on the task naming the owner', async () => {
    const w = world();
    run(w, "INSERT INTO hub_tasks (id, title, status, owner_email, created_by, created_at, updated_at) VALUES ('t9', 'Send the invoices', 'open', ?, ?, ?, ?)", BEN.email, ANN.email, ago(6 * 24 * H), ago(5 * 24 * H));
    const list = await fastWaiting(w.env, req(), ANN);
    const line = list.find((i) => i.id === 'wt:t9');
    assert.ok(line);
    assert.equal(line.who.email, BEN.email);
    await nudge(w.env, req(), ANN, 'wt:t9', `<@${BEN.email}> checking in on this one.`);
    const c = one(w, "SELECT body, author_email FROM hub_task_comments WHERE task_id = 't9'");
    assert.equal(c.author_email, ANN.email);
    assert.match(c.body, /checking in/);
    assert.ok(one(w, "SELECT 1 AS ok FROM hub_task_notices WHERE email = ? AND task_id = 't9'", BEN.email), 'Ben was told');
  });
  it('Stop waiting takes a line off without touching its source, and Undo brings it back', async () => {
    const w = world();
    run(w, "INSERT INTO hub_tasks (id, title, status, owner_email, created_by, created_at, updated_at) VALUES ('t9', 'Send the invoices', 'open', ?, ?, ?, ?)", BEN.email, ANN.email, ago(6 * 24 * H), ago(5 * 24 * H));
    await stopWaiting(w.env, ANN, 'wt:t9');
    assert.ok(!(await fastWaiting(w.env, req(), ANN)).some((i) => i.id === 'wt:t9'));
    assert.equal(one(w, "SELECT status FROM hub_tasks WHERE id = 't9'").status, 'open');
    await stopWaiting(w.env, ANN, 'wt:t9', true);
    assert.ok((await fastWaiting(w.env, req(), ANN)).some((i) => i.id === 'wt:t9'));
  });
  it('real staff never see a line about a tester', async () => {
    const w = world();
    run(w, "INSERT INTO hub_tasks (id, title, status, owner_email, created_by, created_at, updated_at) VALUES ('tt', 'Test', 'open', ?, ?, ?, ?)", T2.email, ANN.email, ago(6 * 24 * H), ago(5 * 24 * H));
    assert.ok(!(await fastWaiting(w.env, req(), ANN)).some((i) => i.id === 'wt:tt'));
  });
});

describe('Hand off', () => {
  it('a task moves to the teammate with the note, they hear in Chat, and the giver sees when they pick it up', async () => {
    const w = world();
    run(w, "INSERT INTO hub_tasks (id, title, description, status, owner_email, created_by, created_at, updated_at) VALUES ('t5', 'Call the venue', 'Ask about the deposit', 'open', ?, ?, ?, ?)", ANN.email, ANN.email, ago(H), ago(H));
    const h = await handOff(w.env, req('/api/today/handoff'), ANN, { kind: 'task', id: 't5', to: CAL.email, note: 'They expect a call by Friday.' });
    assert.equal(one(w, "SELECT owner_email FROM hub_tasks WHERE id = 't5'").owner_email, CAL.email);
    assert.equal(h.channel, 'chat');
    assert.equal(h.context, 'Ask about the deposit');
    assert.ok(one(w, "SELECT 1 AS ok FROM hub_task_comments WHERE task_id = 't5' AND body LIKE '%by Friday%'"), 'the note is on the task');
    const dmRow = one(w, "SELECT body FROM chat_messages WHERE body LIKE '%Handed to you%' ORDER BY id DESC LIMIT 1");
    assert.match(dmRow.body, new RegExp(`/h/${h.id}`));
    // Cal's Inbox: the hand-off; Ann cannot see it as Cal's.
    const cals = await fastItems(w.env, req(), CAL);
    assert.ok(cals.some((i) => i.id === `ho:${h.id}`));
    assert.ok(!cals.some((i) => i.app === 'Chat' || (i.app === 'Projects' && i.href.includes('t5'))), 'the Chat message and the task notice fold into the hand-off line');
    await assert.rejects(handoffFor(w.env, BEN, h.id), /not yours/);
    // Cal picks it up: Ann's Inbox says so.
    await pickUp(w.env, CAL, h.id);
    const anns = await fastItems(w.env, req(), ANN);
    assert.ok(anns.some((i) => i.id === `hp:${h.id}` && /picked up/.test(i.title)));
    await clearItem(w.env, ANN, `hp:${h.id}`);
    assert.ok(!(await fastItems(w.env, req(), ANN)).some((i) => i.id === `hp:${h.id}`));
  });
  it('reading the task notice counts as picking it up', async () => {
    const w = world();
    run(w, "INSERT INTO hub_tasks (id, title, status, owner_email, created_by, created_at, updated_at) VALUES ('t6', 'Thank the church', 'open', ?, ?, ?, ?)", ANN.email, ANN.email, ago(H), ago(H));
    const h = await handOff(w.env, req('/api/today/handoff'), ANN, { kind: 'task', id: 't6', to: CAL.email, note: '' });
    const n = one(w, "SELECT id FROM hub_task_notices WHERE email = ? AND task_id = 't6'", CAL.email);
    assert.ok(n, 'the task told Cal');
    run(w, 'UPDATE hub_task_notices SET read_at = ? WHERE id = ?', ago(0), n.id);
    await syncPickups(w.env, ANN.email);
    assert.ok(one(w, 'SELECT picked_at FROM hub_handoffs WHERE id = ?', h.id).picked_at);
  });
  it('refuses yourself, people off the staff list, and a tester handing to real staff', async () => {
    const w = world();
    run(w, "INSERT INTO hub_tasks (id, title, status, owner_email, created_by, created_at, updated_at) VALUES ('t7', 'X', 'open', ?, ?, ?, ?)", ANN.email, ANN.email, ago(H), ago(H));
    await assert.rejects(handOff(w.env, req(), ANN, { kind: 'task', id: 't7', to: ANN.email, note: '' }), /other than you/);
    await assert.rejects(handOff(w.env, req(), ANN, { kind: 'task', id: 't7', to: 'stranger@example.com', note: '' }), /staff list/);
    await assert.rejects(handOff(w.env, req(), T1, { kind: 'task', id: 't7', to: BEN.email, note: '' }), /staff list/);
    await assert.rejects(handOff(w.env, req(), ANN, { kind: 'nope', id: 't7', to: BEN.email, note: '' }), /cannot be handed/);
  });
  it('a tester cannot hand off a request (requests are real records)', async () => {
    const w = world();
    await assert.rejects(handOff(w.env, req(), T1, { kind: 'request', id: 'r1', to: T2.email, note: '' }), /test user/);
  });
});

describe('the /api/today route', () => {
  it('answers a signed-in person with their lists, refuses field staff and the agent key, and turns away a cross-site write', async () => {
    const w = world();
    const { onRequest } = await import('../functions/api/today/[[path]].ts');
    const { withUserHeaders } = await import('../functions/_lib/session.ts');
    const call = async (user, method, path, body, headers = {}) => {
      let r = new Request('https://dash.favorintl.org/api/today/' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1', ...headers }, body: body ? JSON.stringify(body) : undefined });
      if (user) r = withUserHeaders(r, user);
      const res = await onRequest({ request: r, env: w.env, params: { path: path.split('?')[0].split('/') }, waitUntil: () => {}, next: async () => new Response(''), data: {} });
      return { status: res.status, data: await res.json() };
    };
    const a = await call(ANN, 'GET', 'inbox?part=fast');
    assert.equal(a.status, 200);
    assert.ok(Array.isArray(a.data.items));
    const b = await call(ANN, 'GET', 'waiting?part=fast');
    assert.equal(b.status, 200);
    const m = await call(ANN, 'GET', 'inbox?part=mail');
    assert.equal(m.status, 200);
    assert.equal(m.data.connected, false, 'no Google connected: no mail part');
    assert.equal((await call({ ...BEN, role: 'field' }, 'GET', 'inbox')).status, 403);
    assert.equal((await call({ email: 'agent', name: 'Agent', role: 'admin', via: 'agent' }, 'GET', 'inbox')).status, 403);
    assert.equal((await call(ANN, 'POST', 'waiting/stop', { id: 'wt:x' }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await call(null, 'GET', 'inbox')).status, 401);
    const p = await call(T1, 'GET', 'people');
    assert.deepEqual(p.data.people.map((x) => x.email), [T2.email]);
  });
});

const { mentionEvents, guessType, markLogged, noteLogged, patterns } = await import('../functions/_lib/integrations/mentions.ts');

describe('partner mentions on the partner page', () => {
  it('reads the kind of contact from the words, a phone call when nothing says', () => {
    assert.equal(guessType('Met Ada for coffee'), 'Meeting');
    assert.equal(guessType('emailed her the report'), 'Email');
    assert.equal(guessType('Ada is thinking about the match'), 'Phone call');
    assert.equal(patterns('12', 'Ada').phrase, '', 'a one-word name is not searched');
  });
  it('a task or request that names the partner shows as a mention to people who can open it, with a prefilled log line', async () => {
    const w = world();
    const at = ago(H);
    run(w, "INSERT INTO hub_projects (id, key, name, lead_email, visibility, status, created_by, created_at, updated_at) VALUES ('pm', 'PM', 'Members only', ?, 'members', 'active', ?, ?, ?)", BEN.email, BEN.email, at, at);
    run(w, "INSERT INTO hub_project_members (project_id, email, role, added_at) VALUES ('pm', ?, 'lead', ?)", BEN.email, at);
    run(w, "INSERT INTO hub_tasks (id, project_id, title, description, status, owner_email, created_by, created_at, updated_at) VALUES ('tm', 'pm', 'Call Ada Lovelace about the match', 'She asked about the spring match', 'open', ?, ?, ?, ?)", BEN.email, BEN.email, at, at);
    run(w, "INSERT INTO requests (id, title, body, surface, status, submitter_name, submitter_email, created_at, updated_at) VALUES ('rm', 'Thank-you video for Ada Lovelace', 'Met Ada Lovelace at the banquet', 'dashboard', 'approved', 'Cal Cook', ?, ?, ?)", CAL.email, at, at);
    const ben = await mentionEvents(w.env, BEN.email, '77', 'Ada Lovelace');
    assert.ok(ben.some((e) => e.id === 'task:tm' && e.kind === 'mention' && e.log && e.log.source === 'task:tm'), 'Ben sees the task mention');
    const req = ben.find((e) => e.id === 'req:rm');
    assert.ok(req, 'requests are open to staff');
    assert.equal(req.log.type, 'Meeting', 'Met ... reads as a meeting');
    const cal = await mentionEvents(w.env, CAL.email, '77', 'Ada Lovelace');
    assert.ok(!cal.some((e) => e.id === 'task:tm'), 'Cal is not in the members-only project');
    // Saving the prefilled contact marks the line.
    await noteLogged(w.env, BEN.email, '77', 'task:tm');
    const list = [{ id: 'task:tm', log: {} }, { id: 'req:rm', log: {} }];
    await markLogged(w.env, '77', list);
    assert.equal(list[0].logged, true);
    assert.ok(!list[1].logged);
  });
});
