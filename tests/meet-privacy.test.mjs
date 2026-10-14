// Run with: npm test
//
// Meetings: private moments, cutting a stretch of a finished meeting, and the notes checks. Real routes on an in-memory D1 with a
// stand-in model. Made-up people only (the repository is public). No Drive, Brain index, email or Chat outside the in-memory tables.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { route } = await import('../functions/_lib/meetroute.ts');
const priv = await import('../functions/_lib/meetprivacy.ts');
const drive = await import('../functions/_lib/meetdrive.ts');

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const id = (n) => String(n).padStart(24, '0');
const ADMIN = { email: 'will@favorintl.org', role: 'admin' };
const HOST = 'ann@favorintl.org';

function fakeAI(handlers) {
  const asked = [];
  return { asked, run: async (_model, { messages }) => { const sys = messages[0].content; asked.push({ sys, user: messages[1].content }); const h = handlers.find(([k]) => sys.includes(k)); return { response: h ? h[1](messages[1].content) : {} }; } };
}

async function world(ai) {
  const d1 = memoryD1();
  d1.exec(read('db/admin-home.sql'));
  d1.exec(read('db/meetings.sql'));
  d1.exec(read('db/meetings-auto.sql'));
  d1.exec(read('db/meetings-privacy.sql'));
  d1.exec(read('db/projects.sql'));
  d1.exec(read('db/favor-chat.sql'));
  d1.exec(read('db/favor-chat-private.sql'));
  for (const [email, name, team] of [[HOST, 'Ann Example', 'Partner Care'], ['bob@favorintl.org', 'Bob Sample', 'Partner Care']]) await d1.prepare('INSERT INTO meet_directory (email, name, title, team, active, lead) VALUES (?, ?, ?, ?, 1, 0)').bind(email, name, 'Staff', team).run();
  const r2 = new Map();
  const CLIPS = { put: async (k, v) => { r2.set(k, v); }, get: async (k) => (r2.has(k) ? { arrayBuffer: async () => r2.get(k) } : null), delete: async (k) => { for (const x of [].concat(k)) r2.delete(x); } };
  const CHAT_ROOM = { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('ok') }) };
  return { DB: d1, MEET_RELEASE: 'staff', MEET_FAKE_SFU: '1', AI: ai, CLIPS, CHAT_ROOM, d1, r2 };
}

async function call(env, who, path, { method = 'GET', body, query = '', raw, headers = {} } = {}) {
  const user = typeof who === 'string' ? { email: who, role: 'staff' } : who;
  const init = { method, headers: { 'X-Hub-Email': user.email, 'X-Hub-Name': user.name || user.email.split('@')[0], 'X-Hub-Role': user.role, 'content-type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (raw !== undefined) init.body = raw;
  const res = await route({ request: new Request(`https://hub.test/api/meet/${path.join('/')}${query}`, init), env, params: { path }, waitUntil: () => undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// A finished meeting: business first, then prayer requests from 3:00 to the end.
const SAID = [
  [5, 'Ann Example', 'Welcome everyone, let us start with the banquet.'],
  [40, 'Bob Sample', 'I will send the banquet invitations by Friday.'],
  [90, 'Ann Example', 'The banquet moves to November 14.'],
  [180, 'Ann Example', 'Okay, any prayer requests this week?'],
  [195, 'Bob Sample', 'Please pray for my mother, she has surgery Tuesday.'],
  [220, 'Ann Example', 'Amen. Bob, call me after about your mother.'],
];
function finished(env, n, over = {}) {
  const tr = SAID.map(([t, who, text]) => ({ t, who, text }));
  const notes = { decisions: [{ t: 90, text: 'The banquet moves to November 14.' }], actions: [{ text: 'Send the banquet invitations', owner: 'Bob Sample', due: 'Friday', t: 40 }, { text: 'Call Bob about his mother after surgery', owner: 'Ann Example', due: '', t: 220 }], chapters: [{ t: 0, title: 'Banquet' }, { t: 180, title: 'Prayer requests' }] };
  env.d1.prepare(`INSERT INTO hub_meetings (id, title, host_email, host_name, invitees, access, status, rec_mode, notes_status, summary, notes_json, transcript, series_id, created_at, started_at, ended_at, starts_at)
    VALUES (?, ?, ?, 'Ann Example', ?, 'invited', 'ended', 'notes', 'ready', ?, ?, ?, '', ?, ?, ?, ?)`)
    .bind(id(n), 'Care team weekly', HOST, JSON.stringify([{ email: 'bob@favorintl.org', name: 'Bob Sample' }]), 'They set the banquet date and prayed for Bob\'s mother before her surgery.', JSON.stringify(notes), JSON.stringify(tr), '2026-10-09T15:00:00.000Z', '2026-10-09T15:00:00.000Z', '2026-10-09T15:04:00.000Z', '2026-10-09T15:00:00.000Z').run();
  SAID.forEach(([t, who, text], i) => env.d1.prepare('INSERT INTO hub_meeting_lines (meeting_id, n, t, who, text) VALUES (?, ?, ?, ?, ?)').bind(id(n), i + 1, t, who, text).run());
  notes.actions.forEach((a, i) => env.d1.prepare('INSERT INTO hub_meeting_actions (meeting_id, idx, text, owner_name, owner_email, due, t) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id(n), i, a.text, a.owner, a.owner === 'Bob Sample' ? 'bob@favorintl.org' : HOST, a.due, a.t).run());
  notes.actions.forEach((a, i) => env.d1.prepare(`INSERT INTO hub_tasks (id, title, status, owner_email, meeting_id, meeting_action_idx, created_by, created_at, updated_at) VALUES (?, ?, 'open', ?, ?, ?, 'meetings', '2026-10-09', '2026-10-09')`).bind(`t${n}_${i}`, a.text, HOST, id(n), i).run());
  env.d1.prepare(`INSERT INTO chat_channels (id, kind, name, topic, created_by, created_at, last_at) VALUES ('ch${n}', 'private', 'care', '', ?, '2026-10-01', '2026-10-01')`).bind(HOST).run();
  env.d1.prepare(`INSERT INTO chat_messages (channel_id, email, body, attachments, created_at) VALUES ('ch${n}', 'meetings', ?, ?, '2026-10-09')`).bind('Notes from Care team weekly, Oct 9.\n\nThey prayed for Bob\'s mother before her surgery.', JSON.stringify([{ type: 'meeting', id: id(n) }])).run();
  env.d1.prepare(`INSERT INTO hub_meeting_events (meeting_id, kind, from_pid, to_pid, body, ts) VALUES (?, 'chat', '', '', ?, ?)`).bind(id(n), JSON.stringify({ text: 'praying for you Bob' }), Date.parse('2026-10-09T15:03:20.000Z')).run();
  env.d1.prepare(`INSERT INTO hub_meeting_events (meeting_id, kind, from_pid, to_pid, body, ts) VALUES (?, 'chat', '', '', ?, ?)`).bind(id(n), JSON.stringify({ text: 'agenda link' }), Date.parse('2026-10-09T15:00:30.000Z')).run();
}

const rewrite = ['pull out its notes', () => ({ summary: 'The team set the banquet for November 14.', decisions: [{ line: 3, text: 'The banquet moves to November 14.' }], actions: [], topics: [{ line: 1, title: 'Banquet date' }] })];
const head = ['You write the title and summary', () => ({ title: 'Banquet date', summary: 'The team set the banquet for November 14, and Bob sends the invitations by Friday.' })];

describe('the notes checks', () => {
  it('drops vague action items and keeps concrete ones', () => {
    assert.ok(drive.vagueAction('Develop the FavorOS dashboard further'));
    assert.ok(drive.vagueAction('Continue the discussion'));
    assert.ok(drive.vagueAction('Follow up'));
    assert.ok(!drive.vagueAction('Send Megan the final print file for the November letter'));
    assert.ok(!drive.vagueAction('Book the hotel for the Dallas banquet by Friday'));
  });
  it('keeps an item only when its quote was said near that line', () => {
    assert.ok(drive.quoteHolds('I will send the banquet invitations by Friday', 'Okay. I will send the banquet invitations by Friday. Thanks.'));
    assert.ok(!drive.quoteHolds('I will book the Dallas hotel', 'I will send the banquet invitations by Friday.'));
    assert.ok(!drive.quoteHolds('', 'anything'));
  });
  it('gives chapters the time of the line they cite, and reads a long meeting in parts', async () => {
    const lines = Array.from({ length: 400 }, (_, i) => ({ t: i * 12, who: 'Ann Example', text: `Line ${i} about item ${i} with some more words to make it long enough for the reader to split.` }));
    const ai = fakeAI([['pull out its notes', (u) => { const first = Number(/L(\d+) /.exec(u)[1]); return { summary: `Part from L${first}.`, decisions: [], actions: [], topics: [{ line: first + 20, title: `Topic at ${first + 20}` }] }; }], head]);
    const env = await world(ai);
    const out = await drive.makeNotes(env, { id: 'x', title: 'Long', transcript: JSON.stringify(lines) }, ['Ann Example']);
    const parts = ai.asked.filter((a) => a.sys.includes('pull out its notes'));
    assert.ok(parts.length >= 2, 'read in parts: ' + parts.length);
    assert.ok(parts.some((p) => p.user.includes('L400 ')), 'the end is read');
    assert.equal(out.chapters[0].title, 'Opening', 'an opening chapter when the first topic starts late');
    assert.equal(out.chapters[1].t, lines[20].t, 'the chapter takes its line\'s real time');
    assert.ok(out.chapters.every((c) => c.t % 12 === 0));
  });
});

describe('cutting a stretch of a finished meeting', () => {
  it('only the host or an admin may cut; an invitee and a stranger are refused', async () => {
    const env = await world(fakeAI([rewrite, head]));
    finished(env, 1);
    assert.equal((await call(env, 'bob@favorintl.org', ['meetings', id(1), 'privacy'], { method: 'POST', body: { op: 'cut', from: 180 } })).status, 403);
    assert.equal((await call(env, 'zed@favorintl.org', ['meetings', id(1), 'privacy'], { method: 'POST', body: { op: 'cut', from: 180 } })).status, 404);
    assert.equal((await call(env, HOST, ['meetings', id(1), 'privacy'], { method: 'POST', body: { op: 'cut', from: 180, to: 100 } })).status, 400);
  });
  it('cutting prayer requests to the end removes the words, the item, its task and the summary line, and rewrites the Chat post', async () => {
    const env = await world(fakeAI([rewrite, head]));
    finished(env, 2);
    const before = (await call(env, HOST, ['meetings', id(2), 'notes'])).body;
    assert.deepEqual(before.privacy.suggestion, { from: 175, to: null, label: 'Prayer requests' }, 'offered to the host');
    assert.equal((await call(env, 'bob@favorintl.org', ['meetings', id(2), 'notes'])).body.privacy.canEdit, false);
    const r = await call(env, HOST, ['meetings', id(2), 'privacy'], { method: 'POST', body: { op: 'cut', from: 175, to: null } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.actions, 1);
    assert.equal(r.body.tasks, 1);
    assert.ok(r.body.rewritten);
    const after = (await call(env, HOST, ['meetings', id(2), 'notes'])).body;
    const all = JSON.stringify(after);
    for (const word of ['pray', 'mother', 'surgery', 'Amen']) assert.ok(!new RegExp(word, 'i').test(all), `${word} is gone from the notes page`);
    assert.equal(after.transcript.length, 3);
    assert.deepEqual(after.actions.map((a) => [a.idx, a.text]), [[0, 'Send the banquet invitations']], 'the kept item keeps its number');
    assert.equal(after.privacy.suggestion, null, 'not offered again');
    assert.equal(after.privacy.cuts[0].from, 175);
    const lines = env.d1.db.prepare('SELECT COUNT(*) AS n FROM hub_meeting_lines WHERE meeting_id = ? AND t >= 175').get(id(2)).n;
    assert.equal(lines, 0);
    const tasks = env.d1.db.prepare('SELECT id, status, title FROM hub_tasks WHERE meeting_id = ? ORDER BY id').all(id(2));
    assert.deepEqual(tasks.map((t) => t.status), ['open', 'dropped']);
    assert.ok(!/mother/i.test(tasks[1].title));
    const chat = env.d1.db.prepare('SELECT body FROM chat_messages').all();
    assert.ok(chat.every((c) => !/prayed|mother/i.test(c.body)), 'the Chat post was rewritten');
    const ev = env.d1.db.prepare(`SELECT body FROM hub_meeting_events WHERE meeting_id = ? AND kind = 'chat'`).all(id(2)).map((e) => e.body);
    assert.deepEqual(ev, [JSON.stringify({ text: 'agenda link' })], 'room chat in the stretch is gone, the rest stays');
  });
  it('a summary that cannot be written again never keeps the old words', async () => {
    const env = await world(fakeAI([]));
    finished(env, 3);
    const r = await call(env, ADMIN, ['meetings', id(3), 'privacy'], { method: 'POST', body: { op: 'cut', from: 175 } });
    assert.equal(r.status, 200);
    const m = env.d1.db.prepare('SELECT summary FROM hub_meetings WHERE id = ?').get(id(3));
    assert.ok(!/pray|mother/i.test(m.summary));
  });
  it('deleting the recording clears stored pieces and the player', async () => {
    const env = await world(fakeAI([rewrite, head]));
    finished(env, 4);
    env.d1.prepare('INSERT INTO hub_meeting_chunks (meeting_id, epoch, seq, t0, t1, bytes) VALUES (?, 1, 0, 0, 0, 3)').bind(id(4)).run();
    env.r2.set(`meet/${id(4)}/1/000000.webm`, new Uint8Array([1, 2, 3]).buffer);
    assert.equal((await call(env, 'bob@favorintl.org', ['meetings', id(4), 'privacy'], { method: 'POST', body: { op: 'delete-recording' } })).status, 403);
    const r = await call(env, HOST, ['meetings', id(4), 'privacy'], { method: 'POST', body: { op: 'delete-recording' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(env.r2.size, 0);
    const m = env.d1.db.prepare('SELECT rec_state FROM hub_meetings WHERE id = ?').get(id(4));
    assert.equal(m.rec_state, 'removed');
    assert.equal((await call(env, HOST, ['meetings', id(4), 'notes'])).body.files.length, 0);
  });
});

describe('a private moment during the call', () => {
  it('a host turns it on, the recorder\'s sound and pieces are not kept, and it closes when turned off', async () => {
    const env = await world(fakeAI([]));
    env.d1.prepare(`INSERT INTO hub_meetings (id, title, host_email, host_name, invitees, access, status, rec_mode, notes_status, created_at, started_at, starts_at) VALUES (?, 'Live', ?, 'Ann Example', ?, 'invited', 'live', 'video', 'none', ?, ?, ?)`)
      .bind(id(9), HOST, JSON.stringify([{ email: 'bob@favorintl.org' }]), new Date(Date.now() - 60000).toISOString(), new Date(Date.now() - 60000).toISOString(), new Date().toISOString()).run();
    const now = Date.now();
    env.d1.prepare(`INSERT INTO hub_meeting_presence (meeting_id, pid, email, name, role, joined_at, seen) VALUES (?, 'aaaaaaaaaaaa', ?, 'Ann Example', 'host', ?, ?), (?, 'bbbbbbbbbbbb', 'bob@favorintl.org', 'Bob Sample', 'staff', ?, ?)`).bind(id(9), HOST, now, now, id(9), now, now).run();
    env.d1.prepare(`INSERT INTO hub_meeting_rec (meeting_id, epoch, owner_pid, mode, active, last_chunk, started) VALUES (?, 1, 'aaaaaaaaaaaa', 'video', 1, ?, ?)`).bind(id(9), now, now).run();
    assert.equal((await call(env, 'bob@favorintl.org', ['meetings', id(9), 'private'], { method: 'POST', body: { pid: 'bbbbbbbbbbbb', on: true } })).status, 403, 'not for a guest of the meeting');
    const on = await call(env, HOST, ['meetings', id(9), 'private'], { method: 'POST', body: { pid: 'aaaaaaaaaaaa', on: true } });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    const a = await call(env, HOST, ['meetings', id(9), 'rec', 'audio', '1', '3'], { method: 'PUT', raw: new Uint8Array([9, 9, 9]), query: '?pid=aaaaaaaaaaaa' });
    assert.equal(a.body.private, true);
    const c = await call(env, HOST, ['meetings', id(9), 'rec', 'chunk', '1', '5'], { method: 'PUT', raw: new Uint8Array([9, 9]), query: '?pid=aaaaaaaaaaaa' });
    assert.equal(c.body.private, true);
    assert.equal(env.r2.size, 0, 'nothing stored');
    assert.equal(env.d1.db.prepare('SELECT COUNT(*) AS n FROM hub_meeting_audio').get().n, 0);
    const notice = env.d1.db.prepare(`SELECT body FROM hub_meeting_events WHERE kind = 'notice'`).all().map((e) => JSON.parse(e.body).a);
    assert.ok(notice.includes('private-on'));
    const off = await call(env, HOST, ['meetings', id(9), 'private'], { method: 'POST', body: { pid: 'aaaaaaaaaaaa', on: false } });
    assert.equal(off.status, 200);
    const row = env.d1.db.prepare('SELECT from_t, to_t FROM hub_meeting_private WHERE meeting_id = ?').get(id(9));
    assert.ok(row.to_t != null && row.to_t >= row.from_t);
    assert.equal(env.d1.db.prepare('SELECT private_on FROM hub_meetings WHERE id = ?').get(id(9)).private_on, 0);
  });
  it('the prayer finder runs to the end near the end and stops after a prayer in the middle', () => {
    const near = priv.prayerSuggestion([{ t: 10, text: 'hello' }, { t: 3000, text: 'any prayer requests?' }, { t: 3100, text: 'amen' }], 3200);
    assert.deepEqual(near, { from: 2995, to: null, label: 'Prayer requests' });
    const mid = priv.prayerSuggestion([{ t: 60, text: 'let us pray' }, { t: 120, text: 'Amen.' }, { t: 2000, text: 'budget' }], 3600);
    assert.deepEqual(mid, { from: 55, to: 150, label: 'Prayer requests' });
    assert.equal(priv.prayerSuggestion([{ t: 1, text: 'the banquet budget' }], 100), null);
  });
});

describe('Drive folders', () => {
  it('files a meeting under its host\'s team, kind, year and month in Eastern time', () => {
    assert.deepEqual(drive.folderPath('Marketing', 'Recordings', '2026-10-13T18:03:57.343Z'), ['Marketing', 'Recordings', '2026', '10 October']);
    assert.deepEqual(drive.folderPath('', 'Notes', '2026-01-01T03:00:00.000Z'), ['Other', 'Notes', '2025', '12 December'], 'an evening on Dec 31 Eastern');
    assert.deepEqual(drive.folderPath('Development (RDD)', 'Notes', '2026-03-05T15:00:00Z'), ['Development (RDD)', 'Notes', '2026', '03 March']);
  });
});

describe('plain words', () => {
  it('says partners, never donors', () => {
    assert.equal(drive.partnersWord('Invite first-time donors; a Donor card'), 'Invite first-time partners; a Partner card');
  });
});

describe('fixing who spoke', () => {
  // The stand-in model gives the send item to whoever the transcript says spoke it.
  const byLabel = ['pull out its notes', (u) => {
    const m = /L(\d+) \[[^\]]+\] ([^:]+): I will send the banquet invitations/.exec(u);
    return { summary: 'The team set the banquet for November 14.', decisions: [], actions: m ? [{ line: Number(m[1]), owner: m[2].includes(' or ') ? 'Ann or Cy' : m[2], text: 'Send the banquet invitations to the partner list', due: 'Friday', quote: 'I will send the banquet invitations by Friday' }] : [], topics: [{ line: 1, title: 'Banquet date' }] };
  }];
  it('a host moves a line to the right person and the notes, items and tasks follow; others are refused', async () => {
    const ai = fakeAI([byLabel, head]);
    const env = await world(ai);
    finished(env, 11);
    const tr = (await call(env, HOST, ['meetings', id(11), 'notes'])).body.transcript;
    assert.equal(tr[1].who, 'Bob Sample');
    assert.equal((await call(env, 'bob@favorintl.org', ['meetings', id(11), 'privacy'], { method: 'POST', body: { op: 'speaker', i0: 1, i1: 1, who: 'Ann Example' } })).status, 403);
    assert.equal((await call(env, HOST, ['meetings', id(11), 'privacy'], { method: 'POST', body: { op: 'speaker', i0: 1, i1: 1, t0: 41, who: 'Ann Example' } })).status, 409, 'an older page changes nothing');
    const r = await call(env, HOST, ['meetings', id(11), 'privacy'], { method: 'POST', body: { op: 'speaker', i0: 1, i1: 1, t0: 40, t1: 40, who: 'Ann Example' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.rewritten, true);
    const after = (await call(env, HOST, ['meetings', id(11), 'notes'])).body;
    assert.equal(after.transcript[1].who, 'Ann Example');
    assert.equal(after.transcript[1].fixed, true);
    assert.equal(env.d1.db.prepare('SELECT who FROM hub_meeting_lines WHERE meeting_id = ? AND t = 40').get(id(11)).who, 'Ann Example');
    assert.deepEqual(after.actions.map((a) => [a.owner_name, a.owner_email]), [['Ann Example', HOST]]);
    assert.equal(env.d1.db.prepare('SELECT summary FROM hub_meetings WHERE id = ?').get(id(11)).summary, 'The team set the banquet for November 14, and Bob sends the invitations by Friday.');
    const tasks = env.d1.db.prepare('SELECT id, status FROM hub_tasks WHERE meeting_id = ? ORDER BY id').all(id(11));
    assert.deepEqual(tasks.filter((t) => t.id.startsWith('t11_')).map((t) => t.status), ['dropped', 'dropped'], 'the old items changed, so their tasks go');
    assert.ok(env.d1.db.prepare(`SELECT body FROM chat_messages WHERE body LIKE 'Notes from %'`).get().body.length > 0);
  });
  it('a shared device reads as either person to the model, and an unclear owner gets no task owner', async () => {
    const ai = fakeAI([byLabel, head]);
    const env = await world(ai);
    finished(env, 12);
    const t0 = Date.parse('2026-10-09T15:00:00.000Z');
    env.d1.prepare(`INSERT INTO hub_meeting_presence (meeting_id, pid, email, name, role, joined_at, seen, left_at) VALUES (?, 'bbbbbbbbbbbb', 'bob@favorintl.org', 'Bob Sample', 'staff', ?, ?, ?)`).bind(id(12), t0, t0, t0 + 240000).run();
    env.d1.prepare(`INSERT INTO hub_meeting_presence (meeting_id, pid, email, name, role, joined_at, seen, left_at, with_pid) VALUES (?, 'cccccccccccc', 'guest:with-c', 'Cy Visitor', 'guest', ?, ?, ?, 'bbbbbbbbbbbb')`).bind(id(12), t0, t0, t0 + 240000).run();
    // Fix an unrelated line, so the notes are read again with the shared device in place.
    const r = await call(env, HOST, ['meetings', id(12), 'privacy'], { method: 'POST', body: { op: 'speaker', i0: 0, i1: 0, who: 'Ann Example' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const asked = ai.asked.filter((a) => a.sys.includes('pull out its notes')).at(-1);
    assert.match(asked.user, /Bob Sample or Cy Visitor \(one device\): I will send/);
    assert.match(asked.sys, /Never guess/);
    const acts = env.d1.db.prepare('SELECT owner_name, owner_email FROM hub_meeting_actions WHERE meeting_id = ?').all(id(12));
    assert.deepEqual(acts.map((a) => [a.owner_name, a.owner_email]), [['Ann or Cy', '']]);
  });
});
