// More than one mailbox in Mail: adding one through Google (only verified favorintl.org accounts), the token kept per owner and
// mailbox, a mailbox reachable only by its owner, lists and changes answered from the chosen mailbox, per-mailbox counts, the
// menu number as the sum, sending from a mailbox or one of its aliases, and removing a mailbox. Every address here is invented.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { handle, mailUnreadCount, forgetCount } = await import('../functions/_lib/mail/route.ts');
const { boxClaims, MAX_BOXES } = await import('../functions/_lib/mail/boxes.ts');
const google = await import('../functions/_lib/hub/google.ts');
const connect = await import('../functions/api/google/connect.ts');
const callback = await import('../functions/api/google/callback.ts');

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ADA = { email: 'ada@favorintl.org', name: 'Ada Admin', picture: '', role: 'admin', via: 'google', kpi: true };
const BEN = { email: 'ben@favorintl.org', name: 'Ben Admin', picture: '', role: 'admin', via: 'google', kpi: true };
const MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const idToken = (claims) => `x.${b64u(JSON.stringify(claims))}.y`;

let d1, env, calls, revoked;
/** What each access token (one per mailbox) sees. */
const boxes = {
  'at-refresh-ada': { addr: 'ada@favorintl.org', unread: 2, subject: 'Ada private', sendAs: [{ sendAsEmail: 'ada@favorintl.org', displayName: 'Ada Admin', isDefault: true }] },
  'at-refresh-acct': { addr: 'accounting@favorintl.org', unread: 4, subject: 'Invoice 114 question', sendAs: [{ sendAsEmail: 'accounting@favorintl.org', displayName: 'Favor Accounting', isDefault: true }, { sendAsEmail: 'billing@favorintl.org', displayName: 'Favor Billing', isDefault: false }] },
};

const fakeGoogle = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  const token = String(init.headers?.Authorization || '').replace('Bearer ', '');
  const p = u.pathname.replace('/gmail/v1/users/me', '');
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, path: p, token, body, q: u.searchParams });
  const J = (o, status = 200) => new Response(JSON.stringify(o), { status });
  const box = boxes[token];
  if (!box) return J({ error: { code: 401, message: 'bad token' } }, 401);
  if (p === '/labels/INBOX') return J({ id: 'INBOX', threadsUnread: box.unread });
  if (p === '/settings/sendAs') return J({ sendAs: box.sendAs });
  if (p === '/threads' && method === 'GET' && (u.searchParams.get('q') || '').includes('category:primary')) return J({ threads: Array.from({ length: box.unread }, (_, i) => ({ id: 'u' + i })) });
  if (p === '/threads' && method === 'GET') return J({ threads: [{ id: 't' + box.addr.slice(0, 5).replace(/\W/g, 'x') + 'aaa', historyId: '1' }], resultSizeEstimate: 1 });
  const tm = p.match(/^\/threads\/([^/]+)(?:\/(modify))?$/);
  if (tm) {
    if (tm[2]) return J({ messages: [] });
    return J({
      id: tm[1], historyId: '1',
      messages: [{ id: 'm' + tm[1], threadId: tm[1], labelIds: ['INBOX', 'UNREAD'], internalDate: String(Date.now() - 3600000), snippet: 'hello',
        payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'Pat <pat@example.org>' }, { name: 'To', value: box.addr }, { name: 'Subject', value: box.subject }] } }],
    });
  }
  if (p === '/messages/send') { box.sent = body; box.sentBy = token; return J({ id: 'm9aaaaaa', threadId: 't9aaaaaa' }); }
  return J({ error: { code: 404, message: 'no route ' + p } }, 404);
};

async function grant(email, scopes, refresh) {
  await d1.prepare('INSERT OR REPLACE INTO hub_google (email, refresh_enc, scopes, connected_at) VALUES (?, ?, ?, ?)').bind(email, await google.seal(env, refresh), scopes, '2026-10-11T12:00:00.000Z').run();
}
async function addBox(owner, mailbox, refresh) {
  const { addBox: add } = await import('../functions/_lib/mail/boxes.ts');
  return add(env, owner, mailbox, mailbox.split('@')[0], refresh, MODIFY + ' openid email');
}
async function call(user, method, path, body) {
  const init = { method, headers: { 'X-Hub-Request': '1', 'Content-Type': 'application/json' } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const res = await handle({ request: new Request('https://dash.favorintl.org/api/mail/' + path, init), env, user, path: path.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent), fetcher: fakeGoogle, partners: async () => ({}) });
  return { status: res.status, data: (res.headers.get('Content-Type') || '').includes('json') ? await res.json() : null };
}

beforeEach(async () => {
  d1 = memoryD1();
  for (const f of ['db/google.sql', 'db/admin-home.sql', 'db/mail.sql', 'db/mail-smart.sql', 'db/mail-cache.sql', 'db/mail-boxes.sql']) d1.exec(read(f));
  env = { DB: d1, GOOGLE_TOKEN_KEY: 'ab'.repeat(32), GOOGLE_CLIENT_SECRET: 'x', GOOGLE_TOKEN_URL: 'https://oauth.test/token' };
  calls = [];
  revoked = [];
  forgetCount(ADA.email);
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://oauth.test/token') {
      const refresh = new URLSearchParams(init.body).get('refresh_token');
      return new Response(JSON.stringify({ access_token: 'at-' + refresh, expires_in: 3600 }), { status: 200 });
    }
    if (String(url).startsWith('https://oauth2.googleapis.com/revoke')) { revoked.push(new URL(String(url)).searchParams.get('token')); return new Response('{}', { status: 200 }); }
    return new Response('{}', { status: 404 });
  };
  boxes['at-refresh-ada'].sent = null;
  boxes['at-refresh-acct'].sent = null;
  await grant(ADA.email, MODIFY, 'refresh-ada');
  await grant(BEN.email, MODIFY, 'refresh-ben');
});

describe('adding a mailbox', () => {
  it('accepts only a verified favorintl.org account that is not the person\'s own', () => {
    assert.equal(boxClaims({ email: 'accounting@favorintl.org', email_verified: true, hd: 'favorintl.org' }, ADA.email).ok, true);
    assert.deepEqual(boxClaims({ email: 'pat@gmail.com', email_verified: true }, ADA.email), { ok: false, why: 'domain' });
    assert.deepEqual(boxClaims({ email: 'x@favorintl.org', hd: 'other.org', email_verified: true }, ADA.email), { ok: false, why: 'domain' });
    assert.deepEqual(boxClaims({ email: 'ada@favorintl.org', email_verified: true }, ADA.email), { ok: false, why: 'same' });
    assert.deepEqual(boxClaims({ email: 'x@favorintl.org', email_verified: false }, ADA.email), { ok: false, why: 'failed' });
    assert.deepEqual(boxClaims({}, ADA.email), { ok: false, why: 'failed' });
  });

  it('asks Google for Gmail only, on the account picker, and never mixes in the person\'s own grant', async () => {
    const res = await connect.onRequestGet({ request: new Request('https://dash.favorintl.org/api/google/connect?add=mailbox&next=%2Fmail%2F', { headers: { 'X-Hub-Email': ADA.email, 'X-Hub-Via': 'google' } }), env });
    const q = new URL(res.headers.get('Location')).searchParams;
    assert.deepEqual(q.get('scope').split(' ').sort(), [MODIFY, 'email', 'openid', 'profile'].sort());
    assert.equal(q.get('prompt'), 'select_account consent');
    assert.equal(q.get('hd'), 'favorintl.org');
    assert.equal(q.get('login_hint'), null);
    assert.equal(q.get('include_granted_scopes'), null);
    assert.ok(q.get('state').endsWith('|mailbox'));
  });

  const back = async (user, claims, tokenAnswer = {}) => {
    const state = 's1|%2Fmail%2F|mailbox';
    globalThis.fetch = async () => new Response(JSON.stringify({ access_token: 'a', refresh_token: 'refresh-acct', scope: `openid email profile ${MODIFY}`, id_token: idToken(claims), ...tokenAnswer }), { status: 200 });
    const res = await callback.onRequestGet({ request: new Request('https://dash.favorintl.org/api/google/callback?code=c&state=' + encodeURIComponent(state), { headers: { 'X-Hub-Email': user.email, 'X-Hub-Via': 'google', Cookie: 'hub_gstate=' + encodeURIComponent(state) } }), env });
    return res.headers.get('Location');
  };

  it('stores the mailbox encrypted under its owner and leaves the sign-in grant alone', async () => {
    const loc = await back(ADA, { email: 'Accounting@favorintl.org', email_verified: true, hd: 'favorintl.org', name: 'Favor Accounting' });
    assert.equal(loc, '/mail/?google=mailbox');
    const row = d1.db.prepare('SELECT * FROM hub_mailboxes').get();
    assert.equal(row.owner, ada());
    assert.equal(row.mailbox, 'accounting@favorintl.org');
    assert.ok(!row.refresh_enc.includes('refresh-acct'));
    assert.equal(await google.open(env, row.refresh_enc), 'refresh-acct');
    assert.equal(d1.db.prepare('SELECT scopes FROM hub_google WHERE email = ?').get(ADA.email).scopes, MODIFY);
  });

  it('turns away another domain, the person\'s own account, a missing token and a sixth mailbox', async () => {
    assert.equal(await back(ADA, { email: 'pat@gmail.com', email_verified: true }), '/mail/?google=mailbox-domain');
    assert.equal(await back(ADA, { email: ADA.email, email_verified: true, hd: 'favorintl.org' }), '/mail/?google=mailbox-same');
    assert.equal(await back(ADA, { email: 'x@favorintl.org', email_verified: true, hd: 'favorintl.org' }, { refresh_token: undefined }), '/mail/?google=mailbox-failed');
    assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM hub_mailboxes').get().n, 0);
    for (let i = 0; i < MAX_BOXES; i++) await addBox(ADA.email, `box${i}@favorintl.org`, 'r' + i);
    assert.equal(await back(ADA, { email: 'extra@favorintl.org', email_verified: true, hd: 'favorintl.org' }), '/mail/?google=mailbox-limit');
  });
  const ada = () => ADA.email;
});

describe('reading from a mailbox', () => {
  beforeEach(async () => { await addBox(ADA.email, 'accounting@favorintl.org', 'refresh-acct'); });

  it('answers the list from the chosen mailbox with that mailbox\'s own token', async () => {
    const l = await call(ADA, 'GET', 'threads?label=INBOX&mb=accounting%40favorintl.org');
    assert.equal(l.status, 200);
    assert.equal(l.data.threads[0].subject, 'Invoice 114 question');
    const used = calls.filter((c) => c.path.startsWith('/threads')).map((c) => c.token);
    assert.ok(used.every((t) => t === 'at-refresh-acct'));
    const own = await call(ADA, 'GET', 'threads?label=INBOX');
    assert.equal(own.data.threads[0].subject, 'Ada private');
  });

  it('keeps a mailbox visible only to the person who connected it', async () => {
    const l = await call(BEN, 'GET', 'threads?label=INBOX&mb=accounting%40favorintl.org');
    assert.equal(l.status, 404);
    assert.equal(calls.filter((c) => c.token === 'at-refresh-acct').length, 0);
    assert.equal((await call(BEN, 'GET', 'state')).data.mailboxes.length, 0);
    assert.equal((await call(BEN, 'GET', 'boxes')).data.boxes.length, 1);
    assert.equal((await call(BEN, 'DELETE', 'boxes/accounting%40favorintl.org')).status, 404);
  });

  it('lists the mailboxes with an unread count for each', async () => {
    const b = (await call(ADA, 'GET', 'boxes')).data.boxes;
    assert.deepEqual(b.map((x) => [x.email, x.unread]), [['ada@favorintl.org', 2], ['accounting@favorintl.org', 4]]);
    assert.equal(b[0].primary, true);
    assert.ok(b[1].color);
  });

  it('the menu number is the sum of every mailbox', async () => {
    assert.equal(await mailUnreadCount(env, ADA.email, fakeGoogle), 6);
  });

  it('changes a conversation in the mailbox it lives in', async () => {
    await call(ADA, 'POST', 'threads/tacco0aaa1/modify?mb=accounting%40favorintl.org', { remove: ['UNREAD'] });
    const m = calls.find((c) => c.path.endsWith('/modify'));
    assert.equal(m.token, 'at-refresh-acct');
  });
});

describe('sending from a mailbox', () => {
  beforeEach(async () => { await addBox(ADA.email, 'accounting@favorintl.org', 'refresh-acct'); });
  const fromHeader = (sent) => Buffer.from(sent.raw, 'base64url').toString('utf8').match(/^From: (.*)$/m)?.[1];

  it('lists every address a message can go out from, mailbox by mailbox', async () => {
    const f = (await call(ADA, 'GET', 'from')).data.from;
    assert.deepEqual(f.map((x) => x.mailbox + '>' + x.email), ['ada@favorintl.org>ada@favorintl.org', 'accounting@favorintl.org>accounting@favorintl.org', 'accounting@favorintl.org>billing@favorintl.org']);
  });

  it('sends with the mailbox token and its own address', async () => {
    const r = await call(ADA, 'POST', 'send?mb=accounting%40favorintl.org', { to: ['pat@example.org'], subject: 'Re: Invoice', html: '<p>Paid.</p>' });
    assert.equal(r.status, 200);
    const b = boxes['at-refresh-acct'];
    assert.equal(b.sentBy, 'at-refresh-acct');
    assert.match(fromHeader(b.sent), /Favor Accounting <accounting@favorintl\.org>|accounting@favorintl\.org/);
  });

  it('sends as an alias Gmail lists, and refuses an address it does not', async () => {
    await call(ADA, 'POST', 'send?mb=accounting%40favorintl.org', { to: ['pat@example.org'], subject: 'Bill', html: '<p>x</p>', from: 'billing@favorintl.org' });
    assert.match(fromHeader(boxes['at-refresh-acct'].sent), /billing@favorintl\.org/);
    const bad = await call(ADA, 'POST', 'send?mb=accounting%40favorintl.org', { to: ['pat@example.org'], subject: 'x', html: '<p>x</p>', from: 'ceo@favorintl.org' });
    assert.equal(bad.status, 400);
  });
});

describe('removing a mailbox', () => {
  it('revokes the token, forgets the row and its saved answers, and leaves the person\'s own mail alone', async () => {
    await addBox(ADA.email, 'accounting@favorintl.org', 'refresh-acct');
    d1.db.prepare("INSERT INTO hub_mail_class (email, thread_id, last_mid, kind, ask, p, at) VALUES ('accounting@favorintl.org', 't1', 'm1', 'person', 1, 1, 'x')").run();
    d1.db.prepare("INSERT INTO hub_mail_snooze (email, thread_id, until, created_at) VALUES ('accounting@favorintl.org', 't1', 'x', 'x')").run();
    const r = await call(ADA, 'DELETE', 'boxes/accounting%40favorintl.org');
    assert.equal(r.status, 200);
    assert.deepEqual(revoked, ['refresh-acct']);
    assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM hub_mailboxes').get().n, 0);
    assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM hub_mail_class').get().n, 0);
    assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM hub_mail_snooze').get().n, 0);
    assert.equal((await call(ADA, 'GET', 'threads?label=INBOX')).status, 200);
    assert.equal((await call(ADA, 'GET', 'threads?label=INBOX&mb=accounting%40favorintl.org')).status, 404);
  });
});
