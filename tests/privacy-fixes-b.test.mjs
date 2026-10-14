// Run with: npm test
//
// Privacy fixes, second batch (2026-10-14): the expense log no longer hands out review links and only approvers change its settings,
// a clip's viewer list goes to its owner and admins, the Brain proxy keeps admin paths and client history out, evaluation evidence
// lists only staff-project task titles, the activity feed hides declined requests from non-admins, and blocked people get no mail,
// push or held summaries. Real route files on an in-memory D1. Made-up people only (the repository is public).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { PUSH, addUser, call, cookieFor, world as baseWorld } from './support/field-world.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const TOKEN = 'ab'.repeat(24);
const NOW = '2026-10-14T12:00:00.000Z';

async function world() {
  const w = await baseWorld();
  w.d1.exec(read('db/projects.sql'));
  w.d1.exec(read('db/quiet-hours.sql'));
  w.d1.exec('ALTER TABLE expense_settings ADD COLUMN viewers TEXT NOT NULL DEFAULT \'\';');
  w.d1.db.prepare(`INSERT OR REPLACE INTO expense_settings (id, approver_name, approver_email, distribution, viewers, updated_at) VALUES (1, 'Rachel Example', 'rachel@favorintl.org', 'books@favorintl.org', 'viewer@favorintl.org', ?)`).run(NOW);
  w.d1.db.prepare(`INSERT OR REPLACE INTO expense_mileage_settings (id, rate_cents, deduction_miles, updated_at) VALUES (1, 70, 0, ?)`).run(NOW);
  for (const [email, role] of [['rachel@favorintl.org', 'staff'], ['viewer@favorintl.org', 'staff'], ['sub@favorintl.org', 'staff'], ['ann@favorintl.org', 'staff'], ['bob@favorintl.org', 'staff']]) addUser(w, { email, role });
  return w;
}

const as = (email, role = 'staff') => ({ 'X-Hub-Email': email, 'X-Hub-Role': role, 'X-Hub-Via': 'google', 'X-Hub-Name': email.split('@')[0] });
const req = (url, email, role, init = {}) => new Request(url, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...as(email, role), ...(init.headers || {}) } });
const run = async (handler, ctx) => {
  const pending = [];
  const res = await handler({ ...ctx, waitUntil: (p) => pending.push(p) });
  await Promise.allSettled(pending);
  return { status: res.status, data: await res.json().catch(() => null) };
};

function addExpense(w, id, status = 'pending', hash = 'h') {
  w.db.prepare(`INSERT INTO expense_requests (id, doc_number, status, requester_name, requester_email, travel_dates, travel_city, reason, total_cents, approver_name, approver_email, requester_signature, review_token_hash, submitted_at, created_at, updated_at) VALUES (?, ?, ?, 'Pat Requester', 'pat@favorintl.org', 'Oct 1', 'Tampa, FL', 'Conference', 12500, 'Rachel Example', 'rachel@favorintl.org', ?, ?, ?, ?, ?)`).run(id, 'EXP-' + id, status, SIG, hash, NOW, NOW, NOW);
  w.db.prepare(`INSERT INTO expense_items (id, request_id, position, description, item, amount_cents) VALUES (?, ?, 0, 'Hotel', 'Lodging', 12500)`).run('i' + id, id);
}
const sha = async (s) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).toString('hex');
const event = (w, id, kind, actor, payload) => w.db.prepare(`INSERT INTO expense_events (id, request_id, kind, actor, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('e' + Math.random().toString(36).slice(2), id, kind, actor, payload ? JSON.stringify(payload) : null, NOW);

describe('expense log', () => {
  it('the log answers events as kind, actor and time, with the mail recipients and nothing else', async () => {
    const w = await world();
    addExpense(w, 'exp_1');
    event(w, 'exp_1', 'approver_notified', 'system', { sent: true, to: ['rachel@favorintl.org'], subject: 'Expense request', html: `<a href="https://dash.favorintl.org/expenses/review/?token=${TOKEN}">Review</a>` });
    event(w, 'exp_1', 'approver_resolved', 'system', { name: 'Rachel Example', email: 'rachel@favorintl.org' });
    event(w, 'exp_1', 'declined', 'Rachel Example', { note: 'Needs receipts', ip: '203.0.113.9', from: 'log' });
    const { onRequestGet } = await import('../functions/api/expenses/index.ts');
    const out = await run(onRequestGet, { request: req('https://dash.favorintl.org/api/expenses', 'viewer@favorintl.org'), env: w.env });
    assert.equal(out.status, 200, JSON.stringify(out.data));
    const events = out.data.requests[0].events;
    assert.equal(events.length, 3);
    for (const ev of events) assert.deepEqual(Object.keys(ev).filter((k) => !['payload'].includes(k)).sort(), ['actor', 'created_at', 'kind']);
    assert.deepEqual(JSON.parse(events.find((e) => e.kind === 'approver_notified').payload), { to: ['rachel@favorintl.org'] });
    assert.equal(events.find((e) => e.kind === 'declined').payload, undefined);
    assert.equal(events.find((e) => e.kind === 'approver_resolved').payload, undefined);
    const text = JSON.stringify(out.data);
    assert.ok(!text.includes(TOKEN) && !text.includes('token=') && !text.includes('203.0.113.9') && !text.includes('Needs receipts'));
  });

  it('a new request stores who the approver mail went to, not the mail with its review link', async () => {
    const w = await world();
    w.env.RESEND_API_KEY = 're_test';
    const { onRequestPost } = await import('../functions/api/expenses/index.ts');
    const body = { name: 'Pat Requester', reason: 'Conference', affirm: true, signature: SIG, items: [{ description: 'Hotel', item: 'Lodging', amount: '125.00' }] };
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => (String(url).includes('resend.com') ? new Response('{}', { status: 200 }) : real(url, init));
    try {
      const out = await run(onRequestPost, { request: req('https://dash.favorintl.org/api/expenses', 'pat@favorintl.org', 'staff', { method: 'POST', body: JSON.stringify(body) }), env: w.env });
      assert.equal(out.status, 201, JSON.stringify(out.data));
    } finally {
      globalThis.fetch = real;
    }
    const row = w.db.prepare(`SELECT payload FROM expense_events WHERE kind = 'approver_notified'`).get();
    const payload = JSON.parse(row.payload);
    assert.deepEqual(Object.keys(payload).sort(), ['sent', 'subject', 'to']);
    assert.ok(!row.payload.includes('token='));
  });

  it('a log viewer and a substitute read the settings and cannot change them', async () => {
    const w = await world();
    w.db.prepare(`INSERT INTO expense_approver_overrides (id, start_date, end_date, name, email, created_at) VALUES ('ovr_1', '2020-01-01', '2099-01-01', 'Sam Sub', 'sub@favorintl.org', ?)`).run(NOW);
    const settings = await import('../functions/api/expenses/settings.ts');
    const url = 'https://dash.favorintl.org/api/expenses/settings';
    const put = { approver_name: 'Vic Viewer', approver_email: 'viewer@favorintl.org', distribution: [], mileage_rate_cents: 70, mileage_deduction_miles: 0 };
    for (const who of ['viewer@favorintl.org', 'sub@favorintl.org']) {
      assert.equal((await run(settings.onRequestGet, { request: req(url, who), env: w.env })).status, 200, who + ' reads');
      assert.equal((await run(settings.onRequestPut, { request: req(url, who, 'staff', { method: 'PUT', body: JSON.stringify(put) }), env: w.env })).status, 403, who + ' cannot save');
      const add = { start_date: '2026-10-20', end_date: '2026-10-21', name: 'Vic', email: who };
      assert.equal((await run(settings.onRequestPost, { request: req(url, who, 'staff', { method: 'POST', body: JSON.stringify(add) }), env: w.env })).status, 403, who + ' cannot add a substitute');
      assert.equal((await run(settings.onRequestDelete, { request: req(url + '?id=ovr_1', who, 'staff', { method: 'DELETE' }), env: w.env })).status, 403, who + ' cannot remove one');
    }
    assert.equal(w.db.prepare('SELECT approver_email FROM expense_settings').get().approver_email, 'rachel@favorintl.org');
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM expense_approver_overrides').get().n, 1);
  });

  it('an approver and an admin change the settings', async () => {
    const w = await world();
    const settings = await import('../functions/api/expenses/settings.ts');
    const url = 'https://dash.favorintl.org/api/expenses/settings';
    const put = (name) => ({ approver_name: name, approver_email: 'rachel@favorintl.org', distribution: ['books@favorintl.org'], mileage_rate_cents: 70, mileage_deduction_miles: 0 });
    const a = await run(settings.onRequestPut, { request: req(url, 'rachel@favorintl.org', 'staff', { method: 'PUT', body: JSON.stringify(put('Rachel A')) }), env: w.env });
    assert.equal(a.status, 200, JSON.stringify(a.data));
    const b = await run(settings.onRequestPut, { request: req(url, 'will@favorintl.org', 'admin', { method: 'PUT', body: JSON.stringify(put('Rachel B')) }), env: w.env });
    assert.equal(b.status, 200, JSON.stringify(b.data));
    assert.equal(w.db.prepare('SELECT approver_name FROM expense_settings').get().approver_name, 'Rachel B');
  });

  it('the emailed review link shows the request while it waits and answers 410 once it is decided', async () => {
    const w = await world();
    addExpense(w, 'exp_wait', 'pending', await sha(TOKEN));
    const { onRequestGet } = await import('../functions/api/expenses/review.ts');
    const get = () => run(onRequestGet, { request: new Request('https://dash.favorintl.org/api/expenses/review?token=' + TOKEN), env: w.env });
    assert.equal((await get()).status, 200);
    w.db.prepare(`UPDATE expense_requests SET status = 'approved', approver_signature = ?, decided_at = ? WHERE id = 'exp_wait'`).run(SIG, NOW);
    const after = await get();
    assert.equal(after.status, 410);
    assert.ok(!JSON.stringify(after.data).includes('pat@favorintl.org'));
  });
});

describe('clips', () => {
  async function clipWorld() {
    const w = await world();
    const id = 'c'.repeat(32);
    w.db.prepare(`INSERT INTO hub_clips (id, owner_email, owner_name, title, status, share, mime, created_at, updated_at) VALUES (?, 'ann@favorintl.org', 'Ann Example', 'Walkthrough', 'ready', 0, 'video/mp4', ?, ?)`).run(id, NOW, NOW);
    w.db.prepare(`INSERT INTO hub_clip_views (clip_id, person_email, person_name, at, seconds) VALUES (?, 'bob@favorintl.org', 'Bob Sample', ?, 42)`).run(id, NOW);
    return { w, id };
  }
  const info = async (w, id, email, role) => {
    const { onRequestGet } = await import('../functions/api/clips/[id]/info.ts');
    return run(onRequestGet, { request: req('https://dash.favorintl.org/api/clips/' + id + '/info', email, role), env: w.env, params: { id } });
  };

  it('the owner and an admin see who watched', async () => {
    const { w, id } = await clipWorld();
    const mine = await info(w, id, 'ann@favorintl.org', 'staff');
    assert.equal(mine.status, 200, JSON.stringify(mine.data));
    assert.deepEqual(mine.data.viewers.map((v) => v.email), ['bob@favorintl.org']);
    const admin = await info(w, id, 'will@favorintl.org', 'admin');
    assert.deepEqual(admin.data.viewers.map((v) => v.email), ['bob@favorintl.org']);
  });

  it('another staff member with the link gets the clip and its comments but no viewer list, once it is shared with them', async () => {
    const { w, id } = await clipWorld();
    assert.equal((await info(w, id, 'pat@favorintl.org', 'staff')).status, 404, 'a clip not shared with this person');
    w.db.prepare("INSERT INTO hub_clip_people (clip_id, email, added_by, created_at) VALUES (?, 'pat@favorintl.org', 'ann@favorintl.org', ?)").run(id, NOW);
    const out = await info(w, id, 'pat@favorintl.org', 'staff');
    assert.equal(out.status, 200);
    assert.equal(out.data.viewers, undefined);
    assert.ok(Array.isArray(out.data.comments));
    assert.ok(!JSON.stringify(out.data).includes('Bob Sample'));
  });
});

describe('brain proxy', () => {
  const ask = async (w, email, role, path, body = {}) => {
    const { onRequest } = await import('../functions/api/brain/[[path]].ts');
    const method = path === 'ask' ? 'POST' : path.startsWith('admin/') && !['admin/overview', 'admin/names', 'admin/iwave'].includes(path) ? 'POST' : 'GET';
    return run(onRequest, { request: req('https://dash.favorintl.org/api/brain/' + path, email, role, method === 'POST' ? { method, body: JSON.stringify(body) } : { method }), env: w.env, params: { path: path.split('/') } });
  };

  it('admin paths go to the Brain for an admin and answer 403 for everyone else', async () => {
    const w = await world();
    for (const path of ['admin/overview', 'admin/grant', 'admin/reset', 'admin/decide', 'admin/names', 'admin/name-search', 'admin/alias', 'admin/alias-delete', 'admin/iwave', 'admin/iwave/decide']) {
      const out = await ask(w, 'ann@favorintl.org', 'staff', path);
      assert.equal(out.status, 403, path);
    }
    assert.equal(w.brainCalls.length, 0, 'nothing reached the Brain');
    const ok = await ask(w, 'will@favorintl.org', 'admin', 'admin/overview');
    assert.equal(ok.status, 200);
    assert.equal(w.brainCalls.length, 1);
  });

  it('a question that falls back to the old path drops a history field the browser sent', async () => {
    const w = await world();
    const history = [{ q: 'x', written: { secret: 'query behind another answer' } }];
    // No question text means no chat turn is stored, so the proxy takes the fallback path.
    const out = await ask(w, 'ann@favorintl.org', 'staff', 'ask', { question: '', history });
    assert.equal(out.status, 200, JSON.stringify(out.data));
    assert.equal(w.brainCalls.length, 1);
    const sent = JSON.parse(w.brainCalls[0].body);
    assert.deepEqual(sent.history, []);
    assert.ok(!w.brainCalls[0].body.includes('query behind another answer'));
  });
});

describe('evaluation evidence', () => {
  it('task titles come only from staff-visible projects; personal and members-only tasks stay out', async () => {
    const w = await world();
    const ins = (id, name, vis) => w.db.prepare(`INSERT INTO hub_projects (id, key, name, lead_email, visibility, created_by, created_at, updated_at) VALUES (?, ?, ?, 'ann@favorintl.org', ?, 'ann@favorintl.org', ?, ?)`).run(id, id.toUpperCase(), name, vis, NOW, NOW);
    ins('open1', 'Open project', 'staff');
    ins('priv1', 'Private project', 'members');
    const task = (id, project, title) => w.db.prepare(`INSERT INTO hub_tasks (id, project_id, title, status, owner_email, done_at, done_by, created_by, created_at, updated_at) VALUES (?, ?, ?, 'done', 'ann@favorintl.org', '2026-09-20T12:00:00.000Z', 'ann@favorintl.org', 'ann@favorintl.org', ?, ?)`).run(id, project, title, NOW, NOW);
    task('t1', 'open1', 'Mail the banquet invitations');
    task('t2', 'priv1', 'Draft the staffing plan');
    task('t3', null, 'Call my dentist');
    const { evidenceFor } = await import('../functions/_lib/evals/evidence.ts');
    const ev = await evidenceFor(w.env, 'ann@favorintl.org', '2026-10-05', '2020-01-01');
    assert.deepEqual(ev.tasks.recent.map((t) => t.title), ['Mail the banquet invitations']);
    assert.equal(ev.tasks.done, 3, 'the count still covers every finished task');
  });
});

describe('activity feed', () => {
  it('a declined request shows to admins and not to other staff', async () => {
    const w = await world();
    w.d1.exec(`CREATE TABLE IF NOT EXISTS requests (id TEXT, title TEXT, submitter_name TEXT, status TEXT, created_at TEXT, completed_at TEXT);
      CREATE TABLE IF NOT EXISTS rcp_log (at TEXT, actor TEXT, kind TEXT, detail TEXT);
      CREATE TABLE IF NOT EXISTS fnd_contacts (created_at TEXT, created_by TEXT, how TEXT, foundation_id TEXT);
      CREATE TABLE IF NOT EXISTS fnd_foundations (id TEXT, name TEXT);`);
    const at = new Date(Date.now() - 3600_000).toISOString();
    const add = (id, title, status) => w.db.prepare(`INSERT INTO requests (id, title, submitter_name, status, created_at) VALUES (?, ?, 'Pat Requester', ?, ?)`).run(id, title, status, at);
    add('r1', 'New banner for the lobby', 'open');
    add('r2', 'Replace the sign', 'declined');
    const { activityFor } = await import('../functions/_lib/hub/today.ts');
    const staff = await activityFor(w.env, { admin: false, expenseLog: false });
    assert.deepEqual(staff.filter((a) => a.app === 'Requests').map((a) => a.text), ['Pat Requester asked: New banner for the lobby']);
    const admin = await activityFor(w.env, { admin: true, expenseLog: false });
    assert.equal(admin.filter((a) => a.app === 'Requests').length, 2);
  });
});

describe('blocked and offboarded people', () => {
  const mailTo = (w) => {
    const sent = [];
    w.env.MAIL_HOOK = async (m) => (sent.push(m.to), true);
    return sent;
  };
  const mail = (to) => ({ to, subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' });

  it('blockedSet and isBlocked answer from hub_users, and a missing table counts as nobody blocked', async () => {
    const w = await world();
    addUser(w, { email: 'gone@favorintl.org', blocked: 1 });
    const { blockedSet, isBlocked } = await import('../functions/_lib/blocked.ts');
    assert.deepEqual([...(await blockedSet(w.env, ['Gone@favorintl.org', 'ann@favorintl.org', 'nobody@favorintl.org']))], ['gone@favorintl.org']);
    assert.equal(await isBlocked(w.env, ' GONE@favorintl.org '), true);
    assert.equal(await isBlocked(w.env, 'ann@favorintl.org'), false);
    const bare = { DB: (await import('./support/d1.mjs')).memoryD1() };
    assert.equal(await isBlocked(bare, 'gone@favorintl.org'), false);
    const mute = console.warn;
    console.warn = () => undefined;
    try {
      const { sendMail } = await import('../functions/_lib/notify/send.ts');
      let sent = 0;
      bare.MAIL_HOOK = async () => (sent++, true);
      assert.equal(await sendMail(bare, mail('ann@favorintl.org')), true, 'delivery goes on when the lookup fails');
      assert.equal(sent, 1);
    } finally {
      console.warn = mute;
    }
  });

  it('task mail, request mail and project link mail skip a blocked recipient', async () => {
    const w = await world();
    addUser(w, { email: 'gone@favorintl.org', blocked: 1 });
    const sent = mailTo(w);
    const notify = await import('../functions/_lib/notify/send.ts');
    const requests = await import('../functions/_lib/requests/mail.ts');
    const links = await import('../functions/_lib/projects/links/email.ts');
    for (const send of [notify.sendMail, requests.send, links.send]) {
      assert.equal(await send(w.env, mail('gone@favorintl.org')), false);
      assert.equal(await send(w.env, mail('ann@favorintl.org')), true);
    }
    assert.deepEqual(sent, ['ann@favorintl.org', 'ann@favorintl.org', 'ann@favorintl.org']);
  });

  it('evaluation reminders skip a blocked person, tellOnce included', async () => {
    const w = await world();
    w.d1.exec(`CREATE TABLE IF NOT EXISTS eval_nudges (key TEXT PRIMARY KEY, sent_at TEXT);`);
    w.db.prepare(`INSERT OR REPLACE INTO hub_settings (key, value, updated_by, updated_at) VALUES ('requests.notify', 'on', 'test', ?)`).run(NOW);
    addUser(w, { email: 'gone@favorintl.org', blocked: 1 });
    w.env.RESEND_API_KEY = 're_test';
    const to = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => (String(url).includes('resend.com') ? (to.push(...JSON.parse(init.body).to), new Response('{}', { status: 200 })) : real(url, init));
    try {
      const { tell, tellOnce } = await import('../functions/_lib/evals/mail.ts');
      const m = { heading: 'Feedback is past due', lines: ['Please finish it.'], button: 'Open', path: '/evaluations/' };
      assert.equal(await tell(w.env, 'gone@favorintl.org', 'Reminder', m), false);
      assert.equal(await tellOnce(w.env, 'k1', 'gone@favorintl.org', 'Reminder', m), false);
      assert.equal(await tell(w.env, 'ann@favorintl.org', 'Reminder', m), true);
    } finally {
      globalThis.fetch = real;
    }
    assert.deepEqual(to, ['ann@favorintl.org']);
  });

  it('push goes to the devices of people who are not blocked and skips a blocked person whose phone is still subscribed', async () => {
    const w = await world();
    addUser(w, { email: 'gone@favorintl.org', blocked: 1 });
    const sub = (email) => w.db.prepare(`INSERT INTO push_subs (endpoint, email, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)`).run(`${PUSH}/send/${email}`, email, 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg', NOW);
    sub('gone@favorintl.org');
    sub('ann@favorintl.org');
    const { pushToPeople } = await import('../functions/_lib/push.ts');
    const sent = await pushToPeople(w.env, ['gone@favorintl.org', 'ann@favorintl.org'], { title: 'Bob', body: 'hello', url: '/chat/' }, fetch, { loud: true });
    assert.equal(sent, 1);
    assert.deepEqual(w.pushCalls.map((c) => c.url), [`${PUSH}/send/ann@favorintl.org`]);
  });

  it('held quiet-hours items of a blocked person are cleared and never summarized', async () => {
    const w = await world();
    addUser(w, { email: 'gone@favorintl.org', blocked: 1 });
    const hold = (email) => w.db.prepare(`INSERT INTO hub_quiet_held (email, kind, title, body, url, held_at) VALUES (?, 'push', 'Bob: hello', '', '/chat/', ?)`).run(email, '2026-10-14T02:00:00.000Z');
    hold('gone@favorintl.org');
    hold('ann@favorintl.org');
    const mailed = [];
    const deps = { sendMail: async (to) => (mailed.push(to), true), push: async () => 1 };
    const { deliverHeld } = await import('../functions/_lib/quiet.ts');
    await deliverHeld(w.env, deps, new Date('2026-10-14T15:00:00Z'));
    assert.deepEqual(mailed, ['ann@favorintl.org']);
    assert.equal(w.db.prepare(`SELECT COUNT(*) AS n FROM hub_quiet_held WHERE email = 'gone@favorintl.org'`).get().n, 0);
  });

  it('blocking a person in Admin > People also removes their push devices and held notices', async () => {
    const w = await world();
    addUser(w, { email: 'leaver@favorintl.org' });
    w.db.prepare(`INSERT INTO push_subs (endpoint, email, p256dh, auth, created_at) VALUES (?, 'leaver@favorintl.org', 'a', 'b', ?)`).run(`${PUSH}/send/leaver`, NOW);
    w.db.prepare(`INSERT INTO push_subs (endpoint, email, p256dh, auth, created_at) VALUES (?, 'ann@favorintl.org', 'a', 'b', ?)`).run(`${PUSH}/send/ann`, NOW);
    for (const email of ['leaver@favorintl.org', 'ann@favorintl.org']) w.db.prepare(`INSERT INTO hub_quiet_held (email, kind, title, held_at) VALUES (?, 'push', 'x', ?)`).run(email, NOW);
    const admin = await cookieFor(w, 'will@favorintl.org');
    const out = await call(w, 'POST', '/api/admin/people', { cookie: admin, body: { email: 'leaver@favorintl.org', blocked: true }, headers: { Origin: 'https://dash.favorintl.org' } });
    assert.equal(out.status, 200, JSON.stringify(out.data));
    const count = (table, email) => w.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE email = ?`).get(email).n;
    assert.equal(count('push_subs', 'leaver@favorintl.org'), 0);
    assert.equal(count('hub_quiet_held', 'leaver@favorintl.org'), 0);
    assert.equal(count('push_subs', 'ann@favorintl.org'), 1);
    assert.equal(count('hub_quiet_held', 'ann@favorintl.org'), 1);
  });
});
