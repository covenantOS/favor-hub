// Run with: npm test
//
// The FavorOS privacy matrix as a test. The same canaries (functions/_lib/privacy/canaries.ts) and the same probe
// (functions/_lib/privacy/probe.ts) that the 30-minute production smoke check runs, here on an in-memory database with every
// table from db/*.sql. Each probe cell is one test: a made-up staff member, a made-up field member or a signed-out caller reads a
// list, search, feed or by-id route, and the answer must never carry the canary word. Controls must find what is open to them.
// Then one test per rule fixed in the 2026-10-14 privacy pass. Made-up people only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, before } from 'node:test';
import './support/resolve-ts.mjs';
import { fullSchemaD1 } from './support/full-schema.mjs';

const { seedCanaries, canaryStatements, IDS, CANARY, PROBE_STAFF, PROBE_FIELD, MESSAGE_MARKS } = await import('../functions/_lib/privacy/canaries.ts');
const { probes, readCell, runPrivacyProbe } = await import('../functions/_lib/privacy/probe.ts');
const { meetingOpenHere, taskOpenHere } = await import('../functions/_lib/chat/cardaccess.ts');
const { fieldChatGuard } = await import('../functions/_lib/field.ts');
const { notesOpenToConversation } = await import('../functions/_lib/chat/meet.ts');
const { isHiddenAccount, notTesterSql } = await import('../functions/_lib/testuser.ts');
const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const NOW = Date.now();
async function world() {
  const d1 = fullSchemaD1();
  const at = new Date(NOW).toISOString();
  for (const [k, v] of [['chat.enabled', 'staff'], ['projects.enabled', 'staff'], ['meet.release', 'staff'], ['meet.guests', 'on'], ['learn.enabled', 'staff']]) {
    await d1.prepare('INSERT OR REPLACE INTO hub_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)').bind(k, v, 'test', at).run().catch(() => d1.prepare('INSERT OR REPLACE INTO hub_settings (key, value) VALUES (?, ?)').bind(k, v).run());
  }
  for (const [email, role] of [['tester@favorintl.org', 'admin'], ['ann@favorintl.org', 'staff']]) {
    await d1.prepare(`INSERT INTO hub_users (email, name, picture, role, blocked, note, sign_ins, created_at, updated_at) VALUES (?, ?, '', ?, 0, '', 1, ?, ?)`).bind(email, email.split('@')[0], role, at, at).run();
  }
  const r = await seedCanaries(d1, NOW);
  const CHAT_ROOM = { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('ok') }) };
  return { env: { DB: d1, MEET_RELEASE: 'staff', MEET_GUESTS: 'on', MEET_FAKE_SFU: '1', HUB_SIGNIN: 'on', CHAT_ROOM }, d1, seeded: r };
}

describe('privacy matrix: canaries seed on the full schema', () => {
  it('every canary statement runs (no table or column is missing)', async () => {
    const { seeded } = await world();
    assert.equal(seeded.skipped, 0, 'a canary statement was skipped');
    assert.equal(seeded.ran, canaryStatements(NOW).length);
  });
  it('seeding twice changes nothing it should not (safe to repeat every 30 minutes)', async () => {
    const { d1 } = await world();
    await seedCanaries(d1, NOW + 60_000);
    const n = await d1.prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE channel_id LIKE 'ch_prvcnry%'`).first();
    assert.equal(n.n, 5);
  });
});

describe('privacy matrix: every cell, as staff, field and signed out', async () => {
  const { env } = await world();
  for (const p of probes()) {
    for (const who of p.who) {
      it(`${who}: ${p.name}`, async () => {
        const cell = await readCell(env, 'https://dash.favorintl.org', p, who);
        assert.ok(cell.ok, `${cell.why} (status ${cell.status}, ${p.path})`);
      });
    }
  }
  it('the whole probe passes and reports its size', async () => {
    const r = await runPrivacyProbe(env);
    assert.equal(r.failed.length, 0, JSON.stringify(r.failed, null, 1));
    assert.ok(r.total >= 100, `only ${r.total} cells`);
  });
});

describe('privacy rules fixed on 2026-10-14', () => {
  it('a meeting card names the meeting only where every member of the conversation may open it', () => {
    const m = { id: 'x', host_email: 'ann@favorintl.org', cohosts: '[]', invitees: JSON.stringify([{ email: 'bob@favorintl.org' }]), access: 'invited', post_channel: '' };
    const people = (...e) => e.map((email) => ({ email, role: 'staff' }));
    assert.equal(meetingOpenHere(m, people('ann@favorintl.org', 'bob@favorintl.org'), 'ch1', false), true);
    assert.equal(meetingOpenHere(m, people('ann@favorintl.org', 'bob@favorintl.org', 'cat@favorintl.org'), 'ch1', false), false);
    assert.equal(meetingOpenHere(m, [...people('ann@favorintl.org'), { email: 'will@favorintl.org', role: 'admin' }], 'ch1', false), true);
    assert.equal(meetingOpenHere(m, people('cat@favorintl.org'), 'ch1', true), true, 'a huddle started here belongs here');
    assert.equal(meetingOpenHere({ ...m, access: 'staff' }, people('cat@favorintl.org'), 'ch1', false), true);
    assert.equal(meetingOpenHere({ ...m, access: 'staff' }, [{ email: 'f@favourafrica.org', role: 'field' }], 'ch1', false), false);
    assert.equal(meetingOpenHere({ ...m, access: 'guests' }, people('cat@favorintl.org'), 'ch1', false), false, 'a guest link never opens it to staff');
    assert.equal(meetingOpenHere(m, null, undefined, false), false);
  });

  it('a members-only task card names the task only where every member is in the project', async () => {
    const { d1 } = await world();
    const env = { DB: d1 };
    const t = { id: IDS.task, project_id: IDS.project, owner_email: 'tester@favorintl.org' };
    assert.equal(await taskOpenHere(env, t, [{ email: 'tester@favorintl.org', role: 'admin' }], 'x'), true);
    assert.equal(await taskOpenHere(env, t, [{ email: 'tester@favorintl.org', role: 'staff' }, { email: PROBE_STAFF, role: 'staff' }], 'x'), false);
    assert.equal(await taskOpenHere(env, { ...t, project_id: null }, [{ email: PROBE_STAFF, role: 'staff' }], 'x'), true);
  });

  it('a hand-made meeting card for a meeting the writer cannot open is dropped', async () => {
    const { env } = await world();
    const { route } = await import('../functions/_lib/meetroute.ts');
    void route;
    const { onRequest } = await import('../functions/api/chat/[[path]].ts');
    const { withUserHeaders } = await import('../functions/_lib/session.ts');
    const req = withUserHeaders(new Request(`https://dash.favorintl.org/api/chat/channels/${IDS.chProbe}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://dash.favorintl.org' }, body: JSON.stringify({ body: 'look', attachments: [{ type: 'meeting', id: IDS.meetEnded }] }) }), { email: PROBE_STAFF, name: 'P', picture: '', role: 'staff', via: 'google', kpi: true });
    const res = await onRequest({ request: req, env, params: { path: ['channels', IDS.chProbe, 'messages'] }, waitUntil: () => undefined });
    const j = await res.json();
    assert.equal(res.status < 300, true, JSON.stringify(j));
    assert.equal((j.message.attachments || []).filter((a) => a.type === 'meeting').length, 0);
    assert.ok(!JSON.stringify(j).includes(CANARY));
  });

  it('field staff translate only messages in conversations they are in', async () => {
    assert.match(src('functions/_lib/chat/smart-route.ts'), /membersOnly: user\.role === 'field'/);
    assert.match(src('functions/_lib/chat/smart.ts'), /input\.membersOnly \? await store\.isMember\(env, row\.channel_id, me\)/);
    const env = { DB: (await world()).d1 };
    await assert.rejects(fieldChatGuard(env, { role: 'field', email: PROBE_FIELD }, 'POST', ['messages', '1', 'check']), /not part of the field staff app/);
    await assert.rejects(fieldChatGuard(env, { role: 'field', email: PROBE_FIELD }, 'POST', ['messages', '1', 'check-add']), /not part of the field staff app/);
  });

  it('meeting notes go into a conversation only when every member may read them', async () => {
    const { d1 } = await world();
    const env = { DB: d1 };
    // The probes' channel holds people who are not on the finished meeting.
    assert.equal(await notesOpenToConversation(env, IDS.meetEnded, IDS.chProbe), false);
    // A private channel with only the host.
    assert.equal(await notesOpenToConversation(env, IDS.meetEnded, IDS.chPrivate), true);
    await d1.prepare(`UPDATE chat_channels SET kind = 'public' WHERE id = ?`).bind(IDS.chPrivate).run();
    assert.equal(await notesOpenToConversation(env, IDS.meetEnded, IDS.chPrivate), false, 'a public channel is readable by all staff');
    assert.match(src('functions/_lib/meetprivacy.ts'), /body LIKE 'Notes are ready%' AND instr\(body, char\(10\)\) > 0/);
  });

  it('a Drive preview and a new Drive card are checked with the person\'s own Google access', () => {
    const p = src('functions/_lib/chat/preview.ts');
    assert.match(p, /if \(!\(await personSeesDriveFile\(env, me, id\)\)\) throw new HttpError\(404/);
    assert.match(src('functions/_lib/chat/route.ts'), /const card = id && \(await personSeesDriveFile\(env, me, id\)\) \? await driveCardFor\(env, u\) : null;/);
  });

  it('#leadership-gifts is found by id, its name is reserved, and only an admin adds people', async () => {
    const { d1 } = await world();
    const env = { DB: d1 };
    const store = await import('../functions/_lib/chat/db.ts');
    await assert.rejects(store.createChannel(env, 'ann@favorintl.org', { name: 'leadership-gifts' }), /already a channel named/);
    const gifts = await import('../functions/_lib/chat/gifts.ts');
    assert.equal(await gifts.ensureGiftChannel(env), 'ch_leadership_gifts');
    await d1.prepare(`UPDATE chat_channels SET kind = 'public' WHERE id = 'ch_leadership_gifts'`).run();
    assert.equal(await gifts.ensureGiftChannel(env), 'ch_leadership_gifts');
    assert.equal((await d1.prepare(`SELECT kind FROM chat_channels WHERE id = 'ch_leadership_gifts'`).first()).kind, 'private');
    await d1.prepare(`INSERT OR IGNORE INTO chat_members (channel_id, email, role, joined_at) VALUES ('ch_leadership_gifts', 'ann@favorintl.org', 'member', '2026-01-01')`).run();
    await assert.rejects(store.addMembers(env, 'ann@favorintl.org', 'ch_leadership_gifts', ['cat@favorintl.org']), /Only a FavorOS admin/);
  });

  it('a project lead cannot point the project at another channel or Drive folder', () => {
    const s = src('functions/_lib/projects/projects.ts');
    assert.match(s, /if \(\(b\.chat_channel_id \|\| b\.drive_folder_id\) && !actor\.admin\) throw new HttpError\(403/);
    assert.match(src('functions/_lib/projects/links/chat.ts'), /if \(ch\.kind !== 'public' && ch\.kind !== 'private'\) throw new HttpError\(400, 'not_channel'/);
  });

  it('a task can name only a meeting or expense its writer may see', async () => {
    const { env } = await world();
    const { onRequest } = await import('../functions/api/tasks/[[path]].ts');
    const { withUserHeaders } = await import('../functions/_lib/session.ts');
    const post = (body) => onRequest({ request: withUserHeaders(new Request('https://dash.favorintl.org/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://dash.favorintl.org' }, body: JSON.stringify(body) }), { email: PROBE_STAFF, name: 'P', picture: '', role: 'staff', via: 'google', kpi: true }), env, params: { path: [] }, waitUntil: () => undefined });
    const a = await post({ title: 'x', meeting_id: IDS.meetEnded });
    assert.equal(a.status, 404);
    assert.ok(!(await a.text()).includes(CANARY));
    const b = await post({ title: 'x', expense_id: 'exp_000000000000000000000000' });
    assert.equal(b.status, 404);
  });

  it("a meeting's action items reach task links only for people who may read its notes", async () => {
    const { env } = await world();
    const { onRequest } = await import('../functions/api/tasks/[[path]].ts');
    const { withUserHeaders } = await import('../functions/_lib/session.ts');
    const req = withUserHeaders(new Request('https://dash.favorintl.org/api/tasks/links/meet/action-task', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://dash.favorintl.org' }, body: JSON.stringify({ meeting_id: IDS.meetEnded, idx: 0 }) }), { email: PROBE_STAFF, name: 'P', picture: '', role: 'staff', via: 'google', kpi: true });
    const res = await onRequest({ request: req, env, params: { path: ['links', 'meet', 'action-task'] }, waitUntil: () => undefined });
    assert.equal(res.status, 404);
    assert.ok(!(await res.text()).includes(CANARY));
  });

  it('the privacy probes are hidden like the test users and never get Chat email', () => {
    assert.equal(isHiddenAccount(PROBE_STAFF), true);
    assert.equal(isHiddenAccount(PROBE_FIELD), true);
    assert.match(notTesterSql('x'), /privacy-probe@favorintl\.org/);
    assert.match(src('functions/_lib/chat/mail.ts'), /if \(isHiddenAccount\(email\) \|\| SYSTEM_VOICES\.has\(email\)\) return false;/);
  });

  it('a blocked person drops out of every live Chat event', async () => {
    const { d1 } = await world();
    await d1.prepare(`INSERT INTO hub_users (email, name, picture, role, blocked, note, sign_ins, created_at, updated_at) VALUES ('gone@favorintl.org', 'Gone', '', 'staff', 1, '', 1, '2026-01-01', '2026-01-01')`).run();
    const sent = [];
    const env = { DB: d1, CHAT_ROOM: { idFromName: (n) => n, get: () => ({ fetch: async (_u, init) => { sent.push(JSON.parse(init.body).audience); return new Response('ok'); } }) } };
    const { publish } = await import('../functions/_lib/chat/live.ts');
    await publish(env, ['ann@favorintl.org', 'gone@favorintl.org'], { type: 'typing' });
    assert.deepEqual(sent, [['ann@favorintl.org']]);
  });

  it('the entity card of a guest-link meeting is closed to staff who are not on it', () => {
    const s = src('functions/_lib/hub/entity.ts');
    assert.doesNotMatch(s, /access IN \('staff','guests'\)/);
    assert.match(s, /if \(!onIt && !mayJoin\(m, user\) && !mayReadNotes\(/);
  });

  it('MESSAGE_MARKS stay free of the canary word, so a control never trips the leak check', () => {
    for (const v of Object.values(MESSAGE_MARKS)) if (v === MESSAGE_MARKS.meetingLink || v === MESSAGE_MARKS.taskLink) assert.ok(!v.includes(CANARY));
  });
});

describe('partner data stays with the Work Center', () => {
  it('Mail and the day panel match partners only for people with the Work Center', () => {
    assert.match(src('functions/_lib/mail/route.ts'), /if \(!wc\.ok\) ctx\.partners = async \(\) => \(\{\}\);/);
    assert.match(src('functions/api/hub/day.ts'), /if \(emails\.length && wc\.ok\) \{/);
  });
});

describe('HR records', () => {
  it("an onboarding step owner sees the steps, not the HR file checklist or the history", () => {
    const s = src('functions/_lib/onboard/run.ts');
    assert.match(s, /const full = manage \|\| run\.supervisor_email === actor\.email;/);
    assert.match(s, /const docs = full \?/);
    assert.match(s, /const events = full \?/);
  });
});
