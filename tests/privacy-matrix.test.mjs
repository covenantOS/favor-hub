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

describe('privacy follow-ups 2026-10-14: clips open only for the people they are shared with', () => {
  const CID = 'ab12'.repeat(8);
  async function clipWorld() {
    const w = await world();
    const at = new Date(NOW).toISOString();
    for (const [email, role] of [['owner@favorintl.org', 'staff'], ['bob@favorintl.org', 'staff'], ['cat@favorintl.org', 'staff'], ['field@favourafrica.org', 'field']]) {
      await w.d1.prepare(`INSERT OR IGNORE INTO hub_users (email, name, picture, role, blocked, note, sign_ins, created_at, updated_at) VALUES (?, ?, '', ?, 0, '', 1, ?, ?)`).bind(email, email.split('@')[0], role, at, at).run();
    }
    await w.d1.prepare(`INSERT INTO hub_clips (id, owner_email, owner_name, title, status, share, mime, size_bytes, duration_ms, created_at, updated_at, summary) VALUES (?, 'owner@favorintl.org', 'Owner', 'Quiet clip', 'ready', 0, 'video/webm', 0, 1000, ?, ?, '')`).bind(CID, at, at).run();
    return w;
  }
  const info = async (w, email, role = 'staff') => {
    const { onRequestGet } = await import('../functions/api/clips/[id]/info.ts');
    const headers = email ? { 'X-Hub-Email': email, 'X-Hub-Role': role, 'X-Hub-Name': email.split('@')[0] } : {};
    const res = await onRequestGet({ request: new Request(`https://dash.favorintl.org/api/clips/${CID}/info`, { headers }), env: w.env, params: { id: CID } });
    return res.status;
  };

  it('a new clip opens for its owner and admins only', async () => {
    const w = await clipWorld();
    assert.equal(await info(w, 'owner@favorintl.org'), 200);
    assert.equal(await info(w, 'tester@favorintl.org', 'admin'), 200);
    assert.equal(await info(w, 'bob@favorintl.org'), 404);
    assert.equal(await info(w, 'field@favourafrica.org', 'field'), 404);
    assert.equal(await info(w, ''), 401);
  });
  it('a person the owner adds can watch; nobody else gains anything', async () => {
    const w = await clipWorld();
    await w.d1.prepare(`INSERT INTO hub_clip_people (clip_id, email, added_by, created_at) VALUES (?, 'bob@favorintl.org', 'owner@favorintl.org', ?)`).bind(CID, new Date(NOW).toISOString()).run();
    assert.equal(await info(w, 'bob@favorintl.org'), 200);
    assert.equal(await info(w, 'cat@favorintl.org'), 404);
  });
  it('posting the clip in a Chat conversation opens it to its members, a public channel to every staff member', async () => {
    const w = await clipWorld();
    const at = new Date(NOW).toISOString();
    await w.d1.prepare(`INSERT INTO chat_channels (id, kind, name, created_by, created_at) VALUES ('ch_dm_clip', 'dm', '', 'owner@favorintl.org', ?)`).bind(at).run();
    for (const e of ['owner@favorintl.org', 'bob@favorintl.org']) await w.d1.prepare(`INSERT INTO chat_members (channel_id, email, joined_at) VALUES ('ch_dm_clip', ?, ?)`).bind(e, at).run();
    await w.d1.prepare(`INSERT INTO chat_messages (channel_id, email, body, attachments, created_at) VALUES ('ch_dm_clip', 'owner@favorintl.org', '', ?, ?)`).bind(JSON.stringify([{ type: 'clip', id: CID }]), at).run();
    assert.equal(await info(w, 'bob@favorintl.org'), 200, 'a member of the conversation');
    assert.equal(await info(w, 'cat@favorintl.org'), 404, 'not in the conversation');
    await w.d1.prepare(`INSERT INTO chat_channels (id, kind, name, created_by, created_at) VALUES ('ch_pub_clip', 'public', 'general-clip', 'owner@favorintl.org', ?)`).bind(at).run();
    await w.d1.prepare(`INSERT INTO chat_messages (channel_id, email, body, attachments, created_at) VALUES ('ch_pub_clip', 'owner@favorintl.org', ?, '[]', ?)`).bind(`Watch https://dash.favorintl.org/c/${CID}`, at).run();
    assert.equal(await info(w, 'cat@favorintl.org'), 200, 'a public channel is open to all staff');
    assert.equal(await info(w, 'field@favourafrica.org', 'field'), 404, 'field never by a staff channel');
  });
  it('someone who watched before the change keeps the link (grandfathered by hub_clip_views)', async () => {
    const w = await clipWorld();
    await w.d1.prepare(`INSERT INTO hub_clip_views (id, clip_id, person_email, person_name, at, seconds) VALUES ('v_old', ?, 'cat@favorintl.org', 'Cat', ?, 10)`).bind(CID, new Date(NOW).toISOString()).run().catch(async () => {
      await w.d1.prepare(`INSERT INTO hub_clip_views (clip_id, person_email, person_name, at, seconds) VALUES (?, 'cat@favorintl.org', 'Cat', ?, 10)`).bind(CID, new Date(NOW).toISOString()).run();
    });
    assert.equal(await info(w, 'cat@favorintl.org'), 200);
    assert.equal(await info(w, 'bob@favorintl.org'), 404);
  });
  it('"Anyone at Favor with the link" opens it to signed-in staff only; "Anyone with the link" to everyone', async () => {
    const w = await clipWorld();
    await w.d1.prepare('UPDATE hub_clips SET staff_link = 1 WHERE id = ?').bind(CID).run();
    assert.equal(await info(w, 'bob@favorintl.org'), 200);
    assert.equal(await info(w, ''), 401);
    assert.equal(await info(w, 'field@favourafrica.org', 'field'), 404);
    await w.d1.prepare('UPDATE hub_clips SET staff_link = 0, share = 1 WHERE id = ?').bind(CID).run();
    assert.equal(await info(w, ''), 200);
  });
  it('comments, reactions and the search card follow the same rule', async () => {
    const w = await clipWorld();
    const { onRequestPost } = await import('../functions/api/clips/[id]/comments.ts');
    const post = (email) => onRequestPost({ request: new Request(`https://dash.favorintl.org/api/clips/${CID}/comments`, { method: 'POST', headers: { 'X-Hub-Email': email, 'X-Hub-Role': 'staff', 'X-Hub-Name': 'x', 'Content-Type': 'application/json' }, body: JSON.stringify({ at: 0, text: 'hi' }) }), env: w.env, params: { id: CID } });
    assert.equal((await post('bob@favorintl.org')).status, 404);
    assert.match(src('functions/api/clips/[id]/reactions.ts'), /mayWatch\(env, who\.user, clip\)/);
    assert.match(src('functions/_lib/hub/entity.ts'), /if \(!c \|\| !\(await mayWatch\(env as any, user, c\)\)\) return null;/);
  });
  it('the new switch is off for every clip, and copying the link turns nothing on', () => {
    assert.match(src('db/clip-access.sql'), /ADD COLUMN staff_link INTEGER NOT NULL DEFAULT 0/);
    assert.doesNotMatch(src('public/js/clips/watch.js'), /json: \{ share: true \}/);
  });
});

describe('privacy follow-ups 2026-10-14: a Brain answer with partner data is shared only where everyone may read it', () => {
  async function shareWorld({ bobHasPartners }) {
    const w = await world();
    const at = new Date(NOW).toISOString();
    for (const [email, team] of [['rdd@favorintl.org', 'Development (RDD)'], ['bob@favorintl.org', bobHasPartners ? 'Development (RDD)' : 'Marketing']]) {
      await w.d1.prepare(`INSERT OR IGNORE INTO hub_users (email, name, picture, role, blocked, note, sign_ins, created_at, updated_at) VALUES (?, ?, '', 'staff', 0, '', 1, ?, ?)`).bind(email, email.split('@')[0], at, at).run();
      await w.d1.prepare(`INSERT OR REPLACE INTO meet_directory (email, name, team, active) VALUES (?, ?, ?, 1)`).bind(email, email.split('@')[0], team).run();
    }
    for (const [kind, key, pkg] of [['everyone', '', 'sheets'], ['team', 'Development (RDD)', 'partners']]) await w.d1.prepare(`INSERT INTO brain_access_rules (kind, key, package, created_by, created_at) VALUES (?, ?, ?, 'test', ?)`).bind(kind, key, pkg, at).run();
    await w.d1.prepare(`INSERT INTO chat_channels (id, kind, name, created_by, created_at) VALUES ('ch_grp_share', 'group', '', 'rdd@favorintl.org', ?)`).bind(at).run();
    for (const e of ['rdd@favorintl.org', 'bob@favorintl.org']) await w.d1.prepare(`INSERT INTO chat_members (channel_id, email, joined_at) VALUES ('ch_grp_share', ?, ?)`).bind(e, at).run();
    const brain = { status: 'done', blocks: [{ type: 'tiles', tiles: [{ label: 'Households', value: '12' }] }, { type: 'table', title: 'Lapsed partners', token: 'abcdefabcdefabcdefabcdef', keys: ['name', 'lookup_id', 'lifetime'], rows: [{ name: 'Pat Example', lookup_id: '123', lifetime: 500 }] }], follow: [], asked_as: 'lapsed partners', lists: [{ token: 'abcdefabcdefabcdefabcdef', title: 'Lapsed partners' }] };
    const r = await w.d1.prepare(`INSERT INTO chat_messages (channel_id, email, body, attachments, brain, created_at, visible_to) VALUES ('ch_grp_share', 'brain', '', '[]', ?, ?, 'rdd@favorintl.org')`).bind(JSON.stringify(brain), at).run();
    const id = Number(r.meta?.last_row_id ?? (await w.d1.prepare(`SELECT MAX(id) AS id FROM chat_messages`).first()).id);
    return { w, id };
  }
  const shareAnswer = async () => (await import('../functions/_lib/chat/db.ts')).shareAnswer;

  it('refused with a plain message when someone in the conversation lacks partner access', async () => {
    const { w, id } = await shareWorld({ bobHasPartners: false });
    await assert.rejects((await shareAnswer())(w.env, 'rdd@favorintl.org', id), (e) => e.status === 409 && e.code === 'partner_audience' && /1 person in this conversation does not have partner access/.test(e.message));
    const still = await w.d1.prepare('SELECT visible_to FROM chat_messages WHERE id = ?').bind(id).first();
    assert.equal(still.visible_to, 'rdd@favorintl.org', 'the private answer stays private');
  });
  it('the summary without partner details can be shared instead', async () => {
    const { w, id } = await shareWorld({ bobHasPartners: false });
    const { posted } = await (await shareAnswer())(w.env, 'rdd@favorintl.org', id, { summary: true });
    const row = await w.d1.prepare('SELECT brain, visible_to FROM chat_messages WHERE id = ?').bind(posted.message.id).first();
    const b = JSON.parse(row.brain);
    assert.equal(row.visible_to, null);
    assert.deepEqual(b.blocks.map((x) => x.type), ['tiles']);
    assert.ok(!row.brain.includes('Pat Example') && !row.brain.includes('abcdefabcdef'), 'no partner name and no list token');
  });
  it('shared in full when every member holds the Brain partner package', async () => {
    const { w, id } = await shareWorld({ bobHasPartners: true });
    const { posted } = await (await shareAnswer())(w.env, 'rdd@favorintl.org', id);
    const row = await w.d1.prepare('SELECT brain FROM chat_messages WHERE id = ?').bind(posted.message.id).first();
    assert.ok(row.brain.includes('Pat Example'));
  });
  it('an answer with no partner data shares anywhere', async () => {
    const { answerHasPartnerData } = await import('../functions/_lib/brain-access.ts');
    assert.equal(answerHasPartnerData({ blocks: [{ type: 'text', md: 'CTG means Change the Game.' }, { type: 'team', rows: [] }] }), false);
    assert.equal(answerHasPartnerData({ blocks: [{ type: 'partner', name: 'Pat' }] }), true);
  });
});

describe('privacy follow-ups 2026-10-14: Brain packages from FavorOS rules, and list downloads through FavorOS', () => {
  it('FavorOS matches rules the way the Brain does (team, role, lead, person; admin only by person; inactive gives nothing)', async () => {
    const { rulePackages } = await import('../functions/_lib/brain-access.ts');
    const rules = [{ kind: 'team', key: 'Grants', package: 'partners' }, { kind: 'team', key: 'Grants', package: 'admin' }, { kind: 'role', key: 'admin', package: 'contacts' }, { kind: 'lead', key: '', package: 'all_teams' }, { kind: 'person', key: 'ann@favorintl.org', package: 'iwave' }];
    const p = (who) => [...rulePackages(rules, who)].filter((x) => x !== 'basics').sort().join(',');
    assert.equal(p({ email: 'g@favorintl.org', team: 'Grants' }), 'partners');
    assert.equal(p({ email: 'g@favorintl.org', team: 'grants', lead: 1 }), 'all_teams,partners');
    assert.equal(p({ email: 'a@favorintl.org', role: 'admin' }), 'contacts');
    assert.equal(p({ email: 'ann@favorintl.org' }), 'iwave');
    assert.equal(p({ email: 'x@favorintl.org', team: '' }), '');
  });
  it('a blocked person and anyone when no rules exist get Basics only', async () => {
    const { brainPackagesFor } = await import('../functions/_lib/brain-access.ts');
    const { env, d1 } = await world();
    const at = new Date(NOW).toISOString();
    assert.deepEqual([...(await brainPackagesFor(env, ['ann@favorintl.org'])).get('ann@favorintl.org')], ['basics']);
    await d1.prepare(`INSERT INTO brain_access_rules (kind, key, package, created_by, created_at) VALUES ('everyone', '', 'partners', 't', ?)`).bind(at).run();
    assert.ok((await brainPackagesFor(env, ['ann@favorintl.org'])).get('ann@favorintl.org').has('partners'));
    await d1.prepare(`UPDATE hub_users SET blocked = 1 WHERE email = 'ann@favorintl.org'`).run();
    assert.deepEqual([...(await brainPackagesFor(env, ['ann@favorintl.org'])).get('ann@favorintl.org')], ['basics']);
  });
  it('Admin > People changes a rule; staff cannot', async () => {
    const { onRequestPost, onRequestGet } = await import('../functions/api/admin/brain-access.ts');
    const { env } = await world();
    const req = (email, role, body) => new Request('https://dash.favorintl.org/api/admin/brain-access', { method: body ? 'POST' : 'GET', headers: { 'X-Hub-Email': email, 'X-Hub-Role': role, 'X-Hub-Name': 'x', Origin: 'https://dash.favorintl.org', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const add = { op: 'add', kind: 'team', key: 'Grants', package: 'partners' };
    assert.equal((await onRequestPost({ request: req('ann@favorintl.org', 'staff', add), env, waitUntil: () => {} })).status, 403);
    const ok = await onRequestPost({ request: req('tester@favorintl.org', 'admin', add), env, waitUntil: () => {} });
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.equal((await onRequestPost({ request: req('tester@favorintl.org', 'admin', { op: 'add', kind: 'team', key: 'Grants', package: 'admin' }), env, waitUntil: () => {} })).status, 400, 'Brain admin goes to one person');
    const got = await (await onRequestGet({ request: req('tester@favorintl.org', 'admin'), env, waitUntil: () => {} })).json();
    assert.ok(got.rules.some((r) => r.kind === 'team' && r.key === 'Grants' && r.package === 'partners'));
  });
  it('FavorOS rewrites Brain list links to its own route and forwards only the signed-in person', async () => {
    const { onRequest, hubCsvLinks } = await import('../functions/api/brain/[[path]].ts');
    assert.equal(hubCsvLinks('see https://mcp.favorintl.org/csv/abcdefabcdefabcdefabcdef/x.csv', {}), 'see /api/brain/csv/abcdefabcdefabcdefabcdef/x.csv');
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      seen.push({ url: String(url), who: init.headers['X-Acting-Email'] });
      return new Response('name\nPat', { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="x.csv"' } });
    };
    try {
      const { env } = await world();
      const call = (email, role, path = 'csv/abcdefabcdefabcdefabcdef/x.csv') => onRequest({ request: new Request('https://dash.favorintl.org/api/brain/' + path, { headers: email ? { 'X-Hub-Email': email, 'X-Hub-Role': role, 'X-Hub-Name': 'x' } : {} }), env: { ...env, BRAIN_HUB_KEY: 'k' }, params: { path: path.split('/') }, waitUntil: () => {} });
      const res = await call('ann@favorintl.org', 'staff');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
      assert.deepEqual(seen.pop(), { url: 'https://mcp.favorintl.org/hub/csv/abcdefabcdefabcdefabcdef', who: 'ann@favorintl.org' });
      assert.equal((await call('', '')).status, 401, 'signed out');
      assert.equal((await call('f@favourafrica.org', 'field')).status, 403, 'field');
      assert.equal(seen.length, 0, 'signed out and field never reach the Brain');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('clip sharing levels (2026-10-14): private, specific people, anyone at Favor, everybody', () => {
  const CID = 'ef34'.repeat(8);
  const OTHER = 'ef35'.repeat(8);
  const SECRET = 'levels-test-secret';
  const R2 = {
    head: async () => ({ size: 100, httpEtag: '"x"' }),
    get: async (_k, o) => ({ body: o && o.range ? 'x'.repeat(o.range.length) : 'x'.repeat(100) }),
  };
  async function levelWorld(access = 'people') {
    const w = await world();
    const at = new Date(NOW).toISOString();
    for (const [email, role] of [['owner@favorintl.org', 'staff'], ['bob@favorintl.org', 'staff'], ['cat@favorintl.org', 'staff'], ['dan@favorintl.org', 'staff'], ['field@favourafrica.org', 'field']]) {
      await w.d1.prepare(`INSERT OR IGNORE INTO hub_users (email, name, picture, role, blocked, note, sign_ins, created_at, updated_at) VALUES (?, ?, '', ?, 0, '', 1, ?, ?)`).bind(email, email.split('@')[0], role, at, at).run();
    }
    const share = access === 'public' ? 1 : 0;
    const link = access === 'staff' || access === 'public' ? 1 : 0;
    await w.d1.prepare(`INSERT INTO hub_clips (id, owner_email, owner_name, title, status, share, staff_link, access, mime, size_bytes, duration_ms, created_at, updated_at, summary) VALUES (?, 'owner@favorintl.org', 'Owner', 'A clip', 'ready', ?, ?, ?, 'video/webm', 100, 1000, ?, ?, '')`).bind(CID, share, link, access, at, at).run();
    // bob is named, cat is in a direct message with the owner where the clip was posted, dan watched it before levels existed.
    await w.d1.prepare(`INSERT INTO hub_clip_people (clip_id, email, added_by, created_at) VALUES (?, 'bob@favorintl.org', 'owner@favorintl.org', ?)`).bind(CID, at).run();
    await w.d1.prepare(`INSERT INTO chat_channels (id, kind, name, created_by, created_at) VALUES ('ch_lv_dm', 'dm', '', 'owner@favorintl.org', ?)`).bind(at).run();
    for (const e of ['owner@favorintl.org', 'cat@favorintl.org']) await w.d1.prepare(`INSERT INTO chat_members (channel_id, email, joined_at) VALUES ('ch_lv_dm', ?, ?)`).bind(e, at).run();
    await w.d1.prepare(`INSERT INTO chat_messages (channel_id, email, body, attachments, created_at) VALUES ('ch_lv_dm', 'owner@favorintl.org', '', ?, ?)`).bind(JSON.stringify([{ type: 'clip', id: CID }]), at).run();
    await w.d1.prepare(`INSERT INTO hub_clip_views (id, clip_id, person_email, person_name, at, seconds) VALUES ('v_lv', ?, 'dan@favorintl.org', 'Dan', ?, 5)`).bind(CID, at).run();
    return { ...w, env: { ...w.env, CLIPS: R2, SFU_APP_SECRET: SECRET } };
  }
  const as = (email, role = 'staff') => (email ? { 'X-Hub-Email': email, 'X-Hub-Role': role, 'X-Hub-Name': email.split('@')[0] } : {});
  const WHO = {
    owner: as('owner@favorintl.org'),
    admin: as('tester@favorintl.org', 'admin'),
    named: as('bob@favorintl.org'),
    chat: as('cat@favorintl.org'),
    earlier: as('dan@favorintl.org'),
    stranger: as('ann@favorintl.org'),
    field: as('field@favourafrica.org', 'field'),
    out: as(''),
  };
  const base = 'https://dash.favorintl.org';
  const route = async (file, name, w, who, path = '', init = {}, id = CID) => {
    const mod = await import(`../functions/api/clips/[id]/${file}.ts`);
    return mod[name]({ request: new Request(`${base}/api/clips/${id}/${file}${path}`, { ...init, headers: { ...WHO[who], ...(init.headers || {}) } }), env: w.env, params: { id }, waitUntil: () => undefined });
  };
  const info = async (w, who) => (await route('info', 'onRequestGet', w, who)).status;
  const grid = async (w) => {
    const out = {};
    for (const who of Object.keys(WHO)) out[who] = await info(w, who);
    return out;
  };

  it('Private opens for the owner and admins only, even for a named person, a chat member and an earlier viewer', async () => {
    const g = await grid(await levelWorld('private'));
    assert.deepEqual(g, { owner: 200, admin: 200, named: 404, chat: 404, earlier: 404, stranger: 404, field: 404, out: 401 });
  });
  it('Specific people opens for the owner, admins, named people and members of a chat it was posted in, not earlier viewers', async () => {
    const g = await grid(await levelWorld('people'));
    assert.deepEqual(g, { owner: 200, admin: 200, named: 200, chat: 200, earlier: 404, stranger: 404, field: 404, out: 401 });
  });
  it('Anyone at Favor opens for every signed-in staff member and still refuses field accounts and signed-out callers', async () => {
    const g = await grid(await levelWorld('staff'));
    assert.deepEqual(g, { owner: 200, admin: 200, named: 200, chat: 200, earlier: 200, stranger: 200, field: 404, out: 401 });
  });
  it('Everybody opens for every signed-in staff member, field accounts and signed-out callers', async () => {
    const g = await grid(await levelWorld('public'));
    assert.deepEqual(g, { owner: 200, admin: 200, named: 200, chat: 200, earlier: 200, stranger: 200, field: 200, out: 200 });
  });
  it('a clip whose level was never set keeps the old rules: earlier viewers keep it, others need to be named or in the chat', async () => {
    const w = await levelWorld('people');
    await w.d1.prepare('UPDATE hub_clips SET access = NULL WHERE id = ?').bind(CID).run();
    assert.deepEqual(await grid(w), { owner: 200, admin: 200, named: 200, chat: 200, earlier: 200, stranger: 404, field: 404, out: 401 });
    await w.d1.prepare('UPDATE hub_clips SET access = NULL, share = 1 WHERE id = ?').bind(CID).run();
    assert.equal(await info(w, 'out'), 200, 'the old public switch still means Everybody');
  });
  it('the video, thumbnail and download follow the level on every request, for each person', async () => {
    for (const [level, staffOk, outOk] of [['private', false, false], ['people', false, false], ['staff', true, false], ['public', true, false]]) {
      const w = await levelWorld(level);
      const stranger = await route('media', 'onRequestGet', w, 'stranger');
      assert.equal(stranger.status === 200, staffOk, `${level}: a stranger streaming`);
      assert.equal((await route('media', 'onRequestGet', w, 'stranger', '?dl=1')).status === 200, staffOk, `${level}: a stranger downloading`);
      assert.equal((await route('media', 'onRequestGet', w, 'stranger', '?poster=1')).status === 200 || (await route('poster', 'onRequestGet', w, 'stranger')).status === 404, true);
      assert.equal((await route('media', 'onRequestGet', w, 'out')).status === 200, outOk, `${level}: signed out with no token`);
      assert.equal((await route('media', 'onRequestGet', w, 'owner')).status, 200, `${level}: the owner`);
    }
  });
  it('Everybody streams to a signed-out viewer only with the short-lived token the page was given', async () => {
    const w = await levelWorld('public');
    const body = await (await route('info', 'onRequestGet', w, 'out')).json();
    assert.ok(body.clip.share && body.clip.access === 'public');
    const video = body.media.video;
    assert.match(video, new RegExp('^/api/clips/' + CID + '/media[?]k=v[0-9]{13}[.][0-9a-f]{40}$'));
    const k = new URL(base + video).searchParams.get('k');
    const ok = await route('media', 'onRequestGet', w, 'out', '?k=' + k, { headers: { Range: 'bytes=0-9' } });
    assert.equal(ok.status, 206);
    assert.match(ok.headers.get('Cache-Control'), /no-store/);
    assert.equal((await route('media', 'onRequestGet', w, 'out', '?dl=1&k=' + k)).status, 200, 'download works with the token');
    assert.equal((await route('media', 'onRequestGet', w, 'out', '?k=' + k.slice(0, -1) + (k.endsWith('0') ? '1' : '0'))).status, 401, 'a changed token');
    assert.equal((await route('media', 'onRequestGet', w, 'out', '?k=' + k, {}, OTHER)).status, 401, 'a token for another clip finds nothing');
    const lib = await import('../functions/_lib/clips.ts');
    const expired = await lib.publicToken(w.env, CID, 'v', -1000);
    assert.equal((await route('media', 'onRequestGet', w, 'out', '?k=' + expired)).status, 401, 'an expired token');
    const posterOnly = await lib.publicToken(w.env, CID, 'p');
    assert.equal((await route('media', 'onRequestGet', w, 'out', '?poster=1&k=' + posterOnly)).status, 200, 'a poster token opens the poster');
    assert.equal((await route('media', 'onRequestGet', w, 'out', '?k=' + posterOnly)).status, 401, 'and never the video');
    // The owner turns it off: the token in hand stops working on the next request.
    await w.d1.prepare(`UPDATE hub_clips SET access = 'staff', share = 0 WHERE id = ?`).bind(CID).run();
    assert.equal((await route('media', 'onRequestGet', w, 'out', '?k=' + k)).status, 401);
    assert.equal(await info(w, 'out'), 401);
  });
  it('a public clip of a blocked owner stops for outsiders but signed-in staff keep it', async () => {
    const w = await levelWorld('public');
    await w.d1.prepare(`UPDATE hub_users SET blocked = 1 WHERE email = 'owner@favorintl.org'`).run();
    assert.equal(await info(w, 'out'), 401);
    assert.equal(await info(w, 'stranger'), 200);
  });
  it('comments, reactions and view counts follow the level', async () => {
    const post = (w, who, file, body) => route(file, 'onRequestPost', w, who, '', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    for (const [level, strangerOk] of [['private', false], ['people', false], ['staff', true], ['public', true]]) {
      const w = await levelWorld(level);
      assert.equal((await post(w, 'stranger', 'comments', { text: 'hi', at: 1 })).status === 200, strangerOk, `${level}: a stranger commenting`);
      assert.equal((await post(w, 'stranger', 'reactions', { emoji: '\u{1F44D}', at: 1 })).status === 200, strangerOk, `${level}: a stranger reacting`);
      assert.equal((await post(w, 'stranger', 'views', { seconds: 1 })).status === 200, strangerOk, `${level}: a stranger counted as a view`);
      assert.equal((await post(w, 'out', 'views', { seconds: 1 })).status === 200, level === 'public', `${level}: a signed-out view`);
    }
  });
  it('the viewers list and the transcript, notes and sharing detail go to the owner and admins, never to other staff or outsiders', async () => {
    const w = await levelWorld('public');
    const owner = await (await route('info', 'onRequestGet', w, 'owner')).json();
    const stranger = await (await route('info', 'onRequestGet', w, 'stranger')).json();
    const out = await (await route('info', 'onRequestGet', w, 'out')).json();
    assert.ok(Array.isArray(owner.viewers) && owner.people && owner.postedIn && owner.level === 'public');
    for (const body of [stranger, out]) {
      assert.equal(body.viewers, undefined);
      assert.equal(body.people, undefined);
      assert.equal(body.postedIn, undefined);
      assert.equal(body.helpDraft, undefined);
    }
    assert.equal(out.comments, undefined, 'a signed-out viewer gets no comments');
    assert.equal(stranger.can.share, false);
  });
  it('only the owner changes the level, it takes effect at once, and an unknown level is refused', async () => {
    const w = await levelWorld('private');
    const patch = (who, json) => route('index', 'onRequestPatch', w, who, '', { method: 'PATCH', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });
    assert.equal(await info(w, 'stranger'), 404);
    assert.equal((await patch('stranger', { access: 'public' })).status, 404, 'another staff member cannot');
    assert.equal((await patch('admin', { access: 'public' })).status, 404, 'an admin cannot edit another person\'s clip');
    assert.equal((await patch('owner', { access: 'everyone' })).status, 400);
    for (const [level, strangerStatus, outStatus] of [['staff', 200, 401], ['public', 200, 200], ['people', 404, 401], ['private', 404, 401]]) {
      const r = await patch('owner', { access: level });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).access, level);
      assert.equal(await info(w, 'stranger'), strangerStatus, `${level}: stranger right after the change`);
      assert.equal(await info(w, 'out'), outStatus, `${level}: signed out right after the change`);
    }
    const row = await w.d1.prepare('SELECT access, share, staff_link FROM hub_clips WHERE id = ?').bind(CID).first();
    assert.deepEqual({ ...row }, { access: 'private', share: 0, staff_link: 0 });
  });
  it('the older share and staffLink switches still map onto a level', async () => {
    const w = await levelWorld('people');
    const patch = (json) => route('index', 'onRequestPatch', w, 'owner', '', { method: 'PATCH', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });
    assert.equal((await (await patch({ staffLink: true })).json()).access, 'staff');
    assert.equal((await (await patch({ share: true })).json()).access, 'public');
    assert.equal((await (await patch({ share: false })).json()).access, 'people');
  });
  it('people are staff only: an outside email is refused and a blocked person cannot be added', async () => {
    const w = await levelWorld('people');
    await w.d1.prepare(`UPDATE hub_users SET blocked = 1 WHERE email = 'cat@favorintl.org'`).run();
    const patch = (json) => route('index', 'onRequestPatch', w, 'owner', '', { method: 'PATCH', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });
    const out = await patch({ addPeople: ['someone@gmail.com'] });
    assert.equal(out.status, 400);
    assert.match((await out.json()).message || '', /outside Favor, choose Everybody/);
    assert.equal((await patch({ addPeople: ['cat@favorintl.org'] })).status, 400);
    assert.equal((await patch({ addPeople: ['ann@favorintl.org'] })).status, 200);
    assert.equal(await info(w, 'stranger'), 200, 'the person just named opens it');
    assert.equal((await patch({ removePeople: ['ann@favorintl.org'] })).status, 200);
    assert.equal(await info(w, 'stranger'), 404, 'and loses it when removed');
  });
  it('the staff picker finds staff by name, never a blocked or field account', async () => {
    const w = await levelWorld('people');
    await w.d1.prepare(`UPDATE hub_users SET blocked = 1 WHERE email = 'cat@favorintl.org'`).run();
    const { onRequestGet } = await import('../functions/api/clips/people.ts');
    const find = async (q, who = WHO.owner) => (await (await onRequestGet({ request: new Request(`${base}/api/clips/people?q=${q}`, { headers: who }), env: w.env, params: {} })).json());
    assert.deepEqual((await find('bob')).people.map((p) => p.email), ['bob@favorintl.org']);
    assert.deepEqual((await find('cat')).people, []);
    assert.deepEqual((await find('field')).people, []);
    assert.deepEqual((await find('b')).people, [], 'one letter returns nothing');
    const signedOut = await onRequestGet({ request: new Request(`${base}/api/clips/people?q=bob`), env: w.env, params: {} });
    assert.equal(signedOut.status, 401);
  });
  it('a new clip starts as Specific people unless an admin changed the default, and Everybody is never a default', async () => {
    const w = await levelWorld('people');
    const create = async (headers) => {
      const { onRequestPost } = await import('../functions/api/clips/index.ts');
      const env = { ...w.env, CLIPS: { createMultipartUpload: async () => ({ uploadId: 'u1' }) } };
      const res = await onRequestPost({ request: new Request(`${base}/api/clips`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ mime: 'video/webm' }) }), env, params: {}, waitUntil: () => undefined });
      assert.equal(res.status, 200);
      return (await res.json()).id;
    };
    const a = await create(WHO.owner);
    assert.deepEqual({ ...(await w.d1.prepare('SELECT access, share, staff_link FROM hub_clips WHERE id = ?').bind(a).first()) }, { access: 'people', share: 0, staff_link: 0 });
    await w.d1.prepare(`INSERT OR REPLACE INTO hub_settings (key, value, updated_by, updated_at) VALUES ('clips.share_default', 'public', 'test', ?)`).bind(new Date(NOW).toISOString()).run();
    const b = await create(WHO.owner);
    assert.equal((await w.d1.prepare('SELECT access FROM hub_clips WHERE id = ?').bind(b).first()).access, 'people', 'public is not a default');
    await w.d1.prepare(`UPDATE hub_settings SET value = 'staff' WHERE key = 'clips.share_default'`).run();
    const c = await create(WHO.owner);
    assert.deepEqual({ ...(await w.d1.prepare('SELECT access, staff_link FROM hub_clips WHERE id = ?').bind(c).first()) }, { access: 'staff', staff_link: 1 });
  });
  it('the Brain and search card for a clip follow the level', async () => {
    const w = await levelWorld('private');
    const E = await import('../functions/_lib/hub/entity.ts');
    const user = (email, role = 'staff') => ({ email, name: email, role, picture: '', via: 'google', kpi: true });
    const acc = { admin: false, work: false };
    const card = (u) => E.resolveEntity(w.env, new Request(base + '/x'), u, acc, 'clip', CID).catch(() => 'error');
    assert.equal(await card(user('ann@favorintl.org')), null);
    await w.d1.prepare(`UPDATE hub_clips SET access = 'staff', staff_link = 1 WHERE id = ?`).bind(CID).run();
    const open = await card(user('ann@favorintl.org'));
    assert.ok(open && open.title === 'A clip');
  });
  it('every clip route that shows or streams a clip checks the level on the server', () => {
    for (const f of ['info', 'media', 'views']) assert.match(src(`functions/api/clips/[id]/${f}.ts`), /canWatch\(env, request, clip\)/, f);
    for (const f of ['comments', 'reactions']) assert.match(src(`functions/api/clips/[id]/${f}.ts`), /mayWatch\(env, (who\.)?user, c(lip)?\)/, f);
    assert.match(src('functions/api/clips/[id]/lesson.ts'), /readableClip/);
    assert.match(src('functions/api/clips/[id]/article.ts'), /readableClip/);
    assert.match(src('functions/api/clips/[id]/poster.ts'), /mediaGet/, 'the thumbnail goes through the media route');
    assert.match(src('functions/api/clips/[id]/media.ts'), /publicTokenOk/);
    assert.match(src('db/clip-share.sql'), /ADD COLUMN access TEXT/);
  });
  it('the production probe covers a Private clip, an unshared clip and an Everybody clip', async () => {
    const names = probes().map((p) => p.name);
    for (const n of ['Private clip', 'Private clip video', 'Unshared clip video', 'Public clip (everybody reads it)', 'Public clip video without its token']) assert.ok(names.includes(n), n);
    assert.ok(canaryStatements(NOW).some(([sql, args]) => args.includes(IDS.clipPublic)));
  });
});
