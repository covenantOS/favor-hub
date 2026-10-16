// Run with: npm test
//
// Field staff reach Chat, Meetings and Favor Brain and nothing else, and favorintl.org staff and admins lose nothing.
// Three layers are tested: the middleware path list, the Chat and Meetings routers, and the Brain proxy. Made-up people only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addUser, call, cookieFor, world } from './support/field-world.mjs';

async function people() {
  const w = await world();
  addUser(w, { email: 'ann@favorintl.org', name: 'Ann Staff', role: 'staff' });
  addUser(w, { email: 'kofi@favourafrica.org', name: 'Kofi Test', role: 'field', kpi: 0 });
  addUser(w, { email: 'lola@favourafrica.org', name: 'Lola Test', role: 'field', kpi: 0 });
  return { w, ann: await cookieFor(w, 'ann@favorintl.org'), kofi: await cookieFor(w, 'kofi@favourafrica.org'), lola: await cookieFor(w, 'lola@favourafrica.org'), will: await cookieFor(w, 'will@favorintl.org') };
}

const BLOCKED_API = [
  '/api/work/portfolio', '/api/work/board', '/api/hub/today', '/api/hub/home', '/api/hub/kpi', '/api/kpi/enter', '/api/mail/threads', '/api/reports/list', '/api/requests',
  '/api/projects/list', '/api/clips', '/api/admin/people', '/api/admin/settings?area=chat', '/api/foundations/search', '/api/receipts/list', '/api/statements/find',
  '/api/gift-entry/deposits', '/api/expenses/log', '/api/learn/courses', '/api/onboarding/runs', '/api/evaluations/mine', '/api/sheets/recent', '/api/google/status',
  '/api/mobile/today', '/api/uploads/x', '/api/drill', '/api/tasks', '/api/feedback', '/api/videos/list', '/api/agent/queue-not-field',
];
const BLOCKED_PAGES = ['/work/', '/gifts/', '/gifts/letters/', '/gift-entry/', '/dashboard/', '/reports/', '/mail/', '/projects/', '/learn/', '/admin/', '/admin/people/', '/foundations/', '/receipts/', '/statements/', '/clips/', '/evaluations/', '/expenses/', '/onboarding/', '/brain/admin/', '/feedback/', '/'];
const OPEN_API = ['/api/chat/boot', '/api/meet/meetings', '/api/hub/nav', '/api/auth/me', '/api/push/key', '/api/work/gate'];
const OPEN_PAGES = ['/m/', '/chat/', '/meet/', '/meet/room/', '/meet/book/', '/brain/', '/help/', '/help/chat/', '/login/'];

describe('the middleware keeps field staff to Chat, Meetings and Favor Brain', () => {
  it('turns every other API away with a 403 and never reaches the route', async () => {
    const { w, kofi } = await people();
    for (const p of BLOCKED_API.filter((x) => !x.includes('/api/agent/'))) {
      const out = await call(w, 'GET', p, { cookie: kofi });
      assert.equal(out.status, 403, p);
      assert.equal(out.reached, false, p);
    }
    for (const p of ['/api/work/week', '/api/admin/audit']) assert.equal((await call(w, 'POST', p, { cookie: kofi, body: {} })).status, 403, p);
  });

  it('sends every other page to Chat', async () => {
    const { w, kofi } = await people();
    for (const p of BLOCKED_PAGES) {
      const out = await call(w, 'GET', p, { cookie: kofi });
      assert.equal(out.status, 302, p);
      assert.equal(new URL(out.location).pathname, '/chat/', p);
    }
  });

  it('lets the field app pages and APIs through', async () => {
    const { w, kofi } = await people();
    for (const p of OPEN_API) assert.notEqual((await call(w, 'GET', p, { cookie: kofi })).status, 403, p);
    for (const p of OPEN_PAGES) {
      const out = await call(w, 'GET', p, { cookie: kofi });
      assert.ok(out.status !== 302 || new URL(out.location).pathname === '/login/', `${p} ${out.status} ${out.location}`);
      assert.equal(out.reached, true, p);
    }
  });

  it('does not match a path that only starts like an allowed one', async () => {
    const { fieldMayOpen } = await import('../functions/_lib/field.ts');
    for (const p of ['/chatter', '/chat-admin/', '/meeting-notes/', '/meetx/', '/mail/', '/m2/', '/api/chatty/boot', '/api/meeting/x', '/api/brainy', '/api/hub/navx', '/api/hub/today', '/api/work/gate/x', '/api/pushy/key', '/api/phones/x', '/brain/admin/', '/brain/anything', '/helpful']) assert.equal(fieldMayOpen(p), false, p);
    for (const p of ['/css/x.css', '/m', '/m/', '/chat', '/chat/', '/meet/room/', '/brain/', '/api/chat/boot', '/api/meet/meetings', '/api/brain/ask', '/api/hub/nav', '/api/push/subscribe', '/api/phone/x']) assert.equal(fieldMayOpen(p), true, p);
  });

  it('leaves favorintl.org staff and admins exactly where they were', async () => {
    const { w, ann, will } = await people();
    for (const cookie of [ann, will]) {
      for (const p of ['/api/work/portfolio', '/api/hub/today', '/api/mail/threads', '/api/reports/list', '/api/clips', '/api/projects/list', '/api/kpi/enter']) {
        const out = await call(w, 'GET', p, { cookie });
        assert.equal(out.reached, true, p);
      }
      for (const p of ['/work/', '/dashboard/', '/mail/', '/reports/', '/projects/', '/chat/', '/meet/']) {
        const out = await call(w, 'GET', p, { cookie });
        // Staff outside Early access land on Today for the held apps; admins keep them.
        if (cookie === ann && ['/mail/', '/chat/', '/meet/', '/projects/'].includes(p)) { assert.equal(out.reached, false, p); assert.equal(new URL(out.location).pathname, '/', p); continue; }
        assert.equal(out.reached, true, p);
      }
    }
  });

  it('a signed-out person still goes to sign-in, and a field person skips the Google connect redirect', async () => {
    const { w, kofi } = await people();
    const out = await call(w, 'GET', '/chat/');
    assert.equal(new URL(out.location).pathname, '/login/');
    // A staff member with no connected Google account is sent to connect; a field person never is.
    w.db.exec('CREATE TABLE IF NOT EXISTS hub_google (email TEXT PRIMARY KEY)');
    const field = await call(w, 'GET', '/chat/', { cookie: kofi });
    assert.equal(field.reached, true);
    const staff = await call(w, 'GET', '/chat/', { cookie: await cookieFor(w, 'ann@favorintl.org') });
    assert.equal(new URL(staff.location).pathname, '/api/google/connect');
  });

  it('the nav endpoint gives a field person Chat and Meetings and a short answer', async () => {
    const { w, kofi } = await people();
    const out = await call(w, 'GET', '/api/hub/nav', { cookie: kofi });
    assert.equal(out.status, 200);
    assert.deepEqual(out.data.access, { field: true, chat: true, meetings: true, brain: false, admin: false, kpi: false });
    assert.deepEqual(out.data.counts, {});
    assert.deepEqual(out.data.kpiTeams, []);
    w.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('field.brain', 'on', 't', 'x')").run();
    assert.equal((await call(w, 'GET', '/api/hub/nav', { cookie: kofi })).data.access.brain, true);
  });
});

describe('Chat shows field staff only their own conversations', () => {
  async function chatWorld() {
    const p = await people();
    const { w, ann, kofi } = p;
    await call(w, 'GET', '/api/chat/boot', { cookie: ann });
    const secret = await call(w, 'POST', '/api/chat/channels/ch_general/messages', { cookie: ann, body: { body: 'Pledge from the Smith family is salmon-colored' } });
    const priv = (await call(w, 'POST', '/api/chat/channels', { cookie: ann, body: { name: 'care-team', private: true } })).data.channel;
    const privMsg = await call(w, 'POST', `/api/chat/channels/${priv.id}/messages`, { cookie: ann, body: { body: 'private salmon plan' } });
    const reply = await call(w, 'POST', 'api/chat/channels/ch_general/messages'.replace(/^/, '/'), { cookie: ann, body: { body: 'a reply', thread_id: secret.data.message.id } });
    return { ...p, secretId: secret.data.message.id, privId: privMsg.data.message.id, priv, replyId: reply.data.message.id };
  }

  it('boot does not join the team channels and lists only what they belong to', async () => {
    const { w, kofi } = await chatWorld();
    const boot = await call(w, 'GET', '/api/chat/boot', { cookie: kofi });
    assert.equal(boot.status, 200);
    assert.deepEqual(boot.data.channels, []);
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM chat_members WHERE email = 'kofi@favourafrica.org'").get().n, 0);
    // A staff member still joins the defaults as before.
    const ann = await call(w, 'GET', '/api/chat/boot', { cookie: await cookieFor(w, 'ann@favorintl.org') });
    assert.ok(ann.data.channels.some((c) => c.id === 'ch_general'));
  });

  it('cannot browse, join, read, thread, react, pin, search or count their way into a public channel', async () => {
    const { w, kofi, secretId, replyId } = await chatWorld();
    const no = async (m, p, body) => { const o = await call(w, m, p, { cookie: kofi, body }); assert.equal(o.status, 403, `${m} ${p} ${o.status}`); };
    await no('GET', '/api/chat/channels/browse');
    await no('POST', '/api/chat/channels/ch_general/join', {});
    await no('GET', '/api/chat/channels/ch_general/messages');
    await no('POST', '/api/chat/channels/ch_general/messages', { body: 'hello' });
    await no('GET', `/api/chat/threads/${secretId}`);
    await no('GET', `/api/chat/threads/${replyId}`);
    await no('POST', `/api/chat/messages/${secretId}/reactions`, { emoji: '\u{1F44D}' });
    await no('POST', `/api/chat/messages/${secretId}/pin`, { on: true });
    await no('PATCH', `/api/chat/messages/${secretId}`, { body: 'x' });
    await no('DELETE', `/api/chat/messages/${secretId}`);
    await no('GET', '/api/chat/channels/ch_general/pins');
    await no('GET', '/api/chat/channels/ch_general/huddle');
    await no('POST', '/api/chat/channels/ch_general/members', { emails: ['kofi@favourafrica.org'] });
    await no('POST', `/api/chat/channels/ch_general/unread`, { from: secretId });
    await no('GET', `/api/chat/drive-file/${secretId}/0/thumb`);
    const hit = await call(w, 'GET', '/api/chat/search?q=salmon', { cookie: kofi });
    assert.equal(hit.status, 200);
    assert.deepEqual(hit.data.results, []);
  });

  it('cannot reach a private channel either, and sees nothing of it by search', async () => {
    const { w, kofi, priv, privId } = await chatWorld();
    assert.equal((await call(w, 'GET', `/api/chat/channels/${priv.id}/messages`, { cookie: kofi })).status, 403);
    assert.equal((await call(w, 'GET', `/api/chat/threads/${privId}`, { cookie: kofi })).status, 403);
  });

  it('cannot use Drive search, the clip picker or the request board from Chat', async () => {
    const { w, kofi, ann } = await chatWorld();
    const dm = (await call(w, 'POST', '/api/chat/conversations', { cookie: ann, body: { members: ['kofi@favourafrica.org'] } })).data.channel;
    for (const p of ['/api/chat/drive?q=budget', '/api/chat/clips']) assert.equal((await call(w, 'GET', p, { cookie: kofi })).status, 403, p);
    assert.equal((await call(w, 'POST', `/api/chat/channels/${dm.id}/request`, { cookie: kofi, body: { title: 'Fix the site' } })).status, 403);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE email = ?').get('kofi@favourafrica.org').n, 0);
    // Staff keep them: the picker answers (an empty list without the Brain), not 403.
    assert.notEqual((await call(w, 'GET', '/api/chat/clips', { cookie: ann })).status, 403);
  });

  it('can read and write the direct message a staff member opened, and the field-staff channel they were added to', async () => {
    const { w, kofi, lola, ann } = await chatWorld();
    const dm = (await call(w, 'POST', '/api/chat/conversations', { cookie: ann, body: { members: ['kofi@favourafrica.org'] } })).data.channel;
    await call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: ann, body: { body: 'hello Kofi' } });
    const read = await call(w, 'GET', `/api/chat/channels/${dm.id}/messages`, { cookie: kofi });
    assert.equal(read.status, 200);
    assert.equal(read.data.messages[0].body, 'hello Kofi');
    const out = await call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: kofi, body: { body: 'hello Ann' } });
    assert.equal(out.status, 200);
    // Lola is not in that conversation.
    assert.equal((await call(w, 'GET', `/api/chat/channels/${dm.id}/messages`, { cookie: lola })).status, 403);
    const boot = await call(w, 'GET', '/api/chat/boot', { cookie: kofi });
    assert.deepEqual(boot.data.channels.map((c) => c.id), [dm.id]);
    // A staff member adds Kofi to a channel and then he can read it.
    const ch = (await call(w, 'POST', '/api/chat/channels', { cookie: ann, body: { name: 'program-updates' } })).data.channel;
    assert.equal((await call(w, 'GET', `/api/chat/channels/${ch.id}/messages`, { cookie: kofi })).status, 403);
    await call(w, 'POST', `/api/chat/channels/${ch.id}/members`, { cookie: ann, body: { emails: ['kofi@favourafrica.org'] } });
    assert.equal((await call(w, 'GET', `/api/chat/channels/${ch.id}/messages`, { cookie: kofi })).status, 200);
  });

  it('can start a conversation with staff or a colleague, and create a channel of their own', async () => {
    const { w, kofi } = await chatWorld();
    const dm = await call(w, 'POST', '/api/chat/conversations', { cookie: kofi, body: { members: ['lola@favourafrica.org', 'nobody@favorintl.org'] } });
    assert.equal(dm.status, 200);
    assert.deepEqual(dm.data.channel.members.sort(), ['kofi@favourafrica.org', 'lola@favourafrica.org'], 'a person outside the directory is dropped');
    assert.equal((await call(w, 'POST', '/api/chat/channels', { cookie: kofi, body: { name: 'kampala-team', private: true } })).status, 200);
  });

  it('a /task typed by field staff is just text, never a task', async () => {
    const { w, kofi, ann } = await chatWorld();
    const dm = (await call(w, 'POST', '/api/chat/conversations', { cookie: ann, body: { members: ['kofi@favourafrica.org'] } })).data.channel;
    const out = await call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: kofi, body: { body: '/task buy cables' } });
    assert.equal(out.status, 200);
    assert.equal(out.data.message.body, '/task buy cables');
  });

  it('an @Brain mention from field staff asks nothing until an admin turns the field Brain on, then carries the field scope', async () => {
    const { w, kofi, ann } = await chatWorld();
    const dm = (await call(w, 'POST', '/api/chat/conversations', { cookie: ann, body: { members: ['kofi@favourafrica.org'] } })).data.channel;
    await call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: kofi, body: { body: '<@brain> what is the sponsorship program?' } });
    assert.equal(w.brainCalls.length, 0);
    w.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('field.brain', 'on', 't', 'x')").run();
    await call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: kofi, body: { body: '<@brain> what is the sponsorship program?' } });
    assert.equal(w.brainCalls.length, 1);
    assert.equal(w.brainCalls[0].headers['x-acting-scope'], 'field');
    assert.equal(w.brainCalls[0].headers['x-acting-email'], 'kofi@favourafrica.org');
    // Staff asking the Brain carry no scope header.
    w.brainCalls.length = 0;
    await call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: ann, body: { body: '<@brain> who gave most?' } });
    assert.equal(w.brainCalls[0].headers['x-acting-scope'], undefined);
  });
});

describe('Meetings show field staff only the meetings they host or are invited to', () => {
  const insert = (w, over) => {
    const m = { id: 'a'.repeat(24), title: 'Meeting', host_email: 'ann@favorintl.org', host_name: 'Ann', access: 'staff', invitees: '[]', status: 'scheduled', ...over };
    w.db.prepare(`INSERT INTO hub_meetings (id, title, agenda, host_email, host_name, duration_min, rec_mode, access, invitees, status, created_at) VALUES (?, ?, '', ?, ?, 60, 'notes', ?, ?, ?, ?)`).run(m.id, m.title, m.host_email, m.host_name, m.access, m.invitees, m.status, new Date().toISOString());
    return m.id;
  };

  it('does not list or open a meeting that is open to all staff, and does list one they are invited to', async () => {
    const { w, kofi } = await people();
    const open = insert(w, { id: 'a'.repeat(24), title: 'Partner call with the Smith family', access: 'staff' });
    const invited = insert(w, { id: 'b'.repeat(24), title: 'Kampala planning', access: 'invited', invitees: JSON.stringify([{ email: 'kofi@favourafrica.org', name: 'Kofi' }]) });
    const other = insert(w, { id: 'c'.repeat(24), title: 'Leadership only', access: 'invited', invitees: '[]' });
    const list = await call(w, 'GET', '/api/meet/meetings', { cookie: kofi });
    assert.equal(list.status, 200, JSON.stringify(list.data));
    assert.deepEqual(list.data.meetings.map((m) => m.id), [invited]);
    assert.equal((await call(w, 'GET', `/api/meet/meetings/${open}`, { cookie: kofi })).status, 403);
    assert.equal((await call(w, 'GET', `/api/meet/meetings/${other}`, { cookie: kofi })).status, 403);
    assert.equal((await call(w, 'GET', `/api/meet/meetings/${invited}`, { cookie: kofi })).status, 200);
    // Staff still see the open one (Meetings open to staff).
    w.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('meet.release', 'staff', 't', 'x')").run();
    const staff = await call(w, 'GET', '/api/meet/meetings', { cookie: await cookieFor(w, 'ann@favorintl.org') });
    assert.ok(staff.data.meetings.some((m) => m.id === open));
  });

  it('works even while Meetings is admin-only for staff', async () => {
    const { w, kofi, ann } = await people();
    w.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('meet.release', 'admin', 't', 'x')").run();
    assert.equal((await call(w, 'GET', '/api/meet/meetings', { cookie: kofi })).status, 200);
    assert.equal((await call(w, 'GET', '/api/meet/meetings', { cookie: ann })).status, 404, 'staff are still held back by the setting');
  });

  it('creates an instant meeting with no calendar event, no outside invitees and no guests', async () => {
    const { w, kofi } = await people();
    const out = await call(w, 'POST', '/api/meet/meetings', { cookie: kofi, body: { title: 'Quick call', access: 'guests', calendar: true, invitees: [{ email: 'lola@favourafrica.org' }, { email: 'stranger@example.com' }, { email: 'ann@favorintl.org', guest: true }] } });
    assert.equal(out.status, 200, JSON.stringify(out.data));
    const row = w.db.prepare('SELECT * FROM hub_meetings WHERE id = ?').get(out.data.meeting.id);
    assert.equal(row.access, 'invited');
    assert.equal(row.calendar_event_id, '');
    assert.deepEqual(JSON.parse(row.invitees).map((i) => i.email).sort(), ['ann@favorintl.org', 'lola@favourafrica.org']);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM hub_meeting_guest').get().n, 0);
  });

  it('turns away the routes that read other people’s calendars, book, make guest links or reach the Brain through a meeting', async () => {
    const { w, kofi } = await people();
    const mine = insert(w, { id: 'd'.repeat(24), host_email: 'kofi@favourafrica.org', access: 'invited' });
    const no = async (m, p, body) => assert.equal((await call(w, m, p, { cookie: kofi, body })).status, 403, `${m} ${p}`);
    await no('POST', '/api/meet/meetings/freebusy', { emails: ['ann@favorintl.org'], from: 'a', to: 'b' });
    await no('GET', '/api/meet/meetings/bookstatus');
    await no('POST', '/api/meet/meetings/calendar/switch', {});
    await no('POST', '/api/meet/meetings/remind', {});
    await no('GET', '/api/meet/meetings/actions');
    await no('POST', `/api/meet/meetings/${mine}/guestlink`, {});
    await no('POST', `/api/meet/meetings/${mine}/invite`, { emails: ['x@example.com'] });
    await no('POST', `/api/meet/meetings/${mine}/brain`, { q: 'who gave?' });
    await no('POST', `/api/meet/meetings/${mine}/ask`, { q: 'who gave?' });
    await no('POST', `/api/meet/meetings/${mine}/pump`, {});
    await no('GET', `/api/meet/meetings/${mine}/rec/start`);
  });

  it('answers the two calls the Meetings page makes with empty, true answers', async () => {
    const { w, kofi } = await people();
    const cal = await call(w, 'GET', '/api/meet/meetings/calendar', { cookie: kofi });
    assert.deepEqual(cal.data, { ok: true, connected: false, canWrite: false, meetings: [] });
    const pump = await call(w, 'POST', '/api/meet/meetings/pump', { cookie: kofi, body: {} });
    assert.deepEqual(pump.data, { ok: true, done: true, state: 'idle' });
  });

  it('a host who is field staff can update their own meeting but not someone else’s', async () => {
    const { w, kofi } = await people();
    const mine = insert(w, { id: 'e'.repeat(24), host_email: 'kofi@favourafrica.org', access: 'invited' });
    const theirs = insert(w, { id: 'f'.repeat(24), host_email: 'ann@favorintl.org', access: 'invited', invitees: JSON.stringify([{ email: 'kofi@favourafrica.org' }]) });
    assert.equal((await call(w, 'POST', `/api/meet/meetings/${mine}/update`, { cookie: kofi, body: { title: 'Renamed' } })).status, 200);
    assert.equal((await call(w, 'POST', `/api/meet/meetings/${theirs}/update`, { cookie: kofi, body: { title: 'Mine now' } })).status, 403);
  });
});

describe('Favor Brain for field staff', () => {
  it('is closed until an admin turns it on, and then allows one question at a time with the field scope', async () => {
    const { w, kofi } = await people();
    const ask = () => call(w, 'POST', '/api/brain/ask', { cookie: kofi, body: { question: 'What does the sponsorship program cover?' } });
    const closed = await ask();
    assert.equal(closed.status, 403);
    assert.equal(closed.data.error, 'not_ready');
    assert.equal(w.brainCalls.length, 0);
    w.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('field.brain', 'on', 'test', 'x')").run();
    const open = await ask();
    assert.equal(open.status, 200, JSON.stringify(open.data));
    assert.equal(w.brainCalls.length, 1);
    assert.equal(w.brainCalls[0].headers['x-acting-scope'], 'field');
    assert.equal(w.brainCalls[0].headers['x-acting-email'], 'kofi@favourafrica.org');
  });

  it('allows nothing else of the Brain: no access request, no admin, no lists, no Drive, no connector', async () => {
    const { w, kofi } = await people();
    w.db.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('field.brain', 'on', 'test', 'x')").run();
    for (const [m, p] of [['GET', '/api/brain/me'], ['GET', '/api/brain/connector'], ['POST', '/api/brain/request'], ['POST', '/api/brain/confirm'], ['POST', '/api/brain/list/read'], ['POST', '/api/brain/drive/search'], ['GET', '/api/brain/admin/overview'], ['POST', '/api/brain/admin/grant'], ['GET', '/api/brain/admin/iwave']]) {
      const out = await call(w, m, p, { cookie: kofi, body: m === 'POST' ? {} : undefined });
      assert.equal(out.status, 403, `${m} ${p}`);
    }
    assert.equal(w.brainCalls.length, 0);
  });

  it('staff ask the Brain as before, with no scope header', async () => {
    const { w, ann } = await people();
    const out = await call(w, 'POST', '/api/brain/ask', { cookie: ann, body: { question: 'Who gave most last month?' } });
    assert.equal(out.status, 200, JSON.stringify(out.data));
    assert.equal(w.brainCalls[0].headers['x-acting-scope'], undefined);
  });
});
