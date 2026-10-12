// Run with: npm test
//
// The phone app's client logic (public/js/phone-core.js): Data saver, picture sizing, the voice format choice and the offline send queue,
// plus a read of the service worker for what it must never keep. The queue runs here against a memory store and a scripted server.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { describe, it } from 'node:test';

// The file is a plain browser script (the package is ESM, so require would treat it as a module): run it the way a page does, with a stand-in window.
const sandbox = { module: { exports: {} }, crypto: webcrypto, console, Uint8Array, Promise, Date, JSON, Array, Math, Error, String };
sandbox.self = sandbox;
vm.runInNewContext(readFileSync(new URL('../public/js/phone-core.js', import.meta.url), 'utf8'), sandbox);
const P = sandbox.module.exports;
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

const memory = () => {
  const m = new Map();
  return { put: async (i) => { m.set(i.id, JSON.parse(JSON.stringify({ ...i, files: undefined })) && { ...i }); }, remove: async (id) => { m.delete(id); }, all: async () => [...m.values()].sort((a, b) => a.created - b.created), m };
};
const store = (map) => ({ getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) });
const netErr = () => Object.assign(new TypeError('Failed to fetch'), {});
const http = (status, message = 'no') => Object.assign(new Error(message), { status });

function server() {
  const s = { online: true, refuse: new Set(), posted: [], uploads: 0, seen: new Map(), log: [] };
  s.transport = {
    upload: async (blob, name, type) => {
      if (!s.online) throw netErr();
      s.uploads += 1;
      return { type: 'file', id: 'f' + s.uploads, name, mime: type, size: 3, url: '/f/' + s.uploads };
    },
    send: async (channel, payload, clientId) => {
      if (!s.online) throw netErr();
      s.log.push(clientId);
      if (s.refuse.has(payload.body)) throw http(403, 'You are not in that conversation.');
      if (s.seen.has(clientId)) return s.seen.get(clientId);
      const msg = { id: s.posted.length + 1, channel_id: channel, body: payload.body, attachments: payload.attachments };
      s.posted.push(msg);
      s.seen.set(clientId, msg);
      return msg;
    },
  };
  return s;
}

describe('Data saver', () => {
  it('follows the phone when set to automatic, and the person when set to on or off', () => {
    const slow = { effectiveType: '3g' }, fast = { effectiveType: '4g' }, saver = { saveData: true, effectiveType: '4g' };
    const map = new Map();
    const st = store(map);
    assert.equal(P.lowDataSetting(st), 'auto');
    assert.equal(P.isLowData(st, fast), false);
    assert.equal(P.isLowData(st, slow), true);
    assert.equal(P.isLowData(st, saver), true);
    assert.equal(P.isLowData(st, null), false);
    P.setLowData('on', st);
    assert.equal(P.isLowData(st, fast), true);
    P.setLowData('off', st);
    assert.equal(P.isLowData(st, slow), false);
    P.setLowData('garbage', st);
    assert.equal(P.lowDataSetting(st), 'auto');
  });

  it('counts 2g, slow-2g and 3g as slow and nothing else', () => {
    for (const t of ['slow-2g', '2g', '3g']) assert.equal(P.connectionIsSlow({ effectiveType: t }), true, t);
    for (const t of ['4g', '5g', '', undefined]) assert.equal(P.connectionIsSlow({ effectiveType: t }), false, String(t));
  });
});

describe('pictures', () => {
  it('fits the long side to the limit, never enlarges, keeps the shape', () => {
    same(P.fitSize(4000, 3000, 1920), { w: 1920, h: 1440 });
    same(P.fitSize(3000, 4000, 1024), { w: 768, h: 1024 });
    same(P.fitSize(800, 600, 1920), { w: 800, h: 600 });
    same(P.fitSize(10000, 1, 1024), { w: 1024, h: 1 });
    same(P.fitSize(0, 5, 1024), { w: 0, h: 0 });
  });

  it('shrinks big photos always and any photo in Data saver, and leaves GIF, SVG, audio and PDF alone', () => {
    const f = (type, size) => ({ type, size });
    assert.equal(P.shouldCompress(f('image/jpeg', 2_000_000), false), true);
    assert.equal(P.shouldCompress(f('image/jpeg', 100_000), false), false);
    assert.equal(P.shouldCompress(f('image/jpeg', 100_000), true), true);
    assert.equal(P.shouldCompress(f('image/heic', 5_000_000), false), true);
    for (const t of ['image/gif', 'image/svg+xml', 'audio/webm', 'application/pdf', '']) assert.equal(P.shouldCompress(f(t, 9_000_000), true), false, t);
    assert.equal(P.shouldCompress(null, true), false);
  });

  it('Data saver draws smaller and at lower quality than normal', () => {
    assert.ok(P.PICTURE.low.max < P.PICTURE.normal.max);
    assert.ok(P.PICTURE.low.quality < P.PICTURE.normal.quality);
  });

  it('keeps the original when there is no page to draw on', async () => {
    const file = { type: 'image/jpeg', size: 2_000_000, name: 'a.jpg' };
    assert.equal(await P.compress(file, false), file);
  });
});

describe('voice notes', () => {
  it('picks the smallest format the browser records: Opus in WebM, else MP4 (Safari), else plain WebM', () => {
    const mr = (ok) => ({ isTypeSupported: (t) => ok.includes(t) });
    assert.equal(P.voiceMime(mr(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'])), 'audio/webm;codecs=opus');
    assert.equal(P.voiceMime(mr(['audio/mp4'])), 'audio/mp4');
    assert.equal(P.voiceMime(mr(['audio/webm'])), 'audio/webm');
    assert.equal(P.voiceMime(mr([])), '');
    assert.equal(P.voiceMime(null), '');
  });

  it('refuses politely where nothing can record', async () => {
    await assert.rejects(() => P.startVoice(false), /cannot record/);
  });
});

describe('the offline send queue', () => {
  it('sends at once when online and leaves nothing behind', async () => {
    const s = server(), st = memory();
    const box = P.createOutbox(st, s.transport);
    await box.queue({ channel: 'dm_1', body: 'hello' });
    assert.equal(s.posted.length, 1);
    assert.equal((await box.list()).length, 0);
  });

  it('keeps messages written offline in order and sends them oldest first when the connection returns', async () => {
    const s = server(), st = memory();
    const box = P.createOutbox(st, s.transport);
    s.online = false;
    await box.queue({ channel: 'dm_1', body: 'one' });
    await new Promise((r) => setTimeout(r, 2));
    await box.queue({ channel: 'dm_1', body: 'two' });
    await new Promise((r) => setTimeout(r, 2));
    await box.queue({ channel: 'dm_2', body: 'three' });
    assert.equal(s.posted.length, 0);
    assert.equal((await box.list()).length, 3);
    s.online = true;
    const out = await box.flush();
    assert.deepEqual(s.posted.map((m) => m.body), ['one', 'two', 'three']);
    assert.equal(out.sent.length, 3);
    assert.equal((await box.list()).length, 0);
  });

  it('stops at the first connection failure so a conversation keeps its order', async () => {
    const s = server(), st = memory();
    const box = P.createOutbox(st, s.transport);
    s.online = false;
    for (const b of ['a', 'b', 'c']) { await box.queue({ channel: 'x', body: b }); await new Promise((r) => setTimeout(r, 2)); }
    s.online = true;
    let n = 0;
    const real = s.transport.send;
    s.transport.send = async (...args) => { n += 1; if (n === 2) throw netErr(); return real(...args); };
    const out = await box.flush();
    assert.deepEqual(s.posted.map((m) => m.body), ['a']);
    assert.equal(out.waiting, 2);
    assert.equal((await box.list()).length, 2);
    s.transport.send = real;
    await box.flush();
    assert.deepEqual(s.posted.map((m) => m.body), ['a', 'b', 'c']);
  });

  it('a message whose answer was lost is not posted twice: the retry carries the same client id', async () => {
    const s = server(), st = memory();
    const box = P.createOutbox(st, s.transport);
    const real = s.transport.send;
    let lost = true;
    s.transport.send = async (ch, payload, id) => {
      const msg = await real(ch, payload, id);
      if (lost) { lost = false; throw netErr(); }
      return msg;
    };
    await box.queue({ channel: 'dm_1', body: 'only once' });
    assert.equal((await box.list()).length, 1);
    await box.flush();
    assert.equal(s.posted.length, 1);
    assert.equal(new Set(s.log).size, 1, 'both tries used one client id');
    assert.equal(s.log.length, 2);
  });

  it('a refusal from the server marks that message failed and does not block the ones behind it', async () => {
    const s = server(), st = memory();
    const box = P.createOutbox(st, s.transport);
    s.online = false;
    for (const b of ['bad', 'good']) { await box.queue({ channel: 'x', body: b }); await new Promise((r) => setTimeout(r, 2)); }
    s.refuse.add('bad');
    s.online = true;
    const out = await box.flush();
    assert.deepEqual(s.posted.map((m) => m.body), ['good']);
    assert.equal(out.failed.length, 1);
    const left = await box.list();
    assert.equal(left.length, 1);
    assert.match(left[0].failed, /not in that conversation/);
    // A failed message is not tried again on every flush.
    s.log.length = 0;
    await box.flush();
    assert.equal(s.log.length, 0);
    await box.discard(left[0].id);
    assert.equal((await box.list()).length, 0);
  });

  it('treats a server error (500) and rate limiting (429) as "try later", never as a refusal', async () => {
    for (const status of [500, 502, 503, 429]) {
      const s = server(), st = memory();
      const box = P.createOutbox(st, s.transport);
      const real = s.transport.send;
      s.transport.send = async () => { throw http(status, 'busy'); };
      await box.queue({ channel: 'x', body: 'later' });
      const left = await box.list();
      assert.equal(left.length, 1, String(status));
      assert.equal(left[0].failed, undefined, String(status));
      s.transport.send = real;
      await box.flush();
      assert.equal(s.posted.length, 1);
    }
  });

  it('uploads each attached file once, even when the send fails and is retried', async () => {
    const s = server(), st = memory();
    const box = P.createOutbox(st, s.transport);
    const real = s.transport.send;
    s.transport.send = async () => { throw netErr(); };
    await box.queue({ channel: 'x', body: 'with pictures', files: [{ blob: { size: 3 }, name: 'a.jpg', type: 'image/jpeg' }, { blob: { size: 3 }, name: 'v.webm', type: 'audio/webm' }] });
    assert.equal(s.uploads, 2);
    s.transport.send = real;
    await box.flush();
    assert.equal(s.uploads, 2, 'a retry does not upload again');
    assert.equal(s.posted.length, 1);
    same(s.posted[0].attachments.map((a) => a.name), ['a.jpg', 'v.webm']);
  });

  it('resumes a message whose upload stopped halfway', async () => {
    const s = server(), st = memory();
    const box = P.createOutbox(st, s.transport);
    const realUp = s.transport.upload;
    let n = 0;
    s.transport.upload = async (...a) => { n += 1; if (n === 2) throw netErr(); return realUp(...a); };
    await box.queue({ channel: 'x', body: '', files: [{ blob: {}, name: '1.jpg', type: 'image/jpeg' }, { blob: {}, name: '2.jpg', type: 'image/jpeg' }] });
    assert.equal(s.posted.length, 0);
    assert.equal(s.uploads, 1);
    s.transport.upload = realUp;
    await box.flush();
    assert.equal(s.uploads, 2, 'only the second file uploaded on the retry');
    same(s.posted[0].attachments.map((a) => a.name), ['1.jpg', '2.jpg']);
  });

  it('runs one flush at a time', async () => {
    const s = server(), st = memory();
    const box = P.createOutbox(st, s.transport);
    s.online = false;
    await box.queue({ channel: 'x', body: 'once' });
    s.online = true;
    const [a, b] = await Promise.all([box.flush(), box.flush()]);
    assert.equal(a, b);
    assert.equal(s.posted.length, 1);
  });

  it('keeps the thread a reply belongs to', async () => {
    const s = server(), st = memory();
    const seen = [];
    const t = { ...s.transport, send: async (ch, p, id) => { seen.push(p.thread_id); return s.transport.send(ch, p, id); } };
    const box = P.createOutbox(st, t);
    await box.queue({ channel: 'x', body: 'reply', thread_id: 42 });
    assert.deepEqual(seen, [42]);
  });
});

describe('the service worker', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

  it('parses', () => { new Function(sw); });

  it('never stores account data: nothing under /api is cached or answered from a cache', () => {
    assert.match(sw, /if \(url\.pathname\.startsWith\('\/api\/'\)\) return;/);
    assert.ok(!/cache\.put\([^)]*api/i.test(sw));
  });

  it('forgets everything on sign-out and on request', () => {
    assert.match(sw, /\/api\/auth\/logout/);
    assert.match(sw, /forgetEverything/);
  });

  it('keeps a page only when it is the real page for that address, never a redirect to sign-in', () => {
    assert.match(sw, /!res\.redirected/);
  });

  it('opens only paths on this site from a notice and falls back to the start page', () => {
    assert.match(sw, /startsWith\('\/'\)/);
    assert.match(sw, /'\/m\/'/);
  });

  it('shows no second notice while the app is open in front', () => {
    assert.match(sw, /visibilityState === 'visible' && w\.focused/);
  });

  it('is exempt from sign-in and served from the root', () => {
    const mw = readFileSync(new URL('../functions/_middleware.ts', import.meta.url), 'utf8');
    assert.match(mw, /'\/sw\.js'/);
    assert.match(mw, /'\/m\/manifest\.webmanifest'/);
    const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
    assert.match(headers, /\/sw\.js[\s\S]*Service-Worker-Allowed: \//);
  });
});

describe('the manifest', () => {
  const m = JSON.parse(readFileSync(new URL('../public/m/manifest.webmanifest', import.meta.url), 'utf8'));
  it('installs as its own app that opens the start page and covers the whole site', () => {
    assert.equal(m.display, 'standalone');
    assert.equal(m.id, '/m/');
    assert.ok(m.start_url.startsWith('/m/'));
    assert.equal(m.scope, '/');
    assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512') && m.icons.some((i) => i.purpose === 'maskable'));
    assert.deepEqual(m.shortcuts.map((s) => s.name), ['Chat', 'Meetings', 'Favor Brain']);
  });
  it('every icon file exists', () => {
    for (const i of m.icons) readFileSync(new URL('../public' + i.src, import.meta.url));
  });
});
