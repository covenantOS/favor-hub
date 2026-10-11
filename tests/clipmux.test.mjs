// Run with: npm test
// Clips: a recording saved as a fragmented MP4 is rewritten with one index at the front, so it starts playing at once.
// The fixtures in tests/fixtures/clipmux were made with ffmpeg from a test pattern and a tone (no real recording):
//   frag-base       -movflags frag_keyframe+empty_moov+default_base_moof   the shape a browser's recorder writes
//   frag-bframes    -bf 2 -movflags frag_keyframe+empty_moov               composition offsets, base_data_offset
//   frag-separate   +separate_moof -frag_duration 500000                   one moof per track
//   frag-videoonly  no sound track          frag-offset  a second input with -itsoffset
//   prog-fast       -movflags +faststart    prog-tail    moov at the end   tiny.webm  VP8 and Opus
// Where ffmpeg and ffprobe are installed the result is also compared packet by packet with the source and decoded in full.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';
import { memoryR2 } from './support/r2.mjs';

const FIX = new URL('./fixtures/clipmux/', import.meta.url);
const fixture = (name) => new Uint8Array(readFileSync(new URL(name, FIX)));
const FRAGMENTED = ['frag-base.mp4', 'frag-bframes.mp4', 'frag-separate.mp4', 'frag-videoonly.mp4', 'frag-offset.mp4'];
const hasFfmpeg = spawnSync('ffprobe', ['-version']).status === 0 && spawnSync('ffmpeg', ['-version']).status === 0;

let lib;
let job;
before(async () => {
  lib = await import('../functions/_lib/clipmux.ts');
  job = await import('../functions/_lib/clipmuxjob.ts');
});

/** A source over bytes in memory. `chunk` is how many bytes each read returns; `opens` counts how often it was opened. */
function sourceOf(buf, chunk = 5000) {
  return {
    size: buf.byteLength,
    opens: 0,
    /** Where each open began. */
    from: [],
    async open(offset) {
      this.opens++;
      this.from.push(offset);
      let at = offset;
      return new ReadableStream({
        pull(c) {
          if (at >= buf.byteLength) return c.close();
          c.enqueue(new Uint8Array(buf.subarray(at, Math.min(at + chunk, buf.byteLength))));
          at += chunk;
        },
      });
    },
  };
}

/** The new file: the head, then the source bytes the plan names. */
function assemble(buf, res) {
  const parts = [res.head];
  for (let i = 0; i < res.plan.ext.length; i += 2) parts.push(buf.subarray(res.plan.ext[i], res.plan.ext[i] + res.plan.ext[i + 1]));
  return new Uint8Array(Buffer.concat(parts));
}

async function rewrite(buf, chunk) {
  const res = await lib.planMux(sourceOf(buf, chunk));
  assert.ok(res.kind === 'frag' || res.kind === 'tail', `expected a rewrite, got ${res.kind}`);
  lib.checkPlan(res.plan, res.head);
  const out = assemble(buf, res);
  assert.equal(out.byteLength, res.plan.total);
  return { res, out };
}

const boxesOf = (buf) => {
  const out = [];
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let o = 0; o + 8 <= buf.byteLength; ) {
    let size = v.getUint32(o);
    if (size === 1) size = v.getUint32(o + 8) * 4294967296 + v.getUint32(o + 12);
    if (size < 8) break;
    out.push({ type: String.fromCharCode(...buf.subarray(o + 4, o + 8)), at: o, size });
    o += size;
  }
  return out;
};

/* ---------------- ffprobe and ffmpeg, when they are installed ---------------- */

let dir = '';
const tmp = (name, bytes) => {
  if (!dir) dir = mkdtempSync(join(tmpdir(), 'clipmux-'));
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
};
process.on('exit', () => dir && rmSync(dir, { recursive: true, force: true }));

/** Every packet as "stream,pts,dts,size,flags,md5 of its bytes". */
function packets(path, withDuration = false) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', `packet=stream_index,pts_time,dts_time,${withDuration ? 'duration_time,' : ''}size,flags`, '-show_data_hash', 'md5', '-of', 'csv', path], { maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, String(r.stderr));
  return String(r.stdout).trim().split(/\r?\n/);
}
const format = (path) => JSON.parse(String(spawnSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-count_packets', '-of', 'json', path]).stdout));
function decodes(path) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-']);
  assert.equal(r.status, 0, String(r.stderr));
  assert.equal(String(r.stderr).trim(), '', 'ffmpeg reported errors while decoding');
}

/* ---------------- the rewrite ---------------- */

describe('fragmented MP4 to one index at the front', () => {
  for (const name of FRAGMENTED) {
    it(`${name}: one moov before one mdat, tables that agree with the plan`, async () => {
      const buf = fixture(name);
      const { res, out } = await rewrite(buf);
      assert.equal(res.kind, 'frag');
      assert.deepEqual(boxesOf(out).map((b) => b.type), ['ftyp', 'moov', 'mdat']);
      assert.ok(!Buffer.from(out).includes('moof'), 'no fragment headers are left');
      assert.ok(!Buffer.from(out).includes('mvex'), 'the moov no longer says the file is fragmented');
      const head = lib.readHead(res.head);
      assert.equal(head.tracks.length, name === 'frag-videoonly.mp4' ? 1 : 2);
      for (const t of head.tracks) {
        assert.ok(t.samples > 0 && t.duration > 0 && t.chunks > 0);
        assert.ok(t.first >= res.plan.headLen && t.end <= out.byteLength, 'every sample sits inside the mdat');
        if (t.handler === 'vide') assert.ok(t.sync > 0 && t.sync < t.samples, 'video lists its key frames');
        else assert.equal(t.sync, t.samples);
      }
      // The media bytes are the source's own, in order.
      const media = out.subarray(res.plan.headLen);
      const want = Buffer.concat(boxesOf(buf).filter((b) => b.type === 'mdat').map((b) => buf.subarray(b.at + 8, b.at + b.size)));
      assert.ok(Buffer.from(media).equals(want));
    });

    it(`${name}: the same packets, times and length as the source, and it decodes`, { skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
      const buf = fixture(name);
      const { res, out } = await rewrite(buf);
      const a = tmp(`src-${name}`, buf);
      const b = tmp(`out-${name}`, out);
      assert.deepEqual(packets(b, true), packets(a, true));
      const probe = format(b);
      res.plan.tracks.forEach((t, i) => {
        assert.equal(Number(probe.streams[i].nb_read_packets), t.samples);
        assert.equal(Number(probe.streams[i].nb_frames), t.samples);
        assert.ok(Math.abs(Number(probe.streams[i].duration) - t.duration / t.timescale) < 0.002);
      });
      const src = format(a);
      assert.ok(Math.abs(Number(probe.format.duration) - Number(src.format.duration)) < 0.05, `${probe.format.duration} against ${src.format.duration}`);
      assert.ok(Math.abs(res.plan.durationMs / 1000 - Number(probe.format.duration)) < 0.05);
      assert.equal(Number(probe.format.start_time), Number(src.format.start_time));
      decodes(b);
    });
  }

  it('gives the same file however the source arrives', async () => {
    const buf = fixture('frag-bframes.mp4');
    const whole = await rewrite(buf, 1 << 20);
    for (const chunk of [1, 7, 4096]) assert.ok(Buffer.from((await rewrite(buf, chunk)).out).equals(whole.out), `chunk ${chunk}`);
  });

  it('reads a long file in several stretches at once and builds the same file', async () => {
    for (const name of FRAGMENTED) {
      const buf = fixture(name);
      const plain = await lib.planMux(sourceOf(buf), { segments: 1 });
      for (const segments of [2, 3, 5]) {
        for (const chunk of [5000, 11]) {
          const src = sourceOf(buf, chunk);
          const res = await lib.planMux(src, { segments, minSegmentBytes: 1 });
          assert.ok(src.from.some((o) => o > buf.byteLength / (segments + 1)), 'readers started in the middle of the file');
          assert.ok(Buffer.from(res.head).equals(plain.head), `${name} in ${segments} stretches, ${chunk} bytes a read`);
          assert.deepEqual(res.plan, plain.plan);
        }
      }
    }
    // A recording cut short, read the same way.
    const cut = fixture('frag-base.mp4').subarray(0, fixture('frag-base.mp4').byteLength - 900);
    assert.deepEqual((await lib.planMux(sourceOf(cut), { segments: 3, minSegmentBytes: 1 })).plan, (await lib.planMux(sourceOf(cut), { segments: 1 })).plan);
  });

  it('falls back to reading front to back when media bytes look like a fragment header', async () => {
    const buf = fixture('frag-base.mp4').slice();
    // Write the bytes a reader searches for into the middle of the fourth fragment's media.
    const m = boxesOf(buf).filter((b) => b.type === 'mdat')[3];
    buf.set([0, 0, 0, 24, 0x6d, 0x6f, 0x6f, 0x66, 0, 0, 0, 16, 0x6d, 0x66, 0x68, 0x64], m.at + 200);
    const plain = await lib.planMux(sourceOf(buf), { segments: 1 });
    for (const segments of [2, 3, 4, 6, 9]) {
      const res = await lib.planMux(sourceOf(buf), { segments, minSegmentBytes: 1 });
      assert.ok(Buffer.from(res.head).equals(plain.head), `${segments} stretches`);
      assert.deepEqual(res.plan, plain.plan);
    }
  });

  it('keeps a pause: a later fragment that starts late lengthens the sample before it', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
    // Push every fragment after the second one a second later in both tracks, the way a paused recorder leaves a gap.
    const buf = fixture('frag-base.mp4').slice();
    const v = new DataView(buf.buffer);
    const moofs = boxesOf(buf).filter((b) => b.type === 'moof');
    const scale = { 1: 15360, 2: 44100 };
    for (const m of moofs.slice(2)) {
      const body = Buffer.from(buf.subarray(m.at, m.at + m.size));
      for (let at = body.indexOf('tfhd'); at >= 0; at = body.indexOf('tfhd', at + 4)) {
        const track = v.getUint32(m.at + at + 8);
        const tfdt = body.indexOf('tfdt', at);
        const wide = body[tfdt + 4] === 1;
        const o = m.at + tfdt + 8 + (wide ? 4 : 0);
        v.setUint32(o, v.getUint32(o) + scale[track]);
      }
    }
    const { out, res } = await rewrite(buf);
    assert.deepEqual(packets(tmp('out-pause.mp4', out)), packets(tmp('src-pause.mp4', buf)));
    assert.ok(Math.abs(res.plan.durationMs - 7023) < 40, String(res.plan.durationMs));
    decodes(tmp('out-pause.mp4', out));
  });

  it('keeps what a recording cut short still holds', async () => {
    const buf = fixture('frag-base.mp4');
    const full = (await rewrite(buf)).res.plan;
    const moofs = boxesOf(buf).filter((b) => b.type === 'moof');
    const count = (plan) => plan.tracks.reduce((s, t) => s + t.samples, 0);
    let last = count(full);
    // Cut in the middle of the last fragment's media, then in the middle of the last fragment's header.
    for (const cut of [buf.byteLength - 900, moofs[moofs.length - 1].at + 40]) {
      const part = buf.subarray(0, cut);
      const { res, out } = await rewrite(part);
      assert.ok(res.plan.warn.length > 0);
      assert.ok(res.plan.tracks.every((t) => t.samples > 0));
      assert.ok(count(res.plan) < last, 'the samples the cut removed are gone, the rest stay');
      last = count(res.plan);
      if (hasFfmpeg) {
        const p = tmp(`out-cut-${cut}.mp4`, out);
        decodes(p);
        assert.equal(Number(format(p).streams[0].nb_read_packets), res.plan.tracks[0].samples);
      }
    }
  });

  it('refuses a file with an empty index and nothing after it', async () => {
    const buf = fixture('frag-base.mp4');
    const firstMoof = boxesOf(buf).find((b) => b.type === 'moof').at;
    await assert.rejects(lib.planMux(sourceOf(buf.subarray(0, firstMoof))), lib.MuxError);
  });

  it('refuses a fragment that points outside its media data', async () => {
    const buf = fixture('frag-base.mp4').slice();
    const trun = Buffer.from(buf).indexOf('trun');
    new DataView(buf.buffer).setInt32(trun + 12, 40); // data_offset: inside the moof itself
    await assert.rejects(lib.planMux(sourceOf(buf)), lib.MuxError);
  });
});

describe('files that are left alone or only reordered', () => {
  it('leaves an MP4 that already starts with its index, after reading only its front', async () => {
    const src = sourceOf(fixture('prog-fast.mp4'), 512);
    const res = await lib.planMux(src);
    assert.equal(res.kind, 'progressive');
    assert.equal(src.opens, 1);
  });

  it('leaves WebM and anything that is not an MP4', async () => {
    assert.equal((await lib.planMux(sourceOf(fixture('tiny.webm')))).kind, 'other');
    assert.equal((await lib.planMux(sourceOf(new Uint8Array(5000).fill(7)))).kind, 'other');
    assert.equal((await lib.planMux(sourceOf(new Uint8Array(3)))).kind, 'other');
  });

  it('moves an index at the end of the file to the front', async () => {
    const buf = fixture('prog-tail.mp4');
    assert.deepEqual(boxesOf(buf).map((b) => b.type).slice(-2), ['mdat', 'moov']);
    const { res, out } = await rewrite(buf);
    assert.equal(res.kind, 'tail');
    assert.equal(out.byteLength, buf.byteLength);
    const types = boxesOf(out).map((b) => b.type);
    assert.deepEqual(types.slice(0, 2), ['ftyp', 'moov']);
    assert.ok(types.includes('mdat'));
    if (hasFfmpeg) {
      const p = tmp('out-tail.mp4', out);
      assert.deepEqual(packets(p, true), packets(tmp('src-tail.mp4', buf), true));
      decodes(p);
    }
  });
});

describe('where source bytes land', () => {
  it('maps offsets and ranges through the kept stretches', () => {
    const ext = [100, 50, 200, 30, 400, 20];
    const map = lib.mapper(ext, 1000);
    assert.equal(map(100), 1000);
    assert.equal(map(149), 1049);
    assert.equal(map(150), -1);
    assert.equal(map(200), 1050);
    assert.equal(map(419), 1099);
    assert.equal(map(420), -1);
    assert.deepEqual(lib.dataRanges(ext, 0, 100), [[100, 50], [200, 30], [400, 20]]);
    assert.deepEqual(lib.dataRanges(ext, 40, 20), [[140, 10], [200, 10]]);
    assert.deepEqual(lib.dataRanges(ext, 80, 5), [[400, 5]]);
    assert.deepEqual(lib.dataRanges(ext, 100, 5), []);
  });
});

/* ---------------- the job against storage ---------------- */

const ID = 'c'.repeat(32);
const OWNER = 'ada@favorintl.org';

function world(name, { columns = true, mime = 'video/mp4' } = {}) {
  const DB = memoryD1();
  DB.exec(`CREATE TABLE hub_clips (id TEXT PRIMARY KEY, owner_email TEXT, owner_name TEXT DEFAULT '', title TEXT DEFAULT '', summary TEXT DEFAULT '', status TEXT, share INTEGER DEFAULT 0,
    mime TEXT, kind TEXT DEFAULT 'screen', upload_id TEXT, parts TEXT DEFAULT '[]', audio_segments TEXT DEFAULT '[]', transcript TEXT DEFAULT '', words TEXT DEFAULT '', chapters TEXT DEFAULT '',
    edits TEXT DEFAULT '', help_draft TEXT DEFAULT '', translations TEXT DEFAULT '', error TEXT, title_auto INTEGER DEFAULT 1, proc_at TEXT, size_bytes INTEGER DEFAULT 0, duration_ms INTEGER DEFAULT 0,
    has_poster INTEGER DEFAULT 0, owner_team TEXT DEFAULT '', seen TEXT DEFAULT '[]', views INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT${columns ? ", mux TEXT NOT NULL DEFAULT '', mux_info TEXT NOT NULL DEFAULT '', mux_at TEXT" : ''});
    CREATE TABLE hub_clip_frames (clip_id TEXT, t_ms INTEGER, status TEXT, app TEXT, page TEXT, text TEXT, step TEXT, created_at TEXT);
    CREATE TABLE hub_users (email TEXT PRIMARY KEY, blocked INTEGER DEFAULT 0);`);
  const CLIPS = memoryR2({ chunk: 3000 });
  const buf = fixture(name);
  CLIPS.objects.set(`clips/${ID}/video`, buf);
  const now = new Date().toISOString();
  DB.db.prepare('INSERT INTO hub_clips (id, owner_email, status, mime, size_bytes, duration_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(ID, OWNER, 'ready', mime, buf.byteLength, 6000, now, now);
  const env = { DB, CLIPS };
  const row = () => DB.db.prepare('SELECT * FROM hub_clips WHERE id = ?').get(ID);
  return { env, DB, CLIPS, buf, row, info: () => JSON.parse(row().mux_info || '{}') };
}

async function mediaOf(env, range, extra = {}) {
  const { onRequestGet } = await import('../functions/api/clips/[id]/media.ts');
  const waits = [];
  const res = await onRequestGet({
    request: new Request(`https://hub.test/api/clips/${ID}/media${extra.query || ''}`, { headers: { 'X-Hub-Email': OWNER, ...(range ? { Range: range } : {}), ...(extra.cookie ? { Cookie: extra.cookie } : {}) } }),
    env,
    params: { id: ID },
    waitUntil: (p) => waits.push(p),
  });
  const body = new Uint8Array(await res.arrayBuffer());
  await Promise.all(waits);
  return { res, body, waits };
}

describe('the fast-start job', () => {
  it('reads the recording once, then serves the new layout before the new file exists', async () => {
    const w = world('frag-base.mp4');
    const want = (await rewrite(w.buf)).out;
    assert.equal(await job.muxStep(w.env, ID, { stage: 'plan' }), 'plan');
    assert.equal(w.row().mux, 'plan');
    assert.equal(w.row().mux_at, null);
    // As if another run were writing the file right now, so the requests below only read.
    w.DB.db.prepare('UPDATE hub_clips SET mux_at = ? WHERE id = ?').run(new Date().toISOString(), ID);
    assert.ok(w.CLIPS.objects.has(`clips/${ID}/mux/head`) && w.CLIPS.objects.has(`clips/${ID}/mux/plan.json`));
    assert.ok(!w.CLIPS.objects.has(`clips/${ID}/video.fast`));
    const info = w.info();
    assert.equal(info.total, want.byteLength);
    assert.equal(info.tracks.length, 2);

    const whole = await mediaOf(w.env, null);
    assert.equal(whole.res.status, 200);
    assert.equal(whole.res.headers.get('Content-Length'), String(want.byteLength));
    assert.ok(Buffer.from(whole.body).equals(want));
    const headLen = info.headLen;
    // Inside the head, across the head and the media, across the gaps between fragments, the last bytes, and an open end.
    for (const [a, b] of [[0, 99], [headLen - 10, headLen + 10], [headLen + 5, headLen + 30000], [want.byteLength - 50, want.byteLength - 1], [20000, want.byteLength - 1]]) {
      const got = await mediaOf(w.env, `bytes=${a}-${b}`);
      assert.equal(got.res.status, 206);
      assert.equal(got.res.headers.get('Content-Range'), `bytes ${a}-${b}/${want.byteLength}`);
      assert.equal(got.res.headers.get('ETag'), info.etag);
      assert.ok(Buffer.from(got.body).equals(want.subarray(a, b + 1)), `bytes ${a}-${b}`);
    }
    assert.equal((await mediaOf(w.env, `bytes=${want.byteLength}-`)).res.status, 416);
  });

  it('writes the new file over several short runs, checks it and serves the same bytes under the same ETag', async () => {
    const w = world('frag-base.mp4');
    const want = (await rewrite(w.buf)).out;
    await job.muxStep(w.env, ID, { stage: 'plan' });
    const etag = w.info().etag;
    // A budget of nothing: each run writes one part and stops.
    const states = [];
    for (let i = 0; i < 10 && states[states.length - 1] !== 'done'; i++) {
      states.push(await job.muxStep(w.env, ID, { budgetMs: -1, partBytes: 25000, atOnce: 1 }));
      if (states[states.length - 1] === 'plan') {
        assert.equal(w.info().upload.parts.length, states.length);
        assert.equal(w.row().mux_at, null, 'the clip is free for the next run');
      }
    }
    assert.deepEqual(states, ['plan', 'plan', 'done']);
    assert.ok(Buffer.from(w.CLIPS.objects.get(`clips/${ID}/video.fast`)).equals(want));
    assert.ok(w.CLIPS.objects.has(`clips/${ID}/video`), 'the first recording is kept');
    assert.ok(!w.CLIPS.objects.has(`clips/${ID}/mux/head`) && !w.CLIPS.objects.has(`clips/${ID}/mux/plan.json`));
    assert.equal(w.row().size_bytes, want.byteLength);
    assert.equal(w.info().upload, undefined);
    const got = await mediaOf(w.env, 'bytes=100-40099');
    assert.equal(got.res.headers.get('ETag'), etag);
    assert.ok(Buffer.from(got.body).equals(want.subarray(100, 40100)));
    assert.equal(await job.muxStep(w.env, ID), 'done');
  });

  it('writes several parts at the same time and still builds the same file', async () => {
    const w = world('frag-base.mp4');
    const want = (await rewrite(w.buf)).out;
    assert.equal(await job.muxStep(w.env, ID, { partBytes: 7000, atOnce: 3 }), 'done');
    assert.equal(w.CLIPS.log.filter((l) => l.startsWith('part ')).length, Math.ceil(want.byteLength / 7000));
    assert.ok(Buffer.from(w.CLIPS.objects.get(`clips/${ID}/video.fast`)).equals(want));
  });

  it('a request for the video starts the job for a clip that has not been looked at', async () => {
    const w = world('frag-base.mp4');
    const first = await mediaOf(w.env, 'bytes=0-9');
    assert.ok(Buffer.from(first.body).equals(w.buf.subarray(0, 10)), 'the first answer is the recording as stored');
    assert.equal(first.waits.length, 1);
    assert.equal(w.row().mux, 'done');
    const next = await mediaOf(w.env, 'bytes=0-9');
    assert.equal(next.waits.length, 0);
    assert.equal(String.fromCharCode(...next.body.subarray(4, 8)), 'ftyp');
  });

  it('someone in the middle of the stored recording keeps getting it after the clip changes', async () => {
    const w = world('frag-base.mp4');
    const want = (await rewrite(w.buf)).out;
    // The play starts on the recording as stored: the answer marks the browser, and the job runs behind it.
    const first = await mediaOf(w.env, 'bytes=0-');
    assert.ok(Buffer.from(first.body).equals(w.buf));
    const set = first.res.headers.get('Set-Cookie');
    assert.match(set, /^clipsrc=o; Path=\/api\/clips\/c{32}\/; Max-Age=600; Secure; HttpOnly; SameSite=Lax$/);
    assert.equal(w.row().mux, 'done');
    const cookie = 'favor_hub=x; clipsrc=o';
    // The same play asks for more by position, then comes back to byte 0: still the stored recording, and the mark is kept alive.
    for (const [range, a, b] of [['bytes=30000-30099', 30000, 30100], ['bytes=0-', 0, w.buf.byteLength]]) {
      const more = await mediaOf(w.env, range, { cookie });
      assert.ok(Buffer.from(more.body).equals(w.buf.subarray(a, b)), range);
      assert.equal(more.res.headers.get('Content-Range'), `bytes ${a}-${b - 1}/${w.buf.byteLength}`);
      assert.equal(more.res.headers.get('Set-Cookie'), set);
    }
    // A viewer without the mark gets the new file, and is not marked.
    const fresh = await mediaOf(w.env, 'bytes=30000-30099');
    assert.ok(Buffer.from(fresh.body).equals(want.subarray(30000, 30100)));
    assert.equal(fresh.res.headers.get('Set-Cookie'), null);
    // Once the stored recording is gone, the mark means nothing.
    w.CLIPS.objects.delete(`clips/${ID}/video`);
    const late = await mediaOf(w.env, 'bytes=0-', { cookie });
    assert.ok(Buffer.from(late.body).equals(want));
    assert.equal(late.res.headers.get('Set-Cookie'), null);
    // WebM never changes, so it is never marked.
    const webm = world('tiny.webm', { mime: 'video/webm' });
    assert.equal((await mediaOf(webm.env, 'bytes=0-')).res.headers.get('Set-Cookie'), null);
  });

  it('throws a new file away when it does not match the recording, and the clip still plays', async () => {
    const w = world('frag-base.mp4');
    const want = (await rewrite(w.buf)).out;
    w.CLIPS.onPart = (n, bytes) => {
      bytes[bytes.byteLength - 20] ^= 0xff;
    };
    assert.equal(await job.muxStep(w.env, ID), 'plan');
    assert.ok(!w.CLIPS.objects.has(`clips/${ID}/video.fast`));
    assert.equal(w.info().tries, 1);
    assert.match(w.info().error, /differs from the recording/);
    // Watching it serves the new layout from the plan and starts the second try.
    assert.ok(Buffer.from((await mediaOf(w.env, null)).body).equals(want));
    assert.equal(w.info().tries, 2);
    // After three failures the job stops trying on its own.
    await job.muxStep(w.env, ID);
    assert.equal(w.info().tries, 3);
    const parts = w.CLIPS.log.filter((l) => l.startsWith('part ')).length;
    await job.muxStep(w.env, ID);
    assert.equal(job.muxPending(w.row()), false);
    assert.equal(w.CLIPS.log.filter((l) => l.startsWith('part ')).length, parts);
    w.CLIPS.onPart = null;
  });

  it('marks WebM and already progressive files as nothing to do', async () => {
    for (const [name, mime] of [['tiny.webm', 'video/webm'], ['prog-fast.mp4', 'video/mp4']]) {
      const w = world(name, { mime });
      assert.equal(await job.muxStep(w.env, ID), 'skip');
      assert.equal(job.muxPending(w.row()), false);
      const got = await mediaOf(w.env, null);
      assert.equal(got.waits.length, 0);
      assert.ok(Buffer.from(got.body).equals(w.buf));
      assert.equal(got.res.headers.get('Content-Type'), mime);
    }
  });

  it('records why a broken MP4 was left as it is', async () => {
    const w = world('frag-base.mp4');
    const firstMoof = boxesOf(w.buf).find((b) => b.type === 'moof').at;
    w.CLIPS.objects.set(`clips/${ID}/video`, w.buf.subarray(0, firstMoof));
    assert.equal(await job.muxStep(w.env, ID), 'error');
    assert.match(w.info().error, /no fragments/);
    assert.equal(w.row().error, null, 'the viewer-facing error is untouched');
    assert.equal((await mediaOf(w.env, null)).body.byteLength, firstMoof);
  });

  it('moves the index of an uploaded file to the front', async () => {
    const w = world('prog-tail.mp4');
    assert.equal(await job.muxStep(w.env, ID), 'done');
    assert.equal(w.info().kind, 'tail');
    const out = w.CLIPS.objects.get(`clips/${ID}/video.fast`);
    assert.deepEqual(boxesOf(out).map((b) => b.type).slice(0, 2), ['ftyp', 'moov']);
  });

  it('does nothing, and serves the recording, while the database has no columns for it', async () => {
    const w = world('frag-base.mp4', { columns: false });
    assert.equal(await job.muxStep(w.env, ID), null);
    const got = await mediaOf(w.env, null);
    assert.equal(got.waits.length, 0);
    assert.ok(Buffer.from(got.body).equals(w.buf));
  });

  it('stops and leaves no upload behind when the clip is deleted while it runs', async () => {
    const w = world('frag-base.mp4');
    w.CLIPS.onPart = () => w.DB.db.prepare('DELETE FROM hub_clips WHERE id = ?').run(ID);
    assert.equal(await job.muxStep(w.env, ID, { partBytes: 25000 }), null);
    assert.equal(w.CLIPS.uploads.size, 0);
    assert.ok(!w.CLIPS.objects.has(`clips/${ID}/video.fast`));
  });

  it('a second run leaves a clip another run holds', async () => {
    const w = world('frag-base.mp4');
    w.DB.db.prepare('UPDATE hub_clips SET mux_at = ? WHERE id = ?').run(new Date().toISOString(), ID);
    assert.equal(await job.muxStep(w.env, ID), '');
    assert.equal(w.CLIPS.log.length, 0);
    w.DB.db.prepare('UPDATE hub_clips SET mux_at = ? WHERE id = ?').run(new Date(Date.now() - 120000).toISOString(), ID);
    assert.equal(await job.muxStep(w.env, ID), 'done');
  });

  it('removes the first recording a week after the new file passed its checks', async () => {
    const w = world('frag-base.mp4');
    await job.muxStep(w.env, ID);
    await job.muxTidy(w.env);
    assert.ok(w.CLIPS.objects.has(`clips/${ID}/video`));
    w.DB.db.prepare('UPDATE hub_clips SET mux_at = ? WHERE id = ?').run(new Date(Date.now() - job.KEEP_ORIGINAL_MS - 60000).toISOString(), ID);
    await job.muxTidy(w.env);
    assert.ok(!w.CLIPS.objects.has(`clips/${ID}/video`));
    assert.equal(w.row().mux, 'final');
    assert.equal(String.fromCharCode(...(await mediaOf(w.env, 'bytes=0-9')).body.subarray(4, 8)), 'ftyp');
  });
});

describe('routes', () => {
  it('finishing an upload leaves the clip in the new layout before the answer goes back', async () => {
    const w = world('frag-base.mp4');
    // Put the recording back into an open multipart upload, the way the recorder leaves it.
    w.CLIPS.objects.delete(`clips/${ID}/video`);
    const up = await w.CLIPS.createMultipartUpload(`clips/${ID}/video`);
    const part = await w.CLIPS.resumeMultipartUpload(`clips/${ID}/video`, up.uploadId).uploadPart(1, w.buf);
    w.DB.db.prepare("UPDATE hub_clips SET status = 'uploading', upload_id = ?, parts = ? WHERE id = ?").run(up.uploadId, JSON.stringify([{ n: 1, etag: part.etag, size: w.buf.byteLength }]), ID);
    const { onRequestPost } = await import('../functions/api/clips/[id]/complete.ts');
    const waits = [];
    const res = await onRequestPost({
      request: new Request(`https://hub.test/api/clips/${ID}/complete`, { method: 'POST', headers: { 'X-Hub-Email': OWNER, 'Content-Type': 'application/json' }, body: JSON.stringify({ durationMs: 6000 }) }),
      env: w.env,
      params: { id: ID },
      waitUntil: (p) => waits.push(p),
    });
    assert.equal(res.status, 200);
    assert.ok(['plan', 'done'].includes(w.row().mux), `state ${w.row().mux}`);
    await Promise.all(waits);
    assert.equal(w.row().mux, 'done');
    assert.equal(w.row().status, 'ready');
  });

  it('an admin runs the job for clips that are waiting; staff may not', async () => {
    const w = world('frag-base.mp4');
    const { onRequestPost, onRequestGet } = await import('../functions/api/clips/mux.ts');
    const as = (role, method, body) => new Request('https://hub.test/api/clips/mux', { method, headers: { 'X-Hub-Email': role === 'admin' ? 'admin@favorintl.org' : OWNER, 'X-Hub-Role': role, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await onRequestPost({ request: as('staff', 'POST', {}), env: w.env })).status, 403);
    const before = await (await onRequestGet({ request: as('admin', 'GET'), env: w.env })).json();
    assert.equal(before.open.length, 1);
    const ran = await (await onRequestPost({ request: as('admin', 'POST', {}), env: w.env })).json();
    assert.equal(ran.id, ID);
    assert.equal(ran.state, 'done');
    assert.equal(ran.left, 0);
    assert.equal((await (await onRequestPost({ request: as('admin', 'POST', {}), env: w.env })).json()).id, null);
    // A failed clip is taken again only when asked.
    w.DB.db.prepare("UPDATE hub_clips SET mux = 'error', mux_info = '{\"error\":\"x\"}' WHERE id = ?").run(ID);
    assert.equal((await (await onRequestPost({ request: as('admin', 'POST', {}), env: w.env })).json()).id, null);
    assert.equal((await (await onRequestPost({ request: as('admin', 'POST', { retry: true }), env: w.env })).json()).state, 'done');
  });
});
