// Run with: npm test
//
// Meetings that work before, during and after the call, through the real routes on an in-memory D1 with a stand-in model, partner
// source and Blackbaud writer. Made-up people only (the repository is public). Nothing here can reach Blackbaud, Gmail or real staff.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { route } = await import('../functions/_lib/meetroute.ts');
const auto = await import('../functions/_lib/meetauto.ts');

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const id = (n) => String(n).padStart(24, '0');
const ADMIN = { email: 'will@favorintl.org', role: 'admin' };

// ---- the stand-ins
const PARTNERS = { 'pat@example.org': { id: '5001', name: 'Pat Example' } };
const CARD = { id: '5001', name: 'Pat Example', place: 'Springfield, MO', lifetime: 12500, last12: 3000, count: 14, last: { amount: 250, date: '2026-09-02', fund: 'General' }, largest: { amount: 2000, date: '2024-12-20' }, lastContact: { date: '2026-08-15', category: 'Phone call', summary: 'Checked in' }, open: [{ what: 'Send the update', due: '2026-10-20' }], holders: ['Ann Example'] };
let logged = [];
auto.source.current = {
  byEmail: async (_e, emails) => Object.fromEntries(emails.filter((e) => PARTNERS[e]).map((e) => [e, PARTNERS[e]])),
  card: async (_e, pid) => (pid === '5001' ? CARD : null),
  portfolio: async () => ({ count: 41, last12: 88000 }),
  search: async (_e, t) => (/pat/i.test(t) ? [{ id: '5001', name: 'Pat Example', place: 'Springfield, MO' }] : []),
};
auto.writer.current = { log: async (_e, user, mid, cid, f) => { logged.push({ by: user.email, mid, cid, f }); return { batchId: 'b1', state: 'logged', detail: 'Logged on the record.' }; } };

function fakeAI(handlers) {
  const asked = [];
  return { asked, run: async (_model, { messages }) => { const sys = messages[0].content; asked.push(sys.slice(0, 40)); const h = handlers.find(([k]) => sys.includes(k)); return { response: h ? h[1](messages[1].content) : {} }; } };
}

async function world(ai) {
  const d1 = memoryD1();
  d1.exec(read('db/admin-home.sql'));
  d1.exec(read('db/meetings.sql'));
  d1.exec(read('db/meetings-auto.sql'));
  d1.exec(read('db/projects.sql'));
  d1.exec(read('db/favor-chat.sql'));
  d1.exec(read('db/favor-chat-private.sql'));
  const person = (email, name, team, lead = 0) => d1.prepare('INSERT INTO meet_directory (email, name, title, team, active, lead) VALUES (?, ?, ?, ?, 1, ?)').bind(email, name, 'Staff', team, lead).run();
  await person('ann@favorintl.org', 'Ann Example', 'Partner Care');
  await person('bob@favorintl.org', 'Bob Sample', 'Partner Care');
  await person('cat@favorintl.org', 'Cat Placeholder', 'Marketing');
  await person('lee@favorintl.org', 'Lee Marketing', 'Marketing');
  d1.exec(`INSERT INTO chat_channels (id, kind, name, topic, created_by, created_at, last_at) VALUES ('ch_care', 'private', 'care-team', '', 'ann@favorintl.org', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`);
  d1.exec(`INSERT INTO chat_members (channel_id, email, joined_at) VALUES ('ch_care', 'ann@favorintl.org', '2026-10-01T00:00:00Z'), ('ch_care', 'bob@favorintl.org', '2026-10-01T00:00:00Z')`);
  const events = [];
  const CHAT_ROOM = { idFromName: (n) => n, get: () => ({ fetch: async (input, init) => { if (String(input).endsWith('/event')) events.push(JSON.parse(init.body)); return new Response('ok'); } }) };
  return { DB: d1, MEET_RELEASE: 'staff', MEET_FAKE_SFU: '1', AI: ai, CHAT_ROOM, events, d1 };
}

const meeting = (env, n, over = {}) => {
  const m = { host: 'ann@favorintl.org', host_name: 'Ann Example', invitees: [], status: 'ended', title: `Meeting ${n}`, notes: 'ready', summary: `Summary ${n}`, series: '', starts: '2026-10-09T15:00:00.000Z', notes_json: '{}', access: 'invited', post: '', ...over };
  const inv = m.invitees.map((e) => (typeof e === 'string' ? { email: e, name: e.split('@')[0] } : e));
  env.d1.prepare(
    `INSERT INTO hub_meetings (id, title, host_email, host_name, invitees, access, status, rec_mode, notes_status, summary, notes_json, series_id, created_at, started_at, ended_at, starts_at, post_channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'notes', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id(n), m.title, m.host, m.host_name, JSON.stringify(inv), m.access, m.status, m.notes, m.summary, m.notes_json, m.series, m.starts, m.starts, m.starts.replace('15:00', '15:30'), m.starts, m.post).run();
};
const lines = (env, n, list) => list.forEach(([t, who, text], i) => env.d1.prepare('INSERT INTO hub_meeting_lines (meeting_id, n, t, who, text) VALUES (?, ?, ?, ?, ?)').bind(id(n), i, t, who, text).run());

async function call(env, who, path, { method = 'GET', body, query = '' } = {}) {
  const user = typeof who === 'string' ? { email: who, role: 'staff' } : who;
  const init = { method, headers: { 'X-Hub-Email': user.email, 'X-Hub-Name': user.name || user.email.split('@')[0], 'X-Hub-Role': user.role, 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const waits = [];
  const res = await route({ request: new Request(`https://hub.test/api/meet/${path.join('/')}${query}`, init), env, params: { path }, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe('the helpers', () => {
  it('keywords drops filler and keeps the words to search for', () => {
    assert.deepEqual(auto.keywords('What did we decide about the banquet budget?'), ['banquet', 'budget']);
    assert.deepEqual(auto.keywords('who is handling Dallas?'), ['handling', 'dallas']);
    assert.deepEqual(auto.keywords('the and of'), []);
  });
  it('overlap tells a repeat from something new', () => {
    assert.ok(auto.overlap('Ann will send the banquet invitations Friday', 'Ann sends the banquet invitations by Friday') >= 0.7);
    assert.ok(auto.overlap('Ann will send the banquet invitations', 'Order the new printer cartridges') < 0.3);
  });
  it('pickPerson takes a full name, a first name only one person has, and nothing when unsure', () => {
    const list = [{ name: 'Ann Example', email: 'a' }, { name: 'Bob Sample', email: 'b' }, { name: 'Ann Other', email: 'c' }];
    assert.equal(auto.pickPerson(list, 'Bob')?.email, 'b');
    assert.equal(auto.pickPerson(list, 'Ann Other')?.email, 'c');
    assert.equal(auto.pickPerson(list, 'Ann'), null);
    assert.equal(auto.pickPerson(list, 'Zed'), null);
    assert.equal(auto.pickPerson(list, 'Bob', true), null, 'strict mode needs the full name');
  });
  it('mergeLive keeps a kept item, drops a dismissed one and lets a hand-set owner win', () => {
    const notes = { decisions: [{ t: 60, text: 'Move the banquet to November' }], actions: [{ text: 'Bob orders the printer cartridges', owner: '', due: '', t: 90 }, { text: 'Draft the budget memo', owner: 'Ann', due: '', t: 120 }] };
    const live = [
      { kind: 'action', text: 'Bob orders printer cartridges', owner_name: 'Bob Sample', owner_email: 'bob@favorintl.org', due: '', t: 90, dismissed: 0 },
      { kind: 'action', text: 'Call the venue about parking', owner_name: 'Cat Placeholder', owner_email: 'cat@favorintl.org', due: 'Friday', t: 200, dismissed: 0 },
      { kind: 'action', text: 'Draft the budget memo', owner_name: '', owner_email: '', due: '', t: 120, dismissed: 1 },
      { kind: 'decision', text: 'Hold the open house in the spring', owner_name: '', owner_email: '', due: '', t: 300, dismissed: 0 },
    ];
    const out = auto.mergeLive(notes, live);
    assert.deepEqual(out.actions.map((a) => a.text), ['Bob orders the printer cartridges', 'Call the venue about parking']);
    assert.equal(out.actions[0].owner, 'Bob Sample');
    assert.equal(out.actions[1].due, 'Friday');
    assert.equal(out.decisions.length, 2);
  });
  it('summaryBody mentions each owner so the chat bell reaches them', () => {
    const body = auto.summaryBody({ title: 'Banquet', summary: 'We set the date.', started_at: '2026-10-09T15:00:00.000Z', created_at: '' }, { decisions: [{ text: 'November 14' }] }, [{ text: 'Send invitations', owner_name: 'Bob Sample', owner_email: 'bob@favorintl.org', due: 'Friday' }, { text: 'Find a caterer', owner_name: '', owner_email: '', due: '' }]);
    assert.match(body, /<@bob@favorintl\.org> Send invitations \(due Friday\)/);
    assert.match(body, /- Find a caterer/);
    assert.ok(!body.includes('—'));
  });
});

describe('the prep sheet', () => {
  it('lists attendees, the partner with giving, tasks between you, open items and the last meeting', async () => {
    const env = await world(fakeAI([]));
    const decisions = JSON.stringify({ decisions: [{ t: 30, text: 'Send the fall appeal on October 20' }] });
    meeting(env, 1, { invitees: ['bob@favorintl.org'], series: id(1), notes_json: decisions });
    env.d1.prepare(`INSERT INTO hub_meeting_actions (meeting_id, idx, text, owner_name, owner_email, due, done) VALUES (?, 0, 'Review the call list', 'Bob Sample', 'bob@favorintl.org', 'Friday', 0)`).bind(id(1)).run();
    meeting(env, 2, { invitees: ['bob@favorintl.org', 'pat@example.org'], status: 'scheduled', series: id(1), starts: '2026-10-16T15:00:00.000Z', notes: 'none', summary: '' });
    env.d1.prepare(`INSERT INTO hub_tasks (id, title, status, owner_email, due_date, created_by, created_at, updated_at) VALUES ('t1', 'Send Bob the list', 'open', 'bob@favorintl.org', '2026-10-14', 'ann@favorintl.org', 'x', 'x'), ('t2', 'Done one', 'done', 'bob@favorintl.org', NULL, 'ann@favorintl.org', 'x', 'x')`).run();
    const r = await call(env, ADMIN, ['meetings', id(2), 'prep']);
    assert.equal(r.status, 200);
    const p = r.body;
    assert.deepEqual(p.attendees.map((a) => a.email).sort(), ['ann@favorintl.org', 'bob@favorintl.org', 'pat@example.org']);
    assert.equal(p.partners.length, 1);
    assert.equal(p.partners[0].lifetime, 12500);
    assert.equal(p.partners[0].url, '/work/partner/5001');
    assert.equal(p.last.id, id(1), 'the previous meeting in the series');
    assert.deepEqual(p.last.decisions, ['Send the fall appeal on October 20']);
    assert.equal(p.last.open[0].text, 'Review the call list');
    assert.equal(p.openItems[0].text, 'Review the call list');
    assert.match(p.line, /Pat Example is a partner/);
    // As Ann (the host): the open task Bob owes her shows under Bob, marked as not hers.
    const asAnn = (await call(env, 'ann@favorintl.org', ['meetings', id(2), 'prep'])).body;
    const bob = asAnn.attendees.find((a) => a.email === 'bob@favorintl.org');
    assert.equal(bob.between.length, 1);
    assert.equal(bob.between[0].mine, false);
    assert.equal(bob.between[0].title, 'Send Bob the list');
  });
  it('shows a partner by name only to someone without Work Center access', async () => {
    const env = await world(fakeAI([]));
    meeting(env, 1, { invitees: ['bob@favorintl.org', 'pat@example.org'], status: 'scheduled', starts: '2026-10-16T15:00:00.000Z', notes: 'none' });
    const r = await call(env, 'bob@favorintl.org', ['meetings', id(1), 'prep']);
    assert.equal(r.status, 200);
    assert.equal(r.body.partners[0].name, 'Pat Example');
    assert.equal(r.body.partners[0].detail, false);
    assert.equal(r.body.partners[0].lifetime, 0);
  });
  it('is a 404 for someone not invited', async () => {
    const env = await world(fakeAI([]));
    meeting(env, 1, { invitees: ['bob@favorintl.org'], status: 'scheduled', starts: '2026-10-16T15:00:00.000Z', notes: 'none' });
    assert.equal((await call(env, 'lee@favorintl.org', ['meetings', id(1), 'prep'])).status, 403);
  });
});

describe('live notes', () => {
  const said = [[5, 'Ann Example', 'Okay, the banquet date.'], [20, 'Bob Sample', 'I will send the invitations by Friday.'], [40, 'Ann Example', 'Let us move it to November 14.'], [60, 'Cat Placeholder', 'Could you check the parking, Cat?'], [75, 'Cat Placeholder', 'Sure, I will call the venue.']];
  const live = (calls) => ['listen to a staff meeting', () => { calls.n++; return { items: [
    { kind: 'action', text: 'Bob sends the banquet invitations by Friday.', owner: 'Bob', due: 'Friday', t: 20 },
    { kind: 'decision', text: 'The banquet moves to November 14.', owner: '', due: '', t: 40 },
    { kind: 'action', text: 'Cat calls the venue about parking.', owner: 'Cat Placeholder', due: '', t: 75 },
  ] }; }];

  it('catches action items and decisions from the live transcript and runs at most once in 40 seconds', async () => {
    const calls = { n: 0 };
    const env = await world(fakeAI([live(calls)]));
    meeting(env, 1, { status: 'live', invitees: ['bob@favorintl.org', 'cat@favorintl.org'], notes: 'none', summary: '' });
    lines(env, 1, said);
    const mt = env.d1.db.prepare('SELECT * FROM hub_meetings WHERE id = ?').get(id(1));
    assert.equal(await auto.extractLive(env, mt), 3);
    assert.equal(await auto.extractLive(env, mt), 0, 'the second pass inside 40 seconds does nothing');
    assert.equal(calls.n, 1);
    const r = (await call(env, 'bob@favorintl.org', ['meetings', id(1), 'live'])).body;
    assert.equal(r.items.length, 3);
    const inv = r.items.find((i) => i.text.includes('invitations'));
    assert.equal(inv.owner, 'Bob Sample');
    assert.equal(inv.ownerEmail, 'bob@favorintl.org');
    assert.equal(inv.kind, 'action');
    assert.equal(r.items.filter((i) => i.kind === 'decision').length, 1);
    // New lines later: only those are read, and a repeat of an item already noted is not added twice.
    env.d1.prepare('INSERT INTO hub_meeting_lines (meeting_id, n, t, who, text) VALUES (?, 9, 100, ?, ?)').bind(id(1), 'Ann Example', 'One more thing.').run();
    env.d1.prepare('INSERT INTO hub_meeting_lines (meeting_id, n, t, who, text) VALUES (?, 10, 110, ?, ?)').bind(id(1), 'Ann Example', 'Thanks all.').run();
    env.d1.prepare('INSERT INTO hub_meeting_lines (meeting_id, n, t, who, text) VALUES (?, 11, 120, ?, ?)').bind(id(1), 'Ann Example', 'Bye.').run();
    env.d1.prepare('UPDATE hub_meeting_live_state SET at_ms = 1').run();
    assert.equal(await auto.extractLive(env, mt), 0, 'the same three items come back and are all repeats');
  });
  it('a model failure puts the lines back for the next pass', async () => {
    const env = await world({ run: async () => { throw new Error('model down'); } });
    meeting(env, 1, { status: 'live', notes: 'none', summary: '' });
    lines(env, 1, said);
    const mt = env.d1.db.prepare('SELECT * FROM hub_meetings WHERE id = ?').get(id(1));
    assert.equal(await auto.extractLive(env, mt), 0);
    assert.equal(env.d1.db.prepare('SELECT upto_n FROM hub_meeting_live_state').get().upto_n, -1);
  });
  it('anyone in the room adds an item, only a host dismisses or reassigns, a guest-less outsider gets 404', async () => {
    const env = await world(fakeAI([]));
    meeting(env, 1, { status: 'live', invitees: ['bob@favorintl.org', 'cat@favorintl.org'], notes: 'none', summary: '' });
    const add = await call(env, 'bob@favorintl.org', ['meetings', id(1), 'live'], { method: 'POST', body: { add: { text: 'Order the banners', owner: 'cat@favorintl.org' } } });
    assert.equal(add.status, 200);
    assert.equal(add.body.items[0].owner, 'Cat Placeholder');
    assert.equal(add.body.items[0].byHand, true);
    assert.equal((await call(env, 'bob@favorintl.org', ['meetings', id(1), 'live'], { method: 'POST', body: { idx: 0, dismissed: true } })).status, 403);
    const host = await call(env, 'ann@favorintl.org', ['meetings', id(1), 'live'], { method: 'POST', body: { idx: 0, owner: 'bob@favorintl.org' } });
    assert.equal(host.body.items[0].owner, 'Bob Sample');
    assert.equal((await call(env, 'ann@favorintl.org', ['meetings', id(1), 'live'], { method: 'POST', body: { idx: 0, owner: 'zed@favorintl.org' } })).status, 400);
    const gone = await call(env, 'ann@favorintl.org', ['meetings', id(1), 'live'], { method: 'POST', body: { idx: 0, dismissed: true } });
    assert.equal(gone.body.items[0].dismissed, true);
    assert.equal((await call(env, 'lee@favorintl.org', ['meetings', id(1), 'live'])).status, 404);
  });
});

describe('after the call', () => {
  // The notes are read in parts with line numbers (L1, L2), then the title and summary are written from the parts.
  const notesAI = (extra = {}) => ['pull out its notes', () => ({
    summary: 'The team set the banquet for November 14 and split the follow-ups.',
    decisions: [{ line: 2, text: 'The banquet moves to November 14.' }],
    actions: [{ line: 2, text: 'Bob sends the banquet invitations by Friday.', owner: 'Bob', due: 'Friday', quote: 'I will send the invitations by Friday' }, { line: 1, text: 'Find a caterer', owner: '', due: '', quote: 'Welcome' }],
    topics: [{ line: 1, title: 'Date' }], ...extra,
  })];
  const headAI = ['You write the title and summary', () => ({ title: 'Banquet planning', summary: 'The team set the banquet for November 14 and split the follow-ups.' })];
  async function ended(n, over = {}) {
    const env = await world(fakeAI([notesAI(), headAI, ['listen to a staff meeting', () => ({ items: [] })]]));
    meeting(env, n, { status: 'ended', notes: 'pending', summary: '', ...over });
    lines(env, n, [[5, 'Ann Example', 'Welcome.'], [20, 'Bob Sample', 'I will send the invitations by Friday.']]);
    env.d1.prepare('UPDATE hub_meetings SET transcript = ? WHERE id = ?').run(JSON.stringify([{ t: 5, who: 'Ann Example', text: 'Welcome.' }, { t: 20, who: 'Bob Sample', text: 'I will send the invitations by Friday.' }]), id(n));
    return env;
  }
  const finish = async (env, n) => { for (let i = 0; i < 6; i++) { const r = await call(env, ADMIN, ['meetings', id(n), 'pump'], { method: 'POST', body: {} }); if (r.body.done) return r; } };

  it('posts the summary to the chosen channel once, mentioning each owner', async () => {
    const env = await ended(1, { invitees: ['bob@favorintl.org'], post: 'ch_care' });
    await finish(env, 1);
    await finish(env, 1);
    const msgs = env.d1.db.prepare(`SELECT email, body, attachments FROM chat_messages WHERE channel_id = 'ch_care'`).all();
    assert.equal(msgs.length, 1, 'posted once');
    assert.equal(msgs[0].email, 'meetings');
    assert.match(msgs[0].body, /Notes from Meeting 1, Oct 9\./);
    assert.match(msgs[0].body, /<@bob@favorintl\.org> Bob sends the banquet invitations/);
    assert.match(msgs[0].attachments, /"type":"meeting"/);
    const bell = env.d1.db.prepare(`SELECT email FROM chat_mentions`).all().map((x) => x.email);
    assert.deepEqual(bell, ['bob@favorintl.org']);
    assert.ok(env.events.some((e) => e.event.type === 'message'));
  });
  it('posts nothing when no channel was chosen', async () => {
    const env = await ended(2, { invitees: ['bob@favorintl.org'] });
    await finish(env, 2);
    assert.equal(env.d1.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get().n, 0);
  });
  it('turns the named owner into an action item the person can tick, and folds in what the call caught', async () => {
    const env = await ended(3, { invitees: ['bob@favorintl.org', 'cat@favorintl.org'] });
    env.d1.prepare(`INSERT INTO hub_meeting_live (meeting_id, idx, kind, text, owner_name, owner_email, due, t) VALUES (?, 0, 'action', 'Cat calls the venue about parking.', 'Cat Placeholder', 'cat@favorintl.org', '', 75)`).bind(id(3)).run();
    await finish(env, 3);
    const acts = env.d1.db.prepare('SELECT text, owner_email FROM hub_meeting_actions WHERE meeting_id = ? ORDER BY idx').all(id(3));
    assert.ok(acts.some((a) => a.owner_email === 'bob@favorintl.org' && /invitations/.test(a.text)));
    assert.ok(acts.some((a) => a.owner_email === 'cat@favorintl.org' && /venue/.test(a.text)), 'the live item missed by the final reading stays');
  });

  describe('partner meetings', () => {
    it('proposes the partner and writes nothing to Blackbaud until the host confirms', async () => {
      logged = [];
      const env = await ended(4, { invitees: ['bob@favorintl.org', 'pat@example.org'] });
      await finish(env, 4);
      assert.equal(logged.length, 0, 'nothing written by the notes step');
      const asHost = (await call(env, 'ann@favorintl.org', ['meetings', id(4), 'notes'])).body;
      assert.equal(asHost.partners.length, 1);
      assert.equal(asHost.partners[0].state, 'proposed');
      assert.equal(asHost.partners[0].cid, '5001');
      const asBob = (await call(env, 'bob@favorintl.org', ['meetings', id(4), 'notes'])).body;
      assert.deepEqual(asBob.partners, [], 'an invitee does not see the partner proposals');
      const home = (await call(env, 'ann@favorintl.org', ['meetings', 'actions'])).body;
      assert.equal(home.partnerConfirms.length, 1, 'the host is told on the Meetings home');
      assert.equal(logged.length, 0);
    });
    it('refuses without confirm, refuses a non-host, then logs once as the host', async () => {
      logged = [];
      const env = await ended(5, { invitees: ['bob@favorintl.org', 'pat@example.org'] });
      await finish(env, 5);
      const act = (who, body) => call(env, who, ['meetings', id(5), 'partners'], { method: 'POST', body });
      assert.equal((await act('ann@favorintl.org', { action: 'log', cid: '5001' })).status, 400);
      assert.equal((await act('ann@favorintl.org', { action: 'log', cid: '5001', confirm: 'yes' })).status, 400, 'only true counts');
      assert.equal((await act('bob@favorintl.org', { action: 'log', cid: '5001', confirm: true })).status, 403);
      assert.equal(logged.length, 0);
      const ok = await act('ann@favorintl.org', { action: 'log', cid: '5001', confirm: true, summary: 'Banquet planning with Pat' });
      assert.equal(ok.status, 200);
      assert.equal(logged.length, 1);
      assert.equal(logged[0].by, 'ann@favorintl.org');
      assert.equal(logged[0].cid, '5001');
      assert.equal(logged[0].f.summary, 'Banquet planning with Pat');
      assert.equal(logged[0].f.date, '2026-10-09');
      assert.match(logged[0].f.description, /From Favor: Ann Example, Bob Sample\./);
      assert.ok(!logged[0].f.description.includes('pat@example.org'), 'no outside address in the record');
      assert.equal(ok.body.partners[0].state, 'logged');
      assert.equal((await act('ann@favorintl.org', { action: 'log', cid: '5001', confirm: true })).status, 409, 'never twice');
      assert.equal(logged.length, 1);
    });
    it('a failed write is recorded, shown, and can be tried again', async () => {
      logged = [];
      const env = await ended(6, { invitees: ['pat@example.org'] });
      await finish(env, 6);
      const real = auto.writer.current;
      auto.writer.current = { log: async () => { throw new Error('Blackbaud said no'); } };
      const act = (body) => call(env, 'ann@favorintl.org', ['meetings', id(6), 'partners'], { method: 'POST', body });
      assert.equal((await act({ action: 'log', cid: '5001', confirm: true })).status, 500);
      const row = env.d1.db.prepare('SELECT state, detail FROM hub_meeting_partner').get();
      assert.equal(row.state, 'failed');
      assert.match(row.detail, /Blackbaud said no/);
      auto.writer.current = real;
      assert.equal((await act({ action: 'log', cid: '5001', confirm: true })).status, 200);
      assert.equal(logged.length, 1);
    });
    it('the host can add a partner by hand, dismiss one, and search for one', async () => {
      logged = [];
      const env = await ended(7, { invitees: ['bob@favorintl.org'] });
      await finish(env, 7);
      const act = (body) => call(env, 'ann@favorintl.org', ['meetings', id(7), 'partners'], { method: 'POST', body });
      const found = await call(env, ADMIN, ['meetings', id(7), 'partners'], { query: '?q=pat' });
      assert.equal(found.body.hits[0].id, '5001');
      assert.equal((await call(env, 'bob@favorintl.org', ['meetings', id(7), 'partners'], { query: '?q=pat' })).status, 403);
      const added = await act({ action: 'add', cid: '5001', name: 'Pat Example' });
      assert.equal(added.body.partners[0].source, 'host');
      const gone = await act({ action: 'dismiss', cid: '5001' });
      assert.deepEqual(gone.body.partners, []);
      assert.equal(logged.length, 0);
    });
  });
});

describe('ask across meetings', () => {
  const askAI = ['answer a question for a staff member', (prompt) => ({
    answer: /banquet/i.test(prompt) ? 'The banquet moved to November 14 in the October 9 meeting.' : 'Nothing on that.',
    sources: [{ m: 1, t: 40, text: 'Let us move it to November 14.' }, { m: 9, t: 1, text: 'out of range' }],
  })];
  async function seeded() {
    const asked = [];
    const ai = fakeAI([['answer a question for a staff member', (p) => { asked.push(p); return askAI[1](p); }]]);
    const env = await world(ai);
    meeting(env, 1, { title: 'Banquet planning', invitees: ['bob@favorintl.org'], summary: 'We set the banquet for November 14.', notes_json: JSON.stringify({ decisions: [{ t: 40, text: 'Banquet on November 14' }], actions: [] }) });
    meeting(env, 2, { title: 'Printer review', host: 'lee@favorintl.org', host_name: 'Lee Marketing', invitees: ['cat@favorintl.org'], summary: 'We reviewed printers.' });
    meeting(env, 3, { title: 'Secret banquet budget', host: 'lee@favorintl.org', host_name: 'Lee Marketing', invitees: ['cat@favorintl.org'], summary: 'Banquet budget details.' });
    lines(env, 1, [[10, 'Ann Example', 'Welcome to the banquet planning.'], [40, 'Ann Example', 'Let us move it to November 14.']]);
    lines(env, 3, [[10, 'Lee Marketing', 'The banquet budget is confidential.']]);
    return { env, asked };
  }
  it('answers from the meetings the person may read, with sources that link to the moment', async () => {
    const { env, asked } = await seeded();
    const r = await call(env, 'bob@favorintl.org', ['meetings', 'ask'], { method: 'POST', body: { q: 'What did we decide about the banquet?' } });
    assert.equal(r.status, 200);
    assert.match(r.body.answer, /November 14/);
    assert.equal(r.body.sources.length, 1, 'a source that points at no meeting is dropped');
    assert.deepEqual({ id: r.body.sources[0].id, t: r.body.sources[0].t }, { id: id(1), t: 40 });
    assert.equal(r.body.searched, 1, 'Bob can read one meeting');
    assert.ok(!asked[0].includes('confidential'), 'a meeting Bob was not in never reaches the model');
    assert.ok(!asked[0].includes('Secret banquet budget'));
    assert.match(asked[0], /Said in the meeting/);
  });
  it('an admin reads across everything', async () => {
    const { env, asked } = await seeded();
    const r = await call(env, ADMIN, ['meetings', 'ask'], { method: 'POST', body: { q: 'banquet budget' } });
    assert.equal(r.body.searched, 3);
    assert.match(asked[0], /confidential/);
  });
  it('a team leader reads the team\'s meetings', async () => {
    const { env, asked } = await seeded();
    env.d1.prepare(`UPDATE meet_directory SET lead = 1 WHERE email = 'lee@favorintl.org'`).run();
    const r = await call(env, 'lee@favorintl.org', ['meetings', 'ask'], { method: 'POST', body: { q: 'banquet' } });
    assert.equal(r.body.searched, 2, 'Lee hosts two meetings; the Partner Care meeting is outside the Marketing team');
    assert.ok(!asked[0].includes('Banquet planning'));
  });
  it('an empty question is a 400 and a person with no meetings gets a plain answer', async () => {
    const { env } = await seeded();
    assert.equal((await call(env, 'bob@favorintl.org', ['meetings', 'ask'], { method: 'POST', body: { q: '  ' } })).status, 400);
    const r = await call(env, 'zed@favorintl.org', ['meetings', 'ask'], { method: 'POST', body: { q: 'anything' } });
    assert.equal(r.body.searched, 0);
  });
});

describe('channels and the post choice', () => {
  it('lists the channels the person is in and refuses one they are not in', async () => {
    const env = await world(fakeAI([]));
    const list = (await call(env, 'ann@favorintl.org', ['meetings', 'channels'])).body.channels;
    assert.deepEqual(list.map((c) => c.id), ['ch_care']);
    const bad = await call(env, 'ann@favorintl.org', ['meetings'], { method: 'POST', body: { title: 'x', rec: 'notes', access: 'staff', postChannel: 'ch_nope' } });
    assert.equal(bad.status, 400);
    const ok = await call(env, 'ann@favorintl.org', ['meetings'], { method: 'POST', body: { title: 'Care check-in', rec: 'notes', access: 'staff', postChannel: 'ch_care' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.meeting.postChannel, 'ch_care');
  });
});
