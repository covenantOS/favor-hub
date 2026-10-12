// Mail in FavorOS through its router, with a stand-in for Gmail, Google's token call and the database. Who may use it, what each
// Google grant allows (headers, reading, changing), that a refusal never reaches Gmail, the list, a conversation made safe to
// show, files, archive, trash, snooze and its return, drafts, sending a reply that stays in its thread, contacts, and the Google
// connection asking for the mail scopes only when Mail asks. Every person, address and message here is invented.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { handle, wakeDue, mailUnreadCount, forgetCount } = await import('../functions/_lib/mail/route.ts');
const google = await import('../functions/_lib/hub/google.ts');
const { gmail } = await import('../functions/_lib/mail/gmail.ts');
const connect = await import('../functions/api/google/connect.ts');
const callback = await import('../functions/api/google/callback.ts');

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ADMIN = { email: 'ada@favorintl.org', name: 'Ada Admin', picture: '', role: 'admin', via: 'google', kpi: true };
const STAFF = { email: 'dee@favorintl.org', name: 'Dee Staff', picture: '', role: 'staff', via: 'google', kpi: true };
const META = 'https://www.googleapis.com/auth/gmail.metadata';
const READ = 'https://www.googleapis.com/auth/gmail.readonly';
const MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
const CONTACTS = 'https://www.googleapis.com/auth/contacts.readonly';
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url').toString('utf8');

let d1;
let env;
let calls;
let tokenAsks;
let box;

/** An invented mailbox: one thread of two messages (an HTML body with a script and an inline picture, and a PDF). */
function mailbox() {
  const h = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
  return {
    threads: {
      t1aaaaaa: {
        id: 't1aaaaaa',
        historyId: '10',
        messages: [
          {
            id: 'm1aaaaaa', threadId: 't1aaaaaa', labelIds: ['INBOX', 'UNREAD'], internalDate: '1760000000000', snippet: 'We would love to visit &amp; help',
            payload: {
              mimeType: 'multipart/mixed',
              headers: h({ From: '"Okafor, Maya" <Maya.Okafor@Example.org>', To: 'Ada Admin <ada@favorintl.org>, bo@favorintl.org', Subject: 'Visiting in March', 'Message-ID': '<one@example.org>' }),
              parts: [
                { mimeType: 'multipart/alternative', parts: [
                  { mimeType: 'text/plain', body: { data: b64u('We would love to visit.') } },
                  { mimeType: 'text/html', body: { data: b64u('<p onclick="x()">We would love to visit.</p><script>steal()</script><img src="cid:pic1"><a href="javascript:alert(1)">x</a>') } },
                ] },
                { mimeType: 'image/png', filename: 'well.png', headers: h({ 'Content-ID': '<pic1>', 'Content-Disposition': 'inline' }), body: { attachmentId: 'ATTpic1aaaa', size: 1200 } },
                { mimeType: 'application/pdf', filename: 'itinerary.pdf', headers: h({ 'Content-Disposition': 'attachment' }), body: { attachmentId: 'ATTpdf1aaaa', size: 4096 } },
              ],
            },
          },
          {
            id: 'm2aaaaaa', threadId: 't1aaaaaa', labelIds: ['SENT'], internalDate: '1760003600000', snippet: 'Yes, the second week is open.',
            payload: { mimeType: 'text/plain', headers: h({ From: 'Ada Admin <ada@favorintl.org>', To: 'Maya Okafor <maya.okafor@example.org>', Subject: 'Re: Visiting in March', 'Message-ID': '<two@favorintl.org>', References: '<one@example.org>' }), body: { data: b64u('Yes, the second week is open.\n> We would love to visit.') } },
          },
        ],
      },
    },
    sent: [],
    drafts: [],
    modified: [],
  };
}

/** Answers for Gmail and the People API from the invented mailbox, and records every call. */
const fakeGoogle = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, path: u.pathname.replace('/gmail/v1/users/me', ''), q: u.searchParams, body, host: u.hostname });
  const J = (o, status = 200) => new Response(JSON.stringify(o), { status });
  const p = u.pathname.replace('/gmail/v1/users/me', '');
  if (u.hostname === 'people.googleapis.com') return J({ results: [{ person: { names: [{ displayName: 'Tom Whitfield' }], emailAddresses: [{ value: 'Tom@Whitfield.example' }] } }] });
  if (p === '/labels/INBOX') return J({ id: 'INBOX', threadsUnread: 3, threadsTotal: 40 });
  if (p === '/labels' && method === 'GET') return J({ labels: [{ id: 'INBOX', type: 'system' }, { id: 'Label_7', name: 'Trips', type: 'user' }] });
  if (p === '/labels' && method === 'POST') return J({ id: 'Label_9', name: body.name });
  if (p.startsWith('/labels/')) return J({ id: p.split('/')[2], threadsUnread: 1, threadsTotal: 2 });
  if (p === '/settings/sendAs') return J({ sendAs: [{ isDefault: true, signature: '<div>Ada<script>x</script></div>' }] });
  if (p === '/threads' && method === 'GET') {
    if (u.searchParams.get('q') && box.metadataOnly) return J({ error: { code: 403, message: "Metadata scope does not support 'q' parameter", errors: [{ reason: 'forbidden' }] } }, 403);
    return J({ threads: Object.values(box.threads).map((t) => ({ id: t.id, historyId: t.historyId, snippet: 'x' })), resultSizeEstimate: 1 });
  }
  const tm = p.match(/^\/threads\/([^/]+)(?:\/(modify|trash|untrash))?$/);
  if (tm) {
    const t = box.threads[tm[1]];
    if (!t) return J({ error: { code: 404, message: 'Not found' } }, 404);
    if (tm[2]) {
      box.modified.push({ id: tm[1], op: tm[2], body });
      if (tm[2] === 'modify') for (const m of t.messages) m.labelIds = [...new Set(m.labelIds.filter((l) => !(body.removeLabelIds || []).includes(l)).concat(body.addLabelIds || []))];
      t.historyId = String(Number(t.historyId) + 1);
      return J(t);
    }
    if (u.searchParams.get('format') === 'metadata') return J({ ...t, messages: t.messages.map((m) => ({ ...m, payload: { mimeType: m.payload.mimeType, headers: m.payload.headers } })) });
    return J(t);
  }
  if (/^\/messages\/[^/]+\/attachments\//.test(p)) return J({ size: 4, data: b64u('%PDF') });
  if (/^\/messages\/m\w+$/.test(p) && method === 'GET') {
    const m = Object.values(box.threads).flatMap((t) => t.messages).find((x) => x.id === p.split('/')[2]);
    return m ? J({ id: m.id, payload: { headers: m.payload.headers } }) : J({ error: { code: 404, message: 'gone' } }, 404);
  }
  if (p === '/messages/send') { box.sent.push(body); return J({ id: 'm9aaaaaa', threadId: body.threadId || 't9aaaaaa' }); }
  if (p === '/drafts' && method === 'POST') { box.drafts.push({ id: 'r-100200', ...body }); return J({ id: 'r-100200', message: { id: 'm8aaaaaa', threadId: 't8aaaaaa' } }); }
  if (p === '/drafts' && method === 'GET') return J({ drafts: [] });
  if (p.startsWith('/drafts/') && method === 'PUT') { box.drafts.push({ id: p.split('/')[2], ...body, updated: true }); return J({ id: p.split('/')[2], message: { id: 'm8aaaaaa', threadId: 't8aaaaaa' } }); }
  if (p.startsWith('/drafts/') && method === 'DELETE') { box.drafts.push({ id: p.split('/')[2], deleted: true }); return new Response(null, { status: 204 }); }
  return J({ error: { code: 404, message: 'no route ' + p } }, 404);
};

async function grant(email, scopes) {
  await d1.prepare('INSERT OR REPLACE INTO hub_google (email, refresh_enc, scopes, connected_at) VALUES (?, ?, ?, ?)').bind(email, await google.seal(env, 'refresh-' + email), scopes, '2026-10-11T12:00:00.000Z').run();
}

async function call(user, method, path, body, extra = {}) {
  const init = { method, headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1', ...(extra.headers || {}) } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const [p, qs] = path.split('?');
  const res = await handle({
    request: new Request('https://dash.favorintl.org/api/mail/' + path, init),
    env,
    user,
    path: p.split('/').filter(Boolean).map(decodeURIComponent),
    fetcher: fakeGoogle,
    partners: async (emails) => (emails.includes('maya.okafor@example.org') ? { 'maya.okafor@example.org': { id: '27202', name: 'Maya Okafor' } } : {}),
    drive: async () => [{ name: 'Itinerary', url: 'https://docs.google.com/document/d/abc/edit' }],
    workOwners: async () => ({ owners: [{ fid: '7', name: 'Ada Admin' }], mine: '7' }),
  });
  void qs;
  const type = res.headers.get('Content-Type') || '';
  return { status: res.status, res, data: type.includes('json') ? await res.json() : null };
}

beforeEach(() => {
  d1 = memoryD1();
  d1.exec(read('db/google.sql'));
  d1.exec(read('db/admin-home.sql'));
  d1.exec(read('db/mail.sql'));
  d1.exec(`CREATE TABLE meet_directory (email TEXT PRIMARY KEY, name TEXT, title TEXT, team TEXT, active INTEGER)`);
  d1.exec(`INSERT INTO meet_directory VALUES ('bo@favorintl.org', 'Bo Builder', 'Partner Care', 'pc', 1), ('cy@favorintl.org', 'Cy Writer', 'Grants', 'grants', 1)`);
  env = { DB: d1, GOOGLE_TOKEN_KEY: 'ab'.repeat(32), GOOGLE_CLIENT_SECRET: 'x', GOOGLE_TOKEN_URL: 'https://oauth.test/token' };
  calls = [];
  tokenAsks = [];
  box = mailbox();
  forgetCount(ADMIN.email);
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://oauth.test/token') {
      tokenAsks.push(new URLSearchParams(init.body));
      return new Response(JSON.stringify({ access_token: 'at-' + tokenAsks.length, expires_in: 3600 }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
});

describe('who may use Mail', () => {
  it('turns away a signed-out request, a staff member while it is admins only, and the agent key', async () => {
    assert.equal((await call(null, 'GET', 'state')).status, 401);
    assert.equal((await call(STAFF, 'GET', 'state')).status, 403);
    assert.equal((await call({ ...ADMIN, via: 'agent' }, 'GET', 'state')).status, 403);
    assert.equal((await call(ADMIN, 'GET', 'state')).status, 200);
  });

  it('opens to staff, or closes for everyone, with the setting', async () => {
    await d1.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('mail.enabled', 'staff', 'test', 'now')").run();
    assert.equal((await call(STAFF, 'GET', 'state')).status, 200);
    await d1.prepare("UPDATE hub_settings SET value = 'off' WHERE key = 'mail.enabled'").run();
    assert.equal((await call(ADMIN, 'GET', 'state')).status, 403);
  });

  it('refuses a change posted from another site', async () => {
    await grant(ADMIN.email, MODIFY);
    const r = await call(ADMIN, 'POST', 'threads/t1aaaaaa/trash', {}, { headers: { Origin: 'https://evil.example', 'X-Hub-Request': '' } });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'cross_site');
    assert.equal(box.modified.length, 0);
  });
});

describe('what each Google grant allows', () => {
  it('says not connected with no grant, and asks to connect before listing', async () => {
    const s = await call(ADMIN, 'GET', 'state');
    assert.equal(s.data.connected, false);
    const l = await call(ADMIN, 'GET', 'threads');
    assert.equal(l.status, 403);
    assert.equal(l.data.error, 'mail_connect');
  });

  it('with headers only: lists the inbox, refuses search, shows a conversation without bodies, refuses files', async () => {
    await grant(ADMIN.email, 'openid ' + META);
    const s = await call(ADMIN, 'GET', 'state');
    assert.deepEqual(s.data.level, { read: false, write: false, contacts: false, headers: true });
    const l = await call(ADMIN, 'GET', 'threads?label=INBOX');
    assert.equal(l.status, 200);
    assert.equal(l.data.threads[0].subject, 'Visiting in March');
    const q = await call(ADMIN, 'GET', 'threads?q=from%3Amaya');
    assert.equal(q.status, 403);
    assert.equal(q.data.need, 'read');
    const t = await call(ADMIN, 'GET', 'threads/t1aaaaaa');
    assert.equal(t.data.headersOnly, true);
    assert.equal(t.data.thread.messages[0].html, '');
    assert.ok(calls.some((c) => c.path === '/threads/t1aaaaaa' && c.q.get('format') === 'metadata'));
    assert.ok(!calls.some((c) => c.path === '/threads/t1aaaaaa' && c.q.get('format') === 'full'));
    assert.equal((await call(ADMIN, 'GET', 'messages/m1aaaaaa/attachments/ATTpdf1aaaa?name=a.pdf&mime=application%2Fpdf')).status, 403);
  });

  it('asks Google for a token without the headers-only scope once reading is granted', async () => {
    await grant(ADMIN.email, `openid ${META} ${READ}`);
    await call(ADMIN, 'GET', 'threads');
    const asked = tokenAsks[0].get('scope').split(' ');
    assert.ok(asked.includes(READ));
    assert.ok(!asked.includes(META), 'Gmail treats a token that carries gmail.metadata as headers only');
  });

  it('refuses every change with a read grant, and never calls Gmail for it', async () => {
    await grant(ADMIN.email, READ);
    for (const [m, p, b] of [['POST', 'threads/t1aaaaaa/modify', { remove: ['INBOX'] }], ['POST', 'threads/t1aaaaaa/trash', {}], ['POST', 'threads/t1aaaaaa/snooze', { until: new Date(Date.now() + 864e5).toISOString() }], ['POST', 'send', { to: ['x@example.org'], subject: 's', html: 'h' }], ['PUT', 'drafts', { subject: 's' }], ['POST', 'labels', { name: 'New' }]]) {
      const r = await call(ADMIN, m, p, b);
      assert.equal(r.status, 403, p);
      assert.equal(r.data.error, 'mail_scope');
      assert.equal(r.data.need, 'write');
    }
    assert.equal(box.modified.length + box.sent.length + box.drafts.length, 0);
    assert.ok(!calls.some((c) => c.method !== 'GET'));
  });

  it('keeps Mail read only for everyone while mail.write is off', async () => {
    await grant(ADMIN.email, MODIFY);
    await d1.prepare("INSERT INTO hub_settings (key, value, updated_by, updated_at) VALUES ('mail.write', 'off', 'test', 'now')").run();
    const r = await call(ADMIN, 'POST', 'threads/t1aaaaaa/modify', { remove: ['INBOX'] });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'mail_readonly');
    assert.equal((await call(ADMIN, 'GET', 'state')).data.write, false);
    assert.equal(box.modified.length, 0);
  });
});

describe('reading', () => {
  beforeEach(() => grant(ADMIN.email, READ));

  it('lists a page of conversations with who wrote, unread, files and the count', async () => {
    const l = await call(ADMIN, 'GET', 'threads?label=INBOX');
    const t = l.data.threads[0];
    assert.equal(t.count, 2);
    assert.equal(t.unread, true);
    assert.equal(t.files, true);
    assert.deepEqual(t.people.map((p) => p.name), ['Okafor, Maya', 'me']);
    assert.equal(t.snippet, 'Yes, the second week is open.');
    const first = calls.find((c) => c.path === '/threads' && c.method === 'GET');
    assert.equal(first.q.get('labelIds'), 'INBOX');
  });

  it('passes a search to Gmail as typed', async () => {
    await call(ADMIN, 'GET', 'threads?q=' + encodeURIComponent('from:maya has:attachment'));
    assert.equal(calls.find((c) => c.path === '/threads').q.get('q'), 'from:maya has:attachment');
  });

  it('reads a thread once and answers the second look from memory until it changes', async () => {
    await call(ADMIN, 'GET', 'threads');
    const before = calls.filter((c) => c.path === '/threads/t1aaaaaa').length;
    await call(ADMIN, 'GET', 'threads');
    assert.equal(calls.filter((c) => c.path === '/threads/t1aaaaaa').length, before);
  });

  it('shows a conversation made safe: no script, no handlers, the inline picture from the file route, the partner matched', async () => {
    const t = (await call(ADMIN, 'GET', 'threads/t1aaaaaa')).data;
    const [m1, m2] = t.thread.messages;
    assert.ok(!/script|onclick|javascript:/i.test(m1.html));
    assert.match(m1.html, /src="\/api\/mail\/messages\/m1aaaaaa\/attachments\/ATTpic1aaaa\?/);
    assert.deepEqual(m1.from, { name: 'Okafor, Maya', email: 'maya.okafor@example.org' });
    assert.deepEqual(m1.to.map((x) => x.email), ['ada@favorintl.org', 'bo@favorintl.org']);
    assert.deepEqual(m1.attachments.map((f) => [f.name, f.inline]), [['well.png', true], ['itinerary.pdf', false]]);
    assert.match(m2.html, /blockquote class="gmail_quote"/);
    assert.deepEqual(t.partners, { 'maya.okafor@example.org': { id: '27202', name: 'Maya Okafor' } });
  });

  it('serves a file with its type, safe to open in the page, and as a download when asked', async () => {
    const r = await call(ADMIN, 'GET', 'messages/m1aaaaaa/attachments/ATTpdf1aaaa?name=itinerary.pdf&mime=application%2Fpdf');
    assert.equal(r.status, 200);
    assert.equal(r.res.headers.get('Content-Type'), 'application/pdf');
    assert.equal(r.res.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(Buffer.from(await r.res.arrayBuffer()).toString(), '%PDF');
    const h = await call(ADMIN, 'GET', 'messages/m1aaaaaa/attachments/ATTpdf1aaaa?name=x.html&mime=text%2Fhtml');
    assert.equal(h.res.headers.get('Content-Type'), 'application/octet-stream');
    assert.match(h.res.headers.get('Content-Disposition'), /^attachment/);
  });

  it('answers a thread Gmail no longer has with 404', async () => {
    assert.equal((await call(ADMIN, 'GET', 'threads/t0gone00')).status, 404);
  });

  it('lists mailboxes with unread counts and the person labels', async () => {
    const l = (await call(ADMIN, 'GET', 'labels')).data.labels;
    assert.equal(l.find((x) => x.id === 'INBOX').unread, 3);
    assert.deepEqual(l.filter((x) => x.type === 'user').map((x) => x.name), ['Trips']);
    assert.ok(l.some((x) => x.id === 'SNOOZED'));
  });

  it('gives the signature without its script', async () => {
    const s = (await call(ADMIN, 'GET', 'state')).data;
    assert.equal(s.signature, '<div>Ada</div>');
  });
});

describe('changing and sending', () => {
  beforeEach(() => grant(ADMIN.email, `${MODIFY} ${CONTACTS}`));

  it('archives, stars and marks unread with label changes on the thread', async () => {
    await call(ADMIN, 'POST', 'threads/t1aaaaaa/modify', { remove: ['INBOX'] });
    await call(ADMIN, 'POST', 'threads/t1aaaaaa/modify', { add: ['STARRED', 'UNREAD'] });
    assert.deepEqual(box.modified.map((m) => m.body), [{ addLabelIds: [], removeLabelIds: ['INBOX'] }, { addLabelIds: ['STARRED', 'UNREAD'], removeLabelIds: [] }]);
    assert.equal((await call(ADMIN, 'POST', 'threads/t1aaaaaa/modify', {})).status, 400);
  });

  it('moves to Trash and back, never a permanent delete', async () => {
    await call(ADMIN, 'POST', 'threads/t1aaaaaa/trash', {});
    await call(ADMIN, 'POST', 'threads/t1aaaaaa/untrash', {});
    assert.deepEqual(box.modified.map((m) => m.op), ['trash', 'untrash']);
    assert.ok(!calls.some((c) => c.method === 'DELETE'));
  });

  it('snoozes: out of the inbox now, back unread after the time, listed under Snoozed until then', async () => {
    const until = new Date(Date.now() + 3600e3).toISOString();
    const r = await call(ADMIN, 'POST', 'threads/t1aaaaaa/snooze', { until });
    assert.equal(r.status, 200);
    assert.deepEqual(box.modified[0].body, { addLabelIds: [], removeLabelIds: ['INBOX'] });
    assert.equal((await call(ADMIN, 'POST', 'threads/t1aaaaaa/snooze', { until: '2020-01-01T00:00:00Z' })).status, 400);
    const sn = (await call(ADMIN, 'GET', 'threads?label=SNOOZED')).data.threads;
    assert.equal(sn[0].snoozed, until);
    const gm = gmail('t', fakeGoogle);
    assert.equal(await wakeDue(env, gm, ADMIN.email), 0);
    await d1.prepare('UPDATE hub_mail_snooze SET until = ?').bind('2020-01-01T00:00:00.000Z').run();
    assert.equal(await wakeDue(env, gm, ADMIN.email), 1);
    assert.deepEqual(box.modified.at(-1).body, { addLabelIds: ['INBOX', 'UNREAD'], removeLabelIds: [] });
    assert.equal(await wakeDue(env, gm, ADMIN.email), 0, 'a woken thread is not woken twice');
    const row = await d1.prepare('SELECT * FROM hub_mail_snooze').first();
    assert.deepEqual(Object.keys(row).sort(), ['created_at', 'email', 'thread_id', 'until', 'woke_at'], 'thread ids only, no mail content');
  });

  it('sends a reply in its thread with the headers that keep it there', async () => {
    const r = await call(ADMIN, 'POST', 'send', { to: [{ name: 'Maya Okafor', email: 'maya.okafor@example.org' }], cc: ['bo@favorintl.org'], subject: 'Re: Visiting in March', html: '<p>See you then.</p><script>x()</script>', threadId: 't1aaaaaa', replyTo: 'm1aaaaaa', draftId: 'r-100200' });
    assert.equal(r.status, 200);
    const sent = box.sent[0];
    assert.equal(sent.threadId, 't1aaaaaa');
    const mime = unb64u(sent.raw);
    assert.match(mime, /^From: "Ada Admin" <ada@favorintl\.org>\r\n/);
    assert.match(mime, /\r\nTo: "Maya Okafor" <maya\.okafor@example\.org>\r\n/);
    assert.match(mime, /\r\nCc: bo@favorintl\.org\r\n/);
    assert.match(mime, /\r\nIn-Reply-To: <one@example\.org>\r\n/);
    assert.match(mime, /\r\nReferences: <one@example\.org>\r\n/);
    const html = Buffer.from(mime.split('Content-Type: text/html')[1].split('\r\n\r\n')[1].split('\r\n--')[0], 'base64').toString();
    assert.equal(html, '<p>See you then.</p>');
    assert.ok(box.drafts.some((d) => d.id === 'r-100200' && d.deleted), 'the draft it came from is removed');
  });

  it('refuses to send to nobody or to a bad address, and Gmail is not called', async () => {
    assert.equal((await call(ADMIN, 'POST', 'send', { to: [], subject: 's', html: 'h' })).data.error, 'no_one');
    assert.equal((await call(ADMIN, 'POST', 'send', { to: ['not an address'], subject: 's', html: 'h' })).data.error, 'bad_address');
    assert.equal(box.sent.length, 0);
  });

  it('attaches uploaded files and files forwarded from another message', async () => {
    await call(ADMIN, 'POST', 'send', { to: ['cy@favorintl.org'], subject: 'Fwd: Visiting in March', html: '<p>FYI</p>', files: [{ name: 'notes.txt', mime: 'text/plain', data: Buffer.from('hello').toString('base64') }], forward: [{ messageId: 'm1aaaaaa', attachmentId: 'ATTpdf1aaaa', name: 'itinerary.pdf', mime: 'application/pdf' }] });
    const mime = unb64u(box.sent[0].raw);
    assert.match(mime, /Content-Type: multipart\/mixed/);
    assert.match(mime, /filename="notes\.txt"/);
    assert.match(mime, /filename="itinerary\.pdf"/);
    assert.ok(mime.includes(Buffer.from('%PDF').toString('base64')));
  });

  it('saves a draft, then updates the same draft, then discards it', async () => {
    const a = await call(ADMIN, 'PUT', 'drafts', { to: ['cy@favorintl.org'], subject: 'Half written', html: '<p>Hi</p>' });
    assert.equal(a.data.draftId, 'r-100200');
    await call(ADMIN, 'PUT', 'drafts', { draftId: 'r-100200', to: ['cy@favorintl.org'], subject: 'Half written', html: '<p>Hi Cy</p>' });
    assert.ok(box.drafts[1].updated);
    await call(ADMIN, 'DELETE', 'drafts/r-100200');
    assert.ok(box.drafts[2].deleted);
    assert.equal(box.sent.length, 0);
  });

  it('makes a label', async () => {
    const r = await call(ADMIN, 'POST', 'labels', { name: 'Follow up' });
    assert.equal(r.data.label.name, 'Follow up');
    assert.equal((await call(ADMIN, 'POST', 'labels', { name: ' ' })).status, 400);
  });

  it('offers staff first, then the person own Google contacts', async () => {
    const r = (await call(ADMIN, 'GET', 'contacts?q=wh')).data;
    void r;
    const b = (await call(ADMIN, 'GET', 'contacts?q=bo')).data.people;
    assert.equal(b[0].email, 'bo@favorintl.org');
    assert.equal(b[0].kind, 'staff');
    const t = (await call(ADMIN, 'GET', 'contacts?q=tom')).data.people;
    assert.deepEqual(t.map((x) => [x.email, x.kind]), [['tom@whitfield.example', 'contact']]);
  });

  it('answers the Drive picker and the action owners through their stand-ins', async () => {
    assert.equal((await call(ADMIN, 'GET', 'drive?q=itin')).data.files[0].name, 'Itinerary');
    assert.equal((await call(ADMIN, 'GET', 'log-owners')).data.mine, '7');
  });
});

describe('the rail badge', () => {
  it('counts unread inbox conversations, with a headers-only grant too, and 0 with no grant', async () => {
    assert.equal(await mailUnreadCount(env, ADMIN.email, fakeGoogle), 0);
    await grant(ADMIN.email, META);
    forgetCount(ADMIN.email);
    assert.equal(await mailUnreadCount(env, ADMIN.email, fakeGoogle), 3);
  });
});

describe('asking Google for the mail scopes', () => {
  const asUser = (url) => new Request('https://dash.test' + url, { headers: { 'X-Hub-Email': ADMIN.email, 'X-Hub-Name': 'Ada', 'X-Hub-Via': 'google' } });
  const start = async (qs) => new URL((await connect.onRequestGet({ request: asUser('/api/google/connect' + qs), env })).headers.get('Location')).searchParams;

  it('the first sign-in connection still asks for no mail reading or changing', async () => {
    const scopes = (await start('?next=%2F')).get('scope').split(' ');
    assert.ok(!scopes.includes(READ) && !scopes.includes(MODIFY));
  });

  it('opening Mail asks for reading only; the first change asks for changing and contacts', async () => {
    await grant(ADMIN.email, META);
    assert.deepEqual((await start('?add=mail&next=%2Fmail%2F')).get('scope').split(' ').sort(), ['email', READ, 'openid'].sort());
    const w = (await start('?add=mailsend&next=%2Fmail%2F')).get('scope').split(' ');
    assert.ok(w.includes(MODIFY) && w.includes(CONTACTS) && !w.includes(READ));
    assert.equal((await start('?add=mail&next=%2Fmail%2F')).get('include_granted_scopes'), 'true');
  });

  it('a person with no Google connection gets the calendar and Drive scopes with it, without the headers scope', async () => {
    const scopes = (await start('?add=mail&next=%2Fmail%2F')).get('scope').split(' ');
    assert.ok(scopes.includes('https://www.googleapis.com/auth/calendar.events.readonly'));
    assert.ok(scopes.includes(READ) && !scopes.includes(META));
  });

  it('a refusal at Google goes back to Mail, which stays as it was', async () => {
    const state = 'abc|%2Fmail%2F|mailsend';
    const res = await callback.onRequestGet({ request: new Request('https://dash.test/api/google/callback?error=access_denied&state=' + encodeURIComponent(state), { headers: { 'X-Hub-Email': ADMIN.email, 'X-Hub-Via': 'google', Cookie: 'hub_gstate=' + encodeURIComponent(state) } }), env });
    assert.equal(res.headers.get('Location'), '/mail/?google=mailsend-declined');
  });

  it('stores the wider grant and says so on the way back', async () => {
    const state = 'abc|%2Fmail%2F|mail';
    globalThis.fetch = async () => new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r2', scope: `openid ${META} ${READ}`, id_token: `x.${Buffer.from(JSON.stringify({ email: ADMIN.email })).toString('base64url')}.y` }), { status: 200 });
    const res = await callback.onRequestGet({ request: new Request('https://dash.test/api/google/callback?code=c&state=' + encodeURIComponent(state), { headers: { 'X-Hub-Email': ADMIN.email, 'X-Hub-Via': 'google', Cookie: 'hub_gstate=' + encodeURIComponent(state) } }), env });
    assert.equal(res.headers.get('Location'), '/mail/?google=mail');
    const row = await d1.prepare('SELECT scopes FROM hub_google WHERE email = ?').bind(ADMIN.email).first();
    assert.ok(google.mailLevel(row.scopes).read);
  });
});
