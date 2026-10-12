// Run with: npm test
//
// Web push: the message encryption (checked by decrypting it the way a browser does), the VAPID signature, the subscription routes,
// and what a chat message sends to whom. The push service is a stand-in; nobody real is notified.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PUSH, addUser, call, cookieFor, world } from './support/field-world.mjs';

const enc = new TextEncoder();
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const cat = (...p) => Buffer.concat(p.map((x) => Buffer.from(x)));

async function browserKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, pub, auth, p256dh: b64u(pub), authB64: b64u(auth) };
}

async function hkdf(salt, ikm, info, n) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, n * 8));
}

/** RFC 8291 from the receiving side. */
async function decrypt(keys, body) {
  const b = new Uint8Array(body);
  const salt = b.slice(0, 16);
  const rs = new DataView(b.buffer, b.byteOffset + 16, 4).getUint32(0);
  const idlen = b[20];
  const asPub = b.slice(21, 21 + idlen);
  const cipher = b.slice(21 + idlen);
  assert.equal(rs, 4096);
  assert.equal(idlen, 65);
  const as = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: as }, keys.pair.privateKey, 256));
  const ikm = await hkdf(keys.auth, shared, cat(enc.encode('WebPush: info\0'), keys.pub, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, cipher));
  assert.equal(plain[plain.length - 1], 2, 'last record ends with the 0x02 delimiter');
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

async function subscribe(w, email, name = 'a') {
  const keys = await browserKeys();
  const cookie = await cookieFor(w, email);
  const sub = { endpoint: `${PUSH}/send/${name}-${email}`, keys: { p256dh: keys.p256dh, auth: keys.authB64 } };
  const out = await call(w, 'POST', '/api/push/subscribe', { cookie, body: sub });
  assert.equal(out.status, 200, JSON.stringify(out.data));
  return { keys, sub, cookie };
}

describe('encryption and signing', () => {
  it('a payload decrypts in the browser to exactly what was sent', async () => {
    const { encryptPayload } = await import('../functions/_lib/push.ts');
    const keys = await browserKeys();
    const msg = { title: 'Ann', body: 'Emoji \u{1F600} and accents éè', url: '/chat/?c=dm_1' };
    const body = await encryptPayload(keys.p256dh, keys.authB64, enc.encode(JSON.stringify(msg)));
    assert.deepEqual(await decrypt(keys, body), msg);
  });

  it('two sends of the same text differ, and another browser cannot read them', async () => {
    const { encryptPayload } = await import('../functions/_lib/push.ts');
    const a = await browserKeys();
    const other = await browserKeys();
    const one = await encryptPayload(a.p256dh, a.authB64, enc.encode('hello'));
    const two = await encryptPayload(a.p256dh, a.authB64, enc.encode('hello'));
    assert.notDeepEqual(Buffer.from(one), Buffer.from(two));
    await assert.rejects(() => decrypt(other, one));
  });

  it('refuses a payload too large for one push record', async () => {
    const { encryptPayload } = await import('../functions/_lib/push.ts');
    const k = await browserKeys();
    await assert.rejects(() => encryptPayload(k.p256dh, k.authB64, new Uint8Array(4000)), /too large/);
  });

  it('signs the request with a VAPID token that verifies against the public key, for the push service origin only', async () => {
    const w = await world();
    const { vapidPublicKey } = await import('../functions/_lib/push.ts');
    const { sub } = await subscribe(w, 'will@favorintl.org');
    const { pushToPeople } = await import('../functions/_lib/push.ts');
    assert.equal(await pushToPeople(w.env, ['will@favorintl.org'], { title: 'T', body: 'B', url: '/chat/' }), 1);
    const call1 = w.pushCalls[0];
    assert.equal(call1.url, sub.endpoint);
    const auth = call1.headers.authorization;
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(auth);
    assert.ok(m, auth);
    assert.equal(m[4], vapidPublicKey(w.env));
    const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
    assert.equal(claims.aud, PUSH);
    assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 13 * 3600);
    assert.match(claims.sub, /^mailto:/);
    const pub = unb64u(m[4]);
    const key = await crypto.subtle.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64u(m[3]), enc.encode(`${m[1]}.${m[2]}`)));
    assert.equal(call1.headers['content-encoding'], 'aes128gcm');
    assert.equal(call1.headers.ttl, '86400');
  });
});

describe('subscription routes', () => {
  it('the key route answers a signed-in person and says not set up when there is no key', async () => {
    const w = await world();
    const cookie = await cookieFor(w, 'will@favorintl.org');
    const ok = await call(w, 'GET', '/api/push/key', { cookie });
    assert.equal(ok.status, 200);
    assert.equal(unb64u(ok.data.key).length, 65);
    assert.equal((await call(w, 'GET', '/api/push/key')).status, 401);
    const bare = await world({ vapid: false });
    assert.equal((await call(bare, 'GET', '/api/push/key', { cookie: await cookieFor(bare, 'will@favorintl.org') })).status, 503);
  });

  it('subscribes, replaces on a repeat, moves to the new person on a shared phone, and unsubscribes only your own', async () => {
    const w = await world();
    addUser(w, { email: 'ann@favorintl.org' });
    const a = await subscribe(w, 'will@favorintl.org', 'shared');
    await call(w, 'POST', '/api/push/subscribe', { cookie: a.cookie, body: a.sub });
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n, 1);
    const annCookie = await cookieFor(w, 'ann@favorintl.org');
    await call(w, 'POST', '/api/push/subscribe', { cookie: annCookie, body: a.sub });
    assert.equal(w.db.prepare('SELECT email FROM push_subs').get().email, 'ann@favorintl.org');
    await call(w, 'POST', '/api/push/unsubscribe', { cookie: a.cookie, body: { endpoint: a.sub.endpoint } });
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n, 1, 'Will cannot remove Ann’s subscription');
    await call(w, 'POST', '/api/push/unsubscribe', { cookie: annCookie, body: { endpoint: a.sub.endpoint } });
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n, 0);
  });

  it('refuses a plain http address, a private address, a long one and bad keys', async () => {
    const w = await world();
    const cookie = await cookieFor(w, 'will@favorintl.org');
    const k = await browserKeys();
    const good = { p256dh: k.p256dh, auth: k.authB64 };
    for (const endpoint of ['http://push.test/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://192.168.1.5/x', 'https://169.254.169.254/x', 'not a url', 'https://push.test/' + 'a'.repeat(1300)]) {
      assert.equal((await call(w, 'POST', '/api/push/subscribe', { cookie, body: { endpoint, keys: good } })).status, 400, endpoint.slice(0, 40));
    }
    assert.equal((await call(w, 'POST', '/api/push/subscribe', { cookie, body: { endpoint: PUSH + '/x', keys: { p256dh: 'AAAA', auth: k.authB64 } } })).status, 400);
    assert.equal((await call(w, 'POST', '/api/push/subscribe', { cookie, body: { endpoint: PUSH + '/x', keys: { p256dh: k.p256dh, auth: 'AAAA' } } })).status, 400);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n, 0);
  });

  it('signed-out requests are refused', async () => {
    const w = await world();
    for (const [m, p] of [['POST', '/api/push/subscribe'], ['POST', '/api/push/unsubscribe'], ['POST', '/api/push/test'], ['GET', '/api/push/key']]) assert.equal((await call(w, m, p, m === 'POST' ? { body: {} } : {})).status, 401, p);
  });

  it('the test button sends one notice to the caller and to nobody else', async () => {
    const w = await world();
    addUser(w, { email: 'ann@favorintl.org' });
    const me = await subscribe(w, 'will@favorintl.org');
    await subscribe(w, 'ann@favorintl.org');
    const out = await call(w, 'POST', '/api/push/test', { cookie: me.cookie });
    assert.equal(out.data.sent, 1);
    assert.equal(w.pushCalls.length, 1);
    assert.ok(w.pushCalls[0].url.includes('will@favorintl.org'));
  });

  it('a gone subscription (410) is deleted, a failing one is counted and dropped after eight failures', async () => {
    const w = await world();
    const { pushToPeople } = await import('../functions/_lib/push.ts');
    await subscribe(w, 'will@favorintl.org');
    w.pushStatus = 410;
    assert.equal(await pushToPeople(w.env, ['will@favorintl.org'], { title: 'T', body: 'B', url: '/' }), 0);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n, 0);
    await subscribe(w, 'will@favorintl.org');
    w.pushStatus = 503;
    for (let i = 0; i < 7; i++) await pushToPeople(w.env, ['will@favorintl.org'], { title: 'T', body: 'B', url: '/' });
    assert.equal(w.db.prepare('SELECT fails FROM push_subs').get().fails, 7);
    await pushToPeople(w.env, ['will@favorintl.org'], { title: 'T', body: 'B', url: '/' });
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n, 0);
  });

  it('sends nothing, and fails nothing, when no key is set up', async () => {
    const w = await world({ vapid: false });
    const { pushToPeople } = await import('../functions/_lib/push.ts');
    assert.equal(await pushToPeople(w.env, ['will@favorintl.org'], { title: 'T', body: 'B', url: '/' }), 0);
  });
});

describe('what a chat message pushes', () => {
  async function setup() {
    const w = await world();
    addUser(w, { email: 'ann@favorintl.org', name: 'Ann Staff' });
    addUser(w, { email: 'bea@favorintl.org', name: 'Bea Staff' });
    addUser(w, { email: 'kofi@favourafrica.org', name: 'Kofi Test', role: 'field', kpi: 0 });
    const ann = await cookieFor(w, 'ann@favorintl.org');
    const kofi = await subscribe(w, 'kofi@favourafrica.org');
    const bea = await subscribe(w, 'bea@favorintl.org');
    const dm = (await call(w, 'POST', '/api/chat/conversations', { cookie: ann, body: { members: ['kofi@favourafrica.org'] } })).data.channel;
    return { w, ann, kofi, bea, dm };
  }

  it('a direct message is pushed to the other person, with the sender and the text, and opens that conversation', async () => {
    const { w, ann, kofi, dm } = await setup();
    const sent = await call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: ann, body: { body: 'Can you join at ten?' } });
    assert.equal(sent.status, 200);
    assert.equal(w.pushCalls.length, 1);
    const note = await decrypt(kofi.keys, w.pushCalls[0].body);
    assert.equal(note.title, 'Ann Staff');
    assert.equal(note.body, 'Can you join at ten?');
    assert.ok(note.url.startsWith(`/chat/?c=${dm.id}`));
    assert.equal(w.pushCalls[0].url, kofi.sub.endpoint);
  });

  it('the sender is not pushed their own message', async () => {
    const { w, kofi, dm } = await setup();
    await subscribe(w, 'ann@favorintl.org');
    await call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: kofi.cookie, body: { body: 'On my way' } });
    assert.equal(w.pushCalls.length, 1);
    assert.ok(w.pushCalls[0].url.includes('ann@favorintl.org'));
  });

  it('a mention in a channel is pushed to the person named and to nobody else', async () => {
    const { w, ann } = await setup();
    const ch = (await call(w, 'POST', '/api/chat/channels', { cookie: ann, body: { name: 'planning' } })).data.channel;
    await call(w, 'POST', `/api/chat/channels/${ch.id}/members`, { cookie: ann, body: { emails: ['bea@favorintl.org'] } });
    w.pushCalls.length = 0;
    await call(w, 'POST', `/api/chat/channels/${ch.id}/messages`, { cookie: ann, body: { body: 'Review this <@bea@favorintl.org> please' } });
    assert.equal(w.pushCalls.length, 1);
    assert.ok(w.pushCalls[0].url.includes('bea@favorintl.org'));
  });

  it('an ordinary channel message pushes nothing', async () => {
    const { w, ann } = await setup();
    const ch = (await call(w, 'POST', '/api/chat/channels', { cookie: ann, body: { name: 'plain' } })).data.channel;
    await call(w, 'POST', `/api/chat/channels/${ch.id}/members`, { cookie: ann, body: { emails: ['bea@favorintl.org'] } });
    w.pushCalls.length = 0;
    await call(w, 'POST', `/api/chat/channels/${ch.id}/messages`, { cookie: ann, body: { body: 'Lunch is at noon' } });
    assert.equal(w.pushCalls.length, 0);
  });

  it('a muted conversation pushes nothing', async () => {
    const { w, ann, kofi, dm } = await setup();
    await call(w, 'POST', `/api/chat/channels/${dm.id}/mute`, { cookie: kofi.cookie, body: { muted: true } });
    await call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: ann, body: { body: 'Quiet one' } });
    assert.equal(w.pushCalls.length, 0);
  });

  it('a dead push service never fails the message', async () => {
    const { w, ann, dm } = await setup();
    w.pushStatus = () => { throw new Error('network down'); };
    const sent = await call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: ann, body: { body: 'Still sends' } });
    assert.equal(sent.status, 200);
    assert.equal(sent.data.message.body, 'Still sends');
  });

  it('a long message is cut to a short preview', async () => {
    const { w, ann, kofi, dm } = await setup();
    await call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: ann, body: { body: 'word '.repeat(200) } });
    const note = await decrypt(kofi.keys, w.pushCalls[0].body);
    assert.ok(note.body.length <= 140);
  });
});

describe('a message sent twice from an offline queue lands once', () => {
  it('the same X-Client-Id returns the stored message and posts nothing new, and a different id posts', async () => {
    const w = await world();
    addUser(w, { email: 'ann@favorintl.org' });
    addUser(w, { email: 'kofi@favourafrica.org', role: 'field', kpi: 0 });
    const ann = await cookieFor(w, 'ann@favorintl.org');
    const dm = (await call(w, 'POST', '/api/chat/conversations', { cookie: ann, body: { members: ['kofi@favourafrica.org'] } })).data.channel;
    const send = (id, body) => call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: ann, body: { body }, headers: id ? { 'X-Client-Id': id } : {} });
    const a = await send('c0ffee00c0ffee00', 'first');
    const b = await send('c0ffee00c0ffee00', 'first');
    assert.equal(a.data.message.id, b.data.message.id);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE channel_id = ?').get(dm.id).n, 1);
    const c = await send('deadbeefdeadbeef', 'second');
    assert.notEqual(c.data.message.id, a.data.message.id);
    // No client id (the desktop page) posts every time, as before.
    await send('', 'third');
    await send('', 'third');
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE channel_id = ?').get(dm.id).n, 4);
    // A malformed id is ignored, not trusted.
    await send('x', 'fourth');
    await send('x', 'fourth');
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE channel_id = ?').get(dm.id).n, 6);
  });

  it('a client id belongs to its sender: another person with the same id still posts their own message', async () => {
    const w = await world();
    addUser(w, { email: 'ann@favorintl.org' });
    addUser(w, { email: 'kofi@favourafrica.org', role: 'field', kpi: 0 });
    const ann = await cookieFor(w, 'ann@favorintl.org');
    const kofi = await cookieFor(w, 'kofi@favourafrica.org');
    const dm = (await call(w, 'POST', '/api/chat/conversations', { cookie: ann, body: { members: ['kofi@favourafrica.org'] } })).data.channel;
    const id = { 'X-Client-Id': 'abcdefabcdefabcd' };
    const a = await call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: ann, body: { body: 'from Ann' }, headers: id });
    const k = await call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: kofi, body: { body: 'from Kofi' }, headers: id });
    assert.equal(k.data.message.body, 'from Kofi');
    assert.notEqual(a.data.message.id, k.data.message.id);
  });
});

describe('two sends of one client id at the same moment', () => {
  it('post one message and both answers are that message', async () => {
    const w = await world();
    addUser(w, { email: 'ann@favorintl.org' });
    addUser(w, { email: 'kofi@favourafrica.org', role: 'field', kpi: 0 });
    const kofi = await cookieFor(w, 'kofi@favourafrica.org');
    const ann = await cookieFor(w, 'ann@favorintl.org');
    const dm = (await call(w, 'POST', '/api/chat/conversations', { cookie: ann, body: { members: ['kofi@favourafrica.org'] } })).data.channel;
    const send = () => call(w, 'POST', `/api/chat/channels/${dm.id}/messages`, { cookie: kofi, body: { body: 'raced' }, headers: { 'X-Client-Id': 'racecafe00racecafe' } });
    const [a, b, c] = await Promise.all([send(), send(), send()]);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE channel_id = ?').get(dm.id).n, 1);
    assert.equal(a.data.message.id, b.data.message.id);
    assert.equal(b.data.message.id, c.data.message.id);
  });

  it('a send that fails releases its claim so the retry can post', async () => {
    const w = await world();
    addUser(w, { email: 'kofi@favourafrica.org', role: 'field', kpi: 0 });
    const kofi = await cookieFor(w, 'kofi@favourafrica.org');
    const bad = await call(w, 'POST', '/api/chat/channels/ch_nowhere/messages', { cookie: kofi, body: { body: 'x' }, headers: { 'X-Client-Id': 'failfailfailfail' } });
    assert.ok(bad.status >= 400);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM phone_sends').get().n, 0);
  });
});
