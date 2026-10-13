// Meetings: the saved camera, microphone and speaker (public/js/meet/devices.js) and the room's use of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.MediaStream = class { constructor(t) { this.t = t; } getAudioTracks() { return this.t.filter((x) => x.kind === 'audio'); } getVideoTracks() { return this.t.filter((x) => x.kind === 'video'); } };
const D = await import('../public/js/meet/devices.js');

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const track = (kind, id) => ({ kind, id, stopped: false, stop() { this.stopped = true; }, getSettings: () => ({ deviceId: id }) });
// A fake getUserMedia with a fixed set of device ids; an exact id that is not plugged in fails the way browsers fail.
const fakeMd = (have) => ({
  calls: [],
  async getUserMedia(c) {
    this.calls.push(c);
    const out = [];
    for (const kind of ['audio', 'video']) {
      if (!c[kind]) continue;
      const ex = c[kind].deviceId && c[kind].deviceId.exact;
      if (ex && !have[kind].includes(ex)) throw Object.assign(new Error('gone'), { name: 'OverconstrainedError', constraint: 'deviceId' });
      out.push(track(kind, ex || have[kind][0]));
    }
    return new MediaStream(out);
  },
});

test('prefs are kept per person and merged', () => {
  const s = memStore();
  D.savePrefs('Will@Favorintl.org', { camId: 'cam-2' }, s);
  D.savePrefs('will@favorintl.org', { micId: 'mic-3' }, s);
  assert.deepEqual(D.loadPrefs('will@favorintl.org', s), { micId: 'mic-3', camId: 'cam-2', spkId: '', ns: true, ec: true });
  assert.equal(D.loadPrefs('tester2@favorintl.org', s).camId, '');
  assert.ok(s.m.has('favor.meet.devices.will@favorintl.org'));
});

test('a saved device is asked for exactly, with noise suppression and echo cancellation', () => {
  const a = D.audioConstraints({ micId: 'm1', ns: false, ec: true });
  assert.deepEqual(a.deviceId, { exact: 'm1' });
  assert.equal(a.noiseSuppression, false); assert.equal(a.echoCancellation, true);
  assert.deepEqual(D.videoConstraints({ camId: 'c1' }).deviceId, { exact: 'c1' });
  assert.equal(D.videoConstraints({ camId: '' }).deviceId, undefined);
});

test('camera off and on opens the saved camera, never the default', async () => {
  const md = fakeMd({ audio: ['m-default'], video: ['c-default', 'c-usb'] });
  const r = await D.acquire('video', { camId: 'c-usb' }, md);
  assert.equal(r.track.id, 'c-usb'); assert.equal(r.fellBack, false);
});

test('a missing saved device falls back to the default and says so', async () => {
  const md = fakeMd({ audio: ['m-default'], video: ['c-default'] });
  const r = await D.acquire('video', { camId: 'c-usb' }, md);
  assert.equal(r.track.id, 'c-default'); assert.equal(r.fellBack, true);
  assert.equal(md.calls.length, 2);
});

test('a blocked camera is not retried on the default', async () => {
  const md = { async getUserMedia() { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); } };
  await assert.rejects(D.acquire('video', { camId: 'c-usb' }, md), /no/);
});

test('the lobby keeps the microphone when the camera fails', async () => {
  const md = fakeMd({ audio: ['m1'], video: [] });
  md.getUserMedia = (async function (orig, c) { if (c.video) throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); return orig.call(this, c); }).bind(md, md.getUserMedia);
  const r = await D.acquireBoth({ micId: 'm1' }, true, md);
  assert.equal(r.stream.getAudioTracks().length, 1); assert.ok(r.camError);
});

test('the room reacquires through the saved devices and switches on the same sender', () => {
  const room = readFileSync(new URL('../public/js/meet/room.js', import.meta.url), 'utf8');
  assert.doesNotMatch(room, /deviceId: \{ ideal/, 'no loose deviceId constraints left in the room');
  assert.match(room, /acquire\('video', P\)/);
  assert.match(room, /rtc\.replace\('v', /);
  assert.match(room, /data-a="devmenu" data-p="mic"/);
  assert.match(room, /data-a="devmenu" data-p="cam"/);
  const pj = readFileSync(new URL('../public/js/meet/prejoin.js', import.meta.url), 'utf8');
  assert.match(pj, /favor\.meet\.devices\./);
  assert.doesNotMatch(pj, /deviceId: \{ ideal/);
});

test('a re-pulled track is handed to the room even when the browser fires no ontrack', () => {
  const rtc = readFileSync(new URL('../public/js/meet/rtc.js', import.meta.url), 'utf8');
  assert.match(rtc, /getTransceivers\(\)\) if \(tr\.mid != null && fresh\.has/);
  assert.match(rtc, /this\.lastPull = /);
});

test('the room reconnects only when its own connection is down, with backoff, and quietly', () => {
  const room = readFileSync(new URL('../public/js/meet/room.js', import.meta.url), 'utf8');
  assert.doesNotMatch(room, /no media for 9 seconds/);
  assert.match(room, /function rejoinSoon/);
  assert.match(room, /rejoin: !!isRejoin/);
  assert.match(room, /data-a="sound-on"/);
  const route = readFileSync(new URL('../functions/_lib/meetroute.ts', import.meta.url), 'utf8');
  assert.match(route, /if \(!quiet\) await addEvent\(env, id, 'notice', pid, '', \{ a: 'joined'/);
  assert.match(route, /kind === 'diag'/);
});

test('gallery order does not follow speech', () => {
  const room = readFileSync(new URL('../public/js/meet/room.js', import.meta.url), 'utf8');
  assert.match(room, /bySpeech \? \(b\.speakAt/);
});

test('final notes use the meeting voice; a redo rewrites the notes without posting to Chat or making tasks again', () => {
  const drive = readFileSync(new URL('../functions/_lib/meetdrive.ts', import.meta.url), 'utf8');
  assert.match(drive, /feature: 'meet-notes', voice: 'You work for Favor International, a Christian nonprofit, and write the notes of a staff meeting/);
  const route = readFileSync(new URL('../functions/_lib/meetroute.ts', import.meta.url), 'utf8');
  assert.match(route, /if \(b\.redo && m\.status === 'ended' && \(isHost\(m, user\.email\) \|\| user\.role === 'admin'\)/);
  assert.match(route, /if \(!redo\) await chatNotesReady/);
  assert.match(route, /if \(!redo\) await meetActionsToTasks/);
  assert.match(route, /if \(!redo\) await afterNotes/);
  const day = readFileSync(new URL('../public/js/meet/day.js', import.meta.url), 'utf8');
  assert.doesNotMatch(day, /rec: '(off|notes)'/);
});

test('in-meeting asks (agreed, open, owners, missed, ask a meeting) charge the tier 1 meetings line', () => {
  const route = readFileSync(new URL('../functions/_lib/meetroute.ts', import.meta.url), 'utf8');
  const calls = route.match(/chatJson<[^>]+>\([\s\S]*?\);/g) || [];
  assert.ok(calls.length >= 2);
  for (const c of calls) assert.match(c, /MEET_AI\)/);
});
