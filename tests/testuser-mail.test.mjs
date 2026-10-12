// The test users' sample mailbox: Mail's real routes answer from stored sample mail, nothing reaches Gmail, a change survives the
// next request, and each tester has a mailbox of their own. Invented mail only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { handle } = await import('../functions/_lib/mail/route.ts');
const { TESTER_EMAIL, TESTER2_EMAIL } = await import('../functions/_lib/testuser.ts');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const T1 = { email: TESTER_EMAIL, name: 'FavorOS Tester', picture: '', role: 'admin', via: 'google', kpi: true };
const T2 = { email: TESTER2_EMAIL, name: 'FavorOS Tester Two', picture: '', role: 'admin', via: 'google', kpi: true };
let env;
let gmailCalls;

async function call(user, method, path, body) {
  const init = { method, headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const res = await handle({ request: new Request('https://dash.favorintl.org/api/mail/' + path, init), env, user, path: path.split('?')[0].split('/').filter(Boolean), partners: async () => ({}) });
  return { status: res.status, data: (res.headers.get('Content-Type') || '').includes('json') ? await res.json() : null };
}

beforeEach(() => {
  const d1 = memoryD1();
  for (const f of ['db/google.sql', 'db/admin-home.sql', 'db/mail.sql', 'db/mail-cache.sql']) d1.exec(read(f));
  env = { DB: d1 };
  gmailCalls = 0;
  globalThis.fetch = async () => { gmailCalls++; return new Response('{}', { status: 404 }); };
});

describe('sample mailbox for the test users', () => {
  it('lists the inbox and opens a conversation without touching Gmail', async () => {
    const l = await call(T1, 'GET', 'threads?label=INBOX');
    assert.equal(l.status, 200);
    assert.ok(l.data.threads.length >= 10);
    assert.ok(l.data.threads.some((t) => t.subject === 'Visiting in March'));
    const id = l.data.threads.find((t) => t.subject === 'Visiting in March').id;
    const t = await call(T1, 'GET', 'threads/' + id);
    assert.equal(t.status, 200);
    assert.equal(t.data.thread.messages.length, 3);
    assert.equal(gmailCalls, 0);
  });

  it('searches, counts unread and keeps a change for the next request', async () => {
    const s = await call(T1, 'GET', 'threads?q=' + encodeURIComponent('from:maya'));
    assert.equal(s.data.threads.length, 3);
    assert.ok(s.data.threads.every((t) => /maya/i.test(t.from.name + t.from.email)));
    const before = (await call(T1, 'GET', 'labels')).data.labels.find((x) => x.id === 'INBOX').unread;
    assert.ok(before >= 3);
    const id = (await call(T1, 'GET', 'threads?label=INBOX')).data.threads.find((t) => t.subject === 'Thank you for the update letter').id;
    assert.equal((await call(T1, 'POST', `threads/${id}/modify`, { remove: ['UNREAD'] })).status, 200);
    assert.equal((await call(T1, 'GET', 'labels')).data.labels.find((x) => x.id === 'INBOX').unread, before - 1);
    assert.equal((await call(T1, 'POST', `threads/${id}/modify`, { remove: ['INBOX'] })).status, 200);
    assert.ok(!(await call(T1, 'GET', 'threads?label=INBOX')).data.threads.some((t) => t.id === id));
  });

  it('sends into the sample Sent folder and gives each tester a mailbox of their own', async () => {
    const sent = await call(T1, 'POST', 'send', { to: ['someone@example.org'], subject: 'Sample hello', html: '<p>Hello</p>' });
    assert.equal(sent.status, 200);
    assert.ok((await call(T1, 'GET', 'threads?label=SENT')).data.threads.some((t) => t.subject === 'Sample hello'));
    assert.ok(!(await call(T2, 'GET', 'threads?label=SENT')).data.threads.some((t) => t.subject === 'Sample hello'));
    assert.equal(gmailCalls, 0);
  });
});
