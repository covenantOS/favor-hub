// Run with: npm test
//
// Meetings: Pause recording during a call, and cutting a stretch out of a finished meeting's recording in Drive.
// Real routes on an in-memory D1 with a stand-in Google Drive (a fetch that keeps files and versions in memory) and a stand-in model.
// The recording is tests/fixtures/webmtrim/av-live.webm: 20 s of a test pattern and a tone, VP8 with a keyframe every 2 s, in the
// shape a browser's MediaRecorder writes. Made-up people only (the repository is public).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { route } = await import('../functions/_lib/meetroute.ts');

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const id = (n) => String(n).padStart(24, '0');
const HOST = 'ann@favorintl.org';
const VIDEO = new Uint8Array(readFileSync(new URL('./fixtures/webmtrim/av-live.webm', import.meta.url)));
const hasFfmpeg = spawnSync('ffprobe', ['-version']).status === 0;

// ---- a stand-in Google Drive: files with versions, resumable sessions, and the calls the trim job makes
const drive = { files: new Map(), sessions: new Map(), n: 0, calls: [], refuseHistory: false };
const realFetch = globalThis.fetch;
function driveFetch(url, init = {}) {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  const h = new Headers(init.headers || {});
  drive.calls.push(`${method} ${u.pathname}`);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (u.host === 'oauth2.googleapis.com') return json({ access_token: 'tok', expires_in: 3600 });
  if (u.host === 'upload.test') {
    const s = drive.sessions.get(u.pathname);
    const cr = h.get('Content-Range') || '';
    const body = init.body ? new Uint8Array(init.body.buffer ? init.body.buffer.slice(init.body.byteOffset, init.body.byteOffset + init.body.byteLength) : init.body) : new Uint8Array(0);
    const m = /bytes (\d+)-(\d+)\/(\d+|\*)/.exec(cr) || /bytes \*\/(\d+)/.exec(cr);
    if (!s || !m) return json({}, 400);
    if (m.length === 4) {
      if (Number(m[1]) !== s.got.length) return json({}, 400);
      const next = new Uint8Array(s.got.length + body.length); next.set(s.got); next.set(body, s.got.length); s.got = next;
      if (m[3] === '*') return new Response(null, { status: 308, headers: { Range: `bytes=0-${s.got.length - 1}` } });
    }
    const f = drive.files.get(s.file);
    const rid = 'r' + ++drive.n;
    f.revs.push({ id: rid, data: s.got });
    drive.sessions.delete(u.pathname);
    return json({ id: s.file, size: String(s.got.length), headRevisionId: rid });
  }
  let p = u.pathname.replace('/drive/v3/files/', '').replace('/upload', '');
  if (u.pathname.startsWith('/upload/drive/v3/files/')) {
    const fid = decodeURIComponent(u.pathname.split('/').pop());
    const key = '/s/' + ++drive.n;
    drive.sessions.set(key, { file: fid, got: new Uint8Array(0) });
    return new Response('{}', { status: 200, headers: { Location: 'https://upload.test' + key } });
  }
  const parts = p.split('/').map(decodeURIComponent);
  const f = drive.files.get(parts[0]);
  if (!f) return json({}, 404);
  const head = f.revs[f.revs.length - 1];
  if (parts.length === 1) {
    if (method === 'PATCH') { const b = JSON.parse(init.body || '{}'); if (b.trashed) f.trashed = true; return json({ id: parts[0] }); }
    return json({ id: parts[0], size: String(head.data.length), mimeType: 'video/webm', headRevisionId: head.id, name: f.name, parents: ['folder'] });
  }
  if (parts[1] === 'copy') { const nid = 'copy' + ++drive.n; drive.files.set(nid, { name: f.name, revs: [{ id: 'r' + ++drive.n, data: head.data }] }); return json({ id: nid }); }
  if (parts[1] === 'revisions' && parts.length === 2) return json({ revisions: f.revs.map((r) => ({ id: r.id })) });
  if (parts[1] === 'revisions' && method === 'DELETE') {
    if (drive.refuseHistory) return json({}, 403);
    f.revs = f.revs.filter((r) => r.id !== parts[2]); return new Response(null, { status: 204 });
  }
  if (parts[1] === 'revisions' && u.searchParams.get('alt') === 'media') {
    const r = f.revs.find((x) => x.id === parts[2]);
    if (!r) return json({}, 404);
    const rg = /bytes=(\d+)-(\d+)/.exec(h.get('Range') || '');
    if (!rg) return new Response(r.data, { status: 200 });
    const a = Number(rg[1]), b = Math.min(Number(rg[2]), r.data.length - 1);
    return new Response(r.data.slice(a, b + 1), { status: 206 });
  }
  return json({}, 404);
}

before(() => { globalThis.fetch = (url, init) => Promise.resolve(driveFetch(url, init)); });
after(() => { globalThis.fetch = realFetch; });

function fakeAI() {
  const calls = { whisper: 0, chat: 0 };
  return {
    calls,
    run: async (model, input) => {
      if (!input.messages) { calls.whisper++; return { text: 'hello there', segments: [{ start: 0, text: 'hello there' }] }; }
      calls.chat++;
      const sys = input.messages[0].content;
      if (sys.includes('pull out its notes')) return { response: { summary: 'They talked about the banquet.', decisions: [], actions: [], topics: [] } };
      if (sys.includes('You write the title and summary')) return { response: { title: 'Banquet', summary: 'They talked about the banquet.' } };
      return { response: {} };
    },
  };
}

async function world() {
  const d1 = memoryD1();
  for (const f of ['db/admin-home.sql', 'db/meetings.sql', 'db/meetings-auto.sql', 'db/meetings-privacy.sql', 'db/meetings-trim.sql', 'db/projects.sql', 'db/favor-chat.sql', 'db/favor-chat-private.sql']) d1.exec(read(f));
  for (const [email, name] of [[HOST, 'Ann Example'], ['bob@favorintl.org', 'Bob Sample'], ['cy@favorintl.org', 'Cy Test']]) await d1.prepare('INSERT INTO meet_directory (email, name, title, team, active, lead) VALUES (?, ?, ?, ?, 1, 0)').bind(email, name, 'Staff', 'Partner Care').run();
  const r2 = new Map();
  const CLIPS = { put: async (k, v) => { r2.set(k, v instanceof Uint8Array ? v.slice() : v); }, get: async (k) => (r2.has(k) ? { arrayBuffer: async () => { const v = r2.get(k); return v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v; } } : null), delete: async (k) => { for (const x of [].concat(k)) r2.delete(x); } };
  const CHAT_ROOM = { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('ok') }) };
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const GOOGLE_SA_JSON = JSON.stringify({ client_email: 'sa@test.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const ai = fakeAI();
  return { DB: d1, MEET_RELEASE: 'staff', MEET_FAKE_SFU: '1', AI: ai, CLIPS, CHAT_ROOM, GOOGLE_SA_JSON, MEET_DRIVE_FOLDER: 'folder', d1, r2, ai };
}

async function call(env, who, path, { method = 'GET', body, query = '', raw, headers = {} } = {}) {
  const user = typeof who === 'string' ? { email: who, role: 'staff' } : who;
  const init = { method, headers: { 'X-Hub-Email': user.email, 'X-Hub-Name': user.name || user.email.split('@')[0], 'X-Hub-Role': user.role, 'content-type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (raw !== undefined) init.body = raw;
  const res = await route({ request: new Request(`https://hub.test/api/meet/${path.join('/')}${query}`, init), env, params: { path }, waitUntil: () => undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function probe(buf) {
  const dir = mkdtempSync(join(tmpdir(), 'meettrim-'));
  try {
    const f = join(dir, 'x.webm');
    writeFileSync(f, buf);
    const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'], { encoding: 'utf8' });
    const pk = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'packet=codec_type,pts_time', '-of', 'csv=p=0', f], { encoding: 'utf8' });
    const rows = pk.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => { const [type, t] = l.split(','); return { type, t: Number(t) }; });
    return { status: dec.status, errors: dec.stderr.trim(), end: Math.max(...rows.filter((r) => r.type === 'video').map((r) => r.t)) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('Pause recording during a call', () => {
  it('a cohost pauses; sound, voice pieces and video pieces from the pause are dropped even when they arrive after Resume; later pieces are kept', async () => {
    const env = await world();
    const t0 = Date.now() - 120_000;
    env.d1.prepare(`INSERT INTO hub_meetings (id, title, host_email, host_name, invitees, access, status, rec_mode, notes_status, created_at, started_at, starts_at) VALUES (?, 'Live', ?, 'Ann Example', ?, 'invited', 'live', 'video', 'none', ?, ?, ?)`)
      .bind(id(1), HOST, JSON.stringify([{ email: 'bob@favorintl.org' }, { email: 'cy@favorintl.org' }]), new Date(t0).toISOString(), new Date(t0).toISOString(), new Date(t0).toISOString()).run();
    const now = Date.now();
    env.d1.prepare(`INSERT INTO hub_meeting_presence (meeting_id, pid, email, name, role, joined_at, seen) VALUES (?, 'aaaaaaaaaaaa', ?, 'Ann Example', 'host', ?, ?), (?, 'cccccccccccc', 'cy@favorintl.org', 'Cy Test', 'cohost', ?, ?), (?, 'bbbbbbbbbbbb', 'bob@favorintl.org', 'Bob Sample', 'staff', ?, ?)`).bind(id(1), HOST, now, now, id(1), now, now, id(1), now, now).run();
    env.d1.prepare(`INSERT INTO hub_meeting_rec (meeting_id, epoch, owner_pid, mode, active, last_chunk, started) VALUES (?, 1, 'aaaaaaaaaaaa', 'video', 1, ?, ?)`).bind(id(1), now, now).run();
    assert.equal((await call(env, 'bob@favorintl.org', ['meetings', id(1), 'private'], { method: 'POST', body: { pid: 'bbbbbbbbbbbb', on: true } })).status, 403, 'a participant cannot pause');
    const on = await call(env, 'cy@favorintl.org', ['meetings', id(1), 'private'], { method: 'POST', body: { pid: 'cccccccccccc', on: true } });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    const sync = await call(env, 'bob@favorintl.org', ['meetings', id(1), 'sync'], { query: '?pid=bbbbbbbbbbbb&since=0' });
    if (sync.status === 200) assert.equal(sync.body.meeting.private, true, 'everyone in the room is told');
    const put = (kind, n, start, end) => call(env, HOST, ['meetings', id(1), 'rec', kind, '1', String(n)], { method: 'PUT', raw: new Uint8Array(1200).fill(7), query: '?pid=aaaaaaaaaaaa', headers: kind === 'chunk' ? { 'x-t0': String(start), 'x-t1': String(end) } : { 'x-start': String(start), 'x-end': String(end), 'x-spk': 'bbbbbbbbbbbb' } });
    // While paused nothing is kept.
    assert.equal((await put('voice', 0, now - 500, now)).body.private, true);
    assert.equal((await put('chunk', 5, now - 1000, now)).body.private, true);
    assert.equal((await put('audio', 0, now - 1000, now)).body.private, true);
    // Resume, set the pause to a known stretch: 60 s to 80 s of the meeting.
    assert.equal((await call(env, HOST, ['meetings', id(1), 'private'], { method: 'POST', body: { pid: 'aaaaaaaaaaaa', on: false } })).status, 200);
    env.d1.prepare('UPDATE hub_meeting_private SET from_t = 60, to_t = 80 WHERE meeting_id = ?').bind(id(1)).run();
    // A piece that began before Pause and arrived after Resume, and a video piece recorded during the pause and sent late.
    assert.equal((await put('voice', 1, t0 + 50_000, t0 + 65_000)).body.private, true, 'a voice piece reaching into the pause is dropped');
    assert.equal((await put('chunk', 6, t0 + 70_000, t0 + 71_000)).body.private, true, 'a late video piece from the pause is dropped');
    assert.equal((await put('voice', 2, t0 + 79_500, t0 + 85_000)).body.private, true, 'a piece starting just before Resume is dropped');
    assert.equal(env.ai.calls.whisper, 0, 'nothing from the pause was read, so no caption or transcript line came from it');
    assert.equal(env.d1.db.prepare('SELECT COUNT(*) AS n FROM hub_meeting_lines WHERE meeting_id = ?').get(id(1)).n, 0);
    // After the pause, everything is kept and read again.
    const v = await put('voice', 3, t0 + 90_000, t0 + 95_000);
    assert.notEqual(v.body.private, true);
    assert.notEqual((await put('chunk', 7, t0 + 90_000, t0 + 91_000)).body.private, true);
    assert.equal(env.ai.calls.whisper, 1, 'the piece after Resume is read for the transcript and captions');
    assert.ok(env.d1.db.prepare('SELECT COUNT(*) AS n FROM hub_meeting_lines WHERE meeting_id = ?').get(id(1)).n >= 1);
    assert.deepEqual([...env.r2.keys()], [`meet/${id(1)}/1/000007.webm`], 'only the video piece from after the pause is stored (a voice piece is deleted once read)');
    assert.deepEqual(env.d1.db.prepare('SELECT n FROM hub_meeting_voice WHERE meeting_id = ?').all(id(1)).map((r) => r.n), [3], 'only the voice piece from after the pause was taken');
    assert.deepEqual(env.d1.db.prepare('SELECT seq FROM hub_meeting_chunks WHERE meeting_id = ?').all(id(1)).map((r) => r.seq), [7]);
    // The notes page shows the gap.
    env.d1.prepare(`UPDATE hub_meetings SET status = 'ended', ended_at = ? WHERE id = ?`).bind(new Date().toISOString(), id(1)).run();
    const notes = (await call(env, HOST, ['meetings', id(1), 'notes'])).body;
    assert.deepEqual(notes.privacy.paused, [{ from: 60, to: 80 }]);
  });
});

/** A finished video meeting with its 20 s recording in the stand-in Drive. */
function finished(env, n, fileId) {
  const t0 = Date.parse('2026-10-09T15:00:00.000Z');
  const tr = [{ t: 2, who: 'Ann Example', text: 'Welcome, the banquet first.' }, { t: 6, who: 'Bob Sample', text: 'Please pray for my mother, surgery is Tuesday.' }, { t: 13, who: 'Ann Example', text: 'Private family news here.' }, { t: 17, who: 'Ann Example', text: 'Thanks everyone.' }];
  env.d1.prepare(`INSERT INTO hub_meetings (id, title, host_email, host_name, invitees, access, status, rec_mode, rec_state, notes_status, summary, notes_json, transcript, drive_file_id, created_at, started_at, ended_at, starts_at)
    VALUES (?, 'Care team weekly', ?, 'Ann Example', ?, 'invited', 'ended', 'video', 'stored', 'ready', 'They met.', '{}', ?, ?, ?, ?, ?, ?)`)
    .bind(id(n), HOST, JSON.stringify([{ email: 'bob@favorintl.org' }]), JSON.stringify(tr), fileId, new Date(t0).toISOString(), new Date(t0).toISOString(), new Date(t0 + 20_000).toISOString(), new Date(t0).toISOString()).run();
  env.d1.prepare(`INSERT INTO hub_meeting_drive (meeting_id, epoch, session_url, total_bytes, sent_bytes, file_name, ext, state, file_id) VALUES (?, 1, '', ?, ?, 'x, video.webm', 'webm', 'done', ?)`).bind(id(n), VIDEO.length, VIDEO.length, fileId).run();
  env.d1.prepare('INSERT INTO hub_meeting_chunks (meeting_id, epoch, seq, t0, t1, bytes) VALUES (?, 1, 0, ?, ?, ?)').bind(id(n), t0, t0 + 20_000, VIDEO.length).run();
  drive.files.set(fileId, { name: 'x, video.webm', revs: [{ id: 'r' + ++drive.n, data: VIDEO }] });
}

async function pumpAll(env, n) {
  for (let i = 0; i < 50; i++) {
    const r = await call(env, HOST, ['meetings', id(n), 'pump'], { method: 'POST', body: {} });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    if (r.body.done) return r.body;
  }
  throw new Error('the trim never finished');
}

describe('cutting a stretch out of the recording in Drive', () => {
  it('one action cuts the notes and the video; the same Drive file is rewritten, plays end to end, and keeps no older version', async () => {
    const env = await world();
    finished(env, 2, 'F2');
    assert.equal((await call(env, 'bob@favorintl.org', ['meetings', id(2), 'privacy'], { method: 'POST', body: { op: 'cut', from: 5, to: 9 } })).status, 403, 'only a host or an admin');
    const r = await call(env, HOST, ['meetings', id(2), 'privacy'], { method: 'POST', body: { op: 'cut', ranges: [{ from: 5, to: 9 }] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.recording, 'trimming');
    const busy = await call(env, HOST, ['meetings', id(2), 'privacy'], { method: 'POST', body: { op: 'cut', from: 1, to: 2 } });
    assert.equal(busy.status, 409, 'a second cut waits for the first');
    const mid = (await call(env, HOST, ['meetings', id(2), 'notes'])).body;
    assert.equal(mid.privacy.trim.running, true);
    assert.ok(!JSON.stringify(mid.transcript).includes('mother'), 'the transcript is cut at once');
    await pumpAll(env, 2);
    const f = drive.files.get('F2');
    assert.equal(f.revs.length, 1, 'the older version is deleted from Drive');
    assert.notEqual(f.revs[0].data.length, VIDEO.length);
    const row = env.d1.db.prepare('SELECT file_id, trims FROM hub_meeting_drive WHERE meeting_id = ?').get(id(2));
    assert.equal(row.file_id, 'F2', 'same file, so links keep working');
    assert.deepEqual(JSON.parse(row.trims), [[[5000, 10000]]], 'cut to the next keyframe');
    assert.equal(env.d1.db.prepare('SELECT rec_state FROM hub_meetings WHERE id = ?').get(id(2)).rec_state, 'stored');
    assert.equal([...env.r2.keys()].filter((k) => k.includes('/trim/')).length, 0, 'nothing left in R2');
    const notes = (await call(env, HOST, ['meetings', id(2), 'notes'])).body;
    assert.equal(notes.privacy.trim.running, false);
    assert.match(notes.files[0].src, /\?v=1$/, 'the player loads the new file');
    if (hasFfmpeg) {
      const p = probe(f.revs[0].data);
      assert.equal(p.status, 0); assert.equal(p.errors, '');
      assert.ok(p.end > 14.4 && p.end < 15.1, 'plays to about 15 s, got ' + p.end);
    }
    // A second cut, asked in meeting time (12 s to 14 s), lands at 7 s to 9 s of the file as it is now.
    const r2 = await call(env, HOST, ['meetings', id(2), 'privacy'], { method: 'POST', body: { op: 'cut', from: 12, to: 14 } });
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    await pumpAll(env, 2);
    const row2 = JSON.parse(env.d1.db.prepare('SELECT trims FROM hub_meeting_drive WHERE meeting_id = ?').get(id(2)).trims);
    assert.deepEqual(row2[1], [[7000, 9000]]);
    assert.equal(drive.files.get('F2').revs.length, 1);
    if (hasFfmpeg) {
      const p = probe(drive.files.get('F2').revs[0].data);
      assert.equal(p.status, 0); assert.equal(p.errors, '');
      assert.ok(p.end > 12.4 && p.end < 13.1, 'plays to about 13 s, got ' + p.end);
    }
  });

  it('keep only one part, and a Drive that refuses to delete versions gets a fresh copy and the old file trashed', async () => {
    const env = await world();
    finished(env, 3, 'F3');
    drive.refuseHistory = true;
    try {
      const r = await call(env, { email: 'will@favorintl.org', role: 'admin' }, ['meetings', id(3), 'privacy'], { method: 'POST', body: { op: 'cut', ranges: [{ from: 0, to: 4 }, { from: 12, to: null }] } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      await pumpAll(env, 3);
    } finally { drive.refuseHistory = false; }
    const row = env.d1.db.prepare('SELECT file_id FROM hub_meeting_drive WHERE meeting_id = ?').get(id(3));
    assert.notEqual(row.file_id, 'F3');
    assert.ok(drive.files.get('F3').trashed, 'the file with the old version is trashed');
    assert.equal(env.d1.db.prepare('SELECT drive_file_id FROM hub_meetings WHERE id = ?').get(id(3)).drive_file_id, row.file_id);
    const tr = JSON.parse(env.d1.db.prepare('SELECT transcript FROM hub_meetings WHERE id = ?').get(id(3)).transcript);
    assert.deepEqual(tr.map((l) => l.t), [6], 'only the kept part is left in the transcript');
    if (hasFfmpeg) {
      const p = probe(drive.files.get(row.file_id).revs[0].data);
      assert.equal(p.status, 0); assert.equal(p.errors, '');
      assert.ok(p.end > 7.4 && p.end < 8.1, 'plays about 8 s, got ' + p.end);
    }
  });

  it('a cut that covers a whole file takes the file out; Keep leaves the recording alone', async () => {
    const env = await world();
    finished(env, 4, 'F4');
    const r = await call(env, HOST, ['meetings', id(4), 'privacy'], { method: 'POST', body: { op: 'cut', from: 0 } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.recording, 'deleted');
    assert.ok(drive.files.get('F4').trashed);
    finished(env, 5, 'F5');
    const k = await call(env, HOST, ['meetings', id(5), 'privacy'], { method: 'POST', body: { op: 'cut', from: 5, to: 6, recording: 'keep' } });
    assert.equal(k.body.recording, 'kept');
    assert.equal(drive.files.get('F5').revs.length, 1);
    assert.equal(drive.files.get('F5').revs[0].data.length, VIDEO.length);
  });
});
