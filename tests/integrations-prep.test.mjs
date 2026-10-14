// Meeting prep packs and the follow-up email. Packs: only meetings in the next 15 minutes, partners and staff, each piece read as
// the person the pack is for (their own direct messages and saved mail, tasks and requests between the two, notes they may read),
// internal repeating meetings skipped unless asked, and a switch to turn them off. Follow-up: off by default, one suggestion ever,
// a draft only for hosts who turned it on, never sent. Made-up people; no model, no mail, no Google.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import './support/resolve-ts.mjs';
import { DESIGN, NOW, OUTSIDER, VIDEO, WILL, addRequest, rows, world } from './support/request-world.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const PARTNER = 'pat@example.org';

function w0() {
  const w = world();
  for (const f of ['db/projects.sql', 'db/meetings-auto.sql', 'db/meetings-scheduling.sql', 'db/mail-cache.sql', 'db/integrations.sql']) {
    for (const part of read(f).split(/;\s*(?:\r?\n|$)/)) if (part.trim()) { try { w.d1.exec(part + ';'); } catch { /* already there */ } }
  }
  for (const [k, v] of [['projects.enabled', 'staff'], ['chat.enabled', 'staff'], ['mail.enabled', 'staff']]) w.d1.db.prepare('INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)').run(k, v, 'test', NOW);
  return w;
}

function meeting(w, id, o) {
  const at = new Date(Date.now() + (o.inMin ?? 10) * 60000).toISOString();
  w.d1.db.prepare(`INSERT INTO hub_meetings (id, title, agenda, host_email, host_name, starts_at, ends_at, duration_min, rec_mode, access, invitees, status, created_at, series_id, summary, notes_status, notes_json, started_at, ended_at)
    VALUES (?, ?, '', ?, ?, ?, ?, 30, 'video', 'invited', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, o.title || 'Meeting', o.host || WILL.email, 'Host', at, new Date(Date.parse(at) + 1800000).toISOString(), JSON.stringify((o.invitees || []).map((e) => ({ email: e, name: e === PARTNER ? 'Pat Partner' : '' }))),
    o.status || 'scheduled', NOW, o.series || '', o.summary || '', o.notes || 'none', JSON.stringify(o.notesJson || {}), o.status === 'ended' ? NOW : null, o.status === 'ended' ? NOW : null);
}

async function stubPartners() {
  const { source } = await import('../functions/_lib/meetauto.ts');
  source.current = {
    byEmail: async (env, emails) => Object.fromEntries(emails.filter((e) => e === PARTNER).map((e) => [e, { id: '27202', name: 'Pat Partner' }])),
    card: async () => ({ id: '27202', name: 'Pat Partner', place: '', lifetime: 12000, last12: 3000, count: 9, last: { amount: 500, date: '2026-09-30', fund: 'General' }, largest: null, lastContact: { date: '2026-10-01', category: 'Phone call', summary: 'Talked about Uganda' }, open: [{ what: 'Send the report', due: '2026-10-20' }], holders: [] }),
    portfolio: async () => null,
    search: async () => [],
  };
}

test('a pack 15 minutes before: partner first, then staff with tasks, asks, chats, mail and the last meeting, all as the viewer', async () => {
  const w = w0();
  await stubPartners();
  meeting(w, 'a00000000000000000000001', { title: 'Uganda update', invitees: [VIDEO.email, PARTNER] });
  // What Ada and Vic share: a task Vic gave Ada, a request Vic made that Ada owns, their direct messages, an email thread.
  const { createTask } = await import('../functions/_lib/projects/tasks.ts');
  await createTask(w.env, { email: VIDEO.email, name: VIDEO.name, admin: false }, { title: 'Send the photos', owner_email: WILL.email });
  const rid = addRequest(w, 'New banner', VIDEO.email);
  w.d1.db.prepare('INSERT INTO request_tasks (request_id, owner_email, updated_at) VALUES (?, ?, ?)').run(rid, WILL.email, NOW);
  const store = await import('../functions/_lib/chat/db.ts');
  const dm = await store.openConversation(w.env, WILL.email, [VIDEO.email]);
  await store.post(w.env, { channel_id: dm.id, email: VIDEO.email, body: 'Can we talk about the banner?' });
  const other = await store.openConversation(w.env, OUTSIDER.email, [VIDEO.email]);
  await store.post(w.env, { channel_id: other.id, email: VIDEO.email, body: 'Private to Ozzy' });
  w.d1.db.prepare('INSERT INTO hub_mail_rows (mailbox, thread_id, hid, row_json, at) VALUES (?, ?, ?, ?, ?)').run(WILL.email, 't1', '', JSON.stringify({ subject: 'Banner sizes', snippet: 'Here are the sizes', date: NOW, people: [{ email: VIDEO.email }], from: { email: VIDEO.email } }), NOW);
  w.d1.db.prepare('INSERT INTO hub_mail_rows (mailbox, thread_id, hid, row_json, at) VALUES (?, ?, ?, ?, ?)').run(OUTSIDER.email, 't2', '', JSON.stringify({ subject: 'Not yours', snippet: 'x', date: NOW, people: [{ email: VIDEO.email }], from: { email: VIDEO.email } }), NOW);
  // The last meeting with Vic, notes ready, with an open action for Ada.
  meeting(w, 'a00000000000000000000002', { title: 'Banner kickoff', invitees: [VIDEO.email], status: 'ended', notes: 'ready', summary: 'We chose blue.', inMin: -3000 });
  w.d1.db.prepare(`INSERT INTO hub_meeting_actions (meeting_id, idx, text, owner_name, owner_email, due, t, done) VALUES (?, 0, 'Order the banner', 'Ada', ?, '', 0, 0)`).run('a00000000000000000000002', WILL.email);

  const { upcomingPacks } = await import('../functions/_lib/integrations/prep.ts');
  const r = await upcomingPacks(w.env, WILL);
  assert.equal(r.packs.length, 1);
  const [p] = r.packs;
  assert.equal(p.meeting.title, 'Uganda update');
  assert.deepEqual(p.cards.map((c) => c.kind), ['partner', 'staff']);
  const vic = p.cards[1];
  assert.ok(vic.asked.some((t) => t.title === 'Send the photos' && t.kind === 'task'), 'a task Vic gave Ada is under Asked of you');
  assert.ok(!vic.tasks.some((t) => t.title === 'Send the photos'), 'and only there');
  assert.deepEqual(vic.asked.map((a) => a.kind).sort(), ['action', 'request', 'task']);
  assert.deepEqual(vic.chats.map((c) => c.text), ['Can we talk about the banner?'], 'only the viewer\'s own direct messages');
  assert.deepEqual(vic.emails.map((e) => e.subject), ['Banner sizes'], 'only the viewer\'s own mail');
  assert.equal(vic.lastMeeting.title, 'Banner kickoff');
  assert.ok(vic.lastMeeting.actions.some((a) => a.text === 'Order the banner'));
  // Ozzy is not on the meeting: no pack.
  assert.equal((await upcomingPacks(w.env, OUTSIDER)).packs.length, 0);
  // A meeting an hour away is not in the dock yet.
  meeting(w, 'a00000000000000000000003', { title: 'Later', invitees: [VIDEO.email], inMin: 60 });
  assert.equal((await upcomingPacks(w.env, WILL)).packs.length, 1);
});

test('internal repeating meetings are skipped unless asked; the switch turns packs off; field and the agent get none', async () => {
  const w = w0();
  await stubPartners();
  meeting(w, 'b00000000000000000000001', { title: 'Weekly marketing', invitees: [VIDEO.email, DESIGN.email], series: 'sr1' });
  const prep = await import('../functions/_lib/integrations/prep.ts');
  assert.equal((await prep.upcomingPacks(w.env, WILL)).packs.length, 0);
  await prep.setPrefs(w.env, WILL.email, { prep_recurring: true });
  assert.equal((await prep.upcomingPacks(w.env, WILL)).packs.length, 1);
  await prep.setPrefs(w.env, WILL.email, { prep_on: false });
  const off = await prep.upcomingPacks(w.env, WILL);
  assert.equal(off.on, false);
  assert.equal(off.packs.length, 0);
  assert.equal((await prep.upcomingPacks(w.env, { ...VIDEO, role: 'field' })).packs.length, 0);
  assert.equal((await prep.upcomingPacks(w.env, { ...WILL, via: 'agent' })).packs.length, 0);
  // A meeting with nobody else gets nothing; the relevance rule on its own.
  assert.equal(prep.relevant({ others: [], recurring: false }, { prep_recurring: false }), false);
  assert.equal(prep.relevant({ others: [{ email: PARTNER }], recurring: true }, { prep_recurring: false }), true, 'a repeating meeting with a partner still gets a pack');
});

test('follow-up: off by default with one suggestion; on, a draft from the notes for the host; never sent; internal meetings none', async () => {
  const w = w0();
  meeting(w, 'c00000000000000000000001', { title: 'Uganda update', invitees: [VIDEO.email, PARTNER], status: 'ended', notes: 'ready', summary: 'We reviewed the Uganda report and the school visit.', inMin: -60 });
  w.d1.db.prepare(`INSERT INTO hub_meeting_actions (meeting_id, idx, text, owner_name, owner_email, due, t, done) VALUES (?, 0, 'Send the school photos', 'Ada', ?, 'Friday', 0, 0)`).run('c00000000000000000000001', WILL.email);
  meeting(w, 'c00000000000000000000002', { title: 'Staff only', invitees: [VIDEO.email], status: 'ended', notes: 'ready', summary: 'Internal', inMin: -60 });
  const f = await import('../functions/_lib/integrations/followup.ts');
  const prep = await import('../functions/_lib/integrations/prep.ts');
  assert.equal(await f.followupAfterNotes(w.env, 'c00000000000000000000002'), 0, 'no outside attendees, nothing');
  assert.equal(await f.followupAfterNotes(w.env, 'c00000000000000000000001'), 1);
  let mine = await f.myFollowups(w.env, WILL);
  assert.equal(mine.on, false);
  assert.equal(mine.items[0].state, 'offer');
  assert.ok((await prep.prefsFor(w.env, WILL.email)).followup_offered_at, 'counted as offered');
  assert.equal(await f.followupAfterNotes(w.env, 'c00000000000000000000001'), 0, 'once per meeting');
  // Turn it on from the suggestion: the draft is made now.
  await prep.setPrefs(w.env, WILL.email, { followup_on: true });
  const d = await f.actOnFollowup(w.env, WILL, 'c00000000000000000000001', { action: 'draft' });
  assert.deepEqual(d.draft.to, [PARTNER], 'to the people outside Favor only');
  assert.ok(d.draft.body.includes('Uganda report') && d.draft.body.includes('Send the school photos'));
  assert.ok(!d.draft.body.includes(String.fromCharCode(8212)));
  mine = await f.myFollowups(w.env, WILL);
  assert.equal(mine.items[0].state, 'ready');
  await f.actOnFollowup(w.env, WILL, 'c00000000000000000000001', { action: 'opened' });
  assert.equal((await f.myFollowups(w.env, WILL)).items.length, 0);
  assert.equal(w.mail.length, 0, 'nothing is ever sent');
  // With it on, the next meeting's draft is ready at once; Vic (not a host) gets nothing.
  meeting(w, 'c00000000000000000000003', { title: 'Second', invitees: [VIDEO.email, PARTNER], status: 'ended', notes: 'ready', summary: 'Follow up on the visit.', inMin: -30 });
  assert.equal(await f.followupAfterNotes(w.env, 'c00000000000000000000003'), 1);
  assert.equal(rows(w, `SELECT state FROM hub_meeting_followups WHERE meeting_id = 'c00000000000000000000003'`)[0].state, 'ready');
  assert.equal((await f.myFollowups(w.env, VIDEO)).items.length, 0);
  await assert.rejects(f.actOnFollowup(w.env, VIDEO, 'c00000000000000000000003', { action: 'opened' }), /gone/);
});
